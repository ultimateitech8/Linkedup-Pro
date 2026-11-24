import { z } from 'zod';
import { db, emailEnabled } from './database.js';

const filterText = z.string().trim().max(120).default('');
const flag = z.enum(['1', '0']).optional().transform((value) => value === '1');
const pageFilter = z.coerce.number().int().min(0).max(100000).default(0);
const pageSize = 20;

export const leadFilters = z.object({
  q: filterText, location: filterText, company: filterText,
  relationship: z.enum(['connected', 'mutual', 'outside']).optional(),
  leaders: flag, recommended: flag, offset: pageFilter
});
export const accountFilters = z.object({
  q: filterText, location: filterText, industry: filterText,
  size: filterText, workplace: z.enum(['Remote', 'Hybrid', 'On-site', 'Varies by role']).optional(),
  hiring: flag, offset: pageFilter
});

const leadFrom = `FROM "user" u LEFT JOIN profiles p ON p.user_id=u.id
  LEFT JOIN LATERAL (
    SELECT c.id,c.name,(c.owner_id=u.id) AS owner
    FROM company_members m JOIN professional_companies c ON c.id=m.company_id
    WHERE m.user_id=u.id AND m.role IN ('employee','admin')
    ORDER BY (c.owner_id=u.id) DESC,(m.role='admin') DESC,c.id LIMIT 1
  ) company ON true`;
const leadFields = `u.id,u.name,u.image,COALESCE(p.headline,'') AS headline,COALESCE(p.location,'') AS location,
  COALESCE(p.skills,'{}') AS skills,company.id AS "companyId",company.name AS "companyName"`;
const isLeader = `(COALESCE(company.owner,false) OR COALESCE(p.headline,'') ~*
  '(^|[^[:alnum:]])(founder|owner|ceo|cto|cfo|coo|president|vice president|vp|head of|director|chief)([^[:alnum:]]|$)')`;

export async function searchSalesLeads(userId: string, filters: z.output<typeof leadFilters>) {
  const { rows } = await db.query(`WITH edges AS NOT MATERIALIZED (
      SELECT sender AS member,recipient AS peer FROM connections WHERE accepted
      UNION ALL SELECT recipient AS member,sender AS peer FROM connections WHERE accepted
    ), network AS (
      SELECT peer FROM edges WHERE member=$1
    ), mutuals AS (
      SELECT edges.peer,count(*)::int AS count FROM network JOIN edges ON edges.member=network.peer GROUP BY edges.peer
    )
    SELECT ${leadFields}, saved.lead_id IS NOT NULL AS saved,
      CASE WHEN direct.peer IS NOT NULL THEN 'connected' WHEN mutual.count>0 THEN 'mutual' ELSE 'outside' END AS relationship,
      COALESCE(mutual.count,0) AS "mutualCount", match.skills AS "matchedSkills",
      CASE WHEN company.owner THEN 'Company page owner' WHEN ${isLeader} THEN 'Leadership title' END AS "leadershipSignal"
    ${leadFrom}
    LEFT JOIN network direct ON direct.peer=u.id LEFT JOIN mutuals mutual ON mutual.peer=u.id
    LEFT JOIN sales_leads saved ON saved.user_id=$1 AND saved.lead_id=u.id
    LEFT JOIN profiles viewer ON viewer.user_id=$1
    CROSS JOIN LATERAL (
      SELECT ARRAY(SELECT DISTINCT skill FROM unnest(p.skills) skill
        WHERE EXISTS(SELECT 1 FROM unnest(viewer.skills) wanted WHERE lower(wanted)=lower(skill))) AS skills
    ) match
    WHERE u.id<>$1 AND ($10 OR u."emailVerified")
      AND ($2='' OR strpos(lower(concat_ws(' ',u.name,p.headline,array_to_string(p.skills,' '),company.name)),lower($2))>0)
      AND ($3='' OR strpos(lower(COALESCE(p.location,'')),lower($3))>0)
      AND ($4='' OR EXISTS (SELECT 1 FROM company_members team JOIN professional_companies c ON c.id=team.company_id
        WHERE team.user_id=u.id AND team.role IN ('employee','admin') AND strpos(lower(c.name),lower($4))>0))
      AND ($5::text IS NULL OR $5=CASE WHEN direct.peer IS NOT NULL THEN 'connected' WHEN mutual.count>0 THEN 'mutual' ELSE 'outside' END)
      AND (NOT $6 OR ${isLeader})
      AND (NOT $7 OR ((direct.peer IS NOT NULL OR mutual.count>0 OR cardinality(match.skills)>0) AND saved.lead_id IS NULL))
    ORDER BY (direct.peer IS NOT NULL) DESC,cardinality(match.skills) DESC,COALESCE(mutual.count,0) DESC,lower(u.name),u.id
    LIMIT $8 OFFSET $9`,
  [userId, filters.q, filters.location, filters.company, filters.relationship, filters.leaders, filters.recommended,
    pageSize + 1, filters.offset, !emailEnabled]);
  return { results: rows.slice(0, pageSize), next: rows.length > pageSize ? filters.offset + pageSize : null };
}

const accountFields = `c.id,c.name,c.description,c.industry,c.size,c.headquarters,c.workplace,c.logo IS NOT NULL AS "hasLogo",
  c.updated_at AS "updatedAt",activity.jobs AS "openJobs",activity.recent AS "newJobs",
  (SELECT count(*)::int FROM posts p WHERE p.company_id=c.id AND p.hidden_at IS NULL AND p.company_hidden_at IS NULL
    AND p.created_at>=now()-interval '30 days') AS "recentUpdates"`;
const accountActivity = `CROSS JOIN LATERAL (
  SELECT count(*)::int AS jobs,count(*) FILTER(WHERE j.created_at>=now()-interval '30 days')::int AS recent
  FROM jobs j WHERE j.company_id=c.id AND NOT j.closed
) activity`;

export async function searchSalesAccounts(userId: string, filters: z.output<typeof accountFilters>) {
  const { rows } = await db.query(`SELECT ${accountFields}, saved.company_id IS NOT NULL AS saved
    FROM professional_companies c ${accountActivity}
    LEFT JOIN sales_accounts saved ON saved.user_id=$1 AND saved.company_id=c.id
    WHERE ($2='' OR strpos(lower(concat_ws(' ',c.name,c.description,c.industry)),lower($2))>0)
      AND ($3='' OR strpos(lower(concat_ws(' ',c.headquarters,array_to_string(c.locations,' '))),lower($3))>0)
      AND ($4='' OR strpos(lower(c.industry),lower($4))>0)
      AND ($5='' OR c.size=$5) AND ($6::text IS NULL OR c.workplace=$6)
      AND (NOT $7 OR activity.jobs>0)
    ORDER BY lower(c.name),c.id LIMIT $8 OFFSET $9`,
  [userId, filters.q, filters.location, filters.industry, filters.size, filters.workplace, filters.hiring,
    pageSize + 1, filters.offset]);
  return { results: rows.slice(0, pageSize), next: rows.length > pageSize ? filters.offset + pageSize : null };
}

export async function savedSalesLeads(userId: string) {
  const { rows } = await db.query(`SELECT ${leadFields},s.stage,s.notes,s.follow_up_at AS "followUpAt",
    CASE WHEN EXISTS (SELECT 1 FROM connections WHERE accepted AND
      ((sender=$1 AND recipient=u.id) OR (sender=u.id AND recipient=$1))) THEN 'connected' ELSE 'outside' END AS relationship
    ${leadFrom} JOIN sales_leads s ON s.user_id=$1 AND s.lead_id=u.id
    WHERE $2 OR u."emailVerified" ORDER BY s.updated_at DESC,u.id`, [userId, !emailEnabled]);
  return rows;
}

export async function savedSalesAccounts(userId: string) {
  const { rows } = await db.query(`SELECT ${accountFields},s.watched_at IS NOT NULL AS watching
    FROM sales_accounts s JOIN professional_companies c ON c.id=s.company_id ${accountActivity}
    WHERE s.user_id=$1 ORDER BY lower(c.name),c.id`, [userId]);
  return rows;
}
