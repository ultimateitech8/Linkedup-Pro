import type { JSONContent } from '@tiptap/react';
import type { ReactNode } from 'react';
import { YouTubeVideo } from './youtube-video';

function webLink(value: unknown, httpsOnly = false) {
  if (typeof value !== 'string') return undefined;
  return (httpsOnly ? /^https:\/\//i : /^https?:\/\//i).test(value) ? value : undefined;
}

function render(node: JSONContent, key: string): ReactNode {
  const children = () => node.content?.map((child, index) => render(child, `${key}-${index}`));
  switch (node.type) {
    case 'doc': return children();
    case 'paragraph': return <p key={key}>{children()}</p>;
    case 'heading': return node.attrs?.level === 3 ? <h3 key={key}>{children()}</h3> : <h2 key={key}>{children()}</h2>;
    case 'blockquote': return <blockquote key={key}>{children()}</blockquote>;
    case 'bulletList': return <ul key={key}>{children()}</ul>;
    case 'orderedList': return <ol key={key} start={typeof node.attrs?.start === 'number' ? node.attrs.start : 1}>{children()}</ol>;
    case 'listItem': return <li key={key}>{children()}</li>;
    case 'hardBreak': return <br key={key} />;
    case 'horizontalRule': return <hr key={key} />;
    case 'image': {
      const src = webLink(node.attrs?.src, true);
      return src && <img key={key} src={src} alt={typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''} loading="lazy" />;
    }
    case 'youtube': {
      return typeof node.attrs?.src === 'string' && <YouTubeVideo key={key} url={node.attrs.src} title="Embedded YouTube video" />;
    }
    case 'text': {
      const marked = (node.marks ?? []).reduceRight<ReactNode>((text, mark) => {
        switch (mark.type) {
          case 'bold': return <strong>{text}</strong>;
          case 'italic': return <em>{text}</em>;
          case 'strike': return <s>{text}</s>;
          case 'underline': return <u>{text}</u>;
          case 'code': return <code>{text}</code>;
          case 'link': {
            const href = webLink(mark.attrs?.href);
            return href ? <a href={href} target="_blank" rel="noreferrer">{text}</a> : text;
          }
          default: return text;
        }
      }, node.text);
      return <span key={key}>{marked}</span>;
    }
    default: return null;
  }
}

export function ArticleBody({ body }: { body: JSONContent }) {
  return <div className="article-prose">{render(body, 'body')}</div>;
}
