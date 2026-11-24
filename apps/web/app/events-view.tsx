'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, Check, Clock3, Download, Link2, MapPin, Plus, Search, UsersRound, Video } from 'lucide-react';
import { Avatar, Dialog, Empty, FeedPost } from './components';
import { api, type Action, type Dashboard, type Person, type Post } from './data';
import { FilterTabs } from './views';

type EventFormat = 'online' | 'in-person';
type EventInfo = {
  id: number; title: string; description: string; category: string; format: EventFormat;
  startsAt: string; endsAt: string; venue: string | null;
  host: Pick<Person, 'id' | 'name' | 'image' | 'headline'>;
  isHost: boolean; ended: boolean; cancelled: boolean; live: boolean;
  registration: 'none' | 'invited' | 'registered' | 'declined'; checkedInAt: string | null; registeredCount: number;
};
type EventDetail = {
  event: EventInfo & { canEdit: boolean; canStartLive: boolean; canEndLive: boolean };
  meetingUrl: string | null; canCheckIn: boolean;
  analytics: { invitedCount: number; registeredCount: number; checkedInCount: number } | null;
  attendees: (Pick<Person, 'id' | 'name' | 'image' | 'headline'> & { checkedInAt: string | null })[];
  posts: Post[]; invitees: { id: string; name: string }[];
  hidden: { id: number; topic: string; body: string; author: string }[];
};
type Modal = 'create' | 'edit' | 'discussion';
const directoryTabs = ['Upcoming', 'My events', 'Invitations'];

function selectedEvent() {
  const [route, parameters] = window.location.hash.split('?');
  const id = Number(new URLSearchParams(parameters).get('event'));
  return route === '#events' && Number.isInteger(id) && id > 0 ? id : null;
}

function eventDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(value));
}

function localInput(value?: string) {
  if (!value) return '';
  const time = new Date(value);
  return new Date(time.getTime() - time.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function EventDate({ event }: { event: EventInfo }) {
  const date = new Date(event.startsAt);
  return <div className={`event-date ${event.format}`} aria-hidden="true">
    <span>{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date)}</span><strong>{date.getDate()}</strong>
  </div>;
}

function EventStatus({ event }: { event: EventInfo }) {
  if (event.cancelled) return <span className="status">Cancelled</span>;
  if (event.live) return <span className="status event-live">Live now</span>;
  if (event.ended) return <span className="status">Ended</span>;
  if (event.isHost) return <span className="status violet">Hosting</span>;
  if (event.registration === 'registered') return <span className="status green">Registered</span>;
  if (event.registration === 'invited') return <span className="status violet">Invited</span>;
  return null;
}

function EventFormatLabel({ event }: { event: EventInfo }) {
  return event.format === 'online' ? <span><Video size={16} /> Online</span> : <span><MapPin size={16} /> {event.venue}</span>;
}

function EventCard({ event, open }: { event: EventInfo; open: (id: number) => void }) {
  return <article className="card event-card">
    <div className="event-card-heading"><EventDate event={event} />
      <div><span className="status violet">{event.category}</span>
        <h2><button className="group-title-link" onClick={() => open(event.id)}>{event.title}</button></h2></div>
      <EventStatus event={event} />
    </div>
    <p className="event-card-description">{event.description}</p>
    <div className="event-card-meta"><span><Clock3 size={16} />{eventDate(event.startsAt)}</span><EventFormatLabel event={event} /></div>
    <div className="event-card-footer"><span className="event-host"><Avatar person={event.host} size={28} />{event.host.name}</span>
      <button className="button secondary compact" onClick={() => open(event.id)}>View event<span className="sr-only"> {event.title}</span></button>
    </div>
  </article>;
}

export function EventsView({ dashboard, action, showPerson, showReport }: {
  dashboard: Dashboard; action: Action; showPerson: (id: string) => void; showReport: (id: number) => void;
}) {
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [id, setId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [directory, setDirectory] = useState('Upcoming');
  const [tab, setTab] = useState('Discussions');
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState('all');
  const [modal, setModal] = useState<Modal | null>(null);
  const [formFormat, setFormFormat] = useState<EventFormat>('online');
  const [invitee, setInvitee] = useState('');
  const [error, setError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const eventNotice = dashboard.notifications.find((notice) => notice.category === 'Events')?.id;

  const load = useCallback(async (eventId: number | null, signal?: AbortSignal) => {
    try {
      const [list, data] = await Promise.all([
        api<EventInfo[]>('events', { signal }),
        eventId ? api<EventDetail>(`events/${eventId}`, { signal }) : null
      ]);
      if (signal?.aborted) return;
      setEvents(list);
      setDetail(data);
      setError('');
    } catch (failure) {
      if (!signal?.aborted) setError((failure as Error).message);
    }
  }, []);
  useEffect(() => {
    const update = () => {
      setId(selectedEvent());
      setTab('Discussions');
      setInvitee('');
      setModal(null);
      setShareNotice('');
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(id, controller.signal);
    const timer = window.setInterval(() => { if (!document.hidden) void load(id, controller.signal); }, 45_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [id, load, eventNotice]);

  const event = detail?.event.id === id ? detail.event : null;
  const queryText = query.trim().toLowerCase();
  const shown = events?.filter((item) => {
    if (directory === 'Upcoming' && (item.cancelled || item.ended)) return false;
    if (directory === 'My events' && !item.isHost && item.registration !== 'registered') return false;
    if (directory === 'Invitations' && (item.registration !== 'invited' || item.cancelled || item.ended)) return false;
    if (formatFilter !== 'all' && item.format !== formatFilter) return false;
    return !queryText || `${item.title} ${item.category} ${item.venue ?? 'online'} ${item.host.name}`.toLowerCase().includes(queryText);
  });

  function open(next: number | null) {
    window.location.hash = next ? `events?event=${next}` : 'events';
    window.scrollTo({ top: 0 });
  }

  function show(next: Modal | null) {
    setDialogError('');
    setFormFormat(next === 'edit' && event ? event.format : 'online');
    setModal(next);
  }

  const refreshAfter: Action = async (path, data, notice, method) => {
    const ok = await action(path, data, notice, method);
    if (ok && selectedEvent() === id) await load(id);
    return ok;
  };

  async function run(path: string, fields: object, notice: string) {
    setBusy(true);
    try { return await refreshAfter(path, fields, notice); }
    finally { setBusy(false); }
  }

  async function save(eventForm: FormEvent<HTMLFormElement>) {
    eventForm.preventDefault();
    if (!modal || busy) return;
    setBusy(true);
    setDialogError('');
    try {
      const fields = Object.fromEntries(new FormData(eventForm.currentTarget));
      if (modal !== 'discussion') {
        fields.startsAt = new Date(String(fields.startsAt)).toISOString();
        fields.endsAt = new Date(String(fields.endsAt)).toISOString();
      }
      const path = modal === 'create' ? 'events' : modal === 'edit' ? `events/${id}` : `events/${id}/posts`;
      const response = await api<{ id?: number }>(path, { method: modal === 'edit' ? 'PATCH' : 'POST', body: JSON.stringify(fields) });
      setModal(null);
      if (modal === 'create' && response.id) open(response.id);
      else await load(id);
    } catch (failure) {
      setDialogError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const url = new URL(`/#events?event=${id}`, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice('Event link copied.');
    } catch {
      setShareNotice(url);
    }
  }

  let content;
  if (error) {
    content = <section className="card content-card"><p className="form-error" role="alert">{error}</p><div className="button-row">
      <button className="button secondary" onClick={() => void load(id)}>Try again</button>
      {id && <button className="button secondary" onClick={() => open(null)}>Back to events</button>}</div></section>;
  } else if (id && event && detail) {
    const registered = event.registration === 'registered';
    const participant = registered || event.isHost;
    const available = !event.cancelled && !event.ended;
    const tabs = event.isHost ? ['Discussions', 'Attendees', 'Manage'] : ['Discussions', 'Attendees'];
    const registration = (decision: string, notice: string) => run(`events/${id}/registration`, { action: decision }, notice);
    const host = (decision: string, notice: string) => run(`events/${id}/host`, { action: decision }, notice);
    content = <>
      <button className="text-link group-back" onClick={() => open(null)}>Back to events</button>
      <section className="card event-detail">
        <div className="event-detail-heading"><EventDate event={event} /><div>
          <div className="event-tags"><span className="status violet">{event.category}</span><EventStatus event={event} /></div>
          <h1>{event.title}</h1>
        </div></div>
        <div className="event-card-meta event-detail-meta"><span><Clock3 size={17} />{eventDate(event.startsAt)} – {eventDate(event.endsAt)}</span>
          <EventFormatLabel event={event} /><span><UsersRound size={17} />{event.registeredCount} registered</span></div>
        <p className="body-copy event-detail-description">{event.description}</p>
        <div className="event-host"><Avatar person={event.host} size={34} /><div><strong>{event.host.name}</strong><small>Host</small></div></div>
        <div className="event-actions">
          {available && !event.isHost && !registered && <button className="button primary" disabled={busy}
            onClick={() => void registration('register', 'Registration confirmed')}>{event.registration === 'invited' ? 'Accept invitation' : 'Register'}</button>}
          {available && event.registration === 'invited' && <button className="button secondary" disabled={busy}
            onClick={() => void registration('decline', 'Invitation declined')}>Decline invitation</button>}
          {available && registered && !event.checkedInAt && <button className="button secondary" disabled={busy}
            onClick={() => void registration('withdraw', 'Registration cancelled')}>Cancel registration</button>}
          {available && detail.meetingUrl && <a className="button primary" href={detail.meetingUrl} target="_blank" rel="noreferrer"
            onClick={() => { if (detail.canCheckIn && !event.checkedInAt) void registration('check-in', 'Checked in'); }}>
            <Video size={18} /> {event.live ? 'Join live session' : 'Open meeting link'}</a>}
          {available && event.format === 'in-person' && detail.canCheckIn && !event.checkedInAt &&
            <button className="button primary" disabled={busy} onClick={() => void registration('check-in', 'Checked in')}><Check size={17} /> Check in</button>}
          {event.checkedInAt && <span className="status green"><Check size={15} /> Checked in</span>}
          {available && <a className="button secondary" href={`/api/events/${id}/calendar`} download><Download size={17} /> Add to calendar</a>}
          <button className="button secondary" onClick={() => void share()}><Link2 size={17} /> Copy event link</button>
        </div>
        {shareNotice && <p className="form-status event-share-notice" role="status">{shareNotice}</p>}
        {registered && available && event.format === 'online' && !detail.meetingUrl && !event.checkedInAt &&
          <p className="field-hint event-share-notice">The meeting link opens 15 minutes before the scheduled start, or when the host goes live.</p>}
      </section>
      {participant ? <>
        <FilterTabs values={tabs} current={tabs.includes(tab) ? tab : 'Discussions'} change={(next) => {
          setTab(next); if (next !== tab) void load(id);
        }} />
        {(tab === 'Discussions' || !tabs.includes(tab)) && <>
          <div className="section-heading group-section-heading"><h2>Discussions</h2>
            {!event.cancelled && <button className="button primary compact" onClick={() => show('discussion')}><Plus size={17} /> Start a discussion</button>}</div>
          {detail.posts.length ? <div className="post-stack">{detail.posts.map((post) => <FeedPost key={post.id}
            post={post} dashboard={dashboard} action={refreshAfter} showPerson={showPerson} showReport={showReport}
            hideDiscussion={event.isHost ? (postId) => { if (!busy) void run(`events/${id}/posts/${postId}`, { action: 'hide' }, 'Discussion hidden'); } : undefined} />)}</div> :
            <Empty title="No discussions yet" />}
        </>}
        {tab === 'Attendees' && <section className="card content-card"><h2>Attendees</h2>
          {detail.attendees.length ? detail.attendees.map((person) => <div className="group-person-row" key={person.id}>
            <div className="group-person-summary"><Avatar person={person} size={38} /><div><strong>{person.name}</strong><small>{person.headline}</small></div></div>
            {event.isHost && person.checkedInAt && <span className="status green">Checked in</span>}
          </div>) : <p className="muted">No registrations yet.</p>}
        </section>}
        {tab === 'Manage' && event.isHost && detail.analytics && <div className="column-stack">
          <section className="card content-card"><h2>Event activity</h2><dl className="event-metrics">
            <div><dt>Registered</dt><dd>{detail.analytics.registeredCount}</dd></div>
            <div><dt>Invitations pending</dt><dd>{detail.analytics.invitedCount}</dd></div>
            <div><dt>Checked in</dt><dd>{detail.analytics.checkedInCount}</dd></div>
          </dl></section>
          {(available || event.canEndLive) && <section className="card content-card"><h2>Host controls</h2>
            {event.format === 'online' && available && !event.canStartLive && !event.canEndLive &&
              <p className="muted">You can start a live session within 30 minutes of the scheduled start.</p>}
            <div className="button-row">
              {event.canEdit && <button className="button secondary" onClick={() => show('edit')}>Edit event</button>}
              {event.canStartLive && <button className="button primary" disabled={busy} onClick={() => void host('start-live', 'Event is live')}>Go live</button>}
              {event.canEndLive && <button className="button secondary" disabled={busy} onClick={() => void host('end-live', 'Live session ended')}>End live session</button>}
              {available && <button className="text-link" disabled={busy} onClick={() => {
                if (window.confirm(`Cancel ${event.title} and notify attendees?`)) void host('cancel', 'Event cancelled');
              }}>Cancel event</button>}
            </div>
          </section>}
          {available && <section className="card content-card"><h2>Invite a connection</h2>
            {detail.invitees.length ? <form className="group-invite" onSubmit={async (form) => {
              form.preventDefault();
              if (await run(`events/${id}/invites`, { memberId: invitee }, 'Invitation sent')) setInvitee('');
            }}><select aria-label="Choose a connection" value={invitee} onChange={(change) => setInvitee(change.target.value)} required>
              <option value="">Choose a connection</option>
              {detail.invitees.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
            </select><button className="button primary" disabled={busy || !invitee}>Send invitation</button></form> :
              <p className="muted">No connections are available to invite.</p>}
          </section>}
          <section className="card content-card"><h2>Hidden discussions</h2>
            {detail.hidden.length ? detail.hidden.map((post) => <div className="group-hidden-row" key={post.id}><div>
              <h3>{post.topic}</h3><p className="muted">{post.author}</p><p className="review-excerpt">{post.body}</p></div>
              <button className="button secondary compact" disabled={busy} onClick={() => void run(
                `events/${id}/posts/${post.id}`, { action: 'restore' }, 'Discussion restored'
              )}>Restore</button></div>) : <p className="muted">No hidden discussions.</p>}
          </section>
        </div>}
      </> : <Empty title={available ? 'Join the event to participate' : 'This event is closed'}>
        {available ? 'Register to see the attendee list and join the discussion.' : undefined}</Empty>}
    </>;
  } else if (id || !events) {
    content = <p className="muted" role="status">Loading events…</p>;
  } else {
    content = <>
      <div className="page-intro"><div><h1>Events</h1><p>Find professional meetups, webinars, and conferences.</p></div>
        <button className="button primary" onClick={() => show('create')}><Plus size={18} /> Create an event</button></div>
      <div className="group-tools event-tools"><FilterTabs values={directoryTabs} current={directory} change={setDirectory} />
        <div className="event-filters"><label className="group-search"><Search size={18} /><span className="sr-only">Search events</span><input
          placeholder="Search events" value={query} onChange={(change) => setQuery(change.target.value)} /></label>
          <select aria-label="Event format" value={formatFilter} onChange={(change) => setFormatFilter(change.target.value)}>
            <option value="all">All formats</option><option value="online">Online</option><option value="in-person">In person</option>
          </select></div></div>
      {shown?.length ? <div className="event-grid">{shown.map((item) => <EventCard key={item.id} event={item} open={open} />)}</div> :
        <Empty title={queryText ? 'No matching events' : directory === 'Invitations' ? 'No event invitations' :
          directory === 'My events' ? 'No events on your list' : 'No upcoming events'} />}
    </>;
  }

  const editing = modal === 'edit' ? event : null;
  const modalTitle = modal === 'create' ? 'Create an event' : modal === 'edit' ? 'Edit event' : 'Start a discussion';
  return <>{content}{modal && <Dialog title={modalTitle} close={() => show(null)} error={dialogError}><form className="field-form" onSubmit={save}>
    {modal === 'discussion' ? <>
      <label>Topic<input autoFocus name="topic" required maxLength={140} /></label>
      <label>Post<textarea name="body" rows={5} required maxLength={3000} /></label>
    </> : <>
      <label>Event title<input autoFocus name="title" defaultValue={editing?.title} required maxLength={100} /></label>
      <label>Description<textarea name="description" defaultValue={editing?.description} rows={3} required maxLength={3000} /></label>
      <div className="event-form-grid">
        <label>Event type<select name="category" defaultValue={editing?.category ?? 'Meetup'}><option>Meetup</option><option>Webinar</option><option>Conference</option></select></label>
        <label>Format<select name="format" value={formFormat} onChange={(change) => setFormFormat(change.target.value as EventFormat)}>
          <option value="online">Online</option><option value="in-person">In person</option></select></label>
      </div>
      <div className="event-form-grid">
        <label>Starts<input type="datetime-local" name="startsAt" defaultValue={localInput(editing?.startsAt)} required /></label>
        <label>Ends<input type="datetime-local" name="endsAt" defaultValue={localInput(editing?.endsAt)} required /></label>
      </div>
      <p className="field-hint">Times are in {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
      {formFormat === 'online' ? <label>Meeting or livestream link<input type="url" name="meetingUrl"
        defaultValue={editing?.format === 'online' ? detail?.meetingUrl ?? undefined : undefined} placeholder="https://…" required maxLength={2048} /></label> :
        <label>Venue or address<input name="venue" defaultValue={editing?.venue ?? undefined} required maxLength={220} /></label>}
    </>}
    <div className="dialog-footer"><button type="button" className="button secondary" onClick={() => show(null)}>Cancel</button>
      <button className="button primary" disabled={busy}>{modal === 'discussion' ? 'Publish discussion' : modal === 'edit' ? 'Save changes' : 'Publish event'}</button></div>
  </form></Dialog>}</>;
}
