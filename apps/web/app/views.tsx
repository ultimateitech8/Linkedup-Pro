'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BadgeCheck, Check, ChevronRight, ExternalLink, MapPin, MessageCircle, Pencil, Plus, Send, Sparkles, UserRoundPlus
} from 'lucide-react';
import {
  Avatar, Empty, FeedPost, HomeAside, JobListItem, PersonAction, ProjectItem, ResumeLink, SortSelect, Timeline
} from './components';
import { useApiResource } from './api-resource';
import { SponsoredPlacement } from './ad-placement';
import { InlineAiDraft } from './ai-draft';
import { ago, type Action, type Dashboard, type Job, type Person, type View } from './data';

export type Modal =
  | { kind: 'create' | 'profile' | 'project' | 'demo' }
  | { kind: 'newJob'; company?: { id: number; name: string } }
  | { kind: 'job' | 'apply' | 'report'; id: number }
  | { kind: 'person'; id: string };
type Props = {
  dashboard: Dashboard; action: Action; show: (modal: Modal) => void; go: (view: View) => void;
  showPerson: (id: string) => void;
};

export function Home({ dashboard, action, show, go, showPerson }: Props) {
  const [sort, updateSort] = useState('latest');
  const recent = dashboard.posts.filter((post) => !post.groupId && !post.eventId && (!post.company || post.followsCompany)).slice(0, 60);
  const posts = sort === 'popular' ? [...recent].sort((a, b) => b.likes - a.likes) : recent;
  return <>
    <div className="page-intro home-intro"><div><h1>Home feed</h1><p>Welcome back, {dashboard.me.name.split(' ')[0]}.</p></div></div>
    <div className="home-grid">
      <div className="feed-column">
        <section className="feature">
          <div className="feature-content">
            <div className="feature-label"><BadgeCheck size={17} /> Project verification</div>
            <h2>Show what you’ve built.</h2>
            <p>Share your work and ask someone you worked with to confirm your contribution.</p>
            <button className="button feature-button" onClick={() => show({ kind: 'project' })}><Plus size={17} /> Add a project</button>
          </div>
        </section>
        <div className="card composer">
          <Avatar person={dashboard.me} size={43} />
          <button className="composer-input" type="button" onClick={() => show({ kind: 'create' })}>Share something with your network…</button>
          <button className="icon-btn compose-edit" aria-label="Write a post" onClick={() => show({ kind: 'create' })}><Pencil size={18} /></button>
        </div>
        <div className="section-heading feed-heading"><h2>Community feed</h2><SortSelect sort={sort} update={updateSort} /></div>
        <SponsoredPlacement key={dashboard.me.id} member={dashboard.me} />
        {posts.length ? <div className="post-stack">{posts.map((post) =>
          <FeedPost post={post} dashboard={dashboard} action={action} showPerson={showPerson} trackAnalytics
            showReport={(id) => show({ kind: 'report', id })} key={post.id} />)}</div> :
          <Empty title="Your feed is ready"><button className="text-link" onClick={() => show({ kind: 'create' })}>Write the first post</button></Empty>}
      </div>
      <HomeAside dashboard={dashboard} go={go} showJob={(job) => show({ kind: 'job', id: job.id })} showPerson={showPerson} action={action} />
    </div>
  </>;
}

function PageHeading({ title, copy, children }: { title: string; copy?: string; children?: ReactNode }) {
  return <div className="page-intro"><div><h1>{title}</h1>{copy && <p>{copy}</p>}</div>{children}</div>;
}

export function Network({ dashboard, action, showPerson }: Props) {
  const [filter, setFilter] = useState('Discover');
  const people = dashboard.people.filter((person) => filter === 'Discover' ? person.connection !== 'connected' :
    filter === 'Connections' ? person.connection === 'connected' : ['received', 'sent'].includes(person.connection));
  return <>
    <PageHeading title="My network" copy="Find people in your field and manage your connections." />
    <FilterTabs values={['Discover', 'Connections', 'Requests']} current={filter} change={setFilter} />
    {people.length ? <div className="people-grid">{people.map((person) => <article className="card person-card" key={person.id}>
      <button className="person-card-info" onClick={() => showPerson(person.id)}><Avatar person={person} size={56} />
        <strong>{person.name}</strong><small>{person.headline || 'Linkedup Pro member'}</small></button>
      {person.location && <span className="person-location"><MapPin size={14} /> {person.location}</span>}
      {person.connection === 'none' ? <button className="button secondary" onClick={() => action(`connections/${person.id}`, { action: 'request' }, 'Request sent')}><UserRoundPlus size={17} /> Connect</button> : <PersonAction person={person} action={action} />}
      {person.connection === 'connected' && <button className="text-link" onClick={() => action(`connections/${person.id}`, { action: 'remove' }, 'Connection removed')}>Remove connection</button>}
    </article>)}</div> : <Empty title={filter === 'Requests' ? 'No connection requests' : 'No people to show'} />}
  </>;
}

export function FilterTabs({ values, current, change }: { values: string[]; current: string; change: (value: string) => void }) {
  return <div className="filter-tabs" aria-label="Filter view">{values.map((value) => <button
    aria-pressed={current === value} key={value} onClick={() => change(value)}>{value}</button>)}</div>;
}

export function Jobs({ dashboard, action, show, area, changeArea }: Props & { area: string; changeArea: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('Any location type');
  const jobs = dashboard.jobs.filter((job) => !job.closed &&
    `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (mode === 'Any location type' || mode === job.workMode));
  const owned = dashboard.jobs.filter((job) => job.canManage);
  const save = (job: Job) => action(`jobs/${job.id}/save`, { active: !job.saved }, job.saved ? 'Job removed from saved' : 'Job saved');
  return <>
    <PageHeading title="Jobs" copy="Find opportunities and follow your applications."><div className="ai-action-row">
      {dashboard.me.aiAvailable && <a className="button secondary" href="#ai?tab=search"><Sparkles size={17} /> AI job search</a>}
      <button className="button primary" onClick={() => show({ kind: 'newJob' })}><Plus size={18} /> Post a job</button></div></PageHeading>
    <FilterTabs values={['Explore', 'My applications', 'Manage jobs']} current={area} change={changeArea} />
    {area === 'Explore' && <>
      <div className="job-filter">
        <input aria-label="Search jobs" placeholder="Search by job title, company, or location" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label className="sr-only" htmlFor="work-mode">Location type</label><select id="work-mode" value={mode} onChange={(event) => setMode(event.target.value)}>
          {['Any location type', 'Remote', 'Hybrid', 'On-site'].map((option) => <option key={option}>{option}</option>)}
        </select>
      </div>
      {jobs.length ? <div className="jobs-grid">{jobs.map((job) => <JobListItem key={job.id} job={job} application={dashboard.applications.find((item) => item.jobId === job.id)}
        showJob={() => show({ kind: 'job', id: job.id })} save={() => void save(job)} />)}</div> : <Empty title="No matching jobs">Try another search or location type.</Empty>}
    </>}
    {area === 'My applications' && (dashboard.applications.length ? <div className="column-stack">{dashboard.applications.map((application) => <section className="card content-card" key={application.id}>
      <div className="section-heading"><div><h2>{application.title}</h2><p className="muted">{application.company}</p></div><span className="status violet">{application.timeline[0]?.status}</span></div>
      <Timeline events={application.timeline} />
      <ResumeLink application={application} />
    </section>)}</div> : <Empty title="No applications yet">Jobs you apply for will appear here with status updates.</Empty>)}
    {area === 'Manage jobs' && (owned.length ? <div className="column-stack">{owned.map((job) => {
      const applications = dashboard.hiring.filter((item) => item.jobId === job.id);
      return <section className="card content-card" key={job.id}>
        <div className="section-heading"><div><h2>{job.title}</h2><p className="muted">{job.company} · {applications.length} {applications.length === 1 ? 'applicant' : 'applicants'}</p></div>
          {job.closed ? <span className="status">Closed</span> : <button className="button secondary compact" onClick={() => {
            if (window.confirm('Close this listing and notify its applicants?')) void action(`jobs/${job.id}/close`, undefined, 'Job closed');
          }}>Close listing</button>}
        </div>
        {applications.map((item) => <div className="candidate" key={item.id}>
          <div><strong>{item.applicant}</strong>{item.note && <p>{item.note}</p>}
            <ResumeLink application={item} />
            {item.project && <div className="candidate-project"><strong>{item.project.title}</strong>
              {item.project.verified && <BadgeCheck className="verified-icon" size={17} aria-label="Confirmed project" />}<p>{item.project.contribution}</p>
              {item.project.url && <a className="text-link" href={item.project.url} target="_blank" rel="noreferrer">View work <ExternalLink size={13} /></a>}
            </div>}
          </div>
          <select aria-label={`Update status for ${item.applicant}`} value={item.status} disabled={job.closed}
            onChange={(event) => action(`applications/${item.id}`, { status: event.target.value }, 'Application status updated', 'PATCH')}>
            <option disabled>Submitted</option><option>In review</option><option>Interview</option><option>Offer</option><option>Not selected</option><option disabled>Role closed</option>
          </select>
        </div>)}
      </section>;
    })}</div> : <Empty title="You haven’t posted a job">Your listings and applicants will appear here.</Empty>)}
  </>;
}

export function Profile({ dashboard, show, action }: Props) {
  const me = dashboard.me;
  return <>
    <PageHeading title="My profile" />
    <section className="card profile-full"><div className="profile-pattern"><span /><span /><span /></div>
      <div className="profile-full-info"><div className="avatar-border"><Avatar person={me} size={83} /></div>
        <button className="button secondary" onClick={() => show({ kind: 'profile' })}><Pencil size={17} /> Edit profile</button>
        <h2>{me.name}</h2><p>{me.headline || 'Linkedup Pro member'}</p>{me.location && <small><MapPin size={15} /> {me.location}</small>}
      </div>
    </section>
    {me.about && <section className="card content-card"><h2>About</h2><p className="body-copy">{me.about}</p></section>}
    {!!me.skills.length && <section className="card content-card"><h2>Skills</h2><div className="skill-list">{me.skills.map((skill) => <span className="status violet" key={skill}>{skill}</span>)}</div></section>}
    {!!dashboard.pendingProjects.length && <section className="card content-card"><h2>Verification requests</h2>
      {dashboard.pendingProjects.map((project) => <div className="verification-request" key={project.id}>
        <p><strong>{project.owner}</strong> asked you to confirm their work.</p><ProjectItem project={project} />
        <button className="button secondary" onClick={() => action(`projects/${project.id}/verify`, {}, 'Contribution confirmed')}><Check size={17} /> Confirm contribution</button>
      </div>)}</section>}
    <section className="card content-card"><div className="section-heading"><h2>Projects</h2><button className="button secondary compact" onClick={() => show({ kind: 'project' })}><Plus size={17} /> Add a project</button></div>
      {dashboard.projects.length ? dashboard.projects.map((project) => <ProjectItem project={project} key={project.id} />) :
        <p className="muted">Add work you’re proud of and describe what you contributed.</p>}
    </section>
  </>;
}

export function Saved({ dashboard, show, showPerson, action }: Props) {
  const [tab, setTab] = useState('Posts');
  const posts = dashboard.posts.filter((post) => post.saved);
  const jobs = dashboard.jobs.filter((job) => job.saved);
  return <>
    <PageHeading title="Saved" copy="Return to posts and jobs you’ve bookmarked." />
    <FilterTabs current={tab} values={['Posts', 'Jobs']} change={setTab} />
    {tab === 'Posts' ? posts.length ? <div className="post-stack narrow">{posts.map((post) =>
      <FeedPost key={post.id} post={post} dashboard={dashboard} action={action} showPerson={showPerson} showContext
        showReport={(id) => show({ kind: 'report', id })} />)}</div> : <Empty title="No saved posts yet" /> :
      jobs.length ? <div className="jobs-grid">{jobs.map((job) => <JobListItem key={job.id} job={job} showJob={() => show({ kind: 'job', id: job.id })}
        save={() => void action(`jobs/${job.id}/save`, { active: false }, 'Job removed from saved')} />)}</div> : <Empty title="No saved jobs yet" />}
  </>;
}

export function Messages({ dashboard, action, selected, select }: Props & { selected: string; select: (id: string) => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const people = dashboard.people.filter((person) => person.connection === 'connected' ||
    dashboard.messages.some((message) => message.sender === person.id || message.recipient === person.id));
  const missing = Boolean(selected && !dashboard.people.some((person) => person.id === selected));
  const { snapshot: additional } = useApiResource<Person>(missing ? `profiles/${encodeURIComponent(selected)}` : null, dashboard.notifications[0]?.id);
  if (additional && 'data' in additional && (additional.data.connection === 'connected' ||
    dashboard.messages.some((message) => message.sender === selected || message.recipient === selected))) people.push(additional.data);
  const person = people.find((item) => item.id === selected) ?? (missing ? undefined : people[0]);
  const thread = person ? dashboard.messages.filter((message) => message.sender === person.id || message.recipient === person.id).reverse() : [];
  const lastId = thread.at(-1)?.id;
  useEffect(() => { if (bottom.current?.parentElement) bottom.current.parentElement.scrollTop = bottom.current.parentElement.scrollHeight; }, [lastId, person?.id]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!person || !text.trim()) return;
    setSending(true);
    if (await action(`messages/${person.id}`, { body: text })) setText('');
    setSending(false);
  }
  return <>
    <PageHeading title="Messages" />
    {missing && !additional ? <p className="muted" role="status">Loading conversation…</p> :
      missing && !person ? <Empty title="This conversation is unavailable"><button className="text-link" onClick={() => select('')}>View other conversations</button></Empty> :
      !person ? <Empty title="No conversations yet">Connect with someone to start a conversation.</Empty> :
      <section className="card inbox">
        <div className="inbox-list">{people.map((item) => <button key={item.id} aria-pressed={person.id === item.id} onClick={() => { select(item.id); setText(''); }}>
          <Avatar person={item} size={40} /><span>{item.name}</span><ChevronRight size={15} /></button>)}</div>
        <div className="inbox-thread"><div className="thread-heading"><Avatar person={person} size={39} /><div><strong>{person.name}</strong><small>{person.headline}</small></div></div>
          <div className="thread-messages">{thread.length ? thread.map((item) => <div className={`message ${item.sender === dashboard.me.id ? 'mine' : ''}`} key={item.id}>
            <p>{item.body}</p><small>{ago(item.createdAt)}</small>
          </div>) : <div className="thread-empty"><MessageCircle size={22} /><p>Start a conversation with {person.name.split(' ')[0]}.</p></div>}
            <div ref={bottom} />
          </div>
          {person.connection === 'connected' && dashboard.me.aiAvailable && <div className="message-ai-tools">
            <InlineAiDraft key={person.id} task="message" label="Draft or polish message" context={() => text}
              apply={(value) => setText(value.replace(/\s*\r?\n\s*/g, ' '))} />
          </div>}
          {person.connection === 'connected' && <form className="message-form" onSubmit={send}><input aria-label="Message" placeholder="Write a message…" value={text} maxLength={3000} onChange={(event) => setText(event.target.value)} />
            <button className="button primary" disabled={!text.trim() || sending}><Send size={17} /><span>Send</span></button></form>}
        </div>
      </section>}
  </>;
}

export function SettingsView({ dashboard, demo, logout }: { dashboard: Dashboard; demo: () => void; logout: () => void }) {
  return <><PageHeading title="Settings" /><section className="card content-card"><h2>Account</h2><p className="body-copy">{dashboard.me.email}</p>
    <div className="button-row"><button className="button secondary" onClick={logout}>Sign out</button>
      {dashboard.demoMode && <button className="button secondary" onClick={demo}>Switch demo account</button>}</div></section></>;
}
