'use client';

import { useState, type FormEvent } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Youtube, { isValidYoutubeUrl } from '@tiptap/extension-youtube';
import { Bold, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Quote, Underline, Video, type LucideIcon } from 'lucide-react';
import { CoverPicker } from './publication-cover';
import { appendCover, coverFrom, coverPath, type ArticleDetail } from './publications-data';

type Resource = 'link' | 'image' | 'video';

function FormatButton({ label, icon: Icon, toggle, pressed }: {
  label: string; icon: LucideIcon; toggle: () => void; pressed?: boolean;
}) {
  return <button className="icon-btn format-btn" aria-label={label} aria-pressed={pressed} title={label} type="button"
    onMouseDown={(event) => event.preventDefault()} onClick={toggle}><Icon size={19} /></button>;
}

function Toolbar({ editor }: { editor: Editor }) {
  const [resource, setResource] = useState<Resource | null>(null);
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  const active = useEditorState({ editor, selector: ({ editor: current }) => ({
    bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'),
    h2: current.isActive('heading', { level: 2 }), h3: current.isActive('heading', { level: 3 }),
    bullets: current.isActive('bulletList'), numbered: current.isActive('orderedList'), quote: current.isActive('blockquote')
  }) });

  function select(mode: Resource) {
    setResource((previous) => previous === mode ? null : mode);
    setUrl(mode === 'link' ? (editor.getAttributes('link').href ?? '') : '');
    setAlt('');
    setError('');
  }

  function insert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resource) return;
    try {
      const link = new URL(url.trim());
      if (link.username || link.password || (link.protocol !== 'https:' && (resource !== 'link' || link.protocol !== 'http:'))) throw new Error();
      const commands = editor.chain().focus();
      if (resource === 'video' && (!['youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(link.hostname)
        || !isValidYoutubeUrl(link.href))) {
        setError('Use a valid YouTube video link.');
        return;
      }
      if (resource === 'link') {
        if (editor.state.selection.empty && !editor.isActive('link')) {
          commands.insertContent({ type: 'text', text: link.href, marks: [{ type: 'link', attrs: { href: link.href } }] }).run();
        } else commands.extendMarkRange('link').setLink({ href: link.href }).run();
      } else {
        const end = editor.state.selection.$to;
        const insertAt = end.depth > 0 ? end.after(1) : end.pos;
        const media = resource === 'image' ? { type: 'image', attrs: { src: link.href, alt: alt.trim() } } :
          { type: 'youtube', attrs: { src: link.href, width: 720, height: 405 } };
        commands.insertContentAt(insertAt, media).run();
      }
      setResource(null);
    } catch {
      setError(resource === 'link' ? 'Use a valid HTTP or HTTPS link.' : 'Use a valid HTTPS media link.');
    }
  }

  return <>
    <div className="article-toolbar" role="group" aria-label="Article formatting">
      <FormatButton label="Bold" icon={Bold} pressed={active.bold} toggle={() => editor.chain().focus().toggleBold().run()} />
      <FormatButton label="Italic" icon={Italic} pressed={active.italic} toggle={() => editor.chain().focus().toggleItalic().run()} />
      <FormatButton label="Underline" icon={Underline} pressed={active.underline} toggle={() => editor.chain().focus().toggleUnderline().run()} />
      <span className="format-divider" />
      <FormatButton label="Heading" icon={Heading2} pressed={active.h2} toggle={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <FormatButton label="Subheading" icon={Heading3} pressed={active.h3} toggle={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <FormatButton label="Bullet list" icon={List} pressed={active.bullets} toggle={() => editor.chain().focus().toggleBulletList().run()} />
      <FormatButton label="Numbered list" icon={ListOrdered} pressed={active.numbered} toggle={() => editor.chain().focus().toggleOrderedList().run()} />
      <FormatButton label="Quote" icon={Quote} pressed={active.quote} toggle={() => editor.chain().focus().toggleBlockquote().run()} />
      <span className="format-divider" />
      <FormatButton label="Insert link" icon={Link2} pressed={resource === 'link'} toggle={() => select('link')} />
      <FormatButton label="Embed image" icon={ImagePlus} pressed={resource === 'image'} toggle={() => select('image')} />
      <FormatButton label="Embed YouTube video" icon={Video} pressed={resource === 'video'} toggle={() => select('video')} />
    </div>
    {resource && <form className="article-resource field-form" onSubmit={insert}>
      <label>{resource === 'video' ? 'YouTube URL' : resource === 'image' ? 'Image URL' : 'Link URL'}
        <input autoFocus type="url" value={url} onChange={(event) => setUrl(event.target.value)} maxLength={2048} placeholder="https://…" required /></label>
      {resource === 'image' && <label>Image description<input value={alt} onChange={(event) => setAlt(event.target.value)} maxLength={240} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row">
        <button className="button primary compact">Insert</button>
        {resource === 'link' && editor.isActive('link') && <button type="button" className="button secondary compact" onClick={() => {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
          setResource(null);
        }}>Remove link</button>}
        <button type="button" className="button secondary compact" onClick={() => setResource(null)}>Cancel</button>
      </div>
    </form>}
  </>;
}

export function ArticleEditor({ article, newsletterId, newsletterTitle, close, save }: {
  article?: ArticleDetail; newsletterId?: number; newsletterTitle?: string; close: () => void;
  save: (form: FormData, mode: 'draft' | 'publish') => Promise<void>;
}) {
  const [title, setTitle] = useState(article?.title ?? '');
  const [cover, setCover] = useState(() => coverFrom(article));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, link: { openOnClick: false, defaultProtocol: 'https' } }),
      Image.configure({ allowBase64: false }),
      Youtube.configure({ nocookie: true })
    ],
    content: article?.body ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { class: 'article-prose writing-body', role: 'textbox', 'aria-label': 'Article body', 'aria-multiline': 'true' }
    }
  });
  const published = Boolean(article?.publishedAt);
  async function submit(mode: 'draft' | 'publish') {
    if (!editor || busy) return;
    setError('');
    setBusy(true);
    try {
      const form = new FormData();
      form.set('title', title);
      form.set('body', JSON.stringify(editor.getJSON()));
      form.set('mode', mode);
      if (newsletterId) form.set('newsletterId', String(newsletterId));
      appendCover(form, cover);
      await save(form, mode);
    } catch (failure) {
      setError((failure as Error).message);
      window.scrollTo({ top: 0 });
    } finally {
      setBusy(false);
    }
  }

  return <div className="writing-layout">
    <button className="text-link group-back" disabled={busy} onClick={close}>Back to {newsletterTitle ? 'newsletter' : 'articles'}</button>
    <div className="page-intro"><div><h1>{published ? 'Edit published article' : newsletterTitle ? 'Write an edition' : 'Write an article'}</h1>
      {newsletterTitle && <p>{newsletterTitle}</p>}</div>
      <div className="writing-actions">
        {!published && <button className="button secondary" disabled={busy || !editor} onClick={() => void submit('draft')}>Save draft</button>}
        <button className="button primary" disabled={busy || !editor} onClick={() => void submit('publish')}>
          {published ? 'Save changes' : newsletterTitle ? 'Publish edition' : 'Publish article'}</button>
      </div>
    </div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <section className="card writing-card">
      <label className="field-form writing-title">Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="Give your article a title" /></label>
      <CoverPicker value={cover} update={setCover} existing={article?.hasCover ? coverPath('articles', article) : undefined} />
      <div className="writing-composer">{editor && <Toolbar editor={editor} />}<EditorContent editor={editor} /></div>
    </section>
  </div>;
}
