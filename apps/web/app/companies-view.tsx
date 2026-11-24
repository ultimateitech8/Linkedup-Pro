'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Globe2, Link2, MapPin, Package, Pencil, Plus, Search, UsersRound } from 'lucide-react';
import { Avatar, BrandAvatar, Empty, FeedPost, JobListItem } from './components';
import { CompanyProfileForm, CompanyUpdateForm, ShowcaseForm } from './company-forms';
import { mayManageCompany, roleName, type CompanyDetail, type CompanyMember, type CompanyPage, type Showcase } from './company-data';
import { api, companyImagePath, day, type Action, type Dashboard } from './data';
import { FilterTabs, type Modal } from './views';

type Route = { company: number; page: number | null } | null;
type Panel = 'create' | 'edit' | 'update' | 'showcase';
type Decision = 'approve' | 'decline' | 'promote' | 'demote' | 'transfer' | 'remove';
const directoryTabs = ['Discover', 'Following', 'Managed pages'];
const tabs = ['Overview', 'Updates', 'Jobs', 'People', 'Products & showcases'];
const decisions = { approve: 'Request approved', decline: 'Request declined', promote: 'Admin added', demote: 'Role updated',
  transfer: 'Ownership transferred', remove: 'Member removed' };

function readRoute(): Route {
  const [route, query] = window.location.hash.split('?');
  if (route !== '#companies') return null;
  const params = new URLSearchParams(query);
  const company = Number(params.get('company'));
  const page = Number(params.get('page'));
  return Number.isInteger(company) && company > 0 ? { company, page: Number.isInteger(page) && page > 0 ? page : null } : null;
}

function plural(count: number, label: string) { return `${count} ${label}${count === 1 ? '' : 's'}`; }

function CompanyCard({ item, open }: { item: CompanyPage; open: () => void }) {
  return <article className="card company-page-card">
    <div className="company-card-banner">
      {item.hasBanner && <img src={companyImagePath(item, 'banner')} alt={item.bannerAlt} loading="lazy" />}
    </div>
    <div className="company-card-content"><div className="company-logo-tile"><BrandAvatar brand={item} size={52} /></div>
      <h2><button className="group-title-link" onClick={open}>{item.name}</button></h2>
      <p className="company-card-meta">{item.industry} · {item.headquarters}</p>
      <p className="company-card-description">{item.description}</p>
      <div className="company-card-footer"><span className="company-followers"><UsersRound size={16} />{plural(item.followerCount, 'follower')}</span>
        {item.following && <span className="status green"><Check size={14} /> Following</span>}
        {mayManageCompany(item) && <span className="status violet">{item.role === 'owner' ? 'Owner' : 'Admin'}</span>}
      </div>
    </div>
  </article>;
}

function MemberSummary({ member, note }: { member: CompanyMember; note?: string }) {
  return <div className="group-person-summary"><Avatar person={member} size={38} /><div>
    <strong>{member.name}</strong>{(note || member.headline) && <small>{note || member.headline}</small>}
  </div></div>;
}

export function CompaniesView({ dashboard, action, showModal, showPerson, manageJobs, refreshDashboard }: {
  dashboard: Dashboard; action: Action; showModal: (modal: Modal) => void; showPerson: (id: string) => void; manageJobs: () => void;
  refreshDashboard: () => Promise<unknown>;
}) {
  const [route, setRoute] = useState<Route>(null);
  const [companies, setCompanies] = useState<CompanyPage[] | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [directory, setDirectory] = useState('Discover');
  const [tab, setTab] = useState('Overview');
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [editingPage, setEditingPage] = useState<Showcase | undefined>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const currentCompany = useRef<number | null>(null);
  const companyId = route?.company ?? null;
  const latestNotice = dashboard.notifications.find((notice) => notice.category === 'Companies')?.id;
  const jobRevision = dashboard.jobs.filter((job) => companyId !== null && job.companyId === companyId)
    .map((job) => `${job.id}:${job.closed}:${job.saved}`).join(',');

  const load = useCallback(async (id: number | null, signal?: AbortSignal) => {
    try {
      const [list, company] = await Promise.all([
        api<CompanyPage[]>('companies', { signal }),
        id ? api<CompanyDetail>(`companies/${id}`, { signal }) : null
      ]);
      if (signal?.aborted || readRoute()?.company !== (id ?? undefined)) return;
      setCompanies(list);
      setDetail(company);
      setError('');
    } catch (failure) {
      if (!signal?.aborted && readRoute()?.company === (id ?? undefined)) setError((failure as Error).message);
    }
  }, []);

  useEffect(() => {
    const update = () => {
      const next = readRoute();
      if (currentCompany.current !== (next?.company ?? null)) setTab('Overview');
      currentCompany.current = next?.company ?? null;
      setRoute(next);
      setPanel(null);
      setEditingPage(undefined);
      setStatus('');
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(companyId, controller.signal);
    return () => controller.abort();
  }, [companyId, jobRevision, latestNotice, load]);

  function open(next: Route) {
    const hash = next ? `companies?company=${next.company}${next.page ? `&page=${next.page}` : ''}` : 'companies';
    if (window.location.hash === '#' + hash) void load(next?.company ?? null);
    else window.location.hash = hash;
    setPanel(null);
    window.scrollTo({ top: 0 });
  }

  async function share() {
    const url = new URL('/' + window.location.hash, window.location.origin).href;
    try { await navigator.clipboard.writeText(url); setStatus('Link copied.'); }
    catch { setStatus(url); }
  }

  const refreshAfter: Action = async (path, body, success, method) => {
    const ok = await action(path, body, success, method);
    if (ok) await load(companyId);
    return ok;
  };

  async function run(path: string, body: object | undefined, success: string, method?: string) {
    setBusy(true);
    try { return await refreshAfter(path, body, success, method); }
    finally { setBusy(false); }
  }

  const company = detail?.company.id === companyId ? detail.company : null;
  const page = route?.page && company ? detail?.pages.find((item) => item.id === route.page) : undefined;
  const canManage = company ? mayManageCompany(company) : false;
  const isOwner = company?.role === 'owner';
  const lookup = query.trim().toLowerCase();
  const displayed = companies?.filter((item) => {
    if (directory === 'Following' && !item.following) return false;
    if (directory === 'Managed pages' && !mayManageCompany(item)) return false;
    return !lookup || [item.name, item.industry, item.headquarters, ...item.locations].join(' ').toLowerCase().includes(lookup);
  });

  function review(member: CompanyMember, decision: Decision) {
    if (!company) return;
    if (decision === 'transfer' && !window.confirm(`Transfer ownership of ${company.name} to ${member.name}?`)) return;
    void run(`companies/${company.id}/members/${member.id}`, { action: decision }, decisions[decision]);
  }

  let content;
  if (error) {
    content = <section className="card content-card">
      <p className="form-error" role="alert">{error}</p>
      <div className="button-row"><button className="button secondary" onClick={() => void load(companyId)}>Try again</button>
        {companyId && <button className="button secondary" onClick={() => open(null)}>Back to companies</button>}</div>
    </section>;
  } else if (company && detail && route?.page) {
    content = <>
      <button className="text-link group-back" onClick={() => { setTab('Products & showcases'); open({ company: company.id, page: null }); }}>
        Back to {company.name}</button>
      {page ? <article className="card company-showcase-detail">
        <div className="company-showcase-heading"><BrandAvatar brand={company} size={56} /><div><span className="status violet">{page.kind}</span>
          <h1>{page.title}</h1><p className="muted">{company.name}</p></div></div>
        <p className="body-copy">{page.description}</p>
        <div className="button-row">
          {page.url && <a className="button primary" href={page.url} target="_blank" rel="noreferrer"><Globe2 size={17} /> Visit website</a>}
          <button className="button secondary" onClick={() => void share()}><Link2 size={17} /> Copy page link</button>
          {canManage && <button className="button secondary" onClick={() => { setEditingPage(page); setPanel('showcase'); }}>
            <Pencil size={17} /> Edit page</button>}
          {canManage && <button className="text-link" disabled={busy} onClick={async () => {
            if (!window.confirm('Permanently delete this page?')) return;
            if (await run(`companies/${company.id}/pages/${page.id}`, undefined, 'Page deleted', 'DELETE')) {
              setTab('Products & showcases');
              open({ company: company.id, page: null });
            }
          }}>Delete page</button>}
        </div>
        {status && <p className="form-status event-share-notice" role="status">{status}</p>}
      </article> : <Empty title="This page is unavailable" />}
    </>;
  } else if (company && detail) {
    const availableTabs = canManage ? [...tabs, 'Manage'] : tabs;
    const activeTab = availableTabs.includes(tab) ? tab : 'Overview';
    content = <>
      <button className="text-link group-back" onClick={() => open(null)}>Back to companies</button>
      <section className="card company-detail">
        <div className="company-hero-banner">
          {company.hasBanner && <img src={companyImagePath(company, 'banner')} alt={company.bannerAlt} />}
        </div>
        <div className="company-hero-content">
          <div className="company-logo-tile"><BrandAvatar brand={company} size={72} /></div>
          <div className="company-hero-heading"><div>
            <h1>{company.name}</h1><p className="company-hero-meta"><span>{company.industry}</span><span><MapPin size={16} />{company.headquarters}</span>
              <span><UsersRound size={17} />{plural(company.followerCount, 'follower')}</span></p>
          </div>{canManage && <button className="button secondary" onClick={() => setPanel('edit')}><Pencil size={17} /> Edit company</button>}</div>
          <div className="company-hero-actions">
            <button className={`button ${company.following ? 'secondary' : 'primary'}`} aria-pressed={company.following} disabled={busy}
              onClick={() => void run(`companies/${company.id}/follow`, { active: !company.following }, company.following ? 'Company unfollowed' : 'Company followed')}>
              {company.following ? <Check size={17} /> : <Plus size={17} />} {company.following ? 'Following' : 'Follow'}
            </button>
            {company.ctaUrl && <a className="button secondary" href={company.ctaUrl} target="_blank" rel="noreferrer"><Globe2 size={17} />{company.ctaLabel}</a>}
            <button className="button secondary" onClick={() => void share()}><Link2 size={17} /> Copy company link</button>
          </div>
          {status && <p className="form-status event-share-notice" role="status">{status}</p>}
        </div>
      </section>
      <FilterTabs values={availableTabs} current={activeTab} change={(next) => { setTab(next); if (next !== activeTab) void load(company.id); }} />
      {activeTab === 'Overview' && <div className="column-stack">
        <section className="card content-card"><h2>About</h2><p className="body-copy">{company.description}</p>
          <dl className="company-facts">
            <div><dt>Industry</dt><dd>{company.industry}</dd></div>
            <div><dt>Company size</dt><dd>{company.size} employees</dd></div>
            <div><dt>Headquarters</dt><dd>{company.headquarters}</dd></div>
            <div><dt>Workplace</dt><dd>{company.workplace}</dd></div>
          </dl>
          {company.website && <a className="text-link company-site-link" href={company.website} target="_blank" rel="noreferrer"><Globe2 size={16} /> Visit company website</a>}
        </section>
        {company.locations.length > 0 && <section className="card content-card"><h2>Other locations</h2>
          <div className="company-locations">{company.locations.map((place) => <span className="status" key={place}><MapPin size={14} />{place}</span>)}</div>
        </section>}
        {company.culture && <section className="card content-card"><h2>Life at {company.name}</h2><p className="body-copy">{company.culture}</p></section>}
      </div>}
      {activeTab === 'Updates' && <>
        <div className="section-heading group-section-heading"><h2>Company updates</h2>
          {canManage && <button className="button primary compact" onClick={() => setPanel('update')}><Plus size={17} /> Post an update</button>}</div>
        {detail.posts.length ? <div className="post-stack">{detail.posts.map((post) => <FeedPost key={post.id} post={post} dashboard={dashboard} trackAnalytics
          action={refreshAfter} showPerson={showPerson} showReport={(id) => showModal({ kind: 'report', id })}
          hideDiscussion={canManage ? (id) => { if (!busy) void run(`companies/${company.id}/updates/${id}`, { hide: true }, 'Update hidden'); } : undefined} />)}</div> :
          <Empty title="No company updates yet" />}
      </>}
      {activeTab === 'Jobs' && <>
        <div className="section-heading group-section-heading"><h2>Open jobs</h2>
          {canManage && <div className="company-row-actions"><button className="button secondary compact" onClick={manageJobs}>Manage jobs</button>
            <button className="button primary compact" onClick={() => showModal({ kind: 'newJob', company: { id: company.id, name: company.name } })}>
              <Plus size={17} /> Post a job</button></div>}
        </div>
        {detail.jobs.length ? <div className="jobs-grid">{detail.jobs.map((job) => <JobListItem key={job.id} job={job}
          application={dashboard.applications.find((item) => item.jobId === job.id)}
          showJob={() => showModal({ kind: 'job', id: job.id })}
          save={() => void run(`jobs/${job.id}/save`, { active: !job.saved }, job.saved ? 'Job removed from saved' : 'Job saved')} />)}</div> :
          <Empty title="No open roles" />}
      </>}
      {activeTab === 'People' && <section className="card content-card">
        <div className="section-heading"><div><h2>People</h2><p className="muted">{plural(company.employeeCount, 'team member')}</p></div>
          {!isOwner && <button className={`button ${company.role === 'none' ? 'primary' : 'secondary'} compact`} disabled={busy} onClick={() => {
            const join = company.role === 'none';
            void run(`companies/${company.id}/membership`, { join }, join ? 'Request sent' :
              company.role === 'requested' ? 'Request cancelled' : 'Left company');
          }}>{company.role === 'none' ? 'Request to join' : company.role === 'requested' ? 'Cancel request' : 'Leave company'}</button>}
        </div>
        {detail.team.map((member) => <div className="group-person-row" key={member.id}>
          <MemberSummary member={member} /><span className={`status ${member.role !== 'employee' ? 'violet' : ''}`}>{roleName[member.role]}</span>
          {canManage && member.id !== dashboard.me.id && member.role !== 'owner' && <div className="group-row-actions">
            {isOwner && <button className="button secondary compact" disabled={busy} onClick={() =>
              review(member, member.role === 'admin' ? 'demote' : 'promote')}>{member.role === 'admin' ? 'Make employee' : 'Make admin'}</button>}
            {isOwner && <button className="text-link" disabled={busy} onClick={() => review(member, 'transfer')}>Transfer ownership</button>}
            {(isOwner || member.role === 'employee') && <button className="text-link" disabled={busy} onClick={() => review(member, 'remove')}>Remove</button>}
          </div>}
        </div>)}
      </section>}
      {activeTab === 'Products & showcases' && <>
        <div className="section-heading group-section-heading"><h2>Products &amp; showcases</h2>
          {canManage && <button className="button primary compact" onClick={() => { setEditingPage(undefined); setPanel('showcase'); }}>
            <Plus size={17} /> Create a page</button>}</div>
        {detail.pages.length ? <div className="company-grid">{detail.pages.map((item) => <article className="card content-card company-showcase-card" key={item.id}>
          <div className="publication-tags"><Package size={18} /><span className="status violet">{item.kind}</span></div>
          <h3><button className="group-title-link" onClick={() => open({ company: company.id, page: item.id })}>{item.title}</button></h3>
          <p className="review-excerpt">{item.description}</p>
        </article>)}</div> : <Empty title="No product or showcase pages yet" />}
      </>}
      {activeTab === 'Manage' && canManage && detail.analytics && <div className="column-stack">
        <section className="card content-card"><div className="section-heading"><h2>Page analytics</h2>
          <a className="text-link" href="#analytics?tab=companies">Open Analytics</a></div><dl className="event-metrics company-metrics">
          <div><dt>Unique visitors</dt><dd>{detail.analytics.visitorCount}</dd></div>
          <div><dt>Followers</dt><dd>{detail.analytics.followerCount}</dd></div>
          <div><dt>Team members</dt><dd>{detail.analytics.employeeCount}</dd></div>
          <div><dt>Open jobs</dt><dd>{detail.analytics.openJobs}</dd></div>
          <div><dt>Visible updates</dt><dd>{detail.analytics.updateCount}</dd></div>
        </dl></section>
        <section className="card content-card"><div className="section-heading"><h2>Team requests</h2><span className="status violet">{detail.requests.length} pending</span></div>
          {detail.requests.length ? detail.requests.map((member) => <div className="group-person-row" key={member.id}>
            <MemberSummary member={member} note={`Requested ${day(member.requestedAt)}`} />
            <div className="group-row-actions"><button className="button secondary compact" disabled={busy} onClick={() => review(member, 'decline')}>Decline</button>
              <button className="button primary compact" disabled={busy} onClick={() => review(member, 'approve')}>Approve</button></div>
          </div>) : <p className="muted group-inline-empty">No pending requests.</p>}
        </section>
        <section className="card content-card"><h2>Hidden updates</h2>
          {detail.hidden.length ? detail.hidden.map((post) => <div className="group-hidden-row" key={post.id}>
            <div className="review-excerpt">{post.body}</div><button className="button secondary compact" disabled={busy}
              onClick={() => void run(`companies/${company.id}/updates/${post.id}`, { hide: false }, 'Update restored')}>Restore</button>
          </div>) : <p className="muted">No hidden updates.</p>}
        </section>
      </div>}
    </>;
  } else if (companyId || !companies) {
    content = <p className="muted" role="status">Loading companies…</p>;
  } else {
    content = <>
      <div className="page-intro company-directory-intro"><div><h1>Companies</h1><p>Find employers, see how they work, and follow their updates.</p></div>
        <button className="button primary" onClick={() => setPanel('create')}><Plus size={18} /> Create a company page</button></div>
      <div className="group-tools"><FilterTabs values={directoryTabs} current={directory} change={setDirectory} />
        <label className="group-search"><Search size={18} /><span className="sr-only">Search companies</span>
          <input placeholder="Search company, industry, or city" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
      {displayed?.length ? <div className="company-grid">{displayed.map((item) =>
        <CompanyCard key={item.id} item={item} open={() => open({ company: item.id, page: null })} />)}</div> :
        <Empty title={lookup ? 'No matching companies' : directory === 'Following' ? 'You aren’t following any companies' :
          directory === 'Managed pages' ? 'You don’t manage any companies yet' : 'No companies yet'} />}
    </>;
  }

  return <>{content}
    {(panel === 'create' || panel === 'edit') && <CompanyProfileForm company={panel === 'edit' ? company ?? undefined : undefined}
      close={() => setPanel(null)} done={(id) => {
        open({ company: id, page: null });
        if (panel === 'edit') void refreshDashboard().catch(() => {});
      }} />}
    {panel === 'update' && company && <CompanyUpdateForm company={company} close={() => setPanel(null)} done={() => {
      setPanel(null); void load(company.id); void refreshDashboard().catch(() => {});
    }} />}
    {panel === 'showcase' && company && <ShowcaseForm company={company} page={editingPage} close={() => setPanel(null)}
      done={(id) => { open({ company: company.id, page: id }); void load(company.id); }} />}
  </>;
}
