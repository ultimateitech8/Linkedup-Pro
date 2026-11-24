import { db } from './database.js';
import { managesCompany } from './company-access.js';

// The viewer's member ID is the first parameter in these queries.
const canReadGroup = `(post.group_id IS NULL OR EXISTS (
  SELECT 1 FROM professional_groups g WHERE g.id=post.group_id AND (
    g.visibility='public' OR EXISTS (
      SELECT 1 FROM group_members gm WHERE gm.group_id=g.id AND gm.user_id=$1 AND gm.membership='active'
    )
  )
))`;

const registeredForEvent = `(e.host_id=$1 OR EXISTS(SELECT 1 FROM event_attendees ea
  WHERE ea.event_id=e.id AND ea.user_id=$1 AND ea.status='registered'))`;
const canReadEvent = `(post.event_id IS NULL OR EXISTS(
  SELECT 1 FROM professional_events e WHERE e.id=post.event_id AND ${registeredForEvent}
))`;
export const canReadPost = `${canReadGroup} AND ${canReadEvent}`;

export const visiblePosts = 'post.hidden_at IS NULL AND post.group_hidden_at IS NULL AND post.event_hidden_at IS NULL AND post.company_hidden_at IS NULL';
const followsCompany = `EXISTS(SELECT 1 FROM company_followers f WHERE f.company_id=post.company_id AND f.user_id=$1)`;
const canParticipate = `
  (post.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm
    WHERE gm.group_id=post.group_id AND gm.user_id=$1 AND gm.membership='active'))
  AND (post.event_id IS NULL OR EXISTS(SELECT 1 FROM professional_events e
    WHERE e.id=post.event_id AND e.cancelled_at IS NULL AND ${registeredForEvent}))`;
const postDetails = `
  SELECT post.id,post.body,post.image,post.group_id AS "groupId",post.event_id AS "eventId",
    COALESCE(post.group_topic,post.event_topic) AS topic,post.created_at AS "createdAt",
    g.name AS "groupName",e.title AS "eventTitle",(${canParticipate}) AS "canParticipate",
    CASE WHEN company.id IS NOT NULL THEN json_build_object('id',company.id,'name',company.name,
      'hasLogo',company.logo IS NOT NULL,'updatedAt',company.updated_at) END AS company,
    ${followsCompany} AS "followsCompany",${managesCompany('post.company_id', '$1')} AS "canManageCompany",
    json_build_object('id',u.id,'name',u.name,'image',u.image,'headline',COALESCE(p.headline,'')) AS author,
    (SELECT count(*)::int FROM reactions r WHERE r.post_id=post.id) AS likes,
    EXISTS(SELECT 1 FROM reactions r WHERE r.post_id=post.id AND r.user_id=$1) AS liked,
    EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id=post.id AND b.user_id=$1) AS saved,
    (SELECT count(*)::int FROM comments c WHERE c.post_id=post.id) AS "commentCount",
    COALESCE((SELECT json_agg(selected) FROM (
      SELECT c.id,c.body,cu.name,cu.image FROM comments c JOIN "user" cu ON cu.id=c.author_id
      WHERE c.post_id=post.id ORDER BY c.id DESC LIMIT 30
    ) selected), '[]') AS comments
  FROM posts post JOIN "user" u ON post.author_id=u.id LEFT JOIN profiles p ON p.user_id=u.id
  LEFT JOIN professional_groups g ON g.id=post.group_id
  LEFT JOIN professional_events e ON e.id=post.event_id
  LEFT JOIN professional_companies company ON company.id=post.company_id
`;

export function listDashboardPosts(viewer: string) {
  return db.query(`${postDetails}
    WHERE ${visiblePosts} AND (
      post.id IN (SELECT recent.id FROM posts recent
        WHERE recent.hidden_at IS NULL AND recent.company_hidden_at IS NULL AND recent.group_id IS NULL AND recent.event_id IS NULL
          AND (recent.company_id IS NULL OR EXISTS(SELECT 1 FROM company_followers f WHERE f.company_id=recent.company_id AND f.user_id=$1))
        ORDER BY recent.created_at DESC LIMIT 60)
      OR (EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id=post.id AND b.user_id=$1) AND ${canReadPost})
    )
    ORDER BY post.created_at DESC LIMIT 200`, [viewer]);
}

export function listGroupPosts(viewer: string, group: number) {
  return db.query(`${postDetails} WHERE post.group_id=$2 AND ${visiblePosts} AND ${canReadPost}
    ORDER BY post.created_at DESC LIMIT 60`, [viewer, group]);
}

export function listEventPosts(viewer: string, event: number) {
  return db.query(`${postDetails} WHERE post.event_id=$2 AND ${visiblePosts} AND ${canReadPost}
    ORDER BY post.created_at DESC LIMIT 60`, [viewer, event]);
}

export function listCompanyPosts(viewer: string, company: number) {
  return db.query(`${postDetails} WHERE post.company_id=$2 AND ${visiblePosts}
    ORDER BY post.created_at DESC LIMIT 60`, [viewer, company]);
}

export async function postAccess(viewer: string, postId: number) {
  return (await db.query<{ canParticipate: boolean }>(
    `SELECT (${canParticipate}) AS "canParticipate"
    FROM posts post WHERE post.id=$2 AND ${visiblePosts} AND ${canReadPost}`, [viewer, postId]
  )).rows[0];
}
