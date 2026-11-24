import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { recordCompanyView } from './analytics-events.js';
import { db } from './database.js';
import { jobFields } from './jobs-query.js';
import { listCompanyPosts } from './posts.js';
import type { Cover } from './publication-cover.js';
import { notifyMember } from './realtime.js';

type Role = 'none' | 'requested' | 'employee' | 'admin' | 'owner';
type BrandKind = 'logo' | 'banner';
type ImageInput = { file?: Cover; alt: string; remove: boolean };
export type CompanyInput = {
  name: string; description: string; industry: string; size: string; headquarters: string; locations: string[];
  workplace: string; website: string; culture: string; ctaLabel: string; ctaUrl: string; logo: ImageInput; banner: ImageInput;
};
export type PageInput = { kind: 'Product' | 'Showcase'; title: string; description: string; url: string };
export type MembershipDecision = 'approve' | 'decline' | 'promote' | 'demote' | 'transfer' | 'remove';

const role = "CASE WHEN c.owner_id=$1 THEN 'owner' ELSE COALESCE(member.role,'none') END";
const viewer = 'LEFT JOIN company_members member ON member.company_id=c.id AND member.user_id=$1';
const summary = `
  SELECT c.id,c.name,c.description,c.industry,c.size,c.headquarters,c.locations,c.workplace,c.website,c.culture,
    c.cta_label AS "ctaLabel",c.cta_url AS "ctaUrl",c.updated_at AS "updatedAt",
    c.logo IS NOT NULL AS "hasLogo",c.logo_alt AS "logoAlt",c.banner IS NOT NULL AS "hasBanner",c.banner_alt AS "bannerAlt",
    ${role} AS role,
    EXISTS(SELECT 1 FROM company_followers f WHERE f.company_id=c.id AND f.user_id=$1) AS following,
    (SELECT count(*)::int FROM company_followers f WHERE f.company_id=c.id) AS "followerCount",
    (SELECT count(*)::int FROM company_members m WHERE m.company_id=c.id AND m.role IN ('employee','admin')) AS "employeeCount"
  FROM professional_companies c ${viewer}`;

type CompanyRow = {
  id: number; name: string; role: Role; followerCount: number; employeeCount: number;
};
type Organization = { name: string; ownerId: string; role: Role };

function isAdmin(role: Role) { return role === 'owner' || role === 'admin'; }

async function withCompany<T>(member: string, id: number, operation: (client: PoolClient, company: Organization) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const company = (await client.query<Organization>(`
      SELECT c.name,c.owner_id AS "ownerId",${role} AS role
      FROM professional_companies c ${viewer} WHERE c.id=$2 FOR UPDATE OF c`, [member, id])).rows[0];
    if (!company) throw new NotFoundException('This company is unavailable.');
    const result = await operation(client, company);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function requireAdmin(company: Organization) {
  if (!isAdmin(company.role)) throw new ForbiddenException('Company admin access is required.');
}

const profileValues = (fields: CompanyInput) => [
  fields.name, fields.description, fields.industry, fields.size, fields.headquarters, fields.locations, fields.workplace,
  fields.website || null, fields.culture, fields.ctaLabel || null, fields.ctaUrl || null, fields.logo.alt, fields.banner.alt
];

export async function listCompanies(member: string) {
  return (await db.query(`${summary} ORDER BY lower(c.name),c.id LIMIT 200`, [member])).rows;
}

export async function createCompany(member: string, input: CompanyInput) {
  return (await db.query<{ id: number }>(
    `WITH created AS (
       INSERT INTO professional_companies(owner_id,name,description,industry,size,headquarters,locations,workplace,
         website,culture,cta_label,cta_url,logo_alt,banner_alt,logo,logo_type,banner,banner_type)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id
     ), joined AS (
       INSERT INTO company_members(company_id,user_id,role) SELECT id,$1,'admin' FROM created
     ) SELECT id FROM created`, [member, ...profileValues(input), input.logo.file?.content ?? null, input.logo.file?.mime ?? null,
      input.banner.file?.content ?? null, input.banner.file?.mime ?? null]
  )).rows[0];
}

export async function editCompany(member: string, id: number, fields: CompanyInput) {
  await withCompany(member, id, async (client, company) => {
    requireAdmin(company);
    await client.query(`
      UPDATE professional_companies SET name=$2,description=$3,industry=$4,size=$5,headquarters=$6,locations=$7,workplace=$8,
        website=$9,culture=$10,cta_label=$11,cta_url=$12,logo_alt=$13,banner_alt=$14,updated_at=now(),
        logo=CASE WHEN $15 THEN NULL WHEN $16::bytea IS NOT NULL THEN $16 ELSE logo END,
        logo_type=CASE WHEN $15 THEN NULL WHEN $17::text IS NOT NULL THEN $17 ELSE logo_type END,
        banner=CASE WHEN $18 THEN NULL WHEN $19::bytea IS NOT NULL THEN $19 ELSE banner END,
        banner_type=CASE WHEN $18 THEN NULL WHEN $20::text IS NOT NULL THEN $20 ELSE banner_type END
      WHERE id=$1`, [id, ...profileValues(fields), fields.logo.remove, fields.logo.file?.content ?? null, fields.logo.file?.mime ?? null,
      fields.banner.remove, fields.banner.file?.content ?? null, fields.banner.file?.mime ?? null]);
  });
  return { id };
}

export async function viewCompany(member: string, id: number) {
  const company = (await db.query<CompanyRow>(`${summary} WHERE c.id=$2`, [member, id])).rows[0];
  if (!company) throw new NotFoundException('This company is unavailable.');
  const manage = isAdmin(company.role);
  const [posts, jobs, team, pages, requests, stats, hidden] = await Promise.all([
    listCompanyPosts(member, id),
    db.query(`SELECT ${jobFields} FROM jobs j WHERE j.company_id=$2 AND NOT j.closed ORDER BY j.created_at DESC LIMIT 100`, [member, id]),
    db.query(`SELECT u.id,u.name,u.image,COALESCE(p.headline,'') AS headline,
      CASE WHEN c.owner_id=u.id THEN 'owner' ELSE m.role END AS role
      FROM company_members m JOIN professional_companies c ON c.id=m.company_id JOIN "user" u ON u.id=m.user_id
      LEFT JOIN profiles p ON p.user_id=u.id WHERE m.company_id=$1 AND m.role IN ('employee','admin')
      ORDER BY (c.owner_id=u.id) DESC,(m.role='admin') DESC,u.name,u.id LIMIT 150`, [id]),
    db.query('SELECT id,kind,title,description,url FROM company_showcases WHERE company_id=$1 ORDER BY id DESC LIMIT 100', [id]),
    manage ? db.query(`SELECT u.id,u.name,u.image,COALESCE(p.headline,'') AS headline,m.requested_at AS "requestedAt"
        FROM company_members m JOIN "user" u ON u.id=m.user_id LEFT JOIN profiles p ON p.user_id=u.id
        WHERE m.company_id=$1 AND m.role='requested' ORDER BY m.requested_at,u.id LIMIT 100`, [id]) : null,
    manage ? db.query(`SELECT
      (SELECT count(*)::int FROM company_visits WHERE company_id=$1) AS "visitorCount",
      (SELECT count(*)::int FROM jobs WHERE company_id=$1 AND NOT closed) AS "openJobs",
      (SELECT count(*)::int FROM posts WHERE company_id=$1 AND hidden_at IS NULL AND company_hidden_at IS NULL) AS "updateCount"`, [id]) :
      recordCompanyView(member, id),
    manage ? db.query(`SELECT id,body FROM posts WHERE company_id=$1 AND company_hidden_at IS NOT NULL AND hidden_at IS NULL
      ORDER BY company_hidden_at DESC LIMIT 100`, [id]) : null
  ]);
  return { company, posts: posts.rows, jobs: jobs.rows, team: team.rows, pages: pages.rows, requests: requests?.rows ?? [],
    analytics: manage ? { ...stats.rows[0], followerCount: company.followerCount, employeeCount: company.employeeCount } : null,
    hidden: hidden?.rows ?? [] };
}

export async function companyImage(id: number, kind: BrandKind) {
  const image = (await db.query<{ content: Buffer; mime: string }>(
    `SELECT ${kind} AS content,${kind}_type AS mime FROM professional_companies WHERE id=$1 AND ${kind} IS NOT NULL`, [id]
  )).rows[0];
  if (!image) throw new NotFoundException('This image is unavailable.');
  return image;
}

export async function setFollow(member: string, id: number, active: boolean) {
  if (active) {
    const result = await db.query(
      'INSERT INTO company_followers(company_id,user_id) SELECT id,$2 FROM professional_companies WHERE id=$1 ON CONFLICT DO NOTHING',
      [id, member]
    );
    if (!result.rowCount && !(await db.query('SELECT 1 FROM professional_companies WHERE id=$1', [id])).rowCount) {
      throw new NotFoundException('This company is unavailable.');
    }
  } else {
    await db.query('DELETE FROM company_followers WHERE company_id=$1 AND user_id=$2', [id, member]);
  }
}

async function notifyTeam(client: PoolClient, id: number, actor: string, message: string, managersOnly = false) {
  const recipients = await client.query<{ user_id: string }>(
    `INSERT INTO notifications(user_id,message,category,company_id)
     SELECT user_id,$3,'Companies',$1 FROM company_members WHERE company_id=$1 AND user_id<>$2
       AND (role='admin' OR (role='employee' AND NOT $4)) RETURNING user_id`, [id, actor, message, managersOnly]
  );
  return recipients.rows.map((row) => row.user_id);
}

export async function changeCompanyMembership(member: { id: string; name: string }, id: number, join: boolean) {
  const recipients = await withCompany(member.id, id, async (client, company) => {
    if (!join) {
      if (company.role === 'owner') throw new ConflictException('Transfer company ownership before leaving.');
      await client.query('DELETE FROM company_members WHERE company_id=$1 AND user_id=$2', [id, member.id]);
      return [];
    }
    if (company.role !== 'none') return [];
    await client.query("INSERT INTO company_members(company_id,user_id,role) VALUES($1,$2,'requested')", [id, member.id]);
    return notifyTeam(client, id, member.id, `${member.name} requested to join ${company.name}.`, true);
  });
  recipients.forEach(notifyMember);
}

export async function decideCompanyMembership(member: string, id: number, target: string, action: MembershipDecision) {
  if (member === target) throw new BadRequestException('Choose another team member.');
  await withCompany(member, id, async (client, company) => {
    requireAdmin(company);
    const entry = (await client.query<{ role: Role }>('SELECT role FROM company_members WHERE company_id=$1 AND user_id=$2',
      [id, target])).rows[0];
    if (!entry) throw new NotFoundException('This team member is unavailable.');
    if (target === company.ownerId) throw new ForbiddenException('Only the owner can transfer ownership.');
    let message: string;
    if (action === 'approve' || action === 'decline') {
      if (entry.role !== 'requested') throw new ConflictException('This membership request is no longer pending.');
      if (action === 'approve') {
        await client.query("UPDATE company_members SET role='employee' WHERE company_id=$1 AND user_id=$2", [id, target]);
      } else {
        await client.query('DELETE FROM company_members WHERE company_id=$1 AND user_id=$2', [id, target]);
      }
      message = `Your request to join ${company.name} was ${action === 'approve' ? 'approved' : 'declined'}.`;
    } else {
      if (entry.role === 'requested') throw new ConflictException('Approve this membership request first.');
      if (company.role !== 'owner' && (action !== 'remove' || entry.role === 'admin')) {
        throw new ForbiddenException('Only the owner can change admin roles.');
      }
      if (action === 'remove') {
        await client.query('DELETE FROM company_members WHERE company_id=$1 AND user_id=$2', [id, target]);
        message = `You were removed from ${company.name}.`;
      } else {
        if (action === 'transfer') {
          await client.query('UPDATE professional_companies SET owner_id=$2 WHERE id=$1', [id, target]);
        }
        await client.query('UPDATE company_members SET role=$3 WHERE company_id=$1 AND user_id=$2',
          [id, target, action === 'demote' ? 'employee' : 'admin']);
        message = action === 'transfer' ? `You now own the ${company.name} page.` :
          `Your role at ${company.name} changed to ${action === 'promote' ? 'admin' : 'employee'}.`;
      }
    }
    await client.query("INSERT INTO notifications(user_id,message,category,company_id) VALUES($1,$2,'Companies',$3)",
      [target, message, id]);
  });
  notifyMember(target);
}

export async function addCompanyUpdate(member: string, id: number, body: string, notifyEmployees: boolean) {
  const recipients = await withCompany(member, id, async (client, company) => {
    requireAdmin(company);
    await client.query('INSERT INTO posts(author_id,company_id,body) VALUES($1,$2,$3)', [member, id, body]);
    return notifyEmployees ? notifyTeam(client, id, member, `${company.name} shared a new update with employees.`) : [];
  });
  recipients.forEach(notifyMember);
}

export async function moderateCompanyUpdate(member: string, id: number, post: number, hide: boolean) {
  await withCompany(member, id, async (client, company) => {
    requireAdmin(company);
    const changed = await client.query(
      `UPDATE posts SET company_hidden_at=CASE WHEN $3 THEN now() ELSE NULL END
       WHERE id=$1 AND company_id=$2 AND hidden_at IS NULL AND (company_hidden_at IS NULL)=$3`, [post, id, hide]
    );
    if (!changed.rowCount) throw new NotFoundException('This update is unavailable.');
  });
}

export async function saveCompanyPage(member: string, id: number, fields: PageInput, page?: number) {
  return withCompany(member, id, async (client, company) => {
    requireAdmin(company);
    const values = [id, fields.kind, fields.title, fields.description, fields.url || null];
    const result = page ? await client.query<{ id: number }>(
      'UPDATE company_showcases SET kind=$2,title=$3,description=$4,url=$5 WHERE company_id=$1 AND id=$6 RETURNING id', [...values, page]
    ) : await client.query<{ id: number }>(
      'INSERT INTO company_showcases(company_id,kind,title,description,url) VALUES($1,$2,$3,$4,$5) RETURNING id', values
    );
    if (!result.rowCount) throw new NotFoundException('This page is unavailable.');
    return result.rows[0];
  });
}

export async function removeCompanyPage(member: string, id: number, page: number) {
  await withCompany(member, id, async (client, company) => {
    requireAdmin(company);
    const deleted = await client.query('DELETE FROM company_showcases WHERE company_id=$1 AND id=$2', [id, page]);
    if (!deleted.rowCount) throw new NotFoundException('This page is unavailable.');
  });
}
