import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from './database.js';
import { managesCompany } from './company-access.js';
import { availableCreative } from './advertising.js';
import type { Cover } from './publication-cover.js';

const utcDay = "(now() AT TIME ZONE 'UTC')::date";

export async function claimFeedAd(member: string) {
  const { rows: [ad] } = await db.query(`
    WITH available AS (
      SELECT a.id FROM ad_campaigns a LEFT JOIN posts p ON p.id=a.post_id
      LEFT JOIN profiles profile ON profile.user_id=$1
      WHERE a.state='active' AND a.starts_at<=now() AND (a.ends_at IS NULL OR a.ends_at>now()) AND a.delivered<a.budget
        AND ${availableCreative} AND NOT ${managesCompany('a.company_id', '$1')}
        AND (a.target_location='' OR strpos(lower(COALESCE(profile.location,'')),lower(a.target_location))>0)
        AND (cardinality(a.target_skills)=0 OR EXISTS (
          SELECT 1 FROM unnest(a.target_skills) wanted JOIN unnest(profile.skills) skill ON lower(wanted)=lower(skill)
        ))
        AND (NOT a.followers_only OR EXISTS (SELECT 1 FROM company_followers f WHERE f.company_id=a.company_id AND f.user_id=$1))
        AND NOT EXISTS (SELECT 1 FROM ad_deliveries previous WHERE previous.campaign_id=a.id
          AND previous.viewer_id=$1 AND previous.delivery_day=${utcDay})
      ORDER BY a.delivered::float8/a.budget,a.id LIMIT 1 FOR UPDATE OF a SKIP LOCKED
    ), shown AS (
      INSERT INTO ad_deliveries(id,campaign_id,viewer_id,delivery_day)
      SELECT $2,id,$1,${utcDay} FROM available ON CONFLICT (campaign_id,viewer_id,delivery_day) DO NOTHING RETURNING id,campaign_id
    ), counted AS (
      UPDATE ad_campaigns a SET delivered=delivered+1 FROM shown WHERE a.id=shown.campaign_id
      RETURNING a.id,a.company_id,a.format,a.post_id,a.headline,a.body,a.image IS NOT NULL AS "hasImage",a.image_alt,a.objective,a.button_label,shown.id AS delivery_id
    ) SELECT counted.delivery_id AS id,counted.headline,
      CASE WHEN counted.format='Sponsored post' THEN p.body ELSE counted.body END AS body,
      counted."hasImage",counted.image_alt AS "imageAlt",counted.objective,counted.button_label AS "buttonLabel",
      json_build_object('id',c.id,'name',c.name,'hasLogo',c.logo IS NOT NULL,'updatedAt',c.updated_at) AS company,
      EXISTS (SELECT 1 FROM ad_leads l WHERE l.campaign_id=counted.id AND l.member_id=$1) AS converted
    FROM counted JOIN professional_companies c ON c.id=counted.company_id LEFT JOIN posts p ON p.id=counted.post_id`, [member, randomUUID()]);
  return { ad: ad ?? null };
}

const deliveredCampaign = `JOIN ad_campaigns a ON a.id=d.campaign_id LEFT JOIN posts p ON p.id=a.post_id`;

export async function clickFeedAd(member: string, id: string) {
  const { rows: [destination] } = await db.query(`
    WITH clicked AS (
      UPDATE ad_deliveries d SET clicked_at=COALESCE(clicked_at,now())
      FROM ad_campaigns a LEFT JOIN posts p ON p.id=a.post_id
      WHERE d.id=$2 AND d.viewer_id=$1 AND d.campaign_id=a.id AND ${availableCreative}
      RETURNING a.objective,a.destination,a.company_id AS "companyId"
    ) SELECT * FROM clicked`, [member, id]);
  if (!destination) throw new NotFoundException('This sponsored placement is unavailable.');
  return destination;
}

export async function submitAdLead(member: { id: string; name: string; email: string }, id: string, message: string) {
  const { rows: [delivery] } = await db.query(`
    WITH clicked AS (
      UPDATE ad_deliveries d SET clicked_at=COALESCE(clicked_at,now()) FROM ad_campaigns a LEFT JOIN posts p ON p.id=a.post_id
      WHERE d.id=$2 AND d.viewer_id=$1 AND d.campaign_id=a.id AND a.objective='lead' AND ${availableCreative}
      RETURNING d.id,d.campaign_id
    ), registered AS (
      INSERT INTO ad_leads(campaign_id,member_id,delivery_id,name,email,message)
      SELECT campaign_id,$1,id,$3,$4,$5 FROM clicked ON CONFLICT(campaign_id,member_id) DO NOTHING
    ) SELECT id FROM clicked`, [member.id, id, member.name, member.email, message]);
  if (!delivery) throw new NotFoundException('This sponsored form is unavailable.');
  return { ok: true };
}

export async function deliveredAdImage(member: string, id: string) {
  const { rows: [file] } = await db.query<Cover>(`
    SELECT a.image AS content,a.image_type AS mime FROM ad_deliveries d ${deliveredCampaign}
    WHERE d.id=$2 AND d.viewer_id=$1 AND a.image IS NOT NULL`, [member, id]);
  if (!file) throw new NotFoundException('This sponsored image is unavailable.');
  return file;
}
