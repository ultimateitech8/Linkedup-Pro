import { db, emailEnabled } from './database.js';
import { managesCompany } from './company-access.js';
import { visiblePosts } from './posts.js';

const today = "(now() AT TIME ZONE 'UTC')::date";

export async function recordProfileView(viewer: string, member: string) {
  await db.query(`INSERT INTO analytics_profile_activity(subject_id,viewer_id,day,kind)
    SELECT u.id,$1,${today},'profile' FROM "user" u WHERE u.id=$2 AND u.id<>$1 AND ($3 OR u."emailVerified")
    ON CONFLICT DO NOTHING`, [viewer, member, !emailEnabled]);
}

export async function recordSearchAppearances(viewer: string, query: string, results: string[]) {
  await db.query(`INSERT INTO analytics_profile_activity(subject_id,viewer_id,day,kind)
    SELECT u.id,$1,${today},'search' FROM "user" u LEFT JOIN profiles p ON p.user_id=u.id
    WHERE u.id=ANY($2::text[]) AND u.id<>$1 AND ($4 OR u."emailVerified")
      AND strpos(lower(u.name || ' ' || COALESCE(p.headline,'')),lower($3))>0
    ON CONFLICT DO NOTHING`, [viewer, results, query, !emailEnabled]);
}

export async function recordPostImpression(viewer: string, id: number) {
  await db.query(`INSERT INTO analytics_post_impressions(post_id,viewer_id,day)
    SELECT post.id,$1,${today} FROM posts post WHERE post.id=$2 AND ${visiblePosts}
      AND post.author_id<>$1 AND post.group_id IS NULL AND post.event_id IS NULL
      AND NOT ${managesCompany('post.company_id', '$1')}
    ON CONFLICT DO NOTHING`, [viewer, id]);
}

export function recordArticleView(viewer: string, id: number) {
  return db.query(`WITH published AS (
    SELECT id FROM publication_articles WHERE id=$1 AND published_at IS NOT NULL AND author_id<>$2 FOR KEY SHARE
  ), unique_reader AS (
    INSERT INTO article_reads(article_id,user_id) SELECT id,$2 FROM published ON CONFLICT DO NOTHING
  )
  INSERT INTO analytics_article_views(article_id,viewer_id,day)
  SELECT id,$2,${today} FROM published ON CONFLICT DO NOTHING`, [id, viewer]);
}

export function recordCompanyView(viewer: string, id: number) {
  return db.query(`WITH company AS (
    SELECT c.id FROM professional_companies c WHERE c.id=$1 AND NOT ${managesCompany('c.id', '$2')} FOR KEY SHARE
  ), unique_visitor AS (
    INSERT INTO company_visits(company_id,user_id) SELECT id,$2 FROM company ON CONFLICT DO NOTHING
  )
  INSERT INTO analytics_company_views(company_id,viewer_id,day)
  SELECT id,$2,${today} FROM company ON CONFLICT DO NOTHING`, [id, viewer]);
}
