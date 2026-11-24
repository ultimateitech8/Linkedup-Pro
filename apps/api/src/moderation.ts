import { ConflictException, NotFoundException } from '@nestjs/common';
import { db } from './database.js';
import { canReadPost, visiblePosts } from './posts.js';

export async function reportPost(post: number, reporter: string, reason: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (!(await client.query(
      `SELECT post.id FROM posts post WHERE post.id=$2 AND ${visiblePosts}
       AND ${canReadPost} FOR UPDATE OF post`, [reporter, post]
    )).rowCount) {
      throw new NotFoundException('This post is unavailable.');
    }
    await client.query(
      'INSERT INTO post_reports(post_id,user_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [post, reporter, reason]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function loadModeration() {
  const [queue, history] = await Promise.all([
    db.query(`
      SELECT post.id, post.body, post.image, member.name AS author,
        g.name AS "groupName", e.title AS "eventTitle", company.name AS "companyName", count(*)::int AS "reportCount",
        array_agg(DISTINCT r.reason ORDER BY r.reason) AS reasons, min(r.created_at) AS "reportedAt"
      FROM post_reports r JOIN posts post ON post.id=r.post_id JOIN "user" member ON member.id=post.author_id
      LEFT JOIN professional_groups g ON g.id=post.group_id
      LEFT JOIN professional_events e ON e.id=post.event_id
      LEFT JOIN professional_companies company ON company.id=post.company_id
      WHERE r.reviewed_at IS NULL AND post.hidden_at IS NULL
      GROUP BY post.id,member.name,g.name,e.title,company.name ORDER BY min(r.created_at) LIMIT 100
    `),
    db.query(`
      SELECT review.id, review.post_id AS "postId", review.action, review.report_count AS "reportCount",
        COALESCE(moderator.name,'Former moderator') AS moderator, author.name AS author, post.body, review.created_at AS "createdAt",
        (post.hidden_at IS NOT NULL AND review.action='hide' AND NOT EXISTS (
          SELECT 1 FROM post_reviews later WHERE later.post_id=post.id AND later.id>review.id
        )) AS "canRestore"
      FROM post_reviews review
      LEFT JOIN posts post ON post.id=review.post_id
      LEFT JOIN "user" author ON author.id=post.author_id
      LEFT JOIN "user" moderator ON moderator.id=review.moderator_id
      ORDER BY review.id DESC LIMIT 100
    `)
  ]);
  return { queue: queue.rows, history: history.rows };
}

export async function reviewPost(post: number, moderator: string, action: 'dismiss' | 'hide' | 'restore') {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = (await client.query('SELECT hidden_at FROM posts WHERE id=$1 FOR UPDATE', [post])).rows[0];
    if (!found) throw new NotFoundException('This post is unavailable.');
    let reviewCount = 0;
    if (action === 'restore') {
      if (!found.hidden_at) throw new ConflictException('This post is already visible.');
      await client.query('UPDATE posts SET hidden_at=NULL WHERE id=$1', [post]);
    } else {
      if (found.hidden_at) throw new ConflictException('This post is already hidden.');
      const reviewed = await client.query('UPDATE post_reports SET reviewed_at=now() WHERE post_id=$1 AND reviewed_at IS NULL', [post]);
      if (!reviewed.rowCount) throw new ConflictException('This report has already been reviewed.');
      reviewCount = reviewed.rowCount;
      if (action === 'hide') await client.query('UPDATE posts SET hidden_at=now() WHERE id=$1', [post]);
    }
    await client.query('INSERT INTO post_reviews(post_id,moderator_id,action,report_count) VALUES($1,$2,$3,$4)',
      [post, moderator, action, reviewCount]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
