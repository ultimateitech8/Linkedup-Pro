import type { JSONContent } from '@tiptap/react';
import type { Person } from './data';

export type PublicationAuthor = Pick<Person, 'id' | 'name' | 'image' | 'headline'>;
export type CoverFields = { id: number; hasCover: boolean; coverAlt: string; updatedAt: string };
export type Article = CoverFields & {
  title: string; excerpt: string; newsletterId: number | null; newsletterTitle: string | null; editionNumber: number | null;
  publishedAt: string | null; isAuthor: boolean; author: PublicationAuthor; readerCount: number | null;
};
export type ArticleDetail = Article & { body: JSONContent };
export type Newsletter = CoverFields & {
  title: string; description: string; cadence: string; isOwner: boolean; editionCount: number; author: PublicationAuthor;
  subscriberCount: number; subscribed: boolean; readerCount: number | null;
};
export type NewsletterDetail = { newsletter: Newsletter; editions: Article[] };
export type PublicationDirectory = { articles: Article[]; writing: Article[]; newsletters: Newsletter[] };
export type CoverSelection = { file: File | null; alt: string; remove: boolean };
export type PublicationKind = 'articles' | 'newsletters';

export const coverPath = (kind: PublicationKind, item: CoverFields) =>
  `/api/publications/${kind}/${item.id}/cover?v=${encodeURIComponent(item.updatedAt)}`;
export const articleTitle = (title: string) => title || 'Untitled draft';

export function coverFrom(item?: CoverFields | null): CoverSelection {
  return { file: null, alt: item?.coverAlt ?? '', remove: false };
}

export function appendCover(form: FormData, cover: CoverSelection, name = 'cover') {
  form.set(name + 'Alt', cover.alt);
  form.set(name + 'Action', cover.remove ? 'remove' : 'keep');
  if (cover.file) form.set(name, cover.file);
}
