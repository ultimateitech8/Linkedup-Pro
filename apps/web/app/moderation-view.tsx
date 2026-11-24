'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Empty } from './components';
import { api, day, type Action } from './data';
import { FilterTabs } from './views';

type Report = {
  id: number; author: string; body: string; image?: string; groupName?: string; eventTitle?: string; companyName?: string;
  reportCount: number; reasons: string[]; reportedAt: string;
};
type Review = {
  id: number; postId: number | null; author: string | null; action: 'dismiss' | 'hide' | 'restore';
  moderator: string; reportCount: number; createdAt: string; canRestore: boolean; body?: string;
};
type Moderation = { queue: Report[]; history: Review[] };
const labels = { dismiss: 'Dismissed', hide: 'Hidden', restore: 'Restored' };
const messages = { dismiss: 'Reports dismissed', hide: 'Post hidden', restore: 'Post restored' };
const reportCount = (number: number) => `${number} ${number === 1 ? 'report' : 'reports'}`;

export function ModerationView({ action }: { action: Action }) {
  const [data, setData] = useState<Moderation | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Open reports');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setData(await api<Moderation>('moderation', { signal }));
      setError('');
    } catch (failure) {
      if (!signal?.aborted) setError((failure as Error).message);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function review(id: number, decision: Review['action']) {
    setBusy(true);
    try {
      if (await action(`moderation/posts/${id}`, { action: decision }, messages[decision])) await load();
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="page-intro"><div><h1>Moderation</h1><p>Review reported posts and manage their visibility.</p></div></div>
    {error ? <div className="card content-card"><p className="form-error" role="alert">{error}</p>
      <div className="button-row"><button className="button secondary" onClick={() => void load()}>Try again</button></div>
    </div> : !data ? <p className="muted" role="status">Loading reports…</p> : <>
      <FilterTabs values={['Open reports', 'Review history']} current={tab} change={setTab} />
      {tab === 'Open reports' ? data.queue.length ? <div className="column-stack">{data.queue.map((report) =>
        <article className="card content-card moderation-card" key={report.id}>
          <div className="section-heading"><div><h2>Post by {report.author}</h2><p className="muted">Reported {day(report.reportedAt)}
            {(report.groupName || report.eventTitle || report.companyName) && ` · ${report.groupName || report.eventTitle || report.companyName}`}</p></div>
            <span className="status violet">{reportCount(report.reportCount)}</span></div>
          <p className="moderation-excerpt">{report.body}</p>
          {report.image && <img className="post-image" src={report.image} alt="Attachment on the reported post" />}
          <div className="project-tags">{report.reasons.map((reason) => <span className="status" key={reason}>{reason}</span>)}</div>
          <div className="button-row"><button className="button secondary" disabled={busy} onClick={() => void review(report.id, 'dismiss')}>Dismiss reports</button>
            <button className="button primary" disabled={busy} onClick={() => void review(report.id, 'hide')}><EyeOff size={17} /> Hide post</button></div>
        </article>)}</div> : <Empty title="No open reports">New reports will appear here.</Empty> :
        data.history.length ? <div className="column-stack">{data.history.map((entry) => <article className="card content-card moderation-history" key={entry.id}>
          <div className="tile-icon"><ShieldCheck size={20} /></div><div><h3>{labels[entry.action]} · {entry.author ? `Post by ${entry.author}` : 'Deleted post'}</h3>
            <p className="muted">{entry.moderator} · {day(entry.createdAt)}{entry.reportCount ? ` · ${reportCount(entry.reportCount)}` : ''}</p>
            {entry.body && <p className="review-excerpt">{entry.body}</p>}</div>
          {entry.canRestore && entry.postId !== null && <button className="button secondary" disabled={busy}
            onClick={() => void review(entry.postId!, 'restore')}><Eye size={17} /> Restore post</button>}
        </article>)}</div> : <Empty title="No reviews yet" />}
    </>}
  </>;
}
