import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { positiveId } from './access.js';
import { managesCompany } from './company-access.js';
import { db } from './database.js';
import type { Cover } from './publication-cover.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).default('');
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048).refine((value) => {
  const address = new URL(value);
  return !address.username && !address.password;
}, 'Use an HTTPS website without sign-in credentials in the URL.');

export const campaignInput = z.object({
  companyId: positiveId, name: text(100), format: z.enum(['Sponsored post', 'Single image', 'Text']),
  postId: positiveId.nullable(), headline: optional(100), body: optional(1400), imageAlt: optional(240),
  objective: z.enum(['company', 'website', 'lead']), destination: z.union([z.literal(''), httpsUrl]).default(''), buttonLabel: text(30),
  targetLocation: optional(100), targetSkills: z.array(text(50)).max(8).default([]), followersOnly: z.boolean(),
  budget: z.number().int().min(1).max(1000000),
  startsAt: z.iso.datetime().nullable(), endsAt: z.iso.datetime().nullable()
}).superRefine((entry, context) => {
  const message = entry.format === 'Sponsored post' && !entry.postId ? 'Choose a company update to sponsor.' :
    entry.format !== 'Sponsored post' && (!entry.headline || !entry.body) ? 'Add a headline and body text.' :
    entry.format === 'Single image' && !entry.imageAlt ? 'Describe the image for members using screen readers.' :
    entry.objective === 'website' && !entry.destination ? 'Enter an HTTPS website for this call to action.' :
    entry.startsAt && entry.endsAt && new Date(entry.startsAt) >= new Date(entry.endsAt) ? 'Choose an end time after the start time.' : '';
  if (message) context.addIssue({ code: 'custom', message });
});
type CampaignInput = z.output<typeof campaignInput>;

export const campaignAction = z.enum(['publish', 'pause', 'resume', 'end']);
const actions = {
  publish: { before: ['draft'], next: 'active' },
  pause: { before: ['active'], next: 'paused' },
  resume: { before: ['paused'], next: 'active' },
  end: { before: ['active', 'paused'], next: 'ended' }
};

export const visibleSourcePost = 'p.id IS NOT NULL AND p.hidden_at IS NULL AND p.company_hidden_at IS NULL';
export const availableCreative = `(a.format<>'Sponsored post' OR (${visibleSourcePost} AND p.company_id=a.company_id))`;
const selectedCampaign = `FROM ad_campaigns a JOIN professional_companies c ON c.id=a.company_id
  LEFT JOIN posts p ON p.id=a.post_id`;
const campaignFields = `a.id,a.company_id AS "companyId",c.name AS "companyName",a.name,a.format,a.post_id AS "postId",
  a.headline,CASE WHEN a.format='Sponsored post' THEN CASE WHEN ${availableCreative} THEN p.body END ELSE a.body END AS body,
  a.image IS NOT NULL AS "hasImage",a.image_alt AS "imageAlt",a.objective,a.destination,a.button_label AS "buttonLabel",
  a.target_location AS "targetLocation",a.target_skills AS "targetSkills",a.followers_only AS "followersOnly",
  a.budget,a.delivered,a.starts_at AS "startsAt",a.ends_at AS "endsAt",a.state,
  CASE WHEN a.state='draft' THEN 'Draft' WHEN a.state='ended' OR a.ends_at<=now() THEN 'Ended'
    WHEN a.delivered>=a.budget THEN 'Budget reached' WHEN NOT ${availableCreative} THEN 'Post unavailable'
    WHEN a.state='paused' THEN 'Paused' WHEN a.starts_at>now() THEN 'Scheduled' ELSE 'Running' END AS status,
  activity.reach,activity.clicks,
  (SELECT count(*)::int FROM ad_leads lead WHERE lead.campaign_id=a.id) AS "leadCount"`;
const metrics = `CROSS JOIN LATERAL (
  SELECT count(DISTINCT viewer_id)::int AS reach,count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicks
  FROM ad_deliveries d WHERE d.campaign_id=a.id
) activity`;

export async function advertisingWorkspace(member: string) {
  const [companies, campaigns] = await Promise.all([
    db.query(`SELECT c.id,c.name FROM professional_companies c WHERE ${managesCompany('c.id', '$1')} ORDER BY lower(c.name),c.id`, [member]),
    db.query(`SELECT ${campaignFields} ${selectedCampaign} ${metrics}
      WHERE ${managesCompany('a.company_id', '$1')} ORDER BY a.id DESC`, [member])
  ]);
  return { companies: companies.rows, campaigns: campaigns.rows };
}

export async function adSourcePosts(member: string, company: number) {
  const { rows } = await db.query(`SELECT p.id,p.body,p.created_at AS "createdAt" FROM posts p
    WHERE p.company_id=$2 AND ${visibleSourcePost} AND ${managesCompany('p.company_id', '$1')}
    ORDER BY p.created_at DESC,p.id DESC`, [member, company]);
  return rows;
}

function campaignValues(input: CampaignInput, image?: Cover) {
  const sponsored = input.format === 'Sponsored post';
  const skills = Array.from(new Map(input.targetSkills.map((skill) => [skill.toLowerCase(), skill])).values());
  return [
    input.companyId, input.name, input.format, sponsored ? input.postId : null, sponsored ? '' : input.headline,
    sponsored ? '' : input.body, input.format === 'Single image' ? image?.content ?? null : null,
    input.format === 'Single image' ? image?.mime ?? null : null, input.format === 'Single image' ? input.imageAlt : '',
    input.objective, input.objective === 'website' ? input.destination : null, input.buttonLabel, input.targetLocation,
    skills, input.followersOnly, input.budget, input.startsAt, input.endsAt
  ];
}

export async function saveAdCampaign(member: string, input: CampaignInput, image: Cover | undefined, id?: number) {
  const parameters = [member, ...campaignValues(input, image)];
  const validPost = `($5::int IS NULL OR EXISTS(SELECT 1 FROM posts p WHERE p.id=$5 AND p.company_id=$2 AND ${visibleSourcePost}))`;
  const authorizedCompany = managesCompany('$2', '$1');
  if (!id) {
    if (input.format === 'Single image' && !image) throw new BadRequestException('Add an image to this campaign.');
    const { rows: [campaign] } = await db.query<{ id: number }>(`INSERT INTO ad_campaigns
      (company_id,name,format,post_id,headline,body,image,image_type,image_alt,objective,destination,button_label,
        target_location,target_skills,followers_only,budget,starts_at,ends_at)
      SELECT $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      WHERE ${authorizedCompany} AND ${validPost} RETURNING id`, parameters);
    if (!campaign) throw new NotFoundException('The company or selected update is unavailable.');
    return campaign;
  }

  const { rows: [campaign] } = await db.query<{ id: number }>(`UPDATE ad_campaigns a SET name=$3,format=$4,post_id=$5,headline=$6,body=$7,
    image=CASE WHEN $4='Single image' THEN COALESCE($8::bytea,a.image) END,
    image_type=CASE WHEN $4='Single image' THEN COALESCE($9::text,a.image_type) END,image_alt=$10,
    objective=$11,destination=$12,button_label=$13,target_location=$14,target_skills=$15,followers_only=$16,budget=$17,
    starts_at=$18,ends_at=$19 WHERE a.id=$20 AND a.company_id=$2 AND a.state='draft' AND ${authorizedCompany}
      AND ${validPost} AND ($4<>'Single image' OR $8::bytea IS NOT NULL OR a.image IS NOT NULL) RETURNING a.id`, [...parameters, id]);
  if (!campaign) throw new ConflictException('This draft or creative is unavailable. Check the company, update, and image.');
  return campaign;
}

export async function changeAdCampaign(member: string, id: number, action: z.output<typeof campaignAction>) {
  const step = actions[action];
  const { rowCount } = await db.query(`UPDATE ad_campaigns a SET state=$3,
    starts_at=CASE WHEN $3='active' THEN COALESCE(a.starts_at,now()) ELSE a.starts_at END
    WHERE a.id=$2 AND ${managesCompany('a.company_id', '$1')}
      AND a.state=ANY($4::text[])
      AND ($3<>'active' OR (a.delivered<a.budget AND (a.ends_at IS NULL OR a.ends_at>greatest(now(),a.starts_at))
        AND (a.format<>'Sponsored post' OR EXISTS(SELECT 1 FROM posts p WHERE p.id=a.post_id AND p.company_id=a.company_id AND ${visibleSourcePost}))))`,
  [member, id, step.next, step.before]);
  if (!rowCount) throw new ConflictException('This campaign is unavailable for that action. Check the schedule, budget, and sponsored update.');
  return { ok: true };
}

export async function deleteAdDraft(member: string, id: number) {
  const { rowCount } = await db.query(`DELETE FROM ad_campaigns a WHERE a.id=$2 AND a.state='draft'
    AND ${managesCompany('a.company_id', '$1')}`, [member, id]);
  if (!rowCount) throw new NotFoundException('This campaign draft is unavailable.');
  return { ok: true };
}

export async function adCampaignReport(member: string, id: number) {
  const { rows: [campaign] } = await db.query(`
    SELECT ${campaignFields},
      (SELECT json_agg(json_build_object('day',stats.day,'deliveries',stats.deliveries,'clicks',stats.clicks) ORDER BY stats.day)
        FROM (
          SELECT day::date AS day,count(i.id)::int AS deliveries,count(i.clicked_at)::int AS clicks
          FROM generate_series((now() AT TIME ZONE 'UTC')::date-13,(now() AT TIME ZONE 'UTC')::date,interval '1 day') day
          LEFT JOIN ad_deliveries i ON i.campaign_id=a.id AND i.delivery_day=day::date GROUP BY day
        ) stats) AS daily
    ${selectedCampaign} ${metrics} WHERE a.id=$2 AND ${managesCompany('a.company_id', '$1')}`, [member, id]);
  if (!campaign) throw new NotFoundException('This campaign is unavailable.');
  return campaign;
}

export async function adCampaignLeads(member: string, id: number, offset: number) {
  const { rows: [result] } = await db.query(`SELECT COALESCE((
    SELECT json_agg(entries ORDER BY entries."consentedAt" DESC,entries.id)
    FROM (
      SELECT l.delivery_id AS id,l.name,l.email,l.message,l.consented_at AS "consentedAt" FROM ad_leads l
      WHERE l.campaign_id=a.id ORDER BY l.consented_at DESC,l.delivery_id LIMIT 26 OFFSET $3
    ) entries
  ),'[]') AS leads FROM ad_campaigns a WHERE a.id=$2 AND ${managesCompany('a.company_id', '$1')}`, [member, id, offset]);
  if (!result) throw new NotFoundException('This campaign is unavailable.');
  return { leads: result.leads.slice(0, 25), next: result.leads.length > 25 ? offset + 25 : null };
}

export async function adCampaignImage(member: string, id: number) {
  const { rows: [file] } = await db.query<Cover>(`SELECT a.image AS content,a.image_type AS mime FROM ad_campaigns a
    WHERE a.id=$2 AND a.image IS NOT NULL AND ${managesCompany('a.company_id', '$1')}`, [member, id]);
  if (!file) throw new NotFoundException('This campaign image is unavailable.');
  return file;
}
