'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Globe2, LockKeyhole, MessageCircle, Plus, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { Avatar, Dialog, Empty, FeedPost } from './components';
import { api, day, type Action, type Dashboard, type Person, type Post } from './data';
import { FilterTabs } from './views';

type Membership = 'none' | 'active' | 'pending' | 'invited';
type Role = 'owner' | 'admin' | 'member';
type Group = {
  id: number; name: string; description: string; industry: string; visibility: 'public' | 'private';
  membership: Membership; role: Role | null; memberCount: number;
};
type Member = Pick<Person, 'id' | 'name' | 'image' | 'headline'>;
type GroupDetail = {
  group: Group; posts: Post[]; members: (Member & { role: Role })[];
  requests: (Member & { requestedAt: string })[]; invitees: Member[];
  hidden: { id: number; topic: string; body: string; author: string }[];
};
type MemberAction = 'invite' | 'approve' | 'decline' | 'promote' | 'demote' | 'transfer' | 'remove';

const membershipLabels = { active: 'Joined', pending: 'Request pending', invited: 'Invited', none: '' };
const roles = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const results = {
  invite: 'Invitation sent', approve: 'Request approved', decline: 'Request declined', promote: 'Admin added',
  demote: 'Admin removed', transfer: 'Ownership transferred', remove: 'Member removed'
};
const directoryTabs = ['Discover', 'My groups', 'Invitations'];

function currentGroup() {
  const hash = window.location.hash.split('?');
  if (hash[0] !== '#groups') return null;
  const group = Number(new URLSearchParams(hash[1]).get('group'));
  return Number.isInteger(group) && group > 0 ? group : null;
}

function Visibility({ group }: { group: Group }) {
  const Icon = group.visibility === 'private' ? LockKeyhole : Globe2;
  return <span className="status group-visibility"><Icon size={14} />{group.visibility === 'private' ? 'Private' : 'Public'}</span>;
}

function GroupMark({ group }: { group: Group }) {
  const Icon = group.visibility === 'private' ? LockKeyhole : UsersRound;
  return <span className={`group-mark ${group.visibility}`} aria-hidden="true"><Icon size={24} /></span>;
}

function GroupCard({ group, open }: { group: Group; open: (group: number) => void }) {
  return <article className="card group-card">
    <div className={`group-card-cover ${group.visibility}`}><GroupMark group={group} /><Visibility group={group} /></div>
    <div className="group-card-body">
      <h2><button className="group-title-link" onClick={() => open(group.id)}>{group.name}</button></h2>
      <p>{group.description}</p>
      <div className="group-card-meta"><span className="status violet">{group.industry}</span>
        <span className="group-member-count"><UsersRound size={15} /> {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}</span>
      </div>
      <div className="group-card-footer">
        {group.membership !== 'none' && <span className={`status ${group.membership === 'active' ? 'green' : 'violet'}`}>{membershipLabels[group.membership]}</span>}
        <button className="button secondary compact" onClick={() => open(group.id)}>View group<span className="sr-only"> {group.name}</span></button>
      </div>
    </div>
  </article>;
}

export function GroupsView({ dashboard, action, showPerson, showReport }: {
  dashboard: Dashboard; action: Action; showPerson: (id: string) => void; showReport: (id: number) => void;
}) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [directory, setDirectory] = useState('Discover');
  const [tab, setTab] = useState('Discussions');
  const [query, setQuery] = useState('');
  const [invitee, setInvitee] = useState('');
  const [dialog, setDialog] = useState<'create' | 'discussion' | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const groupNotice = dashboard.notifications.find((notice) => notice.category === 'Groups')?.id;

  const load = useCallback(async (group: number | null, signal?: AbortSignal) => {
    try {
      const result = await Promise.all([
        api<Group[]>('groups', { signal }),
        group ? api<GroupDetail>(`groups/${group}`, { signal }) : null
      ]);
      if (signal?.aborted) return;
      setGroups(result[0]);
      setDetail(result[1]);
      setError('');
    } catch (failure) {
      if (!signal?.aborted) setError((failure as Error).message);
    }
  }, []);
  useEffect(() => {
    const update = () => {
      setSelected(currentGroup());
      setTab('Discussions');
      setInvitee('');
      setDialog(null);
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(selected, controller.signal);
    return () => controller.abort();
  }, [selected, load, groupNotice]);

  function open(group: number | null) {
    window.location.hash = group ? `groups?group=${group}` : 'groups';
    window.scrollTo({ top: 0 });
  }

  function show(kind: typeof dialog) {
    setDialogError('');
    setDialog(kind);
  }

  const refreshAfter: Action = async (path, data, success, method) => {
    const ok = await action(path, data, success, method);
    if (ok && currentGroup() === selected) await load(selected);
    return ok;
  };

  async function run(path: string, data: object, success: string) {
    setBusy(true);
    try { return await refreshAfter(path, data, success); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || busy) return;
    setBusy(true);
    setDialogError('');
    try {
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      const created = await api<{ id: number }>(dialog === 'create' ? 'groups' : `groups/${selected}/posts`, {
        method: 'POST', body: JSON.stringify(fields)
      });
      setDialog(null);
      if (dialog === 'create') open(created.id);
      else await load(selected);
    } catch (failure) {
      setDialogError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const group = detail?.group.id === selected ? detail.group : null;
  const isMember = group?.membership === 'active';
  const isOwner = group?.role === 'owner' && isMember;
  const manages = isMember && (isOwner || group?.role === 'admin');
  const members = group && detail ? detail.members : [];
  const lookup = query.trim().toLowerCase();
  const listed = groups?.filter((item) => {
    if (directory === 'My groups' && !['active', 'pending'].includes(item.membership)) return false;
    if (directory === 'Invitations' && item.membership !== 'invited') return false;
    return !lookup || `${item.name} ${item.industry} ${item.description}`.toLowerCase().includes(lookup);
  });

  function manageMember(person: Member, decision: MemberAction) {
    if (!group) return;
    if (decision === 'transfer' && !window.confirm(`Transfer ownership of ${group.name} to ${person.name}?`)) return;
    void run(`groups/${group.id}/members/${person.id}`, { action: decision }, results[decision]);
  }

  let content;
  if (error) {
    content = <section className="card content-card">
      <p className="form-error" role="alert">{error}</p>
      <div className="button-row"><button className="button secondary" onClick={() => void load(selected)}>Try again</button>
        {selected && <button className="button secondary" onClick={() => open(null)}>Back to groups</button>}</div>
    </section>;
  } else if (selected && group && detail) {
    const membershipAction = group.membership === 'invited' || group.membership === 'none' ? 'join' : 'leave';
    const joinLabel = group.membership === 'invited' ? 'Accept invitation' :
      group.visibility === 'private' ? 'Request to join' : 'Join group';
    const leaveLabel = group.membership === 'pending' ? 'Cancel request' : 'Leave group';
    const joinMessage = group.membership === 'invited' || group.visibility === 'public' ? 'Joined group' : 'Membership request sent';
    const membership = (decision: 'join' | 'leave', message: string) =>
      run(`groups/${group.id}/membership`, { action: decision }, message);
    const visible = group.visibility === 'public' || isMember;
    const tabs = isMember ? manages ? ['Discussions', 'Members', 'Manage'] : ['Discussions', 'Members'] : ['Discussions'];
    const activeTab = tabs.includes(tab) ? tab : 'Discussions';
    content = <>
      <button className="text-link group-back" onClick={() => open(null)}>Back to groups</button>
      <section className="card group-detail-heading">
        <div className={`group-card-cover ${group.visibility}`}><GroupMark group={group} /><Visibility group={group} /></div>
        <div className="group-detail-body">
          <div className="group-detail-title">
            <div><h1>{group.name}</h1><p>{group.description}</p></div>
            <div className="group-membership-actions">
              {isOwner ? <span className="status violet"><ShieldCheck size={15} /> Group owner</span> :
                <button className={`button ${membershipAction === 'join' ? 'primary' : 'secondary'}`} disabled={busy}
                  onClick={() => void membership(membershipAction, membershipAction === 'join' ? joinMessage :
                    group.membership === 'pending' ? 'Request cancelled' : 'Left group')}>
                  {membershipAction === 'join' ? joinLabel : leaveLabel}
                </button>}
              {group.membership === 'invited' && <button className="button secondary" disabled={busy}
                onClick={() => void membership('leave', 'Invitation declined')}>Decline invitation</button>}
            </div>
          </div>
          <div className="group-card-meta"><span className="status violet">{group.industry}</span>
            <span className="group-member-count"><UsersRound size={16} />{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}</span>
            {['pending', 'invited'].includes(group.membership) && <span className="status">{membershipLabels[group.membership]}</span>}
          </div>
        </div>
      </section>
      {visible ? <>
        {tabs.length > 1 && <FilterTabs values={tabs} current={activeTab} change={(next) => {
          setTab(next);
          if (next !== activeTab) void load(group.id);
        }} />}
        {activeTab === 'Discussions' && <>
          <div className="section-heading group-section-heading"><h2>Discussions</h2>
            {isMember && <button className="button primary compact" onClick={() => show('discussion')}><MessageCircle size={17} /> Start a discussion</button>}
          </div>
          {detail.posts.length ? <div className="post-stack">{detail.posts.map((post) => <FeedPost key={post.id}
            post={post} dashboard={dashboard} action={refreshAfter} showPerson={showPerson} showReport={showReport}
            hideDiscussion={manages ? (id) => { if (!busy) void run(`groups/${group.id}/posts/${id}`, { action: 'hide' }, 'Discussion hidden'); } : undefined} />)}</div> :
            <Empty title="No discussions yet">{isMember ? 'Start the first conversation in this group.' : 'Discussions will appear here.'}</Empty>}
        </>}
        {activeTab === 'Members' && <section className="card content-card group-member-directory">
          <h2>Member directory</h2>
          {members.map((person) => <div className="group-person-row" key={person.id}>
            <MemberSummary person={person} /><span className={`status ${person.role === 'member' ? '' : 'violet'}`}>{roles[person.role]}</span>
            {manages && person.id !== dashboard.me.id && person.role !== 'owner' && <div className="group-row-actions">
              {isOwner && <button className="button secondary compact" disabled={busy}
                onClick={() => manageMember(person, person.role === 'admin' ? 'demote' : 'promote')}>{person.role === 'admin' ? 'Make member' : 'Make admin'}</button>}
              {isOwner && <button className="text-link" disabled={busy} onClick={() => manageMember(person, 'transfer')}>Transfer ownership</button>}
              {(person.role === 'member' || isOwner) && <button className="text-link" disabled={busy} onClick={() => manageMember(person, 'remove')}>Remove</button>}
            </div>}
          </div>)}
        </section>}
        {activeTab === 'Manage' && <div className="column-stack">
          <section className="card content-card group-member-directory"><div className="section-heading"><h2>Membership requests</h2>
            <span className="status violet">{detail.requests.length} pending</span></div>
            {detail.requests.length ? detail.requests.map((person) => <div className="group-person-row" key={person.id}>
              <MemberSummary person={person} note={`Requested ${day(person.requestedAt)}`} />
              <div className="group-row-actions"><button className="button secondary compact" disabled={busy} onClick={() => manageMember(person, 'decline')}>Decline</button>
                <button className="button primary compact" disabled={busy} onClick={() => manageMember(person, 'approve')}>Approve</button></div>
            </div>) : <p className="muted group-inline-empty">No pending requests.</p>}
          </section>
          <section className="card content-card"><h2>Invite a connection</h2>
            {detail.invitees.length ? <form className="group-invite" onSubmit={async (event) => {
              event.preventDefault();
              if (await run(`groups/${group.id}/members/${invitee}`, { action: 'invite' }, results.invite)) setInvitee('');
            }}><select aria-label="Choose a connection" required value={invitee} onChange={(event) => setInvitee(event.target.value)}>
              <option value="">Choose a connection</option>
              {detail.invitees.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
            </select><button className="button primary" disabled={busy || !invitee}>Send invitation</button></form> :
              <p className="muted">No connections are available to invite.</p>}
          </section>
          <section className="card content-card"><h2>Hidden discussions</h2>
            {detail.hidden.length ? detail.hidden.map((post) => <div className="group-hidden-row" key={post.id}><div>
              <h3>{post.topic}</h3><p className="muted">{post.author}</p><p className="review-excerpt">{post.body}</p></div>
              <button className="button secondary compact" disabled={busy} onClick={() => void run(
                `groups/${group.id}/posts/${post.id}`, { action: 'restore' }, 'Discussion restored'
              )}>Restore</button></div>) : <p className="muted">No hidden discussions.</p>}
          </section>
        </div>}
      </> : <Empty title="Discussions are private">{group.membership === 'pending' ? 'A group admin will review your request.' :
        group.membership === 'invited' ? 'Accept your invitation to see the discussions and member directory.' : 'Request to join to see the discussions and member directory.'}</Empty>}
    </>;
  } else if (selected || !groups) {
    content = <p className="muted" role="status">Loading groups…</p>;
  } else {
    content = <>
      <div className="page-intro"><div><h1>Groups</h1><p>Find people in your field and share what you’re learning.</p></div>
        <button className="button primary" onClick={() => show('create')}><Plus size={18} /> Create a group</button></div>
      <div className="group-tools">
        <FilterTabs values={directoryTabs} current={directory} change={setDirectory} />
        <label className="group-search"><Search size={18} /><span className="sr-only">Search groups</span><input
          placeholder="Search name or industry" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      {listed?.length ? <div className="group-grid">{listed.map((item) => <GroupCard group={item} open={open} key={item.id} />)}</div> :
        <Empty title={lookup ? 'No matching groups' : directory === 'Invitations' ? 'No group invitations' :
          directory === 'My groups' ? 'You haven’t joined any groups' : 'No groups yet'}>
          {lookup ? 'Try searching for another industry or group name.' : directory === 'My groups' ? 'Find a group in Discover to get started.' : undefined}
        </Empty>}
    </>;
  }

  return <>{content}{dialog && <Dialog title={dialog === 'create' ? 'Create a group' : 'Start a discussion'} close={() => show(null)} error={dialogError}>
    <form className="field-form" onSubmit={save}>
      {dialog === 'create' ? <>
        <label>Group name<input autoFocus name="name" required maxLength={80} /></label>
        <label>Industry<input name="industry" placeholder="e.g. Design" required maxLength={60} /></label>
        <label>Description<textarea name="description" rows={3} required maxLength={700} /></label>
        <label>Visibility<select name="visibility" aria-describedby="group-privacy">
          <option value="public">Public</option><option value="private">Private</option></select></label>
        <p className="field-hint" id="group-privacy">Members can discover both types. Private discussions and member directories are available only after joining.</p>
      </> : <>
        <label>Topic<input autoFocus name="topic" required maxLength={140} /></label>
        <label>Post<textarea name="body" rows={5} required maxLength={3000} /></label>
      </>}
      <div className="dialog-footer"><button className="button secondary" type="button" onClick={() => show(null)}>Cancel</button>
        <button className="button primary" disabled={busy}>{dialog === 'create' ? 'Create group' : 'Publish discussion'}</button></div>
    </form>
  </Dialog>}</>;
}

function MemberSummary({ person, note }: { person: Member; note?: string }) {
  return <div className="group-person-summary"><Avatar person={person} size={38} />
    <div><strong>{person.name}</strong>{(note || person.headline) && <small>{note || person.headline}</small>}</div>
  </div>;
}
