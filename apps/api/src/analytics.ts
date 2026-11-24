import { managesCompany, managesJob } from './company-access.js';
import { db } from './database.js';
import { visiblePosts } from './posts.js';

export type AnalyticsDays = 7 | 30 | 90;
const dateString = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 10);
const dayMs = 86_400_000;

function analyticsRange(days: AnalyticsDays) {
  const now = Date.now();
  return { from: dateString(now - (days - 1) * dayMs), through: dateString(now), until: dateString(now + dayMs) };
}

const inDays = (column: string) => `(${column}>=$2::date AND ${column}<$3::date)`;
const inTime = (column: string) => `(${column}>=($2::date::timestamp AT TIME ZONE 'UTC')
  AND ${column}<($3::date::timestamp AT TIME ZONE 'UTC'))`;

async function trackingStarted() {
  const { rows: [installation] } = await db.query<{ day: string }>(
    `SELECT (started_at AT TIME ZONE 'UTC')::date::text AS day FROM analytics_installation`
  );
  return installation.day;
}

async function profileAnalytics(parameters: string[]) {
  const summary = await db.query(`WITH activity AS MATERIALIZED (
    SELECT day,kind,viewer_id FROM analytics_profile_activity WHERE subject_id=$1 AND ${inDays('day')}
  ), daily AS (
    SELECT day, count(*) FILTER (WHERE kind='profile')::int AS views,
      count(*) FILTER (WHERE kind='search')::int AS appearances FROM activity GROUP BY day
  )
  SELECT (SELECT count(*)::int FROM activity WHERE kind='profile') AS views,
    (SELECT count(DISTINCT viewer_id)::int FROM activity WHERE kind='profile') AS visitors,
    (SELECT count(*)::int FROM activity WHERE kind='search') AS appearances,
    (SELECT json_agg(json_build_object('day',days.day::date,'views',COALESCE(daily.views,0),
      'appearances',COALESCE(daily.appearances,0)) ORDER BY days.day)
      FROM generate_series($2::date::timestamp,$3::date::timestamp-interval '1 day',interval '1 day') days(day)
      LEFT JOIN daily ON daily.day=days.day::date) AS daily`, parameters);
  return summary.rows[0];
}

async function personalPostAnalytics(parameters: string[]) {
  const result = await db.query(`WITH owned AS MATERIALIZED (
    SELECT post.id,post.created_at,post.body FROM posts post WHERE post.author_id=$1 AND post.company_id IS NULL
      AND post.group_id IS NULL AND post.event_id IS NULL AND ${visiblePosts}
  ), impressions AS MATERIALIZED (
    SELECT i.post_id,i.viewer_id FROM analytics_post_impressions i JOIN owned ON owned.id=i.post_id WHERE ${inDays('i.day')}
  ), views AS (
    SELECT post_id,count(*)::int AS impressions,count(DISTINCT viewer_id)::int AS reach FROM impressions GROUP BY post_id
  ), active_likes AS (
    SELECT r.post_id,count(*)::int AS likes FROM reactions r JOIN owned ON owned.id=r.post_id
    WHERE r.user_id<>$1 AND ${inTime('r.created_at')} GROUP BY r.post_id
  ), comments AS (
    SELECT c.post_id,count(*)::int AS comments FROM comments c JOIN owned ON owned.id=c.post_id
    WHERE c.author_id<>$1 AND ${inTime('c.created_at')} GROUP BY c.post_id
  ), metrics AS MATERIALIZED (
    SELECT owned.id,left(owned.body,160) AS excerpt,owned.created_at AS "createdAt",COALESCE(views.impressions,0) AS impressions,
      COALESCE(views.reach,0) AS reach,COALESCE(active_likes.likes,0) AS likes,COALESCE(comments.comments,0) AS comments
    FROM owned LEFT JOIN views ON views.post_id=owned.id LEFT JOIN active_likes ON active_likes.post_id=owned.id
    LEFT JOIN comments ON comments.post_id=owned.id
  ) SELECT (SELECT count(*)::int FROM impressions) AS impressions,
    (SELECT count(DISTINCT viewer_id)::int FROM impressions) AS reach,
    COALESCE(sum(metrics.likes),0)::int AS likes,COALESCE(sum(metrics.comments),0)::int AS comments,
    COALESCE((SELECT json_agg(top) FROM (
      SELECT * FROM metrics WHERE impressions>0 OR likes>0 OR comments>0 OR ${inTime('"createdAt"')}
      ORDER BY impressions DESC,(likes+comments) DESC,"createdAt" DESC,id DESC LIMIT 30
    ) top),'[]') AS posts
  FROM metrics`, parameters);
  return result.rows[0];
}

async function publishingAnalytics(parameters: string[]) {
  const [articles, newsletters] = await Promise.all([
    db.query(`WITH published AS MATERIALIZED (
      SELECT id,title,published_at FROM publication_articles WHERE author_id=$1 AND published_at IS NOT NULL
    ), readings AS MATERIALIZED (
      SELECT v.article_id,v.viewer_id FROM analytics_article_views v JOIN published ON published.id=v.article_id WHERE ${inDays('v.day')}
    ), by_article AS (
      SELECT article_id,count(*)::int AS views,count(DISTINCT viewer_id)::int AS readers FROM readings GROUP BY article_id
    ) SELECT (SELECT count(*)::int FROM readings) AS views,(SELECT count(DISTINCT viewer_id)::int FROM readings) AS readers,
      COALESCE((SELECT json_agg(top) FROM (
        SELECT p.id,p.title,p.published_at AS "publishedAt",COALESCE(stats.views,0) AS views,COALESCE(stats.readers,0) AS readers
        FROM published p LEFT JOIN by_article stats ON stats.article_id=p.id
        WHERE stats.views>0 OR ${inTime('p.published_at')}
        ORDER BY views DESC,p.published_at DESC,p.id DESC LIMIT 30
      ) top),'[]') AS articles`, parameters),
    db.query(`SELECT n.id,n.title,
      (SELECT count(*)::int FROM newsletter_subscriptions s WHERE s.newsletter_id=n.id) AS subscribers,
      (SELECT count(*)::int FROM newsletter_subscriptions s WHERE s.newsletter_id=n.id AND ${inTime('s.subscribed_at')}) AS "newSubscribers",
      (SELECT count(*)::int FROM publication_articles a WHERE a.newsletter_id=n.id AND ${inTime('a.published_at')}) AS editions,
      (SELECT count(DISTINCT views.viewer_id)::int FROM publication_articles a JOIN analytics_article_views views ON views.article_id=a.id
        WHERE a.newsletter_id=n.id AND ${inDays('views.day')}) AS readers
      FROM newsletters n WHERE n.owner_id=$1 ORDER BY lower(n.title),n.id`, parameters)
  ]);
  return { ...articles.rows[0], newsletters: newsletters.rows };
}

export async function personalAnalytics(member: string, days: AnalyticsDays) {
  const range = analyticsRange(days);
  const parameters = [member, range.from, range.until];
  const [profile, content, publishing, trackingSince] = await Promise.all([
    profileAnalytics(parameters), personalPostAnalytics(parameters), publishingAnalytics(parameters), trackingStarted()
  ]);
  return { range, trackingSince, profile, content, publishing };
}

export async function companyAnalytics(member: string, days: AnalyticsDays) {
  const range = analyticsRange(days);
  const [report, trackingSince] = await Promise.all([db.query(`SELECT c.id,c.name,c.industry,c.size,c.headquarters,
    visitors.views,visitors.reach AS visitors,
    followers.total AS followers,followers.added AS "newFollowers",
    posts.published AS updates,posts.impressions AS "updateImpressions",
    (SELECT count(*)::int FROM company_members m WHERE m.company_id=c.id AND m.role IN ('admin','employee')) AS "teamSize",
    (SELECT count(*)::int FROM jobs j WHERE j.company_id=c.id AND NOT j.closed) AS "openJobs",
    (SELECT count(*)::int FROM jobs j WHERE j.company_id=c.id AND ${inTime('j.created_at')}) AS "newJobs",
    COALESCE((SELECT json_agg(location_counts) FROM (
      SELECT min(btrim(p.location)) AS location,count(*)::int AS followers
      FROM company_followers f JOIN profiles p ON p.user_id=f.user_id
      WHERE f.company_id=c.id AND btrim(p.location)<>'' GROUP BY lower(btrim(p.location))
      HAVING count(*)>=3 ORDER BY followers DESC,location LIMIT 8
    ) location_counts),'[]') AS locations
  FROM professional_companies c
  CROSS JOIN LATERAL (SELECT count(*)::int AS views,count(DISTINCT v.viewer_id)::int AS reach
    FROM analytics_company_views v WHERE v.company_id=c.id AND ${inDays('v.day')}) visitors
  CROSS JOIN LATERAL (SELECT count(*)::int AS total,count(*) FILTER (WHERE ${inTime('f.followed_at')})::int AS added
    FROM company_followers f WHERE f.company_id=c.id) followers
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE ${inTime('post.created_at')})::int AS published,
      COALESCE(sum((SELECT count(*) FROM analytics_post_impressions i WHERE i.post_id=post.id AND ${inDays('i.day')})),0)::int AS impressions
    FROM posts post WHERE post.company_id=c.id AND ${visiblePosts}
  ) posts
  WHERE ${managesCompany('c.id', '$1')} ORDER BY lower(c.name),c.id`, [member, range.from, range.until]), trackingStarted()]);
  return { range, trackingSince, companies: report.rows };
}

export async function hiringAnalytics(member: string, days: AnalyticsDays) {
  const range = analyticsRange(days);
  const { rows } = await db.query(`SELECT j.id,j.title,COALESCE(c.name,j.company) AS company,j.company_id AS "companyId",j.closed,
    funnel.received,funnel.submitted,funnel.reviewing,funnel.interviews,funnel.offers,funnel.rejected,
    funnel.responded,funnel."medianResponseHours"
  FROM jobs j LEFT JOIN professional_companies c ON c.id=j.company_id
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS received,count(*) FILTER (WHERE COALESCE(latest.status,'Submitted')='Submitted')::int AS submitted,
      count(*) FILTER (WHERE latest.status='In review')::int AS reviewing,count(*) FILTER (WHERE latest.status='Interview')::int AS interviews,
      count(*) FILTER (WHERE latest.status='Offer')::int AS offers,count(*) FILTER (WHERE latest.status='Not selected')::int AS rejected,
      count(first_response.created_at)::int AS responded,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (first_response.created_at-app.created_at))/3600) AS "medianResponseHours"
    FROM applications app
    LEFT JOIN LATERAL (SELECT e.status FROM application_events e
      WHERE e.application_id=app.id AND e.status<>'Role closed' ORDER BY e.id DESC LIMIT 1) latest ON true
    LEFT JOIN LATERAL (SELECT min(e.created_at) AS created_at FROM application_events e
      WHERE e.application_id=app.id AND e.status NOT IN ('Role closed','Submitted')) first_response ON true
    WHERE app.job_id=j.id AND ${inTime('app.created_at')}
  ) funnel
  WHERE ${managesJob('$1')} AND (funnel.received>0 OR NOT j.closed OR ${inTime('j.created_at')})
  ORDER BY funnel.received DESC,j.created_at DESC,j.id DESC`, [member, range.from, range.until]);
  return { range, jobs: rows };
}

export async function campaignAnalytics(member: string, days: AnalyticsDays) {
  const range = analyticsRange(days);
  const { rows } = await db.query(`SELECT a.id,a.name,a.format,a.objective,c.name AS company,a.company_id AS "companyId",
    activity.impressions,activity.reach,activity.clicks,
    (SELECT count(*)::int FROM ad_leads l WHERE l.campaign_id=a.id AND ${inTime('l.consented_at')}) AS leads
  FROM ad_campaigns a JOIN professional_companies c ON c.id=a.company_id
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE ${inDays('d.delivery_day')})::int AS impressions,
      count(DISTINCT d.viewer_id) FILTER (WHERE ${inDays('d.delivery_day')})::int AS reach,
      count(*) FILTER (WHERE ${inTime('d.clicked_at')})::int AS clicks
    FROM ad_deliveries d WHERE d.campaign_id=a.id AND (${inDays('d.delivery_day')} OR ${inTime('d.clicked_at')})
  ) activity
  WHERE a.state<>'draft' AND ${managesCompany('a.company_id', '$1')}
  ORDER BY activity.impressions DESC,a.id DESC`, [member, range.from, range.until]);
  return { range, campaigns: rows };
}
