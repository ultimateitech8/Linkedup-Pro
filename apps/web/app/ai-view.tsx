'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { BriefcaseBusiness, Search, Sparkles } from 'lucide-react';
import { Empty, JobListItem } from './components';
import { useApiMutation, useApiResource } from './api-resource';
import { AiDraftResult, DraftEditor } from './ai-draft';
import { fitHref, writingTasks, type AiDraft, type AiJobResults, type AiStatus, type JobSkillReport, type WritingTask } from './ai-data';
import { type Action, type Dashboard } from './data';
import { FilterTabs } from './views';

const tools = { writing: 'Writing', search: 'Job search', fit: 'Job fit', career: 'Career coaching' } as const;
type Tool = keyof typeof tools;

function Writing({ enabled, refresh }: { enabled: boolean; refresh: () => void }) {
  const [task, setTask] = useState<WritingTask>('post');
  return <section className="card content-card ai-work-card">
    <h2>Writing assistant</h2>
    <label>Writing task<select value={task} onChange={(event) => setTask(event.target.value as WritingTask)}>
      {Object.entries(writingTasks).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}
    </select></label>
    <DraftEditor key={task} task={task} enabled={enabled} onDone={refresh} />
  </section>;
}

function NaturalJobSearch({ enabled, openJob, action, refresh }: {
  enabled: boolean; openJob: (id: number) => void; action: Action; refresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AiJobResults>();
  const { save, busy, error } = useApiMutation();

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || busy) return;
    setResult(undefined);
    const matches = await save<AiJobResults>('ai/generate', { task: 'job-search', input: query });
    if (matches) setResult(matches);
    refresh();
  }

  const filters = result ? [...result.filters.keywords, result.filters.location, result.filters.workMode, result.filters.employmentType].filter(Boolean) : [];
  return <>
    <section className="card content-card ai-work-card">
      <h2>Describe the job you want</h2>
      <form className="field-form" onSubmit={search}>
        <label>Job search request<textarea rows={3} value={query} maxLength={500} placeholder="Find remote, full-time product design roles."
          disabled={!enabled || busy} onChange={(event) => { setQuery(event.target.value); setResult(undefined); }} /></label>
        <p className="ai-note">OpenAI interprets your request. Results come from open listings on Linkedup Pro.</p>
        <div className="ai-action-row"><button className="button primary" disabled={!enabled || busy || query.trim().length < 2}>
          <Search size={17} /> {busy ? 'Finding jobs…' : 'Find jobs'}</button></div>
        {error && <p className="dialog-error" role="alert">{error}</p>}
      </form>
    </section>
    {result && <>
      <div className="ai-search-summary"><h2>Matched listings</h2><div className="skill-list">
        {(filters.length ? filters : ['Any open role']).map((filter, index) => <span className="status violet" key={`${filter}:${index}`}>{filter}</span>)}
      </div></div>
      {result.jobs.length ? <div className="jobs-grid">{result.jobs.map((job) =>
        <JobListItem key={job.id} job={job} showJob={() => openJob(job.id)} save={async () => {
          const next = !job.saved;
          if (await action(`jobs/${job.id}/save`, { active: next }, next ? 'Job saved' : 'Job removed from saved')) {
            setResult((previous) => previous && { ...previous, jobs: previous.jobs.map((item) => item.id === job.id ? { ...item, saved: next } : item) });
          }
        }} />)}</div> : <Empty title="No open jobs matched">Try a wider location or a different role.</Empty>}
    </>}
  </>;
}

function SkillList({ label, skills }: { label: string; skills: string[] }) {
  return <section className="ai-skill-group"><h3>{label}</h3>
    {skills.length ? <div className="skill-list">{skills.map((skill) => <span className="status violet" key={skill}>{skill}</span>)}</div> :
      <p className="muted">None listed</p>}
  </section>;
}

function JobFit({ jobs, selected, select, enabled, openJob, refresh }: {
  jobs: Dashboard['jobs']; selected?: number; select: (id?: number) => void; enabled: boolean; openJob: (id: number) => void; refresh: () => void;
}) {
  const { snapshot, refresh: retry } = useApiResource<JobSkillReport>(selected ? `ai/jobs/${selected}/fit` : null);
  const { save, busy, error } = useApiMutation();
  const [guidance, setGuidance] = useState('');
  const comparison = snapshot && 'data' in snapshot ? snapshot.data : null;
  const choices = jobs.filter((job) => !job.closed);
  return <section className="card content-card ai-work-card">
    <h2>Compare your skills with a job</h2>
    <label>Job to compare<select value={selected ?? ''} onChange={(event) => select(Number(event.target.value) || undefined)}>
      <option value="">Choose an open job</option>
      {selected && !choices.some((job) => job.id === selected) && <option value={selected}>{comparison?.title ?? 'Selected job'}</option>}
      {choices.map((job) => <option value={job.id} key={job.id}>{job.title} · {job.company}</option>)}
    </select></label>
    {selected && !snapshot && <p role="status" className="muted">Loading this job’s skills…</p>}
    {snapshot && 'error' in snapshot && <div><p role="alert" className="dialog-error">{snapshot.error}</p>
      <button className="button secondary" onClick={retry}>Try again</button></div>}
    {comparison && <>
      <div className="section-heading ai-job-heading">
        <div><h3>{comparison.title}</h3><p className="muted">{comparison.company}</p></div>
        <button className="text-link" onClick={() => openJob(comparison.id)}><BriefcaseBusiness size={17} /> View job</button>
      </div>
      {!comparison.requiredSkills.length ? <p className="muted">This listing has no required skills to compare.</p> : <>
        <p className="ai-match-count">{comparison.matched.length} of {comparison.requiredSkills.length} listed skills on your profile</p>
        <div className="ai-skill-grid">
          <SkillList label="Matches" skills={comparison.matched} />
          <SkillList label="Skills to check" skills={comparison.missingFromProfile} />
        </div>
      </>}
      {comparison.profileSkills.length === 0 && <p className="muted"><a className="text-link" href="#profile">Add skills to your profile</a> to improve this comparison.</p>}
      {enabled && <>
        <p className="ai-note">Generating preparation advice sends the listing and your profile skills to OpenAI.</p>
        <div className="ai-action-row"><button className="button primary" disabled={busy}
          onClick={async () => {
            setGuidance('');
            const result = await save<AiDraft>('ai/generate', { task: 'job-fit', jobId: comparison.id });
            if (result) setGuidance(result.text);
            refresh();
          }}><Sparkles size={17} /> {busy ? 'Generating…' : 'Get preparation advice'}</button></div>
      </>}
      {error && <p role="alert" className="dialog-error">{error}</p>}
      {guidance && <AiDraftResult text={guidance} title="Preparation advice" />}
    </>}
  </section>;
}

export function AiView({ dashboard, openJob, action }: { dashboard: Dashboard; openJob: (id: number) => void; action: Action }) {
  const [tab, setTab] = useState<Tool>('writing');
  const [selected, setSelected] = useState<number>();
  const { snapshot, refresh } = useApiResource<AiStatus>('ai/status');
  const status = snapshot && 'data' in snapshot ? snapshot.data : null;
  const configured = status?.available ?? dashboard.me.aiAvailable;
  const enabled = configured && (status?.remaining ?? 1) > 0;

  useEffect(() => {
    const update = () => {
      if (window.location.hash.split('?')[0] !== '#ai') return;
      const params = new URLSearchParams(window.location.hash.split('?')[1]);
      const next = (Object.keys(tools) as Tool[]).find((tool) => tool === params.get('tab')) ?? 'writing';
      setTab(next);
      const id = Number(params.get('job'));
      setSelected(Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : undefined);
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  return <div className="ai-workspace">
    <header className="ai-banner"><div><h1>AI Assistant</h1><p>Draft professional content, explore jobs, and plan your next career step.</p></div>
      <Sparkles size={79} strokeWidth={1.15} aria-hidden="true" /></header>
    <div className="ai-tool-row">
      <FilterTabs values={Object.values(tools)} current={tools[tab]} change={(label) => {
        const next = (Object.keys(tools) as Tool[]).find((tool) => tools[tool] === label) ?? 'writing';
        window.location.hash = next === 'writing' ? 'ai' : `ai?tab=${next}`;
      }} />
      {status?.available && <p className="ai-note" role="status">{status.remaining} of {status.dailyLimit} requests left today</p>}
    </div>
    {!configured && <p className="card ai-availability">AI generation becomes available after OpenAI is configured. <a className="text-link" href="#ai?tab=fit">Compare job skills</a></p>}
    {snapshot && 'error' in snapshot && <div className="card ai-availability"><p role="alert">{snapshot.error}</p>
      <button className="text-link" onClick={refresh}>Check availability again</button></div>}
    {tab === 'writing' && <Writing enabled={enabled} refresh={refresh} />}
    {tab === 'search' && <NaturalJobSearch enabled={enabled} openJob={openJob} action={action} refresh={refresh} />}
    {tab === 'fit' && <JobFit key={selected ?? 'none'} jobs={dashboard.jobs} selected={selected} select={(id) => {
      window.location.hash = id ? fitHref(id) : 'ai?tab=fit';
    }}
      enabled={enabled} openJob={openJob} refresh={refresh} />}
    {tab === 'career' && <section className="card content-card ai-work-card"><h2>Career coaching</h2>
      <DraftEditor task="career" enabled={enabled} onDone={refresh} /></section>}
  </div>;
}
