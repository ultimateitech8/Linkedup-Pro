'use client';

import { useEffect, useState } from 'react';
import { BriefcaseBusiness, Building2, Globe2, MapPin, Pencil, Plus, Search } from 'lucide-react';
import { Avatar, Empty } from './components';
import { ListingCard, ProviderPage } from './service-provider-view';
import { ServiceLoadError, ServiceRating, ServiceRequests, ViewServiceRequest } from './service-request-view';
import { OfferingForm, ProviderForm } from './service-forms';
import {
  serviceCategories, serviceProviderHref, serviceWorkMode, type DirectoryOffering,
  type Offering, type Provider, type ServiceDirectory, type ServiceSummary
} from './service-data';
import { useApiResource } from './api-resource';
import { FilterTabs } from './views';

type Section = 'Discover' | 'My requests' | 'Provider dashboard';
type Route =
  | { kind: 'directory'; section: Section; received: boolean }
  | { kind: 'provider'; id: number; listing?: number }
  | { kind: 'request'; id: number };
const sections: Section[] = ['Discover', 'My requests', 'Provider dashboard'];

function readServiceRoute(): Route {
  const hash = new URLSearchParams(window.location.hash.split('?')[1]);
  const id = (field: string) => {
    const value = Number(hash.get(field));
    return Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : undefined;
  };
  const request = id('request');
  if (request) return { kind: 'request', id: request };
  const provider = id('provider');
  if (provider) return { kind: 'provider', id: provider, listing: id('listing') };
  const tab = hash.get('tab');
  return { kind: 'directory', section: tab === 'requests' ? 'My requests' : tab === 'manage' ? 'Provider dashboard' : 'Discover',
    received: hash.get('side') === 'received' };
}

function DiscoveryCard({ offering }: { offering: DirectoryOffering }) {
  return <article className="card service-listing-card">
    <div className="service-person"><Avatar person={offering} size={41} /><div><strong>{offering.name}</strong><small>{offering.headline}</small></div></div>
    <div><span className="status violet">{offering.category}</span>
      <h2><a href={serviceProviderHref(offering.providerId, offering.id)}>{offering.title}</a></h2>
    </div>
    <p className="service-card-description">{offering.description}</p>
    <div className="service-card-meta"><span><Globe2 size={16} /> {serviceWorkMode(offering.workMode)}</span>
      {offering.location && <span><MapPin size={15} /> {offering.location}</span>}
    </div>
    <div className="service-card-footer"><ServiceRating rating={offering.rating} count={offering.reviewCount} />
      <a className="text-link" href={serviceProviderHref(offering.providerId)}>Service page</a>
    </div>
  </article>;
}

function DiscoverServices() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [mode, setMode] = useState('');
  const [positions, setPositions] = useState<number[]>([]);
  const params = new URLSearchParams({ q: query });
  if (category) params.set('category', category);
  if (mode) params.set('mode', mode);
  const after = positions.at(-1);
  if (after) params.set('after', String(after));
  const { snapshot, refresh } = useApiResource<ServiceDirectory>('services/directory?' + params);
  const result = snapshot && 'data' in snapshot ? snapshot.data : undefined;
  const next = result?.next;

  return <>
    <div className="service-filters">
      <label><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search services" placeholder="Search services or providers"
        value={query} maxLength={120} onChange={(event) => { setQuery(event.target.value); setPositions([]); }} /></label>
      <select aria-label="Service category" value={category} onChange={(event) => { setCategory(event.target.value); setPositions([]); }}>
        <option value="">All categories</option>{serviceCategories.map((value) => <option key={value}>{value}</option>)}
      </select>
      <select aria-label="Work arrangement" value={mode} onChange={(event) => { setMode(event.target.value); setPositions([]); }}>
        <option value="">Any arrangement</option><option>Remote</option><option>On-site</option>
      </select>
    </div>
    {!snapshot && <p className="muted" role="status">Loading services…</p>}
    {snapshot && 'error' in snapshot && <ServiceLoadError message={snapshot.error} refresh={refresh} />}
    {result && (result.offerings.length ? <div className="service-listing-grid">{result.offerings.map((offering) => <DiscoveryCard key={offering.id} offering={offering} />)}</div> :
      <Empty title="No matching services">Try another search or work arrangement.</Empty>)}
    {(positions.length > 0 || next) && <div className="service-actions">
      {positions.length > 0 && <button className="button secondary" onClick={() => setPositions(positions.slice(0, -1))}>Previous page</button>}
      {next && <button className="button secondary" onClick={() => { setPositions([...positions, next]); window.scrollTo({ top: 0 }); }}>Next page</button>}
    </div>}
  </>;
}

function ManageServices({ revision }: { revision?: number }) {
  const [panel, setPanel] = useState<{ type: 'page' } | { type: 'listing'; offering?: Offering } | null>(null);
  const { snapshot, refresh } = useApiResource<{ provider: Provider | null }>('services/manage', revision);
  const provider = snapshot && 'data' in snapshot ? snapshot.data.provider : undefined;
  const saved = () => { setPanel(null); refresh(); };
  return <>
    {!snapshot && <p className="muted" role="status">Loading your service page…</p>}
    {snapshot && 'error' in snapshot && <ServiceLoadError message={snapshot.error} refresh={refresh} />}
    {provider === null && <section className="card content-card service-first-page">
      <div className="tile-icon"><Building2 size={23} /></div>
      <h2>Offer your services</h2>
      <p>Set up a service page and add the work clients can hire you for.</p>
      <button className="button primary" onClick={() => setPanel({ type: 'page' })}><Plus size={17} /> Create service page</button>
    </section>}
    {provider && <>
      <section className="card content-card service-manage-summary">
        <div className="service-person"><Avatar person={provider} size={48} /><div><h2>{provider.name}</h2><p className="muted">{provider.headline}</p></div></div>
        <div className="service-actions"><span className={`status ${provider.accepting ? 'green' : ''}`}>{provider.accepting ? 'Accepting new requests' : 'New requests paused'}</span>
          <a className="button secondary" href={serviceProviderHref(provider.id)}>View service page</a>
          <button className="button secondary" onClick={() => setPanel({ type: 'page' })}><Pencil size={16} /> Edit service page</button>
        </div>
      </section>
      <a className="card service-lead-link" href="#services?tab=requests&side=received"><span className="tile-icon"><BriefcaseBusiness size={19} /></span>
        <span><strong>{provider.leads ?? 0} {(provider.leads ?? 0) === 1 ? 'open lead' : 'open leads'}</strong><small>View incoming service requests</small></span>
      </a>
      <div className="section-heading service-listing-heading"><h2>Your listings</h2>
        <button className="button primary" onClick={() => setPanel({ type: 'listing' })}><Plus size={17} /> Add listing</button></div>
      {provider.offerings.length ? <div className="service-listing-grid">{provider.offerings.map((offering) =>
        <ListingCard key={offering.id} offering={offering} action={<button className="button secondary" onClick={() => setPanel({ type: 'listing', offering })}>Edit listing</button>} />)}</div> :
        <Empty title="Your page has no listings yet" />}
    </>}
    {panel?.type === 'page' && <ProviderForm provider={provider ?? undefined} close={() => setPanel(null)} saved={saved} />}
    {panel?.type === 'listing' && <OfferingForm offering={panel.offering} close={() => setPanel(null)} saved={saved} />}
  </>;
}

export function ProfileService({ memberId, mine, close }: { memberId: string; mine?: boolean; close?: () => void }) {
  const { snapshot } = useApiResource<{ provider: ServiceSummary | null }>('services/member/' + encodeURIComponent(memberId));
  if (!snapshot || 'error' in snapshot) return null;
  const summary = snapshot.data.provider;
  if (!summary && !mine) return null;
  return <section className={mine ? 'card content-card service-profile' : 'member-projects service-profile'}>
    {mine ? <h2>Services</h2> : <h3>Services</h3>}
    {summary && <p>{summary.headline}</p>}
    <a className="text-link" href={summary ? serviceProviderHref(summary.id) : '#services?tab=manage'} onClick={close}>
      <BriefcaseBusiness size={16} /> {summary ? 'View service page' : 'Offer your services'}
    </a>
  </section>;
}

export function ServicesView({ revision }: { revision?: number }) {
  const [route, setRoute] = useState<Route>();
  useEffect(() => {
    function update() {
      if (window.location.hash.split('?')[0] !== '#services') return;
      setRoute(readServiceRoute());
      window.scrollTo({ top: 0 });
    }
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  if (!route) return <p className="muted" role="status">Loading Services…</p>;
  if (route.kind === 'provider') return <ProviderPage key={`${route.id}:${route.listing ?? ''}`} id={route.id} listing={route.listing} />;
  if (route.kind === 'request') return <ViewServiceRequest key={route.id} id={route.id} revision={revision} />;
  return <div className="services">
    <header className="services-banner"><div><h1>Services</h1>
      <p>Find freelancers and consultants for your next project.</p></div><BriefcaseBusiness size={88} strokeWidth={1.12} aria-hidden="true" /></header>
    <FilterTabs values={sections} current={route.section} change={(value) => {
      window.location.hash = value === 'Discover' ? 'services' : `services?tab=${value === 'My requests' ? 'requests' : 'manage'}`;
    }} />
    {route.section === 'Discover' && <DiscoverServices />}
    {route.section === 'My requests' && <ServiceRequests key={String(route.received)} initial={route.received ? 'Received' : 'Sent'} revision={revision} />}
    {route.section === 'Provider dashboard' && <ManageServices revision={revision} />}
  </div>;
}
