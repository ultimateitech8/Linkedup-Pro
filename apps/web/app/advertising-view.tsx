'use client';

import { useEffect, useState } from 'react';
import { Megaphone, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useApiMutation, useApiResource } from './api-resource';
import { Dialog, Empty } from './components';
import { adObjectives, campaignHref, campaignPath, formatAdDate, formatAdNumber, type AdCampaign, type AdCampaignStatus, type AdLead, type AdReport, type AdWorkspace } from './ad-data';
import { AdCampaignForm } from './ad-form';
import { FilterTabs } from './views';

type AdRoute = { view: 'workspace' } | { view: 'create'; company?: number; post?: number } | { view: 'campaign'; id: number };
function readAdRoute(): AdRoute {
  const fields = new URLSearchParams(window.location.hash.split('?')[1]);
  const id = (key: string) => {
    const value = Number(fields.get(key));
    return Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : undefined;
  };
  const campaign = id('campaign');
  if (campaign) return { view: 'campaign', id: campaign };
  if (fields.get('new') === '1') return { view: 'create', company: id('company'), post: id('post') };
  return { view: 'workspace' };
}

function CampaignStatus({ status }: { status: AdCampaignStatus }) {
  const style = status === 'Running' ? 'green' : status === 'Draft' || status === 'Scheduled' ? 'violet' : 'ad-neutral';
  return <span className={`status ${style}`}>{status}</span>;
}

function ImpressionBudget({ campaign }: { campaign: AdCampaign }) {
  return <div className="ad-budget">
    <progress aria-label="Impression budget used" max={campaign.budget} value={campaign.delivered} />
    <span>{formatAdNumber(campaign.delivered)} of {formatAdNumber(campaign.budget)} impressions used</span>
  </div>;
}

function AdError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="card content-card ad-error"><p role="alert">{message}</p>
    <button className="button secondary" onClick={retry}>Try again</button></div>;
}

function CampaignCard({ campaign }: { campaign: AdCampaign }) {
  return <article className="card ad-campaign-card">
    <div className="ad-campaign-card-top"><span className="ad-meta">{campaign.companyName}</span><CampaignStatus status={campaign.status} /></div>
    <h2><a href={campaignHref(campaign.id)}>{campaign.name}</a></h2>
    <p className="ad-meta">{campaign.format} · {adObjectives[campaign.objective]}</p>
    <ImpressionBudget campaign={campaign} />
    <p className="ad-meta">{formatAdNumber(campaign.clicks)} {campaign.clicks === 1 ? 'click' : 'clicks'}{campaign.objective === 'lead' && ` · ${formatAdNumber(campaign.leadCount)} ${campaign.leadCount === 1 ? 'lead' : 'leads'}`}</p>
  </article>;
}

function DailyDeliveries({ days }: { days: AdReport['daily'] }) {
  const max = Math.max(...days.map((day) => day.deliveries), 0);
  const summaryDate = (day: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(day));
  return <section className="card content-card ad-daily">
    <h2>Delivery over the last 14 days</h2>
    {max > 0 ? <>
      <div className="ad-chart" aria-hidden="true">
        {days.map(({ day, deliveries }) => <span key={day} title={`${summaryDate(day)} · ${deliveries} impressions`}
          style={{ height: deliveries ? `${deliveries / max * 100}%` : 2 }} />)}
      </div>
      <div className="ad-chart-dates" aria-hidden="true"><span>{summaryDate(days[0].day)}</span><span>{summaryDate(days[days.length - 1].day)}</span></div>
      <details><summary>Daily metrics (UTC)</summary><div className="ad-table-wrapper">
        <table><thead><tr><th scope="col">Day</th><th scope="col">Impressions</th><th scope="col">CTA clicks</th></tr></thead>
          <tbody>{days.map(({ day, deliveries, clicks }) => <tr key={day}><th scope="row">{summaryDate(day)}</th><td>{formatAdNumber(deliveries)}</td><td>{formatAdNumber(clicks)}</td></tr>)}</tbody></table>
      </div></details>
    </> : <p className="muted">Daily metrics will appear after this campaign is delivered.</p>}
  </section>;
}

function CampaignLeads({ id }: { id: number }) {
  const [offset, setOffset] = useState(0);
  const { snapshot, refresh } = useApiResource<{ leads: AdLead[]; next: number | null }>(campaignPath(id) + '/leads?offset=' + offset, undefined, true);
  if (!snapshot) return <p className="muted" role="status">Loading submitted leads…</p>;
  if ('error' in snapshot) return <AdError message={snapshot.error} retry={refresh} />;
  return <>
    {snapshot.data.leads.length > 0 ? <div className="ad-lead-grid">
      {snapshot.data.leads.map((lead) => <article className="card content-card ad-lead" key={lead.id}>
        <h2>{lead.name}</h2><p>{lead.email}</p><p className="ad-meta">Shared {formatAdDate(lead.consentedAt)}</p>
        {lead.message && <p className="ad-creative-body">{lead.message}</p>}
      </article>)}
    </div> : <Empty title="No submitted leads yet">Contact details appear here after members choose to share them.</Empty>}
    {(offset > 0 || snapshot.data.next !== null) && <div className="ad-actions">
      {offset > 0 && <button className="button secondary" onClick={() => setOffset(Math.max(0, offset - 25))}>Previous page</button>}
      {snapshot.data.next !== null && <button className="button secondary" onClick={() => setOffset(snapshot.data.next ?? 0)}>Next page</button>}
    </div>}
  </>;
}

function CampaignDetail({ id }: { id: number }) {
  const [tab, setTab] = useState('Overview');
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<'end' | 'discard' | null>(null);
  const { snapshot, refresh } = useApiResource<AdReport>(campaignPath(id), undefined, true);
  const { save, busy, error } = useApiMutation();
  const campaign = snapshot && 'data' in snapshot ? snapshot.data : undefined;
  const draft = campaign?.state === 'draft';
  const action = async (value: 'publish' | 'pause' | 'resume' | 'end') => {
    if (await save(campaignPath(id) + '/state', { action: value })) {
      setConfirmation(null);
      refresh();
    }
  };

  return <div className="ad-workspace">
    <a className="text-link ad-back" href="#advertising">Back to campaigns</a>
    {!snapshot && <p className="muted" role="status">Loading the campaign…</p>}
    {snapshot && 'error' in snapshot && <AdError message={snapshot.error} retry={refresh} />}
    {campaign && <>
      <header className="card content-card ad-report-header">
        <div><p className="ad-meta">{campaign.companyName} · {campaign.format}</p><h1>{campaign.name}</h1><CampaignStatus status={campaign.status} /></div>
        <div className="ad-actions">
          <button className="button secondary" onClick={refresh}><RefreshCw size={16} /> Refresh metrics</button>
          {draft && <button className="button secondary" disabled={editing} onClick={() => setEditing(true)}><Pencil size={16} /> Edit draft</button>}
          {draft && <button className="button primary" disabled={busy || editing} onClick={() => void action('publish')}>Publish campaign</button>}
          {(campaign.status === 'Running' || campaign.status === 'Scheduled') && <button className="button secondary" disabled={busy} onClick={() => void action('pause')}>Pause campaign</button>}
          {campaign.status === 'Paused' && <button className="button primary" disabled={busy} onClick={() => void action('resume')}>Resume campaign</button>}
          {draft ? <button className="text-link" disabled={editing} onClick={() => setConfirmation('discard')}>Discard draft</button> :
            (campaign.state === 'active' || campaign.state === 'paused') && campaign.status !== 'Ended' &&
            <button className="text-link" onClick={() => setConfirmation('end')}>End campaign</button>}
        </div>
      </header>
      {error && !confirmation && <p role="alert" className="dialog-error">{error}</p>}
      {editing && draft ? <AdCampaignForm companies={[{ id: campaign.companyId, name: campaign.companyName }]} campaign={campaign}
        close={() => setEditing(false)} saved={() => { setEditing(false); refresh(); }} /> : <>
        <dl className="ad-metrics" aria-label="Campaign performance">
          <div className="card"><dt>Impressions</dt><dd>{formatAdNumber(campaign.delivered)}</dd></div>
          <div className="card"><dt>Unique members reached</dt><dd>{formatAdNumber(campaign.reach)}</dd></div>
          <div className="card"><dt>CTA clicks</dt><dd>{formatAdNumber(campaign.clicks)}</dd></div>
          {campaign.objective === 'lead' ? <div className="card"><dt>Submitted leads</dt><dd>{formatAdNumber(campaign.leadCount)}</dd></div> :
            <div className="card"><dt>Click-through rate</dt><dd>{campaign.delivered ? (campaign.clicks / campaign.delivered * 100).toFixed(1) : '0'}%</dd></div>}
        </dl>
        {campaign.objective === 'lead' && <FilterTabs values={['Overview', 'Leads']} current={tab} change={setTab} />}
        {tab === 'Leads' ? <CampaignLeads id={id} /> : <>
          <DailyDeliveries days={campaign.daily} />
          <div className="ad-report-grid">
            <section className="card content-card ad-detail-section">
              <h2>Audience and delivery</h2>
              <ImpressionBudget campaign={campaign} />
              <dl className="ad-facts">
                <div><dt>Location</dt><dd>{campaign.targetLocation || 'Any location'}</dd></div>
                <div><dt>Profile skills</dt><dd>{campaign.targetSkills.join(', ') || 'Any skills'}</dd></div>
                <div><dt>Audience</dt><dd>{campaign.followersOnly ? 'Company followers' : 'Linkedup Pro members'}</dd></div>
                <div><dt>Starts</dt><dd>{campaign.startsAt ? formatAdDate(campaign.startsAt) : 'When published'}</dd></div>
                <div><dt>Ends</dt><dd>{campaign.endsAt ? formatAdDate(campaign.endsAt) : 'When the budget is used'}</dd></div>
              </dl>
            </section>
            <section className="card content-card ad-detail-section">
              <h2>Creative preview</h2>
              {campaign.headline && <h3>{campaign.headline}</h3>}
              <p className="ad-creative-body">{campaign.body ?? 'The source update is no longer available.'}</p>
              {campaign.hasImage && <img className="ad-image-preview" src={'/api/' + campaignPath(id) + '/image'} alt={campaign.imageAlt} />}
              <p className="ad-meta">{adObjectives[campaign.objective]} · {campaign.buttonLabel}</p>
            </section>
          </div>
        </>}
      </>}
      {confirmation && <Dialog title={confirmation === 'end' ? 'End this campaign?' : 'Discard this draft?'} close={() => setConfirmation(null)} error={error}>
        <p>{confirmation === 'end' ? 'Delivery will stop and the campaign report will remain available.' : 'The draft and its creative will be deleted.'}</p>
        <div className="dialog-footer">
          <button className="button secondary" onClick={() => setConfirmation(null)} disabled={busy}>Cancel</button>
          <button className="button primary" disabled={busy} onClick={async () => {
            if (confirmation === 'end') await action('end');
            else if (await save(campaignPath(id), {}, 'DELETE')) window.location.hash = 'advertising';
          }}>{confirmation === 'end' ? 'End campaign' : 'Discard draft'}</button>
        </div>
      </Dialog>}
    </>}
  </div>;
}

export function AdvertisingView() {
  const [route, setRoute] = useState<AdRoute>();
  useEffect(() => {
    const change = () => {
      if (window.location.hash.split('?')[0] === '#advertising') {
        setRoute(readAdRoute());
        window.scrollTo({ top: 0 });
      }
    };
    change();
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const { snapshot, refresh } = useApiResource<AdWorkspace>(route && route.view !== 'campaign' ? 'advertising/workspace' : null);
  if (route?.view === 'campaign') return <CampaignDetail key={route.id} id={route.id} />;
  const workspace = snapshot && 'data' in snapshot ? snapshot.data : undefined;
  const creating = route?.view === 'create';
  return <div className="ad-workspace">
    <header className="ad-banner"><div><h1>Campaigns</h1><p>Promote company updates and reach members in the feed.</p></div>
      <Megaphone size={85} strokeWidth={1.15} aria-hidden="true" /></header>
    {!snapshot && <p className="muted" role="status">Loading campaigns…</p>}
    {snapshot && 'error' in snapshot && <AdError message={snapshot.error} retry={refresh} />}
    {workspace && (!workspace.companies.length ? <Empty title="Manage a company page to create campaigns">
      <a className="text-link" href="#companies">Open Companies</a>
    </Empty> : creating ? <AdCampaignForm key={`${route.company}:${route.post}`} companies={workspace.companies}
      initial={workspace.companies.some((company) => company.id === route.company) ? { companyId: route.company, postId: route.post } : undefined}
      close={() => { window.location.hash = 'advertising'; }} saved={(id) => { window.location.hash = campaignHref(id); }} /> : <>
      <div className="section-heading ad-list-heading"><h2>Company campaigns</h2><a className="button primary" href="#advertising?new=1"><Plus size={17} /> New campaign</a></div>
      {workspace.campaigns.length ? <div className="ad-campaign-grid">{workspace.campaigns.map((campaign) =>
        <CampaignCard key={campaign.id} campaign={campaign} />)}</div> :
        <Empty title="No campaigns yet">Create a draft to choose a creative, audience, and impression budget.</Empty>}
    </>)}
  </div>;
}
