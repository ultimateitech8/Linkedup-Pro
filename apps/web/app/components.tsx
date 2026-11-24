'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BadgeCheck, Bell, Bookmark, BriefcaseBusiness, Building2, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, ChevronRight, Download, Ellipsis, ExternalLink,
  EyeOff, FileText, Flag, FolderOpen, Globe2, GraduationCap, House, Link2, MapPin, Megaphone, MessageCircle, Send, Settings, ShieldCheck, ThumbsUp, Trash2, UserRound,
  Sparkles, Store, Target, UserRoundPlus, UsersRound, X
} from 'lucide-react';
import { ago, companyImagePath, day, type Action, type CompanyBrand, type Dashboard, type Job, type Person, type Post, type Project, type Resume, type View } from './data';
import { serviceRequestHref } from './service-data';
import { usePostImpression } from './analytics-events';

export const workspaceLinks = [
  { id: 'home', label: 'Home feed', Icon: House },
  { id: 'network', label: 'My network', Icon: UsersRound },
  { id: 'jobs', label: 'Jobs', Icon: BriefcaseBusiness },
  { id: 'companies', label: 'Companies', Icon: Building2 },
  { id: 'groups', label: 'Groups', Icon: Globe2 },
  { id: 'events', label: 'Events', Icon: CalendarDays },
  { id: 'publications', label: 'Articles', Icon: FileText },
  { id: 'learning', label: 'Learning', Icon: GraduationCap },
  { id: 'services', label: 'Services', Icon: Store },
  { id: 'sales', label: 'Sales', Icon: Target },
  { id: 'advertising', label: 'Campaigns', Icon: Megaphone },
  { id: 'analytics', label: 'Analytics', Icon: ChartNoAxesCombined },
  { id: 'ai', label: 'AI Assistant', Icon: Sparkles },
  { id: 'messages', label: 'Messages', Icon: MessageCircle },
  { id: 'saved', label: 'Saved', Icon: Bookmark },
] as const;

export const memberLinks = [
  { id: 'profile', label: 'My profile', Icon: UserRound },
  { id: 'settings', label: 'Settings', Icon: Settings },
  { id: 'moderation', label: 'Moderation', Icon: ShieldCheck }
] as const;
export const links = [...workspaceLinks, ...memberLinks];

export function Brand() {
  return <span className="brand"><span className="brand-mark"><Link2 size={22} strokeWidth={2.6} /></span>
    <span>linkedup<span className="brand-period">.</span></span><span className="brand-pro">PRO</span></span>;
}

export function Avatar({ person, size = 40 }: { person: Pick<Person, 'name' | 'image'>; size?: number }) {
  const initials = person.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * .34) }}>
    {person.image ? <img src={person.image} alt="" /> : initials}
  </span>;
}

export function BrandAvatar({ brand, size = 40 }: { brand: CompanyBrand; size?: number }) {
  return <span aria-hidden="true" className="brand-avatar" style={{ width: size, height: size, fontSize: Math.round(size * .41) }}>
    {brand.hasLogo ? <img src={companyImagePath(brand, 'logo')} alt="" /> : Array.from(brand.name)[0]?.toUpperCase()}
  </span>;
}

export function Dialog({ title, children, close, error }: { title: string; children: ReactNode; close: () => void; error?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="dialog-inner">
      <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-btn" type="button" aria-label="Close" onClick={close}><X size={21} /></button></div>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      {children}
    </div>
  </dialog>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="card empty"><div className="empty-icon"><FolderOpen size={23} /></div><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}

export function Company({ job, size = 'normal' }: { job: Pick<Job, 'company' | 'color'>; size?: 'normal' | 'large' }) {
  return <span aria-hidden="true" className={`company ${job.color} ${size}`}>
    {job.company === 'Forma' ? <span className="forma-mark">◆</span> : job.company === 'Studio North' ? <span className="north-mark">✳</span> : job.company.slice(0, 1).toUpperCase()}
  </span>;
}

export function PersonAction({ person, action }: { person: Person; action: Action }) {
  const current = person.connection;
  if (current === 'connected') return <span className="status green"><Check size={15} /> Connected</span>;
  return <button className={current === 'none' ? 'person-connect' : 'button compact secondary'} type="button"
    aria-label={current === 'none' ? `Connect with ${person.name}` : undefined}
    onClick={() => action(`connections/${person.id}`, { action: current === 'received' ? 'accept' : current === 'none' ? 'request' : 'remove' },
      current === 'received' ? 'Connection accepted' : current === 'none' ? 'Request sent' : 'Request withdrawn')}>
    {current === 'received' ? 'Accept' : current === 'sent' ? 'Withdraw request' : <UserRoundPlus size={19} />}
  </button>;
}

export function FeedPost({ post, dashboard, action, showPerson, showReport, hideDiscussion, showContext, trackAnalytics = false }: {
  post: Post; dashboard: Dashboard; action: Action; showPerson: (id: string) => void;
  showReport: (id: number) => void; hideDiscussion?: (id: number) => void; showContext?: boolean; trackAnalytics?: boolean;
}) {
  const [comments, setComments] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const canParticipate = post.canParticipate !== false;
  const impression = usePostImpression(post.id, dashboard.me.id, trackAnalytics && post.author.id !== dashboard.me.id && !post.canManageCompany);
  const canDelete = post.company ? post.canManageCompany : post.author.id === dashboard.me.id;
  const companyId = post.company?.id;
  async function comment(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    if (await action(`posts/${post.id}/comment`, { body })) setBody('');
    setBusy(false);
  }
  return <article className="card feed-post" id={`post-${post.id}`} ref={impression}>
    <header className="post-head">
      <button className="post-person" onClick={() => {
        if (post.company) window.location.hash = `companies?company=${post.company.id}`;
        else showPerson(post.author.id);
      }}>
        {post.company ? <BrandAvatar brand={post.company} size={46} /> : <Avatar person={post.author} size={46} />}
        <span><strong>{post.company?.name ?? post.author.name}</strong>
          <small>{post.company ? 'Company update' : post.author.headline || 'Linkedup Pro member'}</small></span>
      </button>
      <span className="post-time">{ago(post.createdAt)}</span>
      <details className="post-menu">
        <summary className="icon-btn" aria-label="Post options"><Ellipsis size={22} /></summary>
        <div className="menu-panel">
          <button onClick={(event) => {
            event.currentTarget.closest('details')?.removeAttribute('open');
            void action(`posts/${post.id}/bookmark`, { active: !post.saved }, post.saved ? 'Post removed from saved' : 'Post saved');
          }}><Bookmark size={16} /> {post.saved ? 'Remove bookmark' : 'Bookmark post'}</button>
          {companyId && post.canManageCompany && <button onClick={(event) => {
            event.currentTarget.closest('details')?.removeAttribute('open');
            window.location.hash = `advertising?new=1&company=${companyId}&post=${post.id}`;
          }}><Megaphone size={16} /> Promote update</button>}
          {canDelete ? <button onClick={() => action(`posts/${post.id}`, undefined, 'Post deleted', 'DELETE')}><Trash2 size={16} /> Delete post</button> :
            <button onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open');
              showReport(post.id);
            }}><Flag size={16} /> Report post</button>}
          {hideDiscussion && <button onClick={(event) => {
            event.currentTarget.closest('details')?.removeAttribute('open');
            hideDiscussion(post.id);
          }}><EyeOff size={16} /> {post.company ? 'Hide update' : post.groupId ? 'Hide in group' : 'Hide in event'}</button>}
        </div>
      </details>
    </header>
    {showContext && post.groupId && <a className="text-link post-group" href={`#groups?group=${post.groupId}`}>{post.groupName}</a>}
    {showContext && post.eventId && <a className="text-link post-group" href={`#events?event=${post.eventId}`}>{post.eventTitle}</a>}
    {post.topic && <h3 className="post-topic">{post.topic}</h3>}
    <p className="post-body">{post.body}</p>
    {post.image && <img className="post-image" src={post.image} alt="Sunlit shared studio with wooden desks and plants" />}
    <div className="post-stats"><span><span className="like-dot"><ThumbsUp size={11} /></span>{post.likes}</span>
      <button onClick={() => setComments(!comments)}>{post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}</button></div>
    <div className="post-actions">
      {canParticipate && <button aria-pressed={post.liked} onClick={() => action(`posts/${post.id}/like`, { active: !post.liked })}><ThumbsUp size={17} /> Like</button>}
      <button aria-expanded={comments} onClick={() => setComments(!comments)}><MessageCircle size={17} /> {canParticipate ? 'Comment' : 'View comments'}</button>
      <button aria-pressed={post.saved} onClick={() => action(`posts/${post.id}/bookmark`, { active: !post.saved }, post.saved ? 'Post removed from saved' : 'Post saved')}><Bookmark size={17} /> {post.saved ? 'Saved' : 'Save'}</button>
    </div>
    {comments && <div className="post-comments">
      {canParticipate && <form className="comment-form" onSubmit={comment}><Avatar person={dashboard.me} size={32} />
        <input aria-label="Write a comment" placeholder="Write a comment…" maxLength={1000} value={body} onChange={(event) => setBody(event.target.value)} />
        <button className="icon-btn accent-icon" aria-label="Post comment" disabled={!body.trim() || busy}><Send size={17} /></button></form>}
      {post.comments.map((item) => <div className="comment" key={item.id}><Avatar person={item} size={31} />
        <div><strong>{item.name}</strong><p>{item.body}</p></div></div>)}
    </div>}
  </article>;
}

export function HomeAside({ dashboard, go, showJob, showPerson, action }: {
  dashboard: Dashboard; go: (view: View) => void; showJob: (job: Job) => void; showPerson: (id: string) => void; action: Action;
}) {
  const suggestions = dashboard.people.filter((item) => item.connection !== 'connected').slice(0, 2);
  const jobs = dashboard.jobs.filter((job) => !job.closed && !job.canManage).slice(0, 2);
  const verified = dashboard.projects.filter((project) => project.verifiedAt).length;
  return <aside className="home-aside" aria-label="Profile and recommendations">
    <section className="card profile-mini">
      <div className="profile-pattern"><span /><span /><span /></div>
      <div className="profile-mini-body">
        <div className="avatar-border"><Avatar person={dashboard.me} size={60} /></div>
        <strong>{dashboard.me.name}</strong>
        <p>{dashboard.me.headline || 'Linkedup Pro member'}</p>
        <div className="mini-metrics"><button onClick={() => go('network')}><strong>{dashboard.me.connections}</strong><span>Connections</span></button>
          <button onClick={() => go('profile')}><strong>{verified}</strong><span>Verified projects</span></button></div>
        <button className="button secondary full" onClick={() => go('profile')}>View profile</button>
      </div>
    </section>
    {jobs.length > 0 && <section className="card side-card">
      <div className="side-heading"><span className="side-heading-icon"><BriefcaseBusiness size={17} /></span><h2>Recent jobs</h2></div>
      {jobs.map((job) => <button className="side-row" key={job.id} onClick={() => showJob(job)}><Company job={job} />
        <span className="side-row-copy"><strong>{job.title}</strong><small>{job.company} <span>·</span> {job.workMode}</small></span><ChevronRight size={16} className="row-chevron" /></button>)}
      <button className="side-link" onClick={() => go('jobs')}>Explore jobs</button>
    </section>}
    {suggestions.length > 0 && <section className="card side-card">
      <div className="side-heading"><span className="side-heading-icon green-icon"><UsersRound size={17} /></span><h2>People to connect with</h2></div>
      {suggestions.map((person) => <div className="side-row person-row" key={person.id}><button onClick={() => showPerson(person.id)}>
        <Avatar person={person} size={38} /><span className="side-row-copy"><strong>{person.name}</strong><small>{person.headline}</small></span></button>
        <PersonAction person={person} action={action} /></div>)}
    </section>}
  </aside>;
}

export function Timeline({ events }: { events: Dashboard['applications'][number]['timeline'] }) {
  return <ol className="timeline">{events.map((event, index) => <li key={`${event.createdAt}-${index}`}><span className={index === 0 ? 'latest' : ''} /><div><strong>{event.status}</strong><small>{day(event.createdAt)}</small></div></li>)}</ol>;
}

export function ResumeLink({ application }: { application: Resume }) {
  if (application.resumeFileName) {
    return <a className="text-link resume-link" href={`/api/applications/${application.id}/resume`} download>
      <Download size={15} /> <span>{application.resumeFileName}</span>
    </a>;
  }
  if (application.resumeUrl) {
    return <a className="text-link resume-link" href={application.resumeUrl} target="_blank" rel="noreferrer">Résumé link <ExternalLink size={13} /></a>;
  }
  return null;
}

export function ProjectItem({ project }: { project: Project }) {
  return <article className="project-item"><div className="tile-icon"><FolderOpen size={20} /></div>
    <div><h3>{project.title}</h3><p>{project.contribution}</p>
      <div className="project-tags">{project.verifiedAt ? <span className="status green"><BadgeCheck size={15} /> Confirmed{project.verifier ? ` by ${project.verifier}` : ''}</span> :
        project.verifierId ? <span className="status violet">Verification requested</span> : null}
        {project.isPublic === false && <span className="status">Private</span>}
        {project.url && <a className="text-link" target="_blank" rel="noreferrer" href={project.url}>View work <ExternalLink size={13} /></a>}
      </div>
    </div></article>;
}

export function JobListItem({ job, application, showJob, save }: {
  job: Job; application?: Dashboard['applications'][number]; showJob: () => void; save: () => void;
}) {
  return <article className="card job-card">
    <div className="job-card-top"><button className="job-title" onClick={showJob}><Company job={job} size="large" />
      <span><h3>{job.title}</h3><small>{job.company}</small></span></button>
      <button className="icon-btn" aria-pressed={job.saved} aria-label={job.saved ? 'Remove saved job' : 'Save job'} onClick={save}><Bookmark size={20} fill={job.saved ? 'currentColor' : 'none'} /></button>
    </div>
    <div className="job-tags"><span><MapPin size={15} /> {job.location}</span><span>{job.workMode}</span><span>{job.employmentType}</span>{job.closed && <span>Closed</span>}</div>
    <div className="job-card-foot"><strong>{job.salary}</strong><span>{application?.timeline[0]?.status || ago(job.createdAt)}</span></div>
  </article>;
}

export function SortSelect({ sort, update }: { sort: string; update: (sort: string) => void }) {
  return <label className="select-pill"><span className="sr-only">Sort posts</span><select value={sort} onChange={(event) => update(event.target.value)}>
    <option value="latest">Latest</option><option value="popular">Most liked</option>
  </select><ChevronDown size={15} /></label>;
}

export function Notifications({ dashboard, action, go }: { dashboard: Dashboard; action: Action; go: (view: View) => void }) {
  const unread = dashboard.notifications.filter((notice) => !notice.seen).length;
  return <details className="notifications post-menu">
    <summary aria-label={unread ? `${unread} unread notifications` : 'Notifications'} className="icon-btn"><Bell size={21} />{unread > 0 && <span className="notification-dot" />}</summary>
    <div className="menu-panel notification-panel"><div className="notification-heading"><strong>Notifications</strong>{unread > 0 && <button onClick={() => action('notifications/read')}>Mark all read</button>}</div>
      {dashboard.notifications.length ? dashboard.notifications.map((notice) => <button className="notification-item" key={notice.id} onClick={(event) => {
        event.currentTarget.closest('details')?.removeAttribute('open');
        if (notice.articleId) {
          window.location.hash = `publications?article=${notice.articleId}`;
          return;
        }
        if (notice.companyId) {
          window.location.hash = `companies?company=${notice.companyId}`;
          return;
        }
        if (notice.serviceRequestId) {
          window.location.hash = serviceRequestHref(notice.serviceRequestId);
          return;
        }
        if (notice.category === 'Sales') {
          window.location.hash = 'sales?tab=pipeline&view=due';
          return;
        }
        go(notice.category === 'Jobs' ? 'jobs' : notice.category === 'Messages' ? 'messages' :
          notice.category === 'Network' ? 'network' : notice.category === 'Groups' ? 'groups' :
          notice.category === 'Events' ? 'events' : notice.category === 'Publications' ? 'publications' :
          notice.category === 'Companies' ? 'companies' : 'profile');
      }}><span className={notice.seen ? '' : 'notice-new'} /><div>{notice.message}<small>{ago(notice.createdAt)}</small></div></button>) :
        <p className="empty-notifications">You’re all caught up.</p>}
    </div>
  </details>;
}
