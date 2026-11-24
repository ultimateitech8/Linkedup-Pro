'use client';

import { useState, type FormEvent } from 'react';
import { useApiMutation } from './api-resource';
import { Dialog } from './components';
import { leadPath, salesStages, type SalesList, type SalesWorkspace, type SavedSalesLead } from './sales-data';

function FormButtons({ label, busy, close, disabled }: { label: string; busy: boolean; close: () => void; disabled?: boolean }) {
  return <div className="dialog-footer"><button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button>
    <button className="button primary" disabled={busy || disabled}>{busy ? 'Saving…' : label}</button></div>;
}

function localInputDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function SavedLeadForm({ lead, close, saved }: { lead: SavedSalesLead; close: () => void; saved: () => void }) {
  const { busy, error, save } = useApiMutation();
  const initial = localInputDate(lead.followUpAt);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const followUp = String(form.get('followUp') ?? '');
    const followUpAt = followUp === initial ? lead.followUpAt : followUp ? new Date(followUp).toISOString() : null;
    if (await save(leadPath(lead.id), { stage: form.get('stage'), notes: form.get('notes'), followUpAt }, 'PATCH')) saved();
  }
  return <Dialog title="Edit saved lead" close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <p className="muted">{lead.name}</p>
      <label>Pipeline stage<select name="stage" defaultValue={lead.stage}>
        {salesStages.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label>Follow-up time <small>Optional · your local time</small><input name="followUp" type="datetime-local" defaultValue={initial} max="9999-12-31T23:59" /></label>
      <label>Private notes<textarea name="notes" defaultValue={lead.notes} rows={5} maxLength={3000} /></label>
      <FormButtons label="Save lead changes" busy={busy} close={close} />
    </form>
  </Dialog>;
}

export function ProspectListForm({ list, close, saved }: { list?: SalesList; close: () => void; saved: (id: number) => void }) {
  const { busy, error, save } = useApiMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await save<{ id: number }>(list ? 'sales/lists/' + list.id : 'sales/lists', { name: form.get('name') }, list ? 'PATCH' : 'POST');
    if (result) saved(result.id);
  }
  return <Dialog title={list ? 'Rename prospect list' : 'Create a prospect list'} close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <label>List name<input name="name" defaultValue={list?.name} maxLength={90} required autoFocus /></label>
      <FormButtons label={list ? 'Save list name' : 'Create list'} busy={busy} close={close} />
    </form>
  </Dialog>;
}

export function AddProspectForm({ list, workspace, close, saved }: {
  list: SalesList; workspace: SalesWorkspace; close: () => void; saved: () => void;
}) {
  const leads = workspace.leads.filter((lead) => !list.leadIds.includes(lead.id));
  const accounts = workspace.accounts.filter((account) => !list.accountIds.includes(account.id));
  const [kind, setKind] = useState<'leads' | 'accounts'>(leads.length ? 'leads' : 'accounts');
  const { busy, error, save } = useApiMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const chosen = String(form.get('prospect') ?? '');
    if (await save(`sales/lists/${list.id}/${kind}/${encodeURIComponent(chosen)}`, { active: true }, 'PUT')) saved();
  }
  const options = kind === 'leads' ? leads : accounts;
  return <Dialog title="Add a saved prospect" close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <label>Prospect type<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
        <option value="leads">Lead</option><option value="accounts">Account</option>
      </select></label>
      <label>Saved prospect<select name="prospect" key={kind} defaultValue="" required>
        <option value="">Choose a saved prospect</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {!options.length && <p className="muted">Save more prospects from search to add them here.</p>}
      <FormButtons label="Add to list" busy={busy} disabled={!options.length} close={close} />
    </form>
  </Dialog>;
}

export function ConfirmSalesChange({ title, copy, label, path, method, close, saved }: {
  title: string; copy: string; label: string; path: string; method: 'PUT' | 'DELETE'; close: () => void; saved: () => void;
}) {
  const { busy, error, save } = useApiMutation();
  return <Dialog title={title} close={close} error={error}>
    <p>{copy}</p>
    <form className="field-form" onSubmit={async (event) => {
      event.preventDefault();
      if (await save(path, { active: false }, method)) saved();
    }}><FormButtons label={label} busy={busy} close={close} /></form>
  </Dialog>;
}
