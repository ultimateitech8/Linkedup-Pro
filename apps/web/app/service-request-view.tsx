'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ClipboardList, MessageCircle, Send, Star } from 'lucide-react';
import { Avatar, Empty } from './components';
import { ago } from './data';
import { ProposalForm, ReviewForm } from './service-forms';
import { quoteAmount, requestLabels, serviceDate, serviceProviderHref, serviceRequestHref, type RequestDetail, type ServiceRequest, type ServiceStatus } from './service-data';
import { useApiMutation, useApiResource } from './api-resource';
import { FilterTabs } from './views';

export function RequestStatus({ value }: { value: ServiceStatus }) {
  const style = value === 'completed' || value === 'delivered' ? 'green' : value === 'declined' || value === 'cancelled' ? '' : 'violet';
  return <span className={`status service-status ${style}`}>{requestLabels[value]}</span>;
}

export function ServiceRating({ rating, count }: { rating: number | null; count: number }) {
  return rating === null ? <span className="service-meta">No reviews yet</span> :
    <span className="service-rating"><Star size={16} fill="currentColor" aria-hidden="true" />
      <span><strong>{rating.toFixed(1)}</strong> · {count} {count === 1 ? 'review' : 'reviews'}</span></span>;
}

export function ServiceLoadError({ message, refresh }: { message: string; refresh: () => void }) {
  return <div className="card content-card service-error"><p role="alert">{message}</p><button className="button secondary" onClick={refresh}>Try again</button></div>;
}

export function ServiceRequests({ initial, revision }: { initial: 'Received' | 'Sent'; revision?: number }) {
  const [side, setSide] = useState(initial);
  const { snapshot, refresh } = useApiResource<ServiceRequest[]>('services/requests', revision, true);
  const entries = snapshot && 'data' in snapshot ? snapshot.data.filter((item) => item.role === (side === 'Received' ? 'provider' : 'client')) : null;
  return <>
    <div className="section-heading"><h2>Service requests</h2></div>
    <FilterTabs values={['Sent', 'Received']} current={side} change={(value) => setSide(value as typeof side)} />
    {!snapshot && <p className="muted" role="status">Loading service requests…</p>}
    {snapshot && 'error' in snapshot && <ServiceLoadError message={snapshot.error} refresh={refresh} />}
    {entries && (entries.length > 0 ? <div className="service-request-list">{entries.map((item) => <a className="card service-request-row"
      key={item.id} href={serviceRequestHref(item.id)}>
      <Avatar person={{ name: item.otherName, image: item.otherImage }} size={40} />
      <span><strong>{item.title}</strong><small>{item.otherName} · {item.kind === 'inquiry' ? 'Inquiry' : 'Proposal request'}</small></span>
      <span className="service-request-meta"><RequestStatus value={item.status} /><small>{ago(item.updatedAt)}</small></span>
    </a>)}</div> : <Empty title={side === 'Sent' ? 'No requests sent yet' : 'No requests received yet'}>
      {side === 'Sent' && <a className="text-link" href="#services">Browse services</a>}
    </Empty>)}
  </>;
}

function RequestThread({ request, refresh }: { request: RequestDetail; refresh: () => void }) {
  const { busy, error, save } = useApiMutation();
  const [message, setMessage] = useState('');
  const thread = useRef<HTMLUListElement>(null);
  const last = request.messages.at(-1)?.id;
  const chatOpen = !['completed', 'cancelled', 'declined'].includes(request.status);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [last]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    if (await save(`services/requests/${request.id}/messages`, { body: message })) {
      setMessage('');
      refresh();
    }
  }

  return <section className="card content-card service-thread">
    <h2><MessageCircle size={20} /> Conversation</h2>
    {request.messages.length ? <ul className="service-thread-log" ref={thread} aria-label="Conversation history">
      {request.messages.map((item) => item.kind === 'activity'
        ? <li className="service-thread-event" key={item.id}><span>{item.name} {item.body}</span><small>{ago(item.createdAt)}</small></li>
        : <li className={`service-thread-message ${item.mine ? 'mine' : ''}`} key={item.id}>
          <div><strong>{item.mine ? 'You' : item.name}</strong><p>{item.body}</p><small>{ago(item.createdAt)}</small></div>
        </li>)}
    </ul> : <p className="muted">Messages about this request will appear here.</p>}
    {chatOpen && <form className="field-form" onSubmit={send}>
      <label>Message<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={3} required /></label>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <button className="button primary" disabled={busy || !message.trim()}><Send size={16} /> Send message</button>
    </form>}
  </section>;
}

export function ViewServiceRequest({ id, revision }: { id: number; revision?: number }) {
  const [panel, setPanel] = useState<'quote' | 'review' | null>(null);
  const { snapshot, refresh } = useApiResource<RequestDetail>(`services/requests/${id}`, revision, true);
  const { busy, error, save } = useApiMutation();
  const request = snapshot && 'data' in snapshot ? snapshot.data : null;
  const quote = request?.quote;
  const open = request?.status === 'requested' || request?.status === 'quoted';
  const provider = request?.role === 'provider';

  async function decide(action: 'accept' | 'decline' | 'cancel' | 'deliver' | 'complete') {
    await save(`services/requests/${id}/decision`, { action, ...(action === 'accept' ? { version: quote?.version } : {}) });
    refresh();
  }

  return <div className="services">
    <a className="text-link" href={`#services?tab=requests${provider ? '&side=received' : ''}`}>Back to service requests</a>
    {!snapshot && <p className="muted" role="status">Loading request…</p>}
    {snapshot && 'error' in snapshot && <ServiceLoadError message={snapshot.error} refresh={refresh} />}
    {request && <>
      <header className="card content-card service-request-heading">
        <div><p className="service-meta">{request.kind === 'inquiry' ? 'Service inquiry' : 'Proposal request'}</p><h1>{request.title}</h1>
          {request.offeringTitle && <p className="muted">{request.offeringTitle}</p>}
        </div>
        <RequestStatus value={request.status} />
      </header>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="service-workspace">
        <div className="service-stack">
          <section className="card content-card service-detail-card">
            <h2><ClipboardList size={19} /> Project brief</h2>
            <div className="service-person">
              <Avatar person={{ name: request.otherName, image: request.otherImage }} size={39} />
              <div><strong>{request.otherName}</strong><small>{provider ? 'Client' : 'Service provider'}</small></div>
            </div>
            <p className="service-copy">{request.brief}</p>
            {request.budget && <p><strong>Budget</strong> {request.budget}</p>}
            <a className="text-link" href={serviceProviderHref(request.providerId)}>View service page</a>
          </section>
          {(open || quote) && <section className="card content-card service-detail-card">
            <h2>Proposal</h2>
            {quote ? <>
              <div className="service-quote"><div><span>Quote</span><strong>{quoteAmount(quote)}</strong></div>
                <div><span>Delivery date</span><strong>{serviceDate(quote.delivery)}</strong></div></div>
              <p className="service-copy">{quote.scope}</p>
            </> : <p className="muted">{provider ? 'Set a price, delivery date, and scope before sending a proposal.' : 'Waiting for the provider to send a proposal.'}</p>}
            <div className="service-actions">
              {open && provider && <button className="button primary" onClick={() => setPanel('quote')}>{quote ? 'Revise proposal' : 'Write proposal'}</button>}
              {open && provider && <button className="button secondary" disabled={busy} onClick={() => void decide('decline')}>Decline request</button>}
              {open && !provider && quote && <button className="button primary" disabled={busy} onClick={() => void decide('accept')}>Accept proposal</button>}
              {open && !provider && <button className="button secondary" disabled={busy} onClick={() => void decide('cancel')}>Cancel request</button>}
              {provider && request.status === 'accepted' && <button className="button primary" disabled={busy} onClick={() => void decide('deliver')}>Mark delivered</button>}
              {!provider && request.status === 'delivered' && <button className="button primary" disabled={busy} onClick={() => void decide('complete')}><Check size={17} /> Confirm completion</button>}
            </div>
          </section>}
          {request.status === 'completed' && <section className="card content-card service-detail-card">
            <h2>Review</h2>
            {request.review ? <><ServiceRating rating={request.review.rating} count={1} /><p className="service-copy">{request.review.body}</p></> :
              provider ? <p className="muted">The client can leave a review from this request.</p> :
                <button className="button primary service-inline-button" onClick={() => setPanel('review')}><Star size={17} /> Leave a review</button>}
          </section>}
        </div>
        <RequestThread request={request} refresh={refresh} />
      </div>
      {panel === 'quote' && <ProposalForm requestId={id} quote={quote ?? null} close={() => setPanel(null)} saved={() => { setPanel(null); refresh(); }} />}
      {panel === 'review' && <ReviewForm requestId={id} close={() => setPanel(null)} saved={() => { setPanel(null); refresh(); }} />}
    </>}
  </div>;
}
