'use client';

import { useState, type ReactNode } from 'react';
import { Globe2, MapPin, MessageCircle } from 'lucide-react';
import { Avatar, Empty } from './components';
import { serviceDate, serviceProviderHref, serviceWorkMode, type Offering, type Provider } from './service-data';
import { NewServiceRequestForm } from './service-forms';
import { ServiceLoadError, ServiceRating } from './service-request-view';
import { useApiResource } from './api-resource';

export function ListingCard({ offering, action, showTitle = true }: { offering: Offering; action?: ReactNode; showTitle?: boolean }) {
  return <article className="card service-listing-card">
    <div className="service-actions"><span className="status violet">{offering.category}</span>
      {!offering.active && <span className="status service-status">Hidden</span>}</div>
    {showTitle && <h2>{offering.title}</h2>}
    <p className="service-copy">{offering.description}</p>
    {offering.pricingNote && <p className="service-meta">{offering.pricingNote}</p>}
    {action && <div className="service-actions">{action}</div>}
  </article>;
}

export function ProviderPage({ id, listing }: { id: number; listing?: number }) {
  const [request, setRequest] = useState<{ kind: 'inquiry' | 'proposal'; offering?: Offering } | null>(null);
  const { snapshot, refresh } = useApiResource<Provider>(`services/providers/${id}`);
  const provider = snapshot && 'data' in snapshot ? snapshot.data : null;
  const selected = provider?.offerings.find((offering) => offering.id === listing);
  const canRequest = provider?.accepting && !provider.mine && provider.offerings.length > 0;
  return <div className="services">
    <a className="text-link" href={listing ? serviceProviderHref(id) : '#services'}>{listing ? 'Back to service page' : 'Back to Services'}</a>
    {!snapshot && <p className="muted" role="status">Loading service page…</p>}
    {snapshot && 'error' in snapshot && <ServiceLoadError message={snapshot.error} refresh={refresh} />}
    {provider && <>
      <section className="card content-card service-provider">
        <div className="service-person"><Avatar person={provider} size={66} />
          <div>{selected ? <><h1>{selected.title}</h1><p>{provider.name} · {provider.headline}</p></> :
            <><h1>{provider.name}</h1><p>{provider.headline}</p></>}</div>
        </div>
        <div className="service-card-meta"><span><Globe2 size={16} /> {serviceWorkMode(provider.workMode)}</span>
          {provider.location && <span><MapPin size={15} /> {provider.location}</span>}
          <ServiceRating rating={provider.rating} count={provider.reviewCount} />
        </div>
        {!selected && <p className="service-copy">{provider.about}</p>}
        <div className="service-actions">
          {provider.mine ? <a className="button secondary" href="#services?tab=manage">Manage service page</a> :
            canRequest ? <button className="button secondary" onClick={() => setRequest({ kind: 'inquiry', offering: selected })}><MessageCircle size={17} /> Send inquiry</button> :
              !provider.accepting && <span className="status service-status">New requests paused</span>}
        </div>
      </section>
      {!!listing && !selected && <p className="muted">This listing is unavailable. Other services appear below.</p>}
      {provider.offerings.length ? <div className={selected ? 'service-selected-listing' : 'service-listing-grid'}>
        {(selected ? [selected] : provider.offerings).map((offering) =>
          <ListingCard key={offering.id} offering={offering} showTitle={!selected} action={canRequest && <button className="button primary"
            aria-label={selected ? undefined : `Request proposal for ${offering.title}`}
            onClick={() => setRequest({ kind: 'proposal', offering })}>Request proposal</button>} />)}
      </div> : <Empty title="No service listings yet" />}
      <section className="card content-card service-review-list">
        <h2>Client reviews</h2>
        {provider.reviews.length ? <ul>{provider.reviews.map((review) => <li key={review.id}>
          <div className="service-person"><Avatar person={review} size={39} /><div><strong>{review.name}</strong>
            <small>{serviceDate(review.createdAt)}{review.offeringTitle && ` · ${review.offeringTitle}`}</small></div></div>
          <div className="service-review-rating"><ServiceRating rating={review.rating} count={1} /><span className="status green">Completed work</span></div>
          <p className="service-copy">{review.body}</p>
        </li>)}</ul> : <p className="muted">Reviews appear after a client confirms completed work.</p>}
      </section>
      {request && <NewServiceRequestForm provider={provider} offering={request.offering} kind={request.kind} close={() => setRequest(null)} />}
    </>}
  </div>;
}
