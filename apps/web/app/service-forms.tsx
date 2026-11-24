'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Dialog } from './components';
import { quoteCurrencies, serviceCategories, serviceModes, serviceRequestHref, serviceWorkMode, type Offering, type Proposal, type Provider } from './service-data';
import { useApiMutation } from './api-resource';

function FormButtons({ close, busy, label }: { close: () => void; busy: boolean; label: string }) {
  return <div className="dialog-footer">
    <button className="button secondary" type="button" disabled={busy} onClick={close}>Cancel</button>
    <button className="button primary" disabled={busy}>{busy ? 'Saving…' : label}</button>
  </div>;
}

export function ProviderForm({ provider, close, saved }: { provider?: Provider; close: () => void; saved: () => void }) {
  const [mode, setMode] = useState<Provider['workMode']>(provider?.workMode ?? 'Remote');
  const { busy, error, save } = useApiMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await save('services/manage', { ...Object.fromEntries(data), accepting: data.has('accepting'), workMode: mode }, 'PUT')) saved();
  }
  return <Dialog title={provider ? 'Edit service page' : 'Create your service page'} close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <label>Service headline<input name="headline" defaultValue={provider?.headline} maxLength={120} required autoFocus /></label>
      <label>About your services<textarea name="about" rows={5} defaultValue={provider?.about} maxLength={1800} required /></label>
      <div className="field-grid">
        <label>Availability<select value={mode} onChange={(event) => setMode(event.target.value as Provider['workMode'])}>
          {serviceModes.map((value) => <option key={value} value={value}>{serviceWorkMode(value)}</option>)}
        </select></label>
        <label>Location{mode === 'Remote' && <small>Optional</small>}
          <input name="location" defaultValue={provider?.location} maxLength={120} required={mode !== 'Remote'} />
        </label>
      </div>
      <label className="service-check"><input type="checkbox" name="accepting" defaultChecked={provider?.accepting ?? true} /> Accept new requests</label>
      <FormButtons label="Save service page" close={close} busy={busy} />
    </form>
  </Dialog>;
}

export function OfferingForm({ offering, close, saved }: { offering?: Offering; close: () => void; saved: () => void }) {
  const { busy, error, save } = useApiMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await save(offering ? `services/listings/${offering.id}` : 'services/listings', {
      ...Object.fromEntries(data), active: data.has('active')
    }, offering ? 'PATCH' : 'POST')) saved();
  }
  return <Dialog title={offering ? 'Edit service listing' : 'Add a service listing'} close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <label>Listing title<input name="title" defaultValue={offering?.title} maxLength={100} required autoFocus /></label>
      <label>Category<select name="category" defaultValue={offering?.category ?? serviceCategories[0]}>
        {serviceCategories.map((category) => <option key={category}>{category}</option>)}
      </select></label>
      <label>What’s included?<textarea name="description" rows={4} defaultValue={offering?.description} maxLength={1200} required /></label>
      <label>Pricing note <small>Optional</small><input name="pricingNote" defaultValue={offering?.pricingNote} maxLength={100} placeholder="e.g. Fixed quote after scoping" /></label>
      <label className="service-check"><input type="checkbox" name="active" defaultChecked={offering?.active ?? true} /> Show this listing on your page</label>
      <FormButtons label="Save listing" close={close} busy={busy} />
    </form>
  </Dialog>;
}

export function NewServiceRequestForm({ provider, offering, kind, close }: {
  provider: Provider; offering?: Offering; kind: 'inquiry' | 'proposal'; close: () => void;
}) {
  const requestKey = useRef<string | undefined>(undefined);
  const { busy, error, save } = useApiMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    requestKey.current ??= crypto.randomUUID();
    const data = new FormData(event.currentTarget);
    const request = await save<{ id: number }>(`services/providers/${provider.id}/requests`, {
      ...Object.fromEntries(data), offeringId: offering?.id, kind, key: requestKey.current
    });
    if (request) window.location.hash = serviceRequestHref(request.id);
  }
  return <Dialog title={kind === 'inquiry' ? 'Send a service inquiry' : 'Request a proposal'} close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <p className="muted">{provider.name}{offering ? ` · ${offering.title}` : ''}</p>
      <label>Project title<input name="title" maxLength={110} defaultValue={offering?.title} required autoFocus /></label>
      <label>{kind === 'inquiry' ? 'Your question' : 'Project brief'}<textarea name="brief" rows={5} maxLength={2500} required /></label>
      <label>Budget <small>Optional</small><input name="budget" maxLength={100} placeholder="e.g. INR 25,000–35,000" /></label>
      <FormButtons label={kind === 'inquiry' ? 'Send inquiry' : 'Send request'} close={close} busy={busy} />
    </form>
  </Dialog>;
}

export function ProposalForm({ requestId, quote, close, saved }: {
  requestId: number; quote: Proposal | null; close: () => void; saved: () => void;
}) {
  const { busy, error, save } = useApiMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = Math.round(Number(data.get('amount')) * 100);
    if (await save(`services/requests/${requestId}/proposal`, { ...Object.fromEntries(data), amount })) saved();
  }
  return <Dialog title={quote ? 'Revise proposal' : 'Write a proposal'} close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <div className="field-grid">
        <label>Quote amount<input name="amount" type="number" min="0.01" max={1000000} step="0.01" defaultValue={quote ? quote.amount / 100 : undefined} required autoFocus /></label>
        <label>Currency<select name="currency" defaultValue={quote?.currency ?? 'USD'}>
          {quoteCurrencies.map((currency) => <option key={currency}>{currency}</option>)}
        </select></label>
      </div>
      <label>Delivery date<input name="delivery" type="date" defaultValue={quote?.delivery} required /></label>
      <label>Scope and deliverables<textarea name="scope" rows={5} maxLength={2200} defaultValue={quote?.scope} required /></label>
      <FormButtons label={quote ? 'Send revised proposal' : 'Send proposal'} close={close} busy={busy} />
    </form>
  </Dialog>;
}

export function ReviewForm({ requestId, close, saved }: { requestId: number; close: () => void; saved: () => void }) {
  const { busy, error, save } = useApiMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await save(`services/requests/${requestId}/review`, { rating: Number(data.get('rating')), body: data.get('body') })) saved();
  }
  return <Dialog title="Review completed work" close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <p className="muted">Your name, rating and review will appear on the provider’s service page.</p>
      <label>Rating<select name="rating" defaultValue="" required>
        <option value="">Choose a rating</option>{[5, 4, 3, 2, 1].map((rating) => <option value={rating} key={rating}>{rating} {rating === 1 ? 'star' : 'stars'}</option>)}
      </select></label>
      <label>Your review<textarea name="body" rows={4} maxLength={800} required /></label>
      <FormButtons label="Publish review" close={close} busy={busy} />
    </form>
  </Dialog>;
}
