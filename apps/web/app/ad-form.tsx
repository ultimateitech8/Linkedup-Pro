'use client';

import { useState, type FormEvent } from 'react';
import { useApiMutation, useApiResource } from './api-resource';
import { adFormats, adObjectives, campaignPath, type AdCampaign, type AdCompany, type AdFormat, type AdObjective, type AdSource } from './ad-data';
import { CoverPicker } from './publication-cover';
import type { CoverSelection } from './publications-data';

function inputTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function AdCampaignForm({ companies, campaign, initial, close, saved }: {
  companies: AdCompany[]; campaign?: AdCampaign; initial?: { companyId?: number; postId?: number };
  close: () => void; saved: (id: number) => void;
}) {
  const [companyId, setCompanyId] = useState(campaign?.companyId ?? initial?.companyId ?? companies[0]?.id);
  const [format, setFormat] = useState<AdFormat>(campaign?.format ?? 'Sponsored post');
  const [objective, setObjective] = useState<AdObjective>(campaign?.objective ?? 'company');
  const [postId, setPostId] = useState(campaign?.postId ?? initial?.postId ?? 0);
  const [image, setImage] = useState<CoverSelection>({ file: null, alt: campaign?.imageAlt ?? '', remove: false });
  const [fieldError, setFieldError] = useState('');
  const { busy, error, save } = useApiMutation();
  const { snapshot: sources, refresh } = useApiResource<AdSource[]>(
    companyId && format === 'Sponsored post' ? `advertising/companies/${companyId}/posts` : null
  );
  const posts = sources && 'data' in sources ? sources.data : [];
  const selected = posts.find((post) => post.id === postId);
  const imageUrl = campaign?.hasImage ? '/api/' + campaignPath(campaign.id) + '/image' : undefined;
  const canSave = !!companyId && (format !== 'Sponsored post' || !!selected);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || busy) return;
    setFieldError('');
    if (format === 'Single image' && !image.file && !imageUrl) { setFieldError('Add an image to save this campaign.'); return; }
    const fields = new FormData(event.currentTarget);
    const get = (key: string) => String(fields.get(key) ?? '').trim();
    const toTime = (entry: string, original?: string | null) => entry === inputTime(original) ? original ?? null : entry ? new Date(entry).toISOString() : null;
    const body = new FormData();
    body.set('payload', JSON.stringify({
      companyId, name: get('name'), format, postId: format === 'Sponsored post' ? postId : null,
      headline: get('headline'), body: get('body'), imageAlt: image.alt, objective, destination: get('destination'),
      buttonLabel: get('buttonLabel'),
      targetLocation: get('targetLocation'), targetSkills: get('targetSkills').split(',').map((skill) => skill.trim()).filter(Boolean),
      followersOnly: fields.has('followersOnly'), budget: Number(get('budget')),
      startsAt: toTime(get('startsAt'), campaign?.startsAt), endsAt: toTime(get('endsAt'), campaign?.endsAt)
    }));
    if (format === 'Single image' && image.file) body.set('image', image.file);
    const result = await save<{ id: number }>(campaign ? campaignPath(campaign.id) : 'advertising/campaigns', body, campaign ? 'PATCH' : 'POST');
    if (result) saved(result.id);
  }

  return <section className="card content-card ad-editor">
    <h2>{campaign ? 'Edit campaign draft' : 'Create a campaign'}</h2>
    <form className="field-form" onSubmit={submit}>
      <fieldset className="ad-section">
        <legend>Creative</legend>
        <div className="field-grid">
          <label>Company page<select value={companyId ?? ''} disabled={!!campaign} onChange={(event) => {
            setCompanyId(Number(event.target.value)); setPostId(0);
          }}>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>
          <label>Campaign name<input name="name" defaultValue={campaign?.name} maxLength={100} required /></label>
        </div>
        <label>Ad format<select value={format} onChange={(event) => setFormat(event.target.value as AdFormat)}>
          {adFormats.map((value) => <option key={value}>{value}</option>)}</select></label>
        {format === 'Sponsored post' ? <>
          <label>Company update<select value={postId || ''} required onChange={(event) => setPostId(Number(event.target.value))}>
            <option value="">Choose an update</option>
            {posts.map((post) => <option value={post.id} key={post.id}>{post.body.slice(0, 95)}</option>)}
          </select></label>
          {!sources && <p className="muted" role="status">Loading company updates…</p>}
          {sources && 'error' in sources && <p className="dialog-error" role="alert">{sources.error} <button type="button" className="text-link" onClick={refresh}>Retry</button></p>}
          {sources && 'data' in sources && !posts.length && <p className="muted">Publish a company update before sponsoring it.</p>}
          {selected && <p className="ad-source-preview">{selected.body}</p>}
        </> : <>
          <label>Ad headline<input name="headline" defaultValue={campaign?.headline} required maxLength={100} /></label>
          <label>Ad text<textarea name="body" defaultValue={campaign?.format === 'Sponsored post' ? '' : campaign?.body ?? ''} rows={4} required maxLength={1400} /></label>
          {format === 'Single image' && <CoverPicker value={image} update={setImage} existing={imageUrl} label="Ad image" optional={false} previewClass="ad-image-preview" />}
        </>}
      </fieldset>
      <fieldset className="ad-section">
        <legend>Call to action</legend>
        <div className="field-grid">
          <label>Objective<select value={objective} onChange={(event) => setObjective(event.target.value as AdObjective)}>
            {Object.entries(adObjectives).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Button label<input name="buttonLabel" defaultValue={campaign?.buttonLabel ?? 'Learn more'} maxLength={30} required /></label>
        </div>
        {objective === 'website' && <label>HTTPS destination<input type="url" name="destination" defaultValue={campaign?.destination ?? ''} maxLength={2048} required placeholder="https://example.com/" /></label>}
        {objective === 'lead' && <p className="muted">Members can choose to share their account name, email, and an optional message with your company.</p>}
      </fieldset>
      <fieldset className="ad-section">
        <legend>Audience and delivery</legend>
        <div className="field-grid">
          <label>Profile location <small>Optional</small><input name="targetLocation" maxLength={100} defaultValue={campaign?.targetLocation} placeholder="e.g. Brooklyn" /></label>
          <label>Profile skills <small>Up to 8, comma separated</small><input name="targetSkills" maxLength={416} defaultValue={campaign?.targetSkills.join(', ')} placeholder="e.g. Product design" /></label>
        </div>
        <label className="ad-check"><input type="checkbox" name="followersOnly" defaultChecked={campaign?.followersOnly} /> Company followers only</label>
        <label>Impression budget<input type="number" name="budget" min={1} max={1000000} defaultValue={campaign?.budget ?? 100} required /></label>
        <p className="muted">The campaign stops after this many feed deliveries.</p>
        <div className="field-grid">
          <label>Start time <small>Optional · starts on publication if blank</small><input type="datetime-local" name="startsAt" max="9999-12-31T23:59" defaultValue={inputTime(campaign?.startsAt)} /></label>
          <label>End time <small>Optional · local time</small><input type="datetime-local" name="endsAt" max="9999-12-31T23:59" defaultValue={inputTime(campaign?.endsAt)} /></label>
        </div>
      </fieldset>
      {(fieldError || error) && <p className="dialog-error" role="alert">{fieldError || error}</p>}
      <div className="button-row">
        <button className="button secondary" type="button" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy || !canSave}>{busy ? 'Saving…' : 'Save draft'}</button>
      </div>
    </form>
  </section>;
}
