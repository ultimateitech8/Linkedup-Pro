import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { recordArticleView } from './analytics-events.js';
import { db } from './database.js';
import type { parseArticle } from './article-document.js';
import type { Cover } from './publication-cover.js';
import { notifyMember } from './realtime.js';

type ImageFields = { cover?: Cover; coverAlt: string; removeCover: boolean };
type ArticleInput = ImageFields & ReturnType<typeof parseArticle> & {
  title: string; newsletterId?: number; mode: 'draft' | 'publish';
};
type NewsletterInput = ImageFields & { title: string; description: string; cadence: string };

const articleSummary = `
  SELECT a.id,a.title,a.excerpt,a.cover IS NOT NULL AS "hasCover",a.cover_alt AS "coverAlt",
    a.newsletter_id AS "newsletterId",n.title AS "newsletterTitle",a.edition_number AS "editionNumber",
    a.published_at AS "publishedAt",a.updated_at AS "updatedAt",a.author_id=$1 AS "isAuthor",
    json_build_object('id',u.id,'name',u.name,'image',u.image,'headline',COALESCE(p.headline,'')) AS author,
    CASE WHEN a.author_id=$1 THEN (SELECT count(*)::int FROM article_reads r WHERE r.article_id=a.id) END AS "readerCount"
  FROM publication_articles a JOIN "user" u ON u.id=a.author_id LEFT JOIN profiles p ON p.user_id=u.id
  LEFT JOIN newsletters n ON n.id=a.newsletter_id
`;

const newsletterSummary = `
  SELECT n.id,n.title,n.description,n.cadence,n.cover IS NOT NULL AS "hasCover",n.cover_alt AS "coverAlt",n.updated_at AS "updatedAt",
    n.owner_id=$1 AS "isOwner", n.edition_count AS "editionCount",
    json_build_object('id',u.id,'name',u.name,'image',u.image,'headline',COALESCE(p.headline,'')) AS author,
    (SELECT count(*)::int FROM newsletter_subscriptions s WHERE s.newsletter_id=n.id) AS "subscriberCount",
    EXISTS(SELECT 1 FROM newsletter_subscriptions s WHERE s.newsletter_id=n.id AND s.user_id=$1) AS subscribed,
    CASE WHEN n.owner_id=$1 THEN (
      SELECT count(DISTINCT r.user_id)::int FROM article_reads r
      JOIN publication_articles a ON a.id=r.article_id WHERE a.newsletter_id=n.id
    ) END AS "readerCount"
  FROM newsletters n JOIN "user" u ON u.id=n.owner_id LEFT JOIN profiles p ON p.user_id=u.id
`;

export async function listPublications(member: string) {
  const [articles, writing, newsletters] = await Promise.all([
    db.query(`${articleSummary} WHERE a.published_at IS NOT NULL ORDER BY a.published_at DESC,a.id DESC LIMIT 100`, [member]),
    db.query(`${articleSummary} WHERE a.author_id=$1 ORDER BY a.updated_at DESC,a.id DESC LIMIT 100`, [member]),
    db.query(`${newsletterSummary} ORDER BY n.id DESC LIMIT 100`, [member])
  ]);
  return { articles: articles.rows, writing: writing.rows, newsletters: newsletters.rows };
}

export async function viewArticle(member: string, id: number) {
  const article = (await db.query(
    `SELECT summary.*,a.body FROM (
       ${articleSummary} WHERE a.id=$2 AND (a.author_id=$1 OR a.published_at IS NOT NULL)
     ) summary JOIN publication_articles a ON a.id=summary.id`, [member, id]
  )).rows[0];
  if (!article) throw new NotFoundException('This article is unavailable.');
  if (!article.isAuthor) {
    await recordArticleView(member, id);
  }
  return article;
}

export async function viewNewsletter(member: string, id: number) {
  const newsletter = (await db.query(`${newsletterSummary} WHERE n.id=$2`, [member, id])).rows[0];
  if (!newsletter) throw new NotFoundException('This newsletter is unavailable.');
  const editions = (await db.query(
    `${articleSummary} WHERE a.newsletter_id=$2 AND (a.published_at IS NOT NULL OR a.author_id=$1)
     ORDER BY a.edition_number DESC NULLS FIRST,a.updated_at DESC,a.id DESC LIMIT 100`, [member, id]
  )).rows;
  return { newsletter, editions };
}

export async function saveArticle(member: string, input: ArticleInput, id?: number) {
  if (input.mode === 'publish' && (!input.title || !input.hasContent)) {
    throw new BadRequestException('Add a title and content before publishing.');
  }
  const client = await db.connect();
  let articleId: number;
  let recipients: string[] = [];
  try {
    await client.query('BEGIN');
    let laterPublish = input.mode === 'publish';
    let newsletterId = input.newsletterId ?? null;
    if (id) {
      const article = (await client.query<{ newsletter_id: number | null; published_at: Date | null }>(
        'SELECT newsletter_id,published_at FROM publication_articles WHERE id=$1 AND author_id=$2 FOR UPDATE', [id, member]
      )).rows[0];
      if (!article) throw new NotFoundException('This article is unavailable.');
      if (input.newsletterId !== undefined && input.newsletterId !== article.newsletter_id) {
        throw new BadRequestException('The newsletter for this edition has already been set.');
      }
      if (article.published_at && input.mode === 'draft') throw new ConflictException('This article has already been published.');
      laterPublish = laterPublish && !article.published_at;
      newsletterId = article.newsletter_id;
      articleId = id;
      await client.query(
        `UPDATE publication_articles SET title=$2,excerpt=$3,body=$4,updated_at=now(),cover_alt=$5,
          cover=CASE WHEN $6 THEN NULL WHEN $7::bytea IS NOT NULL THEN $7 ELSE cover END,
          cover_type=CASE WHEN $6 THEN NULL WHEN $8::text IS NOT NULL THEN $8 ELSE cover_type END
         WHERE id=$1`, [id, input.title, input.excerpt, input.document, input.coverAlt, input.removeCover,
          input.cover?.content ?? null, input.cover?.mime ?? null]
      );
    } else {
      if (newsletterId && !(await client.query('SELECT 1 FROM newsletters WHERE id=$1 AND owner_id=$2', [newsletterId, member])).rowCount) {
        throw new NotFoundException('This newsletter is unavailable.');
      }
      const { rows: [created] } = await client.query<{ id: number }>(
        `INSERT INTO publication_articles(author_id,newsletter_id,title,excerpt,body,cover,cover_type,cover_alt)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [member, newsletterId, input.title, input.excerpt, input.document, input.cover?.content ?? null, input.cover?.mime ?? null, input.coverAlt]
      );
      articleId = created.id;
    }

    if (laterPublish && newsletterId) {
      const newsletter = (await client.query<{ title: string; edition_count: number }>(
        'UPDATE newsletters SET edition_count=edition_count+1 WHERE id=$1 AND owner_id=$2 RETURNING title,edition_count',
        [newsletterId, member]
      )).rows[0];
      if (!newsletter) throw new NotFoundException('This newsletter is unavailable.');
      await client.query('UPDATE publication_articles SET published_at=now(),edition_number=$2 WHERE id=$1',
        [articleId, newsletter.edition_count]);
      const notices = await client.query<{ user_id: string }>(
        `INSERT INTO notifications(user_id,message,category,publication_article_id)
         SELECT user_id,$2,'Publications',$3 FROM newsletter_subscriptions WHERE newsletter_id=$1
         RETURNING user_id`, [newsletterId, `A new edition of ${newsletter.title} is available. ${input.title}`, articleId]
      );
      recipients = notices.rows.map((notice) => notice.user_id);
    } else if (laterPublish) {
      await client.query('UPDATE publication_articles SET published_at=now() WHERE id=$1', [articleId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  recipients.forEach(notifyMember);
  return { id: articleId };
}

export async function discardDraft(member: string, id: number) {
  const result = await db.query('DELETE FROM publication_articles WHERE id=$1 AND author_id=$2 AND published_at IS NULL', [id, member]);
  if (!result.rowCount) throw new NotFoundException('This draft is unavailable.');
}

export async function saveNewsletter(member: string, input: NewsletterInput, id?: number) {
  if (!id) return (await db.query<{ id: number }>(
    `INSERT INTO newsletters(owner_id,title,description,cadence,cover_alt,cover,cover_type)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [member, input.title, input.description, input.cadence, input.coverAlt,
      input.cover?.content ?? null, input.cover?.mime ?? null]
  )).rows[0];

  const newsletter = (await db.query<{ id: number }>(
    `UPDATE newsletters SET title=$3,description=$4,cadence=$5,cover_alt=$6,updated_at=now(),
      cover=CASE WHEN $7 THEN NULL WHEN $8::bytea IS NOT NULL THEN $8 ELSE cover END,
      cover_type=CASE WHEN $7 THEN NULL WHEN $9::text IS NOT NULL THEN $9 ELSE cover_type END
     WHERE id=$1 AND owner_id=$2 RETURNING id`, [id, member, input.title, input.description, input.cadence,
      input.coverAlt, input.removeCover, input.cover?.content ?? null, input.cover?.mime ?? null]
  )).rows[0];
  if (!newsletter) throw new NotFoundException('This newsletter is unavailable.');
  return newsletter;
}

export async function setSubscription(member: string, id: number, subscribed: boolean) {
  if (subscribed) {
    const newsletter = (await db.query<{ owner_id: string }>('SELECT owner_id FROM newsletters WHERE id=$1', [id])).rows[0];
    if (!newsletter) throw new NotFoundException('This newsletter is unavailable.');
    if (newsletter.owner_id === member) throw new BadRequestException('You publish this newsletter.');
    await db.query('INSERT INTO newsletter_subscriptions(newsletter_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, member]);
  } else {
    await db.query('DELETE FROM newsletter_subscriptions WHERE newsletter_id=$1 AND user_id=$2', [id, member]);
  }
}

export async function publicationCover(member: string, kind: 'article' | 'newsletter', id: number) {
  type Image = { cover: Buffer; cover_type: string };
  const result = kind === 'article' ? await db.query<Image>(
    'SELECT cover,cover_type FROM publication_articles WHERE id=$1 AND cover IS NOT NULL AND (author_id=$2 OR published_at IS NOT NULL)', [id, member]
  ) : await db.query<Image>('SELECT cover,cover_type FROM newsletters WHERE id=$1 AND cover IS NOT NULL', [id]);
  if (!result.rows[0]) throw new NotFoundException('This cover is unavailable.');
  return result.rows[0];
}
