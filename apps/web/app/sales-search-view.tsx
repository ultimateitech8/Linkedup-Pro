'use client';

import { useState, type FormEvent } from 'react';
import { Bookmark, Building2, Clock3, MapPin, Search, UsersRound } from 'lucide-react';
import { useApiMutation, useApiResource } from './api-resource';
import { Avatar, BrandAvatar, Empty } from './components';
import { accountPath, companyHref, leadPath, salesDate, type SalesAccount, type SalesLead, type SalesSearchResult, type SavedSalesAccount } from './sales-data';

type SearchActions = { changed: () => void };
const sizes = ['1–10', '11–50', '51–200', '201–500', '501–1,000', '1,001–5,000', '5,001+'];
const workplaces = ['Remote', 'Hybrid', 'On-site', 'Varies by role'];

export function SalesLoadError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="card content-card sales-feedback"><p role="alert">{message}</p>
    <button className="button secondary" onClick={retry}>Try again</button></div>;
}

function useSalesSearch<T>(kind: 'leads' | 'accounts') {
  const [filters, setFilters] = useState('');
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams(filters);
  if (offset) params.set('offset', String(offset));
  const { snapshot, refresh } = useApiResource<SalesSearchResult<T>>(`sales/${kind}?${params}`);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => { if (typeof value === 'string' && value.trim()) query.set(key, value.trim()); });
    setFilters(query.toString());
    setOffset(0);
    refresh();
  }
  function paginate(value: number) {
    setOffset(value);
    window.scrollTo({ top: 0 });
  }
  return { search, paginate, offset, snapshot, refresh };
}

function Pagination({ offset, next, paginate }: { offset: number; next: number | null; paginate: (value: number) => void }) {
  if (!offset && !next) return null;
  return <div className="sales-actions">
    {offset > 0 && <button className="button secondary" onClick={() => paginate(Math.max(0, offset - 20))}>Previous page</button>}
    {next !== null && <button className="button secondary" onClick={() => paginate(next)}>Next page</button>}
  </div>;
}

function SaveProspect({ saved, kind, path, changed }: SearchActions & { saved: boolean; kind: 'lead' | 'account'; path: string }) {
  const { save, busy, error } = useApiMutation();
  const [done, setDone] = useState(false);
  return <div className="sales-save">
    {saved || done ? <a className="button secondary compact" href={kind === 'lead' ? '#sales?tab=pipeline' : '#sales?tab=pipeline&view=accounts'}>
      <Bookmark size={16} fill="currentColor" /> Saved {kind}</a> : <button className="button secondary compact" disabled={busy}
      onClick={async () => {
        if (await save(path, { active: true }, 'PUT')) {
          setDone(true);
          changed();
        }
      }}><Bookmark size={16} /> Save {kind}</button>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </div>;
}

function LeadCard({ lead, showPerson, changed }: SearchActions & { lead: SalesLead; showPerson: (id: string) => void }) {
  return <article className="card sales-result">
    <div className="sales-person"><Avatar person={lead} size={47} /><div>
      <h2><button className="sales-title" onClick={() => showPerson(lead.id)}>{lead.name}</button></h2>
      <p>{lead.headline || 'Linkedup Pro member'}</p>
    </div></div>
    <div className="sales-meta">
      {lead.location && <span><MapPin size={15} /> {lead.location}</span>}
      {lead.companyId && <a className="text-link" href={companyHref(lead.companyId)}><Building2 size={15} /> {lead.companyName}</a>}
      {lead.relationship === 'connected' ? <span className="status green"><UsersRound size={14} /> Connected</span> :
        lead.mutualCount > 0 ? <span><UsersRound size={15} /> {lead.mutualCount} mutual {lead.mutualCount === 1 ? 'connection' : 'connections'}</span> :
          <span>Outside your network</span>}
    </div>
    {lead.leadershipSignal && <p className="sales-signal"><span className="status violet">{lead.leadershipSignal}</span></p>}
    {lead.matchedSkills.length ? <p className="sales-match">Shared {lead.matchedSkills.length === 1 ? 'skill' : 'skills'} · {lead.matchedSkills.slice(0, 3).join(', ')}</p> :
      lead.skills.length > 0 && <p className="sales-match">{lead.skills.slice(0, 4).join(' · ')}</p>}
    <div className="sales-result-footer">
      <button className="text-link" onClick={() => showPerson(lead.id)}>View profile</button>
      <SaveProspect path={leadPath(lead.id)} saved={lead.saved} kind="lead" changed={changed} />
    </div>
  </article>;
}

export function AccountIdentity({ account }: { account: SalesAccount | SavedSalesAccount }) {
  return <div className="sales-person"><BrandAvatar brand={account} size={46} /><div>
    <h2><a className="sales-title" href={companyHref(account.id)}>{account.name}</a></h2>
    <p>{account.industry} · {account.size} employees</p>
  </div></div>;
}

export function AccountSignals({ account }: { account: Pick<SalesAccount, 'openJobs' | 'newJobs' | 'recentUpdates'> }) {
  return <div className="sales-signals">
    <span><strong>{account.openJobs}</strong> open {account.openJobs === 1 ? 'job' : 'jobs'}</span>
    <span><strong>{account.newJobs}</strong> new open {account.newJobs === 1 ? 'job' : 'jobs'} in 30 days</span>
    <span><strong>{account.recentUpdates}</strong> public {account.recentUpdates === 1 ? 'update' : 'updates'} in 30 days</span>
  </div>;
}

function AccountCard({ account, changed }: SearchActions & { account: SalesAccount }) {
  return <article className="card sales-result">
    <AccountIdentity account={account} />
    <div className="sales-meta"><span><MapPin size={15} /> {account.headquarters}</span><span>{account.workplace}</span></div>
    <p className="sales-account-description">{account.description}</p>
    <AccountSignals account={account} />
    <div className="sales-result-footer">
      <a className="text-link" href={companyHref(account.id)}>Company page</a>
      <SaveProspect path={accountPath(account.id)} saved={account.saved} kind="account" changed={changed} />
    </div>
  </article>;
}

export function LeadSearch({ changed, showPerson }: SearchActions & { showPerson: (id: string) => void }) {
  const { snapshot, refresh, offset, search, paginate } = useSalesSearch<SalesLead>('leads');
  return <>
    <form className="card sales-filters field-form" onSubmit={search} aria-label="Lead search filters">
      <div className="sales-filter-grid">
        <label>Name, title, or skill<input type="search" name="q" maxLength={120} placeholder="e.g. Product design" /></label>
        <label>Company<input name="company" maxLength={120} placeholder="e.g. Forma" /></label>
        <label>Location<input name="location" maxLength={120} /></label>
        <label>Connection level<select name="relationship"><option value="">Any relationship</option>
          <option value="connected">1st degree</option><option value="mutual">2nd degree</option><option value="outside">Outside your network</option></select></label>
      </div>
      <div className="sales-filter-actions">
        <label className="sales-check"><input type="checkbox" name="leaders" value="1" /> Leadership signals only</label>
        <label className="sales-check"><input type="checkbox" name="recommended" value="1" /> Recommended leads</label>
        <button className="button primary"><Search size={17} /> Search leads</button>
      </div>
    </form>
    {!snapshot && <p className="muted" role="status">Loading leads…</p>}
    {snapshot && 'error' in snapshot && <SalesLoadError message={snapshot.error} retry={refresh} />}
    {snapshot && 'data' in snapshot && <>
      {snapshot.data.results.length ? <div className="sales-result-grid">{snapshot.data.results.map((lead) => <LeadCard
        key={lead.id} lead={lead} changed={changed} showPerson={showPerson} />)}</div> :
        <Empty title="No matching leads">Try a different keyword, location, or connection level.</Empty>}
      <Pagination offset={offset} next={snapshot.data.next} paginate={paginate} />
    </>}
  </>;
}

export function AccountSearch({ changed }: SearchActions) {
  const { snapshot, refresh, offset, search, paginate } = useSalesSearch<SalesAccount>('accounts');
  return <>
    <form className="card sales-filters field-form" onSubmit={search} aria-label="Account search filters">
      <div className="sales-filter-grid sales-account-filters">
        <label>Company or keyword<input type="search" name="q" maxLength={120} /></label>
        <label>Industry<input name="industry" maxLength={120} placeholder="e.g. Software" /></label>
        <label>Location<input name="location" maxLength={120} /></label>
        <label>Company size<select name="size"><option value="">Any size</option>{sizes.map((size) => <option key={size}>{size}</option>)}</select></label>
        <label>Workplace<select name="workplace"><option value="">Any workplace</option>{workplaces.map((place) => <option key={place}>{place}</option>)}</select></label>
      </div>
      <div className="sales-filter-actions">
        <label className="sales-check"><input type="checkbox" name="hiring" value="1" /> Hiring now</label>
        <button className="button primary"><Search size={17} /> Search accounts</button>
      </div>
    </form>
    {!snapshot && <p className="muted" role="status">Loading accounts…</p>}
    {snapshot && 'error' in snapshot && <SalesLoadError message={snapshot.error} retry={refresh} />}
    {snapshot && 'data' in snapshot && <>
      {snapshot.data.results.length ? <div className="sales-result-grid">{snapshot.data.results.map((account) =>
        <AccountCard key={account.id} account={account} changed={changed} />)}</div> :
        <Empty title="No matching accounts">Try a different industry, location, or company size.</Empty>}
      <Pagination offset={offset} next={snapshot.data.next} paginate={paginate} />
    </>}
  </>;
}

export function SalesReminder({ value }: { value: string | null }) {
  if (!value) return null;
  return <span className="sales-reminder"><Clock3 size={15} /> Follow up {salesDate(value)}</span>;
}
