'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BriefcaseBusiness, ChevronDown, Command, Ellipsis, FlaskConical, GraduationCap, LogOut, Plus, Search, Store, X } from 'lucide-react';
import { io } from 'socket.io-client';
import { AuthScreen, takeAuthLink, type AuthLink } from './auth-screen';
import { AdvertisingView } from './advertising-view';
import { sendAnalyticsEvent } from './analytics-events';
import { AnalyticsView } from './analytics-view';
import { AiView } from './ai-view';
import { Avatar, Brand, links, memberLinks, Notifications, workspaceLinks } from './components';
import { CompaniesView } from './companies-view';
import { api, type AccessOptions, type Action, type Dashboard, type View } from './data';
import { WorkDialog } from './forms';
import { EventsView } from './events-view';
import { GroupsView } from './groups-view';
import { courseHref, type CourseSearchResult } from './learning-data';
import { LearningView, ProfileCertificates } from './learning-view';
import { ModerationView } from './moderation-view';
import { PublicationsView } from './publications-view';
import { SalesView } from './sales-view';
import { serviceProviderHref, type ServiceSearchResult } from './service-data';
import { ProfileService, ServicesView } from './services-view';
import { Home, Jobs, Messages, Network, Profile, Saved, SettingsView, type Modal } from './views';

type Snapshot = Dashboard | (AccessOptions & { me: null });
const mobileMoreViews: View[] = ['companies', 'publications', 'learning', 'services', 'sales', 'advertising', 'analytics', 'ai', 'saved'];
const inMobileMore = (id: View) => mobileMoreViews.includes(id);

function readView(): View {
  const name = typeof window === 'undefined' ? '' : window.location.hash.slice(1).split('?')[0];
  return links.find((item) => item.id === name)?.id ?? 'home';
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [view, setView] = useState<View>('home');
  const [modal, setModal] = useState<Modal | null>(null);
  const [area, setArea] = useState('Explore');
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [remoteResults, setRemoteResults] = useState<{ query: string; memberId: string; courses: CourseSearchResult[]; services: ServiceSearchResult[] }>();
  const searchInput = useRef<HTMLInputElement>(null);
  const snapshotVersion = useRef(0);
  const initialLink = useRef<AuthLink | null | undefined>(undefined);
  const [authLink, setAuthLink] = useState<AuthLink | null>(null);
  const query = search.trim().toLowerCase();
  const memberId = dashboard?.me?.id;
  const searchPeople = useMemo(() => query && dashboard?.me ? dashboard.people.filter((person) =>
    `${person.name} ${person.headline}`.toLowerCase().includes(query)).slice(0, 3) : [], [dashboard, query]);

  const reload = useCallback(async () => {
    const version = ++snapshotVersion.current;
    const result = await api<Snapshot>('dashboard');
    if (version === snapshotVersion.current) {
      setDashboard(result);
      setError('');
    }
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    if (initialLink.current === undefined) initialLink.current = takeAuthLink();
    setAuthLink(initialLink.current);
    async function load() {
      try {
        const result = await api<Snapshot>('dashboard');
        if (!active) return;
        if (!result.me && !initialLink.current && result.demoMode && !sessionStorage.getItem('linkedup-signout')) {
          await api('demo/alex', { method: 'POST' });
          if (active) await reload();
        } else setDashboard(result);
      } catch (failure) {
        if (active) setError((failure as Error).message);
      }
    }
    void load();
    const onHash = () => setView(readView());
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); searchInput.current?.focus();
      }
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => { active = false; window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey); };
  }, [reload]);

  useEffect(() => {
    if (!notice || (notice.error && modal)) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice, modal]);

  useEffect(() => {
    if (view !== 'messages' || !dashboard?.me) return;
    const timer = window.setInterval(() => { if (!document.hidden) void reload().catch(() => {}); }, 15000);
    return () => window.clearInterval(timer);
  }, [view, dashboard?.me?.id, reload]);

  useEffect(() => {
    if (!dashboard?.me?.id || authLink) return;
    const endpoint = process.env.NODE_ENV === 'development'
      ? process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:4000'
      : undefined;
    const socket = io(endpoint, { path: '/api/realtime', transports: ['websocket'] });
    socket.on('dashboard:changed', () => { void reload().catch(() => {}); });
    return () => { socket.disconnect(); };
  }, [dashboard?.me?.id, authLink, reload]);

  useEffect(() => {
    if (!searchOpen || !query || !searchPeople.length || authLink) return;
    const timer = window.setTimeout(() => {
      sendAnalyticsEvent('search', { query: query.slice(0, 240), results: searchPeople.map((person) => person.id) });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchOpen, query, searchPeople, authLink]);

  useEffect(() => {
    if (!searchOpen || !query || !memberId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.slice(0, 120) });
      void Promise.allSettled([
        api<CourseSearchResult[]>(`learning/search?${params}`, { signal: controller.signal }),
        api<ServiceSearchResult[]>(`services/search?${params}`, { signal: controller.signal })
      ]).then(([courses, services]) => {
        if (!controller.signal.aborted) setRemoteResults({ query, memberId, courses: courses.status === 'fulfilled' ? courses.value : [],
          services: services.status === 'fulfilled' ? services.value : [] });
      });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, memberId, searchOpen]);

  function go(next: View) {
    if (view !== next || ((next === 'learning' || next === 'services' || next === 'sales' || next === 'advertising' || next === 'analytics' || next === 'ai') && window.location.hash !== '#' + next)) {
      window.location.hash = next === 'home' ? '' : next;
      setView(next);
      window.scrollTo({ top: 0 });
    }
  }

  const action: Action = async (path, body, success, method = 'POST') => {
    try {
      await api(path, { method, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
      await reload();
      if (success) setNotice({ message: success });
      return true;
    } catch (failure) {
      setNotice({ message: (failure as Error).message, error: true });
      return false;
    }
  };

  async function switchDemo(person: string) {
    try {
      await api(`demo/${person}`, { method: 'POST' });
      sessionStorage.removeItem('linkedup-signout');
      setModal(null);
      setSelected('');
      const result = await reload();
      if (result.me) { setAuthLink(null); setNotice({ message: `Switched to ${result.me.name}` }); }
    } catch (failure) {
      setNotice({ message: (failure as Error).message, error: true });
    }
  }

  async function logout() {
    try {
      await api('auth/sign-out', { method: 'POST', body: '{}' });
      sessionStorage.setItem('linkedup-signout', '1');
      setModal(null);
      setSelected('');
      await reload();
      go('home');
    } catch (failure) { setNotice({ message: (failure as Error).message, error: true }); }
  }

  if (!dashboard) return <main className="initial-screen"><Brand />{error ? <><h1>Linkedup Pro couldn’t connect</h1><p>{error}</p>
    <button className="button primary" onClick={() => window.location.reload()}>Try again</button></> : <div className="loading-indicator" aria-label="Loading Linkedup Pro" />}</main>;
  if (!dashboard.me || authLink) return <AuthScreen options={dashboard} link={authLink} loginDemo={() => switchDemo('alex')} signedIn={async () => {
    const result = await reload();
    if (result.me) {
      sessionStorage.removeItem('linkedup-signout');
      setAuthLink(null);
    }
  }} />;

  const profile = dashboard.me;
  const accountLinks = memberLinks.filter((item) => item.id !== 'moderation' || profile.isModerator);
  const activeView = view === 'moderation' && !profile.isModerator ? 'home' : view;
  const show = (next: Modal) => { setNotice(null); setModal(next); };
  const close = () => {
    setNotice((previous) => previous?.error ? null : previous);
    setModal(null);
  };
  const showPerson = (id: string) => { if (id === profile.id) go('profile'); else show({ kind: 'person', id }); };
  const openMessages = (id: string) => { setSelected(id); setModal(null); go('messages'); };
  const props = { dashboard, action, show, go, showPerson };
  const searchJobs = query ? dashboard.jobs.filter((job) => !job.closed && `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(query)).slice(0, 3) : [];
  const remote = remoteResults?.query === query && remoteResults.memberId === profile.id ? remoteResults : undefined;
  const clearSearch = () => { setSearch(''); setSearchOpen(false); searchInput.current?.blur(); };
  const messageCount = dashboard.notifications.filter((item) => item.category === 'Messages' && !item.seen).length;

  return <div className="app-shell">
    <a className="skip" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <header className="topbar">
      <button className="brand-button" aria-label="Linkedup Pro home" onClick={() => go('home')}><Brand /></button>
      <div className="topbar-main">
        <div className="global-search" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
        }} onKeyDown={(event) => {
          if (event.key === 'Escape') clearSearch();
          if (event.key === 'ArrowDown' && event.target === searchInput.current) {
            const first = event.currentTarget.querySelector<HTMLButtonElement>('.search-panel button');
            if (first) { event.preventDefault(); first.focus(); }
          }
        }}>
          <Search size={19} className="search-icon" />
          <input ref={searchInput} placeholder="Search" aria-label="Search Linkedup Pro" value={search}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); }} />
          {search ? <button className="icon-btn clear-search" aria-label="Clear search" onClick={clearSearch}><X size={16} /></button> :
            <kbd><Command size={12} /> K</kbd>}
          {searchOpen && query && <div className="menu-panel search-panel">
            {searchPeople.map((person) => <button key={person.id} onClick={() => {
              sendAnalyticsEvent('search', { query: query.slice(0, 240), results: [person.id] });
              clearSearch(); showPerson(person.id);
            }}>
              <Avatar person={person} size={29} /><span><strong>{person.name}</strong><small>{person.headline}</small></span></button>)}
            {searchJobs.map((job) => <button key={job.id} onClick={() => { clearSearch(); show({ kind: 'job', id: job.id }); }}>
              <BriefcaseBusiness size={19} /><span><strong>{job.title}</strong><small>{job.company}</small></span></button>)}
            {remote?.courses.map((course) => <button key={`course-${course.id}`} onClick={() => { clearSearch(); window.location.hash = courseHref(course.id); }}>
              <GraduationCap size={19} /><span><strong>{course.title}</strong><small>Course · {course.category}</small></span></button>)}
            {remote?.services.map((offer) => <button key={`service-${offer.id}`} onClick={() => { clearSearch(); window.location.hash = serviceProviderHref(offer.providerId, offer.id); }}>
              <Store size={19} /><span><strong>{offer.title}</strong><small>Service · {offer.name}</small></span></button>)}
            {!searchPeople.length && !searchJobs.length && !remote?.courses.length && !remote?.services.length &&
              <p>{remote ? `No results for “${search.trim()}”` : 'Searching…'}</p>}
          </div>}
        </div>
        <div className="topbar-actions">
          <button className="button primary new-post" aria-label="New post" onClick={() => show({ kind: 'create' })}><Plus size={19} /><span>New post</span></button>
          <Notifications dashboard={dashboard} action={action} go={go} />
          <span className="topbar-divider" />
          <details className="account post-menu">
            <summary aria-label="Account menu"><Avatar person={profile} size={36} /><ChevronDown size={14} /></summary>
            <div className="menu-panel"><div className="account-name"><strong>{profile.name}</strong><small>{profile.email}</small></div>
              {accountLinks.map(({ id, label, Icon }) => <button key={id} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); go(id); }}><Icon size={17} /> {label}</button>)}
              <button onClick={() => void logout()}><LogOut size={17} /> Sign out</button></div>
          </details>
        </div>
      </div>
    </header>
    <aside className="sidebar">
      <nav aria-label="Main navigation">
        <div className="nav-group"><p>WORKSPACE</p>{workspaceLinks.map(({ id, label, Icon }) => <button className="nav-button" aria-current={activeView === id ? 'page' : undefined}
          onClick={() => go(id)} key={id}><Icon size={20} strokeWidth={1.9} /><span>{label}</span>{id === 'messages' && messageCount > 0 && <b>{messageCount}</b>}</button>)}</div>
        <div className="nav-group account-nav"><p>ACCOUNT</p>{accountLinks.map(({ id, label, Icon }) => <button className="nav-button" aria-current={activeView === id ? 'page' : undefined}
          onClick={() => go(id)} key={id}><Icon size={20} strokeWidth={1.9} /><span>{label}</span></button>)}</div>
      </nav>
      {dashboard.demoMode && <button className="demo-control" onClick={() => show({ kind: 'demo' })}><span><FlaskConical size={17} /></span><span><strong>Demo workspace</strong><small>Switch accounts</small></span><ChevronDown size={13} /></button>}
    </aside>
    <nav className="mobile-nav" aria-label="Main navigation">
      {workspaceLinks.filter(({ id }) => !inMobileMore(id)).map(({ id, label, Icon }) => <button key={id} aria-label={id === 'messages' ? label : undefined}
        aria-current={activeView === id ? 'page' : undefined} onClick={() => go(id)}>
        <Icon size={21} /><span>{id === 'home' ? 'Home' : id === 'network' ? 'Network' : id === 'messages' ? 'Inbox' : label}</span></button>)}
      <details className="mobile-more post-menu">
        <summary aria-label="More" className={inMobileMore(activeView) ? 'active' : ''}><Ellipsis size={22} /><span>More</span></summary>
        <div className="menu-panel mobile-more-panel">{workspaceLinks.filter(({ id }) => inMobileMore(id)).map(({ id, label, Icon }) =>
          <button key={id} aria-current={activeView === id ? 'page' : undefined} onClick={(event) => {
            event.currentTarget.closest('details')?.removeAttribute('open');
            go(id);
          }}><Icon size={18} /> {label}</button>)}</div>
      </details>
    </nav>
    <main className="main-content" id="main-content" tabIndex={-1}>
      <div className={activeView === 'home' ? 'workspace' : 'workspace other-view'}>
        {activeView === 'home' && <Home {...props} />}
        {activeView === 'network' && <Network {...props} />}
        {activeView === 'jobs' && <Jobs {...props} area={area} changeArea={setArea} />}
        {activeView === 'companies' && <CompaniesView key={profile.id} dashboard={dashboard} action={action}
          showModal={show} showPerson={showPerson} refreshDashboard={reload}
          manageJobs={() => { setArea('Manage jobs'); go('jobs'); }} />}
        {activeView === 'groups' && <GroupsView key={profile.id} dashboard={dashboard} action={action}
          showPerson={showPerson} showReport={(id) => show({ kind: 'report', id })} />}
        {activeView === 'events' && <EventsView key={profile.id} dashboard={dashboard} action={action}
          showPerson={showPerson} showReport={(id) => show({ kind: 'report', id })} />}
        {activeView === 'publications' && <PublicationsView key={profile.id} dashboard={dashboard} action={action} />}
        {activeView === 'learning' && <LearningView key={profile.id} member={profile} />}
        {activeView === 'services' && <ServicesView key={profile.id} revision={dashboard.notifications.find((notice) => notice.serviceRequestId)?.id} />}
        {activeView === 'sales' && <SalesView key={profile.id} showPerson={showPerson} message={openMessages}
          revision={dashboard.notifications.find((notice) => notice.category === 'Sales')?.id} />}
        {activeView === 'advertising' && <AdvertisingView key={profile.id} />}
        {activeView === 'analytics' && <AnalyticsView key={profile.id} />}
        {activeView === 'ai' && <AiView key={profile.id} dashboard={dashboard} action={action} openJob={(id) => show({ kind: 'job', id })} />}
        {activeView === 'messages' && <Messages {...props} selected={selected} select={setSelected} />}
        {activeView === 'saved' && <Saved {...props} />}
        {activeView === 'profile' && <><Profile {...props} /><ProfileCertificates key={profile.id} profileId={profile.id} />
          <ProfileService key={profile.id + '-services'} memberId={profile.id} mine /></>}
        {activeView === 'settings' && <SettingsView dashboard={dashboard} demo={() => show({ kind: 'demo' })} logout={() => void logout()} />}
        {activeView === 'moderation' && <ModerationView key={profile.id} action={action} />}
      </div>
    </main>
    {modal && <WorkDialog key={modal.kind + ('id' in modal ? modal.id : '')} modal={modal} dashboard={dashboard} action={action}
      close={close} show={show} switchDemo={switchDemo} error={notice?.error ? notice.message : undefined}
      goMessages={openMessages}
      applications={() => { setArea('My applications'); go('jobs'); }} />}
    {notice && !(modal && notice.error) && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.message}
      <button aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={17} /></button></div>}
  </div>;
}
