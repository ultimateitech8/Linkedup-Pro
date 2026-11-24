'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bookmark, CalendarDays, MapPin, MessageCircle } from 'lucide-react';
import { Avatar, Company, Dialog, PersonAction, ProjectItem } from './components';
import { useApiResource } from './api-resource';
import { sendAnalyticsEvent } from './analytics-events';
import { fitHref, splitSkills } from './ai-data';
import { InlineAiDraft } from './ai-draft';
import { api, day, type Action, type Dashboard, type Job, type Person, type Project } from './data';
import { ProfileCertificates } from './learning-view';
import { ProfileService } from './services-view';
import type { Modal } from './views';

const titles = { create: 'Create a post', profile: 'Edit profile', project: 'Add a project', newJob: 'Post a job',
  job: 'Job details', apply: 'Apply for this job', report: 'Report post', person: 'Member profile', demo: 'Switch demo account' };
const forms = {
  create: { path: 'posts', method: 'POST', done: 'Post published', submit: 'Publish post' },
  profile: { path: 'profile', method: 'PATCH', done: 'Profile updated', submit: 'Save profile' },
  project: { path: 'projects', method: 'POST', done: 'Project added', submit: 'Add project' },
  newJob: { path: 'jobs', method: 'POST', done: 'Job published', submit: 'Publish job' }
} as const;

export function WorkDialog({ modal, dashboard, action, close, show, switchDemo, goMessages, applications, error }: {
  modal: Modal; dashboard: Dashboard; action: Action; close: () => void; show: (next: Modal) => void;
  switchDemo: (value: string) => Promise<void>; goMessages: (id: string) => void; applications: () => void; error?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectError, setProjectError] = useState(false);
  const [fileError, setFileError] = useState('');
  const [resumeSource, setResumeSource] = useState<'file' | 'link'>('file');
  const [loadedJob, setLoadedJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState('');
  const [skillsEditing, setSkillsEditing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const me = dashboard.me;
  const jobId = modal.kind === 'job' || modal.kind === 'apply' ? modal.id : null;
  const dashboardJob = dashboard.jobs.find((item) => item.id === jobId);
  const job = dashboardJob ?? (loadedJob?.id === jobId ? loadedJob : null);
  const dashboardPerson = modal.kind === 'person' ? dashboard.people.find((item) => item.id === modal.id) : undefined;
  const { snapshot: member, refresh: refreshMember } = useApiResource<Person>(modal.kind === 'person' && !dashboardPerson ? `profiles/${encodeURIComponent(modal.id)}` : null, dashboard.notifications[0]?.id);
  const person = dashboardPerson ?? (member && 'data' in member ? member.data : undefined);

  function draftContext(fields: [name: string, label?: string][]) {
    if (!formRef.current) return '';
    const data = new FormData(formRef.current);
    return fields.flatMap(([name, label]) => {
      const value = String(data.get(name) ?? '').trim();
      return value ? [label ? `${label}: ${value}` : value] : [];
    }).join('\n');
  }

  function applyDraft(name: string, value: string) {
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
      field.value = value;
      field.focus();
    }
  }

  useEffect(() => {
    if (!jobId || dashboardJob) return;
    const controller = new AbortController();
    void api<Job>(`jobs/${jobId}`, { signal: controller.signal }).then(setLoadedJob).catch((failure) => {
      if (!controller.signal.aborted) setJobError((failure as Error).message);
    });
    return () => controller.abort();
  }, [jobId, dashboardJob]);

  useEffect(() => {
    if (!person?.id) return;
    sendAnalyticsEvent('profile', { id: person.id });
    let active = true;
    api<Project[]>(`profiles/${person.id}/projects`).then((result) => { if (active) setProjects(result); })
      .catch(() => { if (active) setProjectError(true); });
    return () => { active = false; };
  }, [person?.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || fileError) return;
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const fields: Record<string, unknown> = Object.fromEntries(form);
    if (modal.kind === 'profile') fields.skills = splitSkills(form.get('skills'));
    if (modal.kind === 'project') fields.isPublic = fields.visibility === 'public';
    if (modal.kind === 'newJob') {
      fields.requiredSkills = splitSkills(form.get('requiredSkills'));
      if (modal.company) fields.companyId = modal.company.id;
    }
    if (modal.kind === 'apply' && job) {
      const resume = form.get('resume');
      if (resume instanceof File && !resume.name) form.delete('resume');
      if (await action(`jobs/${job.id}/apply`, form, 'Application submitted')) { close(); applications(); }
    }
    if (modal.kind === 'report' && await action(`posts/${modal.id}/report`, fields, 'Report submitted')) close();
    if (modal.kind in forms) {
      const entry = forms[modal.kind as keyof typeof forms];
      if (await action(entry.path, fields, entry.done, entry.method)) close();
    }
    setBusy(false);
  }

  if (modal.kind === 'demo') return <Dialog title={titles.demo} close={close} error={error}>
    <div className="demo-options">{[
      { id: 'alex', name: 'Alex Morgan', headline: 'Candidate and product designer' },
      { id: 'maya', name: 'Maya Chen', headline: 'Project reviewer and moderator' },
      { id: 'jordan', name: 'Jordan Lee', headline: 'Hiring manager at Forma' }
    ].map((item) => <button className="demo-option" key={item.id} disabled={busy} onClick={async () => {
      setBusy(true); await switchDemo(item.id); setBusy(false);
    }}><Avatar person={{ ...item, image: `/images/${item.id}.jpg` }} size={41} /><span><strong>{item.name}</strong><small>{item.headline}</small></span></button>)}</div>
  </Dialog>;
  if (modal.kind === 'person' && !person) return <Dialog title={titles.person} close={close} error={member && 'error' in member ? member.error : error}>
    {!member && <p className="muted" role="status">Loading member profile…</p>}
  </Dialog>;
  if (modal.kind === 'person' && person) return <Dialog title={titles.person} close={close} error={error}>
    <div className="member-summary"><Avatar person={person} size={65} /><div><h3>{person.name}</h3><p>{person.headline}</p>
      {person.location && <small><MapPin size={15} /> {person.location}</small>}</div></div>
    {person.about && <p className="body-copy">{person.about}</p>}
    {person.skills?.length > 0 && <div className="skill-list">{person.skills.map((skill) => <span className="status violet" key={skill}>{skill}</span>)}</div>}
    <div className="button-row"><PersonAction person={person} action={async (...args) => {
      const ok = await action(...args);
      if (ok && !dashboardPerson) refreshMember();
      return ok;
    }} />
      {person.connection === 'connected' && <button className="button primary" onClick={() => goMessages(person.id)}><MessageCircle size={17} /> Message</button>}</div>
    {projectError && <p className="muted">Projects couldn’t be loaded.</p>}
    {projects.length > 0 && <div className="member-projects"><h3>Projects</h3>{projects.map((project) => <ProjectItem key={project.id} project={project} />)}</div>}
    <ProfileCertificates profileId={person.id} close={close} />
    <ProfileService memberId={person.id} close={close} />
  </Dialog>;
  if (jobId && !job) return <Dialog title={titles[modal.kind]} close={close} error={jobError || error}>
    {!jobError && <p className="muted" role="status">Loading job…</p>}
  </Dialog>;
  if (modal.kind === 'job' && job) {
    const applied = dashboard.applications.some((item) => item.jobId === job.id);
    return <Dialog title={titles.job} close={close} error={error}>
      <JobSummary job={job} close={close} />
      <p className="body-copy">{job.description}</p>
      <section className="job-skills-section">
        <div className="section-heading"><h3>Required skills</h3>{job.canManage && !skillsEditing &&
          <button className="text-link" onClick={() => setSkillsEditing(true)}>Edit listed skills</button>}</div>
        {skillsEditing ? <form className="field-form job-skills-form" onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const requiredSkills = splitSkills(new FormData(event.currentTarget).get('skills'));
          setBusy(true);
          if (await action(`jobs/${job.id}/skills`, { requiredSkills }, 'Required skills saved', 'PATCH')) {
            if (!dashboardJob) setLoadedJob(await api<Job>(`jobs/${job.id}`).catch(() => ({ ...job, requiredSkills })));
            setSkillsEditing(false);
          }
          setBusy(false);
        }}>
          <label>Skills list <small>Up to 16, comma separated</small><input name="skills" defaultValue={job.requiredSkills.join(', ')} maxLength={830} /></label>
          <div className="ai-action-row"><button className="button secondary compact" type="button" onClick={() => setSkillsEditing(false)}>Cancel</button>
            <button className="button primary compact" disabled={busy}>Save listed skills</button></div>
        </form> : job.requiredSkills.length ? <div className="skill-list">{job.requiredSkills.map((skill) => <span className="status violet" key={skill}>{skill}</span>)}</div> :
          <p className="muted">No required skills listed.</p>}
        {!job.canManage && <a className="text-link" href={fitHref(job.id)} onClick={close}>Compare with your skills</a>}
      </section>
      {job.responseDate && <div className="detail-callout"><CalendarDays size={20} /><div><strong>Expected response by {day(job.responseDate)}</strong>
        <small>Updates from the hiring team will appear in your application timeline.</small></div></div>}
      <div className="dialog-footer">
        <button className="button secondary" onClick={async () => {
          const next = !job.saved;
          if (await action(`jobs/${job.id}/save`, { active: next }, next ? 'Job saved' : 'Job removed from saved') && !dashboardJob) {
            setLoadedJob({ ...job, saved: next });
          }
        }}
          disabled={job.closed && !job.saved}><Bookmark size={17} fill={job.saved ? 'currentColor' : 'none'} /> {job.saved ? 'Saved' : 'Save job'}</button>
        {applied ? <button className="button primary" onClick={() => { close(); applications(); }}>View application</button> :
          !job.closed && !job.canManage && <button className="button primary" onClick={() => show({ kind: 'apply', id: job.id })}>Apply now</button>}
      </div>
    </Dialog>;
  }
  const label = modal.kind === 'apply' ? 'Submit application' : modal.kind === 'report' ? 'Submit report' :
    modal.kind in forms ? forms[modal.kind as keyof typeof forms].submit : '';
  return <Dialog title={titles[modal.kind]} close={close} error={error}>
    <form className="field-form" ref={formRef} onSubmit={submit}>
      {modal.kind === 'create' && <>
        <div className="compose-person"><Avatar person={me} size={43} /><strong>{me.name}</strong></div>
        <label><span className="sr-only">Post</span><textarea autoFocus name="body" placeholder="What would you like to share?" rows={6} required maxLength={3000} /></label>
        {me.aiAvailable && <InlineAiDraft task="post" label="Draft post with AI" context={() => draftContext([['body']])}
          apply={(value) => applyDraft('body', value)} />}
      </>}
      {modal.kind === 'profile' && <>
        <label>Full name<input autoFocus name="name" defaultValue={me.name} required maxLength={100} /></label>
        <label>Headline<input name="headline" defaultValue={me.headline} placeholder="Your role or area of expertise" maxLength={140} /></label>
        {me.aiAvailable && <InlineAiDraft task="headline" label="Suggest a headline" context={() => draftContext([['headline','Current headline'],['skills','Skills'],['about','About']])}
          apply={(value) => applyDraft('headline', value)} />}
        <label>Location<input name="location" defaultValue={me.location} maxLength={100} /></label>
        <label>About<textarea name="about" defaultValue={me.about} rows={3} maxLength={2000} /></label>
        {me.aiAvailable && <InlineAiDraft task="profile" label="Draft profile summary" context={() => draftContext([['headline','Headline'],['skills','Skills'],['about','Current summary']])}
          apply={(value) => applyDraft('about', value)} />}
        <label>Skills<input name="skills" defaultValue={me.skills.join(', ')} placeholder="Separate skills with commas" /></label>
      </>}
      {modal.kind === 'project' && <>
        <label>Project title<input autoFocus name="title" placeholder="e.g. Field Notes research library" required maxLength={100} /></label>
        <label>Your contribution<textarea name="contribution" placeholder="What did you do, and what was the outcome?" required rows={3} maxLength={2000} /></label>
        <label>Link to your work <small>Optional</small><input type="url" name="url" placeholder="https://…" maxLength={2048} /></label>
        <label>Who can confirm your contribution? <small>Optional</small><select name="verifierId">
          <option value="">Choose a connection</option>{dashboard.people.filter((item) => item.connection === 'connected').map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        <label>Visibility<select name="visibility"><option value="public">Show on my profile</option><option value="private">Private unless I share it with an employer</option></select></label>
      </>}
      {modal.kind === 'newJob' && <>
        <label>Job title<input name="title" autoFocus required maxLength={120} /></label>
        <div className="field-grid"><label>Company<input name="company" required maxLength={100}
          defaultValue={modal.company?.name} readOnly={Boolean(modal.company)} /></label><label>Location<input name="location" required maxLength={120} /></label></div>
        <div className="field-grid">
          <label>Location type<select name="workMode"><option>Remote</option><option>Hybrid</option><option>On-site</option></select></label>
          <label>Employment type<select name="employmentType"><option>Full-time</option><option>Part-time</option><option>Internship</option><option>Contract</option></select></label>
        </div>
        <div className="field-grid"><label>Pay range<input name="salary" placeholder="e.g. $95k–$120k" required maxLength={80} /></label>
          <label>Expected response date<input type="date" name="responseDate" required /></label></div>
        <label>Required skills <small>Optional · up to 16, comma separated</small><input name="requiredSkills" maxLength={830} placeholder="e.g. User research, Design systems" /></label>
        <label>Job description<textarea name="description" rows={4} required maxLength={4000} /></label>
        {me.aiAvailable && <InlineAiDraft task="job-description" label="Draft job description with AI" context={() => draftContext([
          ['title','Role'],['workMode','Work arrangement'],['employmentType','Type'],['requiredSkills','Skills'],['description','Responsibilities and notes']
        ])} apply={(value) => applyDraft('description', value)} />}
      </>}
      {modal.kind === 'apply' && job && <>
        <JobSummary job={job} />
        <label>Note to the hiring team <small>Optional</small><textarea name="note" rows={3} maxLength={2000} /></label>
        <fieldset className="resume-field">
          <legend>Résumé <small>Optional</small></legend>
          <div className="filter-tabs resume-switch">
            <button type="button" aria-pressed={resumeSource === 'file'} onClick={() => setResumeSource('file')}>Upload PDF</button>
            <button type="button" aria-pressed={resumeSource === 'link'} onClick={() => { setResumeSource('link'); setFileError(''); }}>Use a link</button>
          </div>
          {resumeSource === 'file' ? <>
            <input className="resume-input" aria-label="Résumé PDF" type="file" name="resume" accept=".pdf,application/pdf" aria-describedby="resume-hint"
              onChange={(event) => {
                const file = event.target.files?.[0];
                setFileError(file && (!file.name.toLowerCase().endsWith('.pdf') || file.size > 5 * 1024 * 1024)
                  ? 'Choose a PDF that is 5 MB or smaller.' : '');
              }} />
            <p id="resume-hint" className={fileError ? 'form-error' : 'field-hint'} role={fileError ? 'alert' : undefined}>
              {fileError || 'Up to 5 MB. Only you and the employer can download the file.'}</p>
          </> : <input type="url" aria-label="Résumé link" name="resumeUrl" placeholder="https://…" maxLength={2048} />}
        </fieldset>
        <label>Share a project <small>Optional</small><select name="projectId"><option value="">Select a project</option>
          {dashboard.projects.map((item) => <option key={item.id} value={item.id}>{item.title}{item.verifiedAt ? ' · Confirmed' : ''}</option>)}
        </select></label>
      </>}
      {modal.kind === 'report' && <label>Reason<select autoFocus name="reason" defaultValue="" required>
        <option value="" disabled>Select a reason</option>
        {['Spam', 'Harassment', 'Fraud or impersonation', 'Inappropriate content', 'Other'].map((reason) => <option key={reason}>{reason}</option>)}
      </select></label>}
      {label && <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy || Boolean(fileError)}>{busy ? 'Saving…' : label}</button></div>}
    </form>
  </Dialog>;
}

function JobSummary({ job, close }: { job: Job; close?: () => void }) {
  return <><div className="job-title job-summary"><Company job={job} size="large" /><div><h3>{job.title}</h3>
    {job.companyId && close ? <a className="text-link" href={`#companies?company=${job.companyId}`} onClick={close}>{job.company}</a> : <p>{job.company}</p>}</div></div>
    <div className="job-tags"><span><MapPin size={15} /> {job.location}</span><span>{job.workMode}</span><span>{job.employmentType}</span></div>
    <div className="detail-pay">{job.salary}</div></>;
}
