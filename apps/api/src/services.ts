import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { positiveId } from './access.js';
import { db } from './database.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default('');
const categories = z.enum(['Design', 'Development', 'Marketing', 'Writing', 'Business consulting', 'Career coaching', 'Other']);
export const providerInput = z.object({
  headline: text(120), about: text(1800), workMode: z.enum(['Remote', 'On-site', 'Both']),
  location: optionalText(120), accepting: z.boolean()
}).refine((value) => value.workMode === 'Remote' || value.location, 'Enter a location for on-site services.');
export const offeringInput = z.object({
  title: text(100), description: text(1200), category: categories, pricingNote: optionalText(100), active: z.boolean()
});
export const directoryInput = z.object({
  q: optionalText(120), category: categories.optional(), mode: z.enum(['Remote', 'On-site']).optional(), after: positiveId.optional()
});

const offeringFields = `o.id,o.title,o.description,o.category,o.pricing_note AS "pricingNote",o.active`;

export async function serviceDirectory(filters: z.output<typeof directoryInput>, size = 24) {
  const { rows } = await db.query(`SELECT ${offeringFields},p.id AS "providerId",p.work_mode AS "workMode",p.location,
    u.id AS "memberId",u.name,u.image,p.headline,feedback.rating,feedback.count AS "reviewCount"
    FROM service_offerings o JOIN service_providers p ON p.id=o.provider_id JOIN "user" u ON u.id=p.owner_id
    LEFT JOIN LATERAL (
      SELECT round(avg(v.rating),1)::float8 AS rating,count(*)::int AS count
      FROM service_reviews v JOIN service_requests r ON r.id=v.request_id WHERE r.provider_id=p.id
    ) feedback ON true
    WHERE o.active AND p.accepting
      AND ($1='' OR strpos(lower(concat_ws(' ',o.title,o.description,o.category,u.name,p.headline,p.location)),lower($1))>0)
      AND ($2::text IS NULL OR o.category=$2) AND ($3::text IS NULL OR p.work_mode IN ($3,'Both'))
      AND ($4::int IS NULL OR o.id<$4)
    ORDER BY o.id DESC LIMIT $5`, [filters.q, filters.category, filters.mode, filters.after, size + 1]);
  const offerings = rows.slice(0, size);
  return { offerings, next: rows.length > size ? offerings.at(-1)?.id ?? null : null };
}

export async function serviceSearch(query: string) {
  if (!query) return [];
  const { offerings } = await serviceDirectory({ q: query }, 4);
  return offerings.map(({ id, title, category, providerId, name }) => ({ id, title, category, providerId, name }));
}

export async function memberServicePage(memberId: string) {
  const { rows: [provider] } = await db.query(`SELECT id,headline FROM service_providers WHERE owner_id=$1
    AND EXISTS (SELECT 1 FROM service_offerings WHERE provider_id=service_providers.id AND active)`, [memberId]);
  return provider ?? null;
}

export async function providerDetail(memberId: string, id?: number) {
  const { rows: [provider] } = await db.query(`SELECT p.id,p.owner_id AS "memberId", u.name,u.image,p.headline,p.about,
    p.work_mode AS "workMode",p.location,p.accepting,p.owner_id=$1 AS mine,
    (SELECT count(*)::int FROM service_requests WHERE provider_id=p.id AND status IN ('requested','quoted')) AS leads
    FROM service_providers p JOIN "user" u ON u.id=p.owner_id
    WHERE ($2::int IS NULL AND p.owner_id=$1) OR p.id=$2`, [memberId, id ?? null]);
  if (!provider) {
    if (id) throw new NotFoundException('This service page is unavailable.');
    return null;
  }
  const [offerings, reviews] = await Promise.all([
    db.query(`SELECT ${offeringFields} FROM service_offerings o WHERE o.provider_id=$1 AND ($2 OR o.active) ORDER BY o.id DESC`,
      [provider.id, provider.mine]),
    db.query(`SELECT v.request_id AS id,v.rating,v.body,v.created_at AS "createdAt",r.offering_title AS "offeringTitle",u.name,u.image,
      round(avg(v.rating) OVER (),1)::float8 AS average,count(*) OVER ()::int AS total
      FROM service_reviews v JOIN service_requests r ON r.id=v.request_id JOIN "user" u ON u.id=r.client_id
      WHERE r.provider_id=$1 ORDER BY v.created_at DESC,v.request_id DESC LIMIT 30`, [provider.id])
  ]);
  const { leads, ...publicFields } = provider;
  return {
    ...publicFields, ...(provider.mine ? { leads } : {}), offerings: offerings.rows,
    rating: reviews.rows[0]?.average ?? null, reviewCount: reviews.rows[0]?.total ?? 0,
    reviews: reviews.rows.map(({ average: _average, total: _total, ...entry }) => entry)
  };
}

export async function saveProvider(memberId: string, input: z.output<typeof providerInput>) {
  const { rows: [provider] } = await db.query(`INSERT INTO service_providers(owner_id,headline,about,work_mode,location,accepting)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (owner_id) DO UPDATE SET headline=EXCLUDED.headline,about=EXCLUDED.about,
    work_mode=EXCLUDED.work_mode,location=EXCLUDED.location,accepting=EXCLUDED.accepting RETURNING id`,
  [memberId, input.headline, input.about, input.workMode, input.location, input.accepting]);
  return provider;
}

export async function saveOffering(memberId: string, input: z.output<typeof offeringInput>, id?: number) {
  const params = [memberId, input.title, input.description, input.category, input.pricingNote, input.active];
  const { rows: [offering] } = id
    ? await db.query(`UPDATE service_offerings o SET title=$2,description=$3,category=$4,pricing_note=$5,active=$6
        FROM service_providers p WHERE o.provider_id=p.id AND p.owner_id=$1 AND o.id=$7 RETURNING o.id`, [...params, id])
    : await db.query(`INSERT INTO service_offerings(provider_id,title,description,category,pricing_note,active)
        SELECT id,$2,$3,$4,$5,$6 FROM service_providers WHERE owner_id=$1 RETURNING id`, params);
  if (!offering) throw new NotFoundException(id ? 'This listing is unavailable.' : 'Create your service page first.');
  return offering;
}
