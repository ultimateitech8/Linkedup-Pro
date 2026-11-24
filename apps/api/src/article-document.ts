import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { read } from './access.js';

const types = z.enum(['doc', 'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem',
  'hardBreak', 'text', 'horizontalRule', 'image', 'youtube']);
const marks = z.enum(['bold', 'italic', 'strike', 'underline', 'code', 'link']);
const attributes = z.record(z.string(), z.unknown()).default({});
const node = z.object({
  type: types, attrs: attributes, text: z.string().max(120_000).optional(),
  content: z.array(z.unknown()).max(500).default([]),
  marks: z.array(z.object({ type: marks, attrs: attributes })).max(8).default([])
});

export type ArticleNode = {
  type: z.output<typeof types>;
  attrs?: Record<string, string | number>;
  text?: string;
  marks?: { type: z.output<typeof marks>; attrs?: { href: string } }[];
  content?: ArticleNode[];
};

const blocks = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'horizontalRule', 'image', 'youtube'];
const inline = ['text', 'hardBreak'];
const allowed: Partial<Record<ArticleNode['type'], string[]>> = {
  doc: blocks, blockquote: blocks, listItem: blocks, paragraph: inline, heading: inline, bulletList: ['listItem'], orderedList: ['listItem']
};

function externalUrl(input: unknown, protocol: 'https' | 'web') {
  try {
    if (typeof input !== 'string' || input.length > 2048) throw new Error();
    const url = new URL(input);
    if (url.username || url.password || !(protocol === 'web' ? ['http:', 'https:'].includes(url.protocol) : url.protocol === 'https:')) {
      throw new Error();
    }
    return url;
  } catch {
    throw new BadRequestException(protocol === 'https' ? 'Use a valid HTTPS media link.' : 'Use a valid HTTP or HTTPS link.');
  }
}

export function videoUrl(input: unknown) {
  const url = externalUrl(input, 'https');
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (url.hostname === 'youtu.be') id = parts[0];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1];
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new BadRequestException('Use a valid YouTube video link.');
  return 'https://www.youtube.com/watch?v=' + id;
}

export function parseArticle(raw: unknown) {
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw) > 180_000) throw new BadRequestException('This article is too long.');
    try { raw = JSON.parse(raw); }
    catch { throw new BadRequestException('The article body is invalid.'); }
  }
  let nodes = 0;

  function visit(value: unknown, depth: number): ArticleNode {
    if (++nodes > 900 || depth > 12) throw new BadRequestException('This article has too many nested elements.');
    const input = read(node, value);
    const format = input.type;
    const item: ArticleNode = { type: format };
    if (format === 'text') {
      if (!input.text) throw new BadRequestException('An article text node is empty.');
      item.text = input.text;
      if (input.marks.length) item.marks = input.marks.map((mark) => mark.type === 'link'
        ? { type: 'link', attrs: { href: externalUrl(mark.attrs.href, 'web').href } }
        : { type: mark.type });
    }
    if (format === 'heading') item.attrs = { level: input.attrs.level === 3 ? 3 : 2 };
    if (format === 'orderedList') item.attrs = { start: read(z.number().int().min(1).max(9999), input.attrs.start ?? 1) };
    if (format === 'image') item.attrs = {
      src: externalUrl(input.attrs.src, 'https').href,
      alt: typeof input.attrs.alt === 'string' ? input.attrs.alt.slice(0, 240) : ''
    };
    if (format === 'youtube') item.attrs = { src: videoUrl(input.attrs.src) };

    if (input.content.length) {
      const childTypes = allowed[format] ?? [];
      item.content = input.content.map((child) => {
        const clean = visit(child, depth + 1);
        if (!childTypes.includes(clean.type)) throw new BadRequestException('The article contains unsupported formatting.');
        return clean;
      });
    }
    if (['bulletList', 'orderedList', 'blockquote', 'listItem'].includes(format) && !item.content?.length) {
      throw new BadRequestException('Complete or remove the empty formatting block.');
    }
    if (format === 'listItem' && item.content?.[0].type !== 'paragraph') {
      item.content?.unshift({ type: 'paragraph' });
    }
    return item;
  }

  const document = visit(raw, 0);
  if (document.type !== 'doc') throw new BadRequestException('The article body is invalid.');
  if (!document.content?.length) document.content = [{ type: 'paragraph' }];
  if (Buffer.byteLength(JSON.stringify(document)) > 180_000) throw new BadRequestException('This article is too long.');
  let includesMedia = false;
  function textOf(item: ArticleNode): string {
    if (item.type === 'image' || item.type === 'youtube') includesMedia = true;
    if (item.text) return item.text;
    return (item.content ?? []).map(textOf).join(['paragraph', 'heading'].includes(item.type) ? '' : ' ');
  }
  const text = textOf(document).replace(/\s+/g, ' ').trim();
  const snippet = Array.from(text).slice(0, 180).join('');
  return { document, excerpt: snippet, hasContent: Boolean(text) || includesMedia };
}
