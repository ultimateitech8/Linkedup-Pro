'use client';

import { useState } from 'react';
import { Bell, Download, FolderOpen, MessageCircle, Plus } from 'lucide-react';
import { useApiMutation } from './api-resource';
import { Avatar, BrandAvatar, Empty } from './components';
import { accountPath, companyHref, leadPath, salesListHref, salesStages, type SalesList, type SalesWorkspace, type SavedSalesAccount, type SavedSalesLead } from './sales-data';
import { AddProspectForm, ConfirmSalesChange, ProspectListForm, SavedLeadForm } from './sales-forms';
import { AccountIdentity, AccountSignals, SalesReminder } from './sales-search-view';
import { FilterTabs } from './views';

type LeadActions = { showPerson: (id: string) => void; message: (id: string) => void };
type PipelineFilter = 'All stages' | 'Due follow-ups' | typeof salesStages[number];
const isDue = (lead: SavedSalesLead, now: number) => !!lead.followUpAt && new Date(lead.followUpAt).getTime() <= now;

function LeadIdentity({ lead, showPerson }: { lead: SavedSalesLead; showPerson: (id: string) => void }) {
  return <div className="sales-person"><Avatar person={lead} size={45} /><div>
    <h2><button className="sales-title" onClick={() => showPerson(lead.id)}>{lead.name}</button></h2>
    <p>{lead.headline || 'Linkedup Pro member'}{lead.companyName ? ` · ${lead.companyName}` : ''}</p>
  </div></div>;
}

function FollowAccount({ account, refresh }: { account: SavedSalesAccount; refresh: () => void }) {
  const { busy, error, save } = useApiMutation();
  const [watching, setWatching] = useState<boolean>();
  const active = watching ?? account.watching;
  return <div className="sales-watch">
    <button className="button secondary" aria-pressed={active} disabled={busy} onClick={async () => {
      if (await save(accountPath(account.id), { active: !active }, 'PATCH')) {
        setWatching(!active);
        refresh();
      }
    }}><Bell size={17} /> {active ? 'Job alerts on' : 'Watch for new jobs'}</button>
    {error && <p role="alert" className="dialog-error">{error}</p>}
  </div>;
}

export function SalesPipeline({ workspace, refresh, initial, showPerson, message }: LeadActions & {
  workspace: SalesWorkspace; refresh: () => void; initial?: 'accounts' | 'due';
}) {
  const [section, setSection] = useState(initial === 'accounts' ? 'Saved accounts' : 'Saved leads');
  const [filter, setFilter] = useState<PipelineFilter>(initial === 'due' ? 'Due follow-ups' : 'All stages');
  const [editing, setEditing] = useState<SavedSalesLead | null>(null);
  const [removal, setRemoval] = useState<{ name: string; path: string; kind: 'lead' | 'account' } | null>(null);
  const now = Date.now();
  const leads = workspace.leads.filter((lead) => filter === 'All stages' || (filter === 'Due follow-ups' ? isDue(lead, now) : lead.stage === filter));
  const due = workspace.leads.filter((lead) => isDue(lead, now)).length;

  return <>
    <div className="sales-stats" aria-label="Sales pipeline summary">
      <div className="card"><span>Saved leads</span><strong>{workspace.leads.length}</strong></div>
      <div className="card"><span>Qualified</span><strong>{workspace.leads.filter((lead) => lead.stage === 'Qualified').length}</strong></div>
      <div className="card"><span>Won</span><strong>{workspace.leads.filter((lead) => lead.stage === 'Won').length}</strong></div>
      <div className="card"><span>Due follow-ups</span><strong>{due}</strong></div>
    </div>
    <div className="sales-pipeline-tools">
      <FilterTabs values={['Saved leads', 'Saved accounts']} current={section} change={setSection} />
      {section === 'Saved leads' && <select className="sales-stage-filter" aria-label="Filter by pipeline stage" value={filter}
        onChange={(event) => setFilter(event.target.value as PipelineFilter)}>
        {['All stages', 'Due follow-ups', ...salesStages].map((value) => <option key={value}>{value}</option>)}
      </select>}
      {(workspace.leads.length > 0 || workspace.accounts.length > 0) && <a className="button secondary" href="/api/sales/export" download>
        <Download size={17} /> Export workspace CSV</a>}
    </div>
    {section === 'Saved leads' ? leads.length ? <div className="sales-pipeline-list">{leads.map((lead) =>
      <article className="card content-card sales-pipeline-card" key={lead.id}>
        <div className="sales-pipeline-heading"><LeadIdentity lead={lead} showPerson={showPerson} /><span className={`status ${lead.stage === 'Won' ? 'green' : 'violet'}`}>{lead.stage}</span></div>
        <SalesReminder value={lead.followUpAt} />
        {lead.notes && <p className="sales-private-note">{lead.notes}</p>}
        <div className="sales-actions">
          <button className="button primary compact" onClick={() => setEditing(lead)}>Edit lead</button>
          {lead.relationship === 'connected' && <button className="button secondary compact" onClick={() => message(lead.id)}><MessageCircle size={16} /> Message</button>}
          <button className="text-link" onClick={() => setRemoval({ name: lead.name, path: leadPath(lead.id), kind: 'lead' })}>Remove lead</button>
        </div>
      </article>)}</div> : <Empty title={filter === 'All stages' ? 'No saved leads yet' : 'No leads in this view'}>
        <a className="text-link" href="#sales">Find leads</a>
      </Empty> : workspace.accounts.length ? <div className="sales-pipeline-list">{workspace.accounts.map((account) =>
        <article className="card content-card sales-pipeline-card" key={account.id}>
          <AccountIdentity account={account} /><AccountSignals account={account} />
          <div className="sales-actions">
            <FollowAccount key={String(account.watching)} account={account} refresh={refresh} />
            <button className="text-link" onClick={() => setRemoval({ name: account.name, path: accountPath(account.id), kind: 'account' })}>Remove account</button>
          </div>
        </article>)}</div> : <Empty title="No saved accounts yet"><a className="text-link" href="#sales?tab=accounts">Find accounts</a></Empty>}
    {editing && <SavedLeadForm lead={editing} close={() => setEditing(null)} saved={() => { setEditing(null); refresh(); }} />}
    {removal && <ConfirmSalesChange title={`Remove saved ${removal.kind}?`} label={`Remove ${removal.kind}`} path={removal.path} method="PUT"
      copy={removal.kind === 'lead' ? `${removal.name} will be removed from your lists. Private notes and follow-ups will be deleted.` :
        `${removal.name} will be removed from your lists and new-job alerts will stop.`}
      close={() => setRemoval(null)} saved={() => { setRemoval(null); refresh(); }} />}
  </>;
}

function ListEntry({ listId, kind, id, refresh, children }: {
  listId: number; kind: 'leads' | 'accounts'; id: string | number; refresh: () => void; children: React.ReactNode;
}) {
  const { save, busy, error } = useApiMutation();
  return <div className="sales-list-entry">
    {children}
    <button className="text-link" disabled={busy} onClick={async () => {
      if (await save(`sales/lists/${listId}/${kind}/${encodeURIComponent(id)}`, { active: false }, 'PUT')) refresh();
    }}>Remove from list</button>
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </div>;
}

export function SalesLists({ workspace, selectedId, showPerson, refresh }: {
  workspace: SalesWorkspace; selectedId?: number; showPerson: (id: string) => void; refresh: () => void;
}) {
  const [panel, setPanel] = useState<'create' | 'rename' | 'add' | 'delete' | null>(null);
  const list = workspace.lists.find((entry) => entry.id === selectedId) ?? workspace.lists[0];
  const open = (id?: number) => { window.location.hash = salesListHref(id); };
  const finished = (id?: number) => { setPanel(null); if (id) open(id); refresh(); };
  const leads = list ? workspace.leads.filter((lead) => list.leadIds.includes(lead.id)) : [];
  const accounts = list ? workspace.accounts.filter((account) => list.accountIds.includes(account.id)) : [];
  return <>
    <div className="section-heading sales-lists-heading"><h2>Prospect lists</h2>
      <button className="button primary" onClick={() => setPanel('create')}><Plus size={17} /> New list</button></div>
    {list ? <div className="sales-list-layout">
      <nav className="card sales-list-nav" aria-label="Prospect lists">
        {workspace.lists.map((entry) => <a className="sales-list-link" href={salesListHref(entry.id)} key={entry.id}
          aria-current={entry.id === list.id ? 'page' : undefined} onClick={() => setPanel(null)}>
          <FolderOpen size={17} /><span>{entry.name}</span><small>{entry.leadIds.length + entry.accountIds.length}</small>
        </a>)}
      </nav>
      <section className="card content-card sales-list-detail">
        <div className="sales-list-heading"><h2>{list.name}</h2><div className="sales-actions">
          <button className="button primary compact" onClick={() => setPanel('add')}><Plus size={17} /> Add prospect</button>
          <a className="button secondary compact" href={`/api/sales/export?list=${list.id}`} download><Download size={16} /> Export list CSV</a>
          <button className="text-link" onClick={() => setPanel('rename')}>Rename list</button>
          <button className="text-link" onClick={() => setPanel('delete')}>Delete list</button>
        </div></div>
        {leads.length === 0 && accounts.length === 0 && <p className="muted">Add leads and accounts you’ve saved to this list.</p>}
        {leads.map((lead) => <ListEntry listId={list.id} kind="leads" id={lead.id} refresh={refresh} key={`lead-${lead.id}`}>
          <div className="sales-person"><Avatar person={lead} size={39} /><div><button className="sales-title" onClick={() => showPerson(lead.id)}>{lead.name}</button>
            <p className="muted">{lead.stage}</p></div></div>
        </ListEntry>)}
        {accounts.map((account) => <ListEntry listId={list.id} kind="accounts" id={account.id} refresh={refresh} key={`account-${account.id}`}>
          <div className="sales-person"><BrandAvatar brand={account} size={39} /><div><a className="sales-title" href={companyHref(account.id)}>{account.name}</a>
            <p className="muted">{account.industry}</p></div></div>
        </ListEntry>)}
      </section>
    </div> : <Empty title="No prospect lists yet">Create a list to group leads and accounts.</Empty>}
    {panel === 'create' && <ProspectListForm close={() => setPanel(null)} saved={finished} />}
    {panel === 'rename' && list && <ProspectListForm key={list.id} list={list} close={() => setPanel(null)} saved={finished} />}
    {panel === 'add' && list && <AddProspectForm list={list} workspace={workspace} close={() => setPanel(null)} saved={() => finished()} />}
    {panel === 'delete' && list && <ConfirmSalesChange title="Delete this prospect list?" label="Delete list" path={`sales/lists/${list.id}`} method="DELETE"
      copy={`“${list.name}” will be deleted. Its leads and accounts will stay saved in your pipeline.`}
      close={() => setPanel(null)} saved={() => { open(); finished(); }} />}
  </>;
}
