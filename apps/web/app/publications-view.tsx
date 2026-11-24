'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BookOpenText, Link2, Mail, PenLine, Plus, Search, UsersRound } from 'lucide-react';
import { ArticleBody } from './article-body';
import { Avatar, Dialog, Empty } from './components';
import { api, day, type Action, type Dashboard } from './data';
import { CoverPicker } from './publication-cover';
import { appendCover, articleTitle, coverFrom, coverPath, type Article, type ArticleDetail, type Newsletter,
  type NewsletterDetail, type PublicationAuthor, type PublicationDirectory } from './publications-data';
import { FilterTabs } from './views';

const ComposeArticle = dynamic(() => import('./article-editor').then((module) => module.ArticleEditor), {
  ssr: false, loading: () => <p className="muted" role="status">Loading editor…</p>
});
type Route = { kind: 'article' | 'newsletter'; id: number } | null;
type Writer = { article?: ArticleDetail; newsletterId?: number; newsletterTitle?: string };
const directoryTabs = ['Articles', 'Newsletters', 'My writing'];

function readRoute(): Route {
  const [route, parameters] = window.location.hash.split('?');
  if (route !== '#publications') return null;
  const values = new URLSearchParams(parameters);
  for (const kind of ['article', 'newsletter'] as const) {
    const id = Number(values.get(kind));
    if (Number.isInteger(id) && id > 0) return { kind, id };
  }
  return null;
}

function Author({ person, note }: { person: PublicationAuthor; note?: string }) {
  return <div className="publication-author"><Avatar person={person} size={34} /><div>
    <strong>{person.name}</strong>{note && <small>{note}</small>}
  </div></div>;
}

function ArticleCard({ article, open, personal = false }: { article: Article; open: () => void; personal?: boolean }) {
  return <article className="card publication-card">
    {article.hasCover ? <img className="publication-card-cover" src={coverPath('articles', article)} alt={article.coverAlt} loading="lazy" /> :
      <div className="publication-card-mark"><BookOpenText size={25} /></div>}
    <div className="publication-card-content">
      <div className="publication-tags">
        {article.newsletterTitle && <span className="status violet">{article.newsletterTitle}{article.editionNumber ? ` · Edition ${article.editionNumber}` : ''}</span>}
        {!article.publishedAt && <span className="status">Draft</span>}
      </div>
      <h2><button className="group-title-link" onClick={open}>{articleTitle(article.title)}</button></h2>
      {article.excerpt && <p>{article.excerpt}</p>}
      <div className="publication-card-footer"><Author person={article.author} note={day(article.publishedAt ?? article.updatedAt)} />
        {personal && article.publishedAt && <span className="status"> {article.readerCount ?? 0} readers</span>}
      </div>
    </div>
  </article>;
}

function NewsletterCard({ newsletter, open }: { newsletter: Newsletter; open: () => void }) {
  return <article className="card publication-card newsletter-card">
    {newsletter.hasCover ? <img className="publication-card-cover" src={coverPath('newsletters', newsletter)} alt={newsletter.coverAlt} loading="lazy" /> :
      <div className="publication-card-mark"><Mail size={25} /></div>}
    <div className="publication-card-content">
      <div className="publication-tags"><span className="status violet">{newsletter.cadence}</span>
        {newsletter.subscribed && <span className="status green">Subscribed</span>}
        {newsletter.isOwner && <span className="status">Your newsletter</span>}
      </div>
      <h2><button className="group-title-link" onClick={open}>{newsletter.title}</button></h2>
      <p>{newsletter.description}</p>
      <div className="publication-card-footer"><Author person={newsletter.author} />
        <span className="publication-subscribers"><UsersRound size={16} />{newsletter.subscriberCount} {newsletter.subscriberCount === 1 ? 'subscriber' : 'subscribers'}</span></div>
    </div>
  </article>;
}

export function PublicationsView({ dashboard, action }: { dashboard: Dashboard; action: Action }) {
  const [route, setRoute] = useState<Route>(null);
  const [directory, setDirectory] = useState<PublicationDirectory | null>(null);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [newsletter, setNewsletter] = useState<NewsletterDetail | null>(null);
  const [tab, setTab] = useState('Articles');
  const [query, setQuery] = useState('');
  const [writer, setWriter] = useState<Writer | null>(null);
  const [newsletterForm, setNewsletterForm] = useState<'new' | 'edit' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const latestNotice = dashboard.notifications.find((notice) => notice.category === 'Publications')?.id;

  const load = useCallback(async (target: Route, signal?: AbortSignal) => {
    try {
      const [directoryData, articleData, newsletterData] = await Promise.all([
        api<PublicationDirectory>('publications', { signal }),
        target?.kind === 'article' ? api<ArticleDetail>(`publications/articles/${target.id}`, { signal }) : null,
        target?.kind === 'newsletter' ? api<NewsletterDetail>(`publications/newsletters/${target.id}`, { signal }) : null
      ]);
      if (signal?.aborted) return;
      setDirectory(directoryData);
      setArticle(articleData);
      setNewsletter(newsletterData);
      setError('');
    } catch (failure) {
      if (!signal?.aborted) setError((failure as Error).message);
    }
  }, []);

  useEffect(() => {
    const change = () => {
      setRoute(readRoute());
      setWriter(null);
      setNewsletterForm(null);
      setStatus('');
    };
    change();
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(route, controller.signal);
    return () => controller.abort();
  }, [route, load, latestNotice]);

  function open(target: Route) {
    const hash = target ? `publications?${target.kind}=${target.id}` : 'publications';
    if (window.location.hash === '#' + hash) {
      setWriter(null);
      setNewsletterForm(null);
      void load(target);
    } else window.location.hash = hash;
    window.scrollTo({ top: 0 });
  }

  function openEditor(next: Writer) {
    setWriter(next);
    setStatus('');
    window.scrollTo({ top: 0 });
  }

  async function share(target: Exclude<Route, null>) {
    const url = new URL(`/#publications?${target.kind}=${target.id}`, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setStatus(target.kind === 'article' ? 'Article link copied.' : 'Newsletter link copied.');
    } catch { setStatus(url); }
  }

  async function toggleSubscription(item: Newsletter) {
    setBusy(true);
    try {
      const changed = await action(`publications/newsletters/${item.id}/subscription`, { subscribed: !item.subscribed },
        item.subscribed ? 'Unsubscribed' : 'Subscribed to newsletter');
      if (changed) await load({ kind: 'newsletter', id: item.id });
    } finally { setBusy(false); }
  }

  if (writer) return <ComposeArticle {...writer}
    close={() => { setWriter(null); window.scrollTo({ top: 0 }); }}
    save={async (form, mode) => {
      const routePath = writer.article ? `publications/articles/${writer.article.id}` : 'publications/articles';
      const saved = await api<{ id: number }>(routePath, { method: writer.article ? 'PATCH' : 'POST', body: form });
      if (mode === 'draft') setTab('My writing');
      open({ kind: 'article', id: saved.id });
    }} />;

  const activeNewsletter = route?.kind === 'newsletter' && route.id === newsletter?.newsletter.id ? newsletter : null;
  const activeArticle = route?.kind === 'article' && route.id === article?.id ? article : null;
  const search = query.trim().toLowerCase();
  const findArticles = (items: Article[]) => items.filter((item) =>
    !search || `${articleTitle(item.title)} ${item.excerpt} ${item.author.name} ${item.newsletterTitle ?? ''}`.toLowerCase().includes(search));
  const newsletters = (directory?.newsletters ?? []).filter((item) =>
    !search || `${item.title} ${item.description} ${item.author.name}`.toLowerCase().includes(search));

  let content;
  if (error) {
    content = <section className="card content-card">
      <p className="form-error" role="alert">{error}</p>
      <div className="button-row"><button className="button secondary" onClick={() => void load(route)}>Try again</button>
        {route && <button className="button secondary" onClick={() => open(null)}>Back to articles</button>}</div>
    </section>;
  } else if (activeArticle) {
    const item = activeArticle;
    content = <div className="publication-reader">
      <button className="text-link group-back" onClick={() => open(item.newsletterId ? { kind: 'newsletter', id: item.newsletterId } : null)}>
        Back to {item.newsletterId ? 'newsletter' : 'articles'}</button>
      <article className="card full-article">
        <header className="full-article-heading">
          <div className="publication-tags">
            {item.newsletterId && <button className="text-link" onClick={() => open({ kind: 'newsletter', id: item.newsletterId! })}>
              {item.newsletterTitle}{item.editionNumber ? ` · Edition ${item.editionNumber}` : ''}</button>}
            {!item.publishedAt && <span className="status">Draft</span>}
          </div>
          <h1>{articleTitle(item.title)}</h1>
          <Author person={item.author} note={item.publishedAt ? day(item.publishedAt) : `Edited ${day(item.updatedAt)}`} />
          <div className="button-row">
            {item.isAuthor && <button className="button secondary" onClick={() => openEditor({
              article: item, newsletterId: item.newsletterId ?? undefined, newsletterTitle: item.newsletterTitle ?? undefined
            })}><PenLine size={17} />{item.publishedAt ? 'Edit article' : 'Edit draft'}</button>}
            {item.isAuthor && !item.publishedAt && <button className="text-link" disabled={busy} onClick={async () => {
              if (!window.confirm('Permanently discard this draft?')) return;
              setBusy(true);
              try {
                if (await action(`publications/articles/${item.id}`, undefined, 'Draft discarded', 'DELETE')) {
                  setTab('My writing'); open(null);
                }
              } finally { setBusy(false); }
            }}>Discard draft</button>}
            {item.publishedAt && <button className="button secondary" onClick={() => void share({ kind: 'article', id: item.id })}><Link2 size={17} /> Copy article link</button>}
            {item.publishedAt && item.isAuthor && <span className="status violet">{item.readerCount ?? 0} unique readers</span>}
          </div>
          {status && <p className="form-status event-share-notice" role="status">{status}</p>}
        </header>
        {item.hasCover && <img className="publication-reader-cover" src={coverPath('articles', item)} alt={item.coverAlt} />}
        <ArticleBody body={item.body} />
      </article>
    </div>;
  } else if (activeNewsletter) {
    const item = activeNewsletter.newsletter;
    content = <>
      <button className="text-link group-back" onClick={() => { setTab('Newsletters'); open(null); }}>Back to newsletters</button>
      <section className="card newsletter-heading">
        {item.hasCover && <img className="publication-reader-cover" src={coverPath('newsletters', item)} alt={item.coverAlt} />}
        <div className="newsletter-heading-content">
          <div className="publication-tags"><span className="status violet">{item.cadence}</span>
            {item.subscribed && <span className="status green">Subscribed</span>}</div>
          <h1>{item.title}</h1><p className="body-copy">{item.description}</p>
          <Author person={item.author} note={`${item.subscriberCount} ${item.subscriberCount === 1 ? 'subscriber' : 'subscribers'}`} />
          <div className="button-row">
            {item.isOwner ? <>
              <button className="button primary" onClick={() => openEditor({ newsletterId: item.id, newsletterTitle: item.title })}><PenLine size={17} /> Write an edition</button>
              <button className="button secondary" onClick={() => setNewsletterForm('edit')}>Edit newsletter</button>
            </> : <button className={`button ${item.subscribed ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => void toggleSubscription(item)}>
              <Mail size={17} />{item.subscribed ? 'Unsubscribe' : 'Subscribe'}</button>}
            <button className="button secondary" onClick={() => void share({ kind: 'newsletter', id: item.id })}><Link2 size={17} /> Copy newsletter link</button>
          </div>
          {status && <p className="form-status event-share-notice" role="status">{status}</p>}
        </div>
      </section>
      {item.isOwner && <section className="card content-card newsletter-insights"><h2>Newsletter analytics</h2><dl className="event-metrics">
        <div><dt>Active subscribers</dt><dd>{item.subscriberCount}</dd></div>
        <div><dt>Published editions</dt><dd>{item.editionCount}</dd></div>
        <div><dt>Unique readers</dt><dd>{item.readerCount ?? 0}</dd></div>
      </dl></section>}
      <div className="section-heading group-section-heading"><h2>{item.isOwner ? 'Editions and drafts' : 'Editions'}</h2></div>
      {activeNewsletter.editions.length ? <div className="publication-grid">{activeNewsletter.editions.map((edition) => <ArticleCard
        key={edition.id} article={edition} personal={item.isOwner} open={() => open({ kind: 'article', id: edition.id })} />)}</div> :
        <Empty title="No editions yet" />}
    </>;
  } else if (route || !directory) {
    content = <p className="muted" role="status">Loading articles and newsletters…</p>;
  } else {
    const articles = findArticles(tab === 'My writing' ? directory.writing : directory.articles);
    content = <>
      <div className="page-intro"><div><h1>Articles &amp; newsletters</h1><p>Read and publish ideas from your professional community.</p></div>
        <div className="writing-actions">
          <button className="button secondary" onClick={() => setNewsletterForm('new')}><Plus size={17} /> Create a newsletter</button>
          <button className="button primary" onClick={() => openEditor({})}><PenLine size={17} /> Write an article</button>
        </div></div>
      <div className="group-tools"><FilterTabs values={directoryTabs} current={tab} change={(value) => { setTab(value); setQuery(''); }} />
        <label className="group-search"><Search size={18} /><span className="sr-only">Search articles and newsletters</span>
          <input placeholder={tab === 'Newsletters' ? 'Search newsletters' : 'Search articles'} value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
      {tab === 'Newsletters' ? newsletters.length > 0 ? <div className="publication-grid">{newsletters.map((item) =>
        <NewsletterCard key={item.id} newsletter={item} open={() => open({ kind: 'newsletter', id: item.id })} />)}</div> :
        <Empty title={search ? 'No matching newsletters' : 'No newsletters yet'} /> :
        articles.length > 0 ? <div className="publication-grid">{articles.map((item) =>
          <ArticleCard key={item.id} article={item} personal={tab === 'My writing'} open={() => open({ kind: 'article', id: item.id })} />)}</div> :
          <Empty title={search ? 'No matching articles' : tab === 'My writing' ? 'No drafts or articles yet' : 'No published articles yet'}>
            {!search && tab === 'My writing' && <button className="text-link" onClick={() => openEditor({})}>Start writing</button>}
          </Empty>}
      {tab === 'My writing' && directory.newsletters.some((item) => item.isOwner) && <section className="my-newsletters">
        <div className="section-heading group-section-heading"><h2>Your newsletters</h2></div>
        <div className="publication-grid">{directory.newsletters.filter((item) => item.isOwner).map((item) =>
          <NewsletterCard key={item.id} newsletter={item} open={() => open({ kind: 'newsletter', id: item.id })} />)}</div>
      </section>}
    </>;
  }

  return <>{content}{newsletterForm && <NewsletterForm item={newsletterForm === 'edit' ? activeNewsletter?.newsletter : undefined}
    close={() => setNewsletterForm(null)} done={(id) => { setTab('Newsletters'); open({ kind: 'newsletter', id }); }} />}</>;
}

function NewsletterForm({ item, close, done }: { item?: Newsletter; close: () => void; done: (id: number) => void }) {
  const [cover, setCover] = useState(() => coverFrom(item));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      appendCover(form, cover);
      const data = await api<{ id: number }>(item ? `publications/newsletters/${item.id}` : 'publications/newsletters',
        { method: item ? 'PATCH' : 'POST', body: form });
      done(data.id);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog title={item ? 'Edit newsletter' : 'Create a newsletter'} close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <label>Newsletter title<input name="title" defaultValue={item?.title} autoFocus maxLength={100} required /></label>
      <label>Description<textarea name="description" defaultValue={item?.description} rows={4} maxLength={800} required /></label>
      <label>Publishing frequency<select name="cadence" defaultValue={item?.cadence ?? 'Monthly'}>
        {['Weekly', 'Every two weeks', 'Monthly', 'Occasional'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <CoverPicker value={cover} update={setCover} existing={item?.hasCover ? coverPath('newsletters', item) : undefined} />
      <div className="dialog-footer"><button className="button secondary" type="button" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{item ? 'Save changes' : 'Create newsletter'}</button></div>
    </form>
  </Dialog>;
}
