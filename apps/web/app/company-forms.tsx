'use client';

import { useState, type FormEvent } from 'react';
import { BrandAvatar, Dialog } from './components';
import { api, companyImagePath } from './data';
import { CoverPicker } from './publication-cover';
import { appendCover } from './publications-data';
import type { CompanyPage, Showcase } from './company-data';

const sizes = ['1–10','11–50','51–200','201–500','501–1,000','1,001–5,000','5,001+'];

export function CompanyProfileForm({ company, close, done }: { company?: CompanyPage; close: () => void; done: (id: number) => void }) {
  const [logo, setLogo] = useState({ file: null as File | null, alt: company?.logoAlt ?? '', remove: false });
  const [banner, setBanner] = useState({ file: null as File | null, alt: company?.bannerAlt ?? '', remove: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      appendCover(form, logo, 'logo');
      appendCover(form, banner, 'banner');
      const saved = await api<{ id: number }>(company ? `companies/${company.id}` : 'companies',
        { method: company ? 'PATCH' : 'POST', body: form });
      done(saved.id);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog title={company ? 'Edit company' : 'Create a company page'} close={close} error={error}>
    <form className="field-form company-form" onSubmit={submit}>
      <label>Company name<input autoFocus name="name" defaultValue={company?.name} maxLength={100} required /></label>
      <label>Description<textarea name="description" defaultValue={company?.description} rows={3} maxLength={2400} required /></label>
      <div className="event-form-grid">
        <label>Industry<input name="industry" defaultValue={company?.industry} maxLength={80} required /></label>
        <label>Company size<select name="size" defaultValue={company?.size ?? sizes[0]}>{sizes.map((size) => <option key={size}>{size}</option>)}</select></label>
      </div>
      <div className="event-form-grid">
        <label>Headquarters<input name="headquarters" defaultValue={company?.headquarters} maxLength={120} required /></label>
        <label>Workplace<select name="workplace" defaultValue={company?.workplace ?? 'Varies by role'}>
          {['On-site','Hybrid','Remote','Varies by role'].map((item) => <option key={item}>{item}</option>)}
        </select></label>
      </div>
      <label>Other locations <small>Optional · One per line</small><textarea name="locations" defaultValue={company?.locations.join('\n')} rows={2} maxLength={900} /></label>
      <label>Website <small>Optional</small><input name="website" type="url" defaultValue={company?.website ?? ''} maxLength={2048} placeholder="https://…" /></label>
      <label>Life at the company <small>Optional</small><textarea name="culture" defaultValue={company?.culture} rows={3} maxLength={3000} /></label>
      <div className="event-form-grid">
        <label>Action button label <small>Optional</small><input name="ctaLabel" defaultValue={company?.ctaLabel ?? ''} maxLength={40} placeholder="Contact us" /></label>
        <label>Action button link <small>Optional</small><input name="ctaUrl" type="url" defaultValue={company?.ctaUrl ?? ''} maxLength={2048} placeholder="https://…" /></label>
      </div>
      <CoverPicker value={logo} update={setLogo} existing={company?.hasLogo ? companyImagePath(company, 'logo') : undefined}
        label="Company logo" altLabel="Logo description" removeLabel="Remove logo" previewClass="company-logo-preview" maxMb={2} />
      <CoverPicker value={banner} update={setBanner} existing={company?.hasBanner ? companyImagePath(company, 'banner') : undefined}
        label="Company banner" altLabel="Banner description" removeLabel="Remove banner" />
      <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{company ? 'Save changes' : 'Create company page'}</button></div>
    </form>
  </Dialog>;
}

export function CompanyUpdateForm({ company, close, done }: { company: CompanyPage; close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      await api(`companies/${company.id}/updates`, {
        method: 'POST', body: JSON.stringify({ body: form.get('body'), notifyEmployees: form.has('notifyEmployees') })
      });
      done();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog title="Post a company update" close={close} error={error}><form className="field-form" onSubmit={submit}>
    <div className="company-post-identity"><BrandAvatar brand={company} /><strong>{company.name}</strong></div>
    <label>Update<textarea name="body" autoFocus rows={5} required maxLength={3000} /></label>
    <label className="company-notify"><input type="checkbox" name="notifyEmployees" /> Notify employees</label>
    <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>Cancel</button>
      <button className="button primary" disabled={busy}>Publish update</button></div>
  </form></Dialog>;
}

export function ShowcaseForm({ company, page, close, done }: { company: CompanyPage; page?: Showcase; close: () => void; done: (id: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const form = Object.fromEntries(new FormData(event.currentTarget));
      const base = `companies/${company.id}/pages`;
      const saved = await api<{ id: number }>(page ? `${base}/${page.id}` : base,
        { method: page ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      done(saved.id);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog title={page ? 'Edit page' : 'Create a product or showcase page'} close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <label>Page type<select name="kind" defaultValue={page?.kind ?? 'Product'}><option>Product</option><option>Showcase</option></select></label>
      <label>Page title<input name="title" autoFocus defaultValue={page?.title} maxLength={100} required /></label>
      <label>Description<textarea name="description" defaultValue={page?.description} rows={5} maxLength={2000} required /></label>
      <label>Website <small>Optional</small><input name="url" type="url" defaultValue={page?.url ?? ''} maxLength={2048} placeholder="https://…" /></label>
      <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{page ? 'Save changes' : 'Create page'}</button></div>
    </form>
  </Dialog>;
}
