'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Award, Bookmark, BookOpen, BriefcaseBusiness, Check, CirclePlay, Clock3, Code2, GraduationCap, ListChecks, MessageCircle, Pencil, Plus, Printer, Route } from 'lucide-react';
import { Empty } from './components';
import { api, type Me } from './data';
import { categories, certificateHref, courseHref, issueDate, type Catalog, type Certificate, type CertificateDetail, type Course, type CourseDetail, type CourseLesson, type LearningPath } from './learning-data';
import { CourseForm, PathForm } from './learning-forms';
import { FilterTabs } from './views';
import { YouTubeVideo } from './youtube-video';

type LearningRoute = { type: 'course'; id: number } | { type: 'certificate'; id: string } | null;
type CatalogPanel = 'course' | 'path' | null;
const categoryIcons = { Technical: Code2, Business: BriefcaseBusiness, 'Soft skills': MessageCircle, 'Certification prep': Award };

function readRoute(): LearningRoute {
  const [section, query] = window.location.hash.split('?');
  if (section !== '#learning') return null;
  const fields = new URLSearchParams(query);
  const certificate = fields.get('certificate');
  if (certificate) return { type: 'certificate', id: certificate };
  const course = Number(fields.get('course'));
  return Number.isInteger(course) && course > 0 ? { type: 'course', id: course } : null;
}

function useResource<T>(path: string, revision: number) {
  const [snapshot, setSnapshot] = useState<{ path: string; data?: T; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setSnapshot({ path, data });
    }).catch((failure) => {
      if (!controller.signal.aborted) setSnapshot({ path, error: (failure as Error).message });
    });
    return () => controller.abort();
  }, [path, revision]);
  return snapshot?.path === path ? snapshot : undefined;
}

function Progress({ total, completed, label = 'Course progress' }: { total: number; completed: number; label?: string }) {
  return <div className="learning-progress">
    <progress max={total} value={completed} aria-label={label} />
    <span>{completed} of {total} complete</span>
  </div>;
}

function CategoryMark({ category }: { category: Course['category'] }) {
  const Icon = categoryIcons[category];
  return <span className="learning-category-icon" data-category={category}><Icon size={23} strokeWidth={1.75} aria-hidden="true" /></span>;
}

function CourseCard({ course, recommended }: { course: Course; recommended?: boolean }) {
  return <article className="card learning-course-card">
    <div className="learning-card-heading"><CategoryMark category={course.category} /><span>{course.category}</span>
      {course.saved && <Bookmark size={17} className="learning-saved-mark" fill="currentColor" aria-label="Saved course" />}</div>
    <h3><a href={courseHref(course.id)}>{course.title}</a></h3>
    <p className="muted">{course.description}</p>
    <p className="learning-card-meta"><span>{course.level}</span><span><Clock3 size={15} /> {course.minutes} min</span></p>
    {recommended && <span className="status violet">Matches your profile skills</span>}
    {course.enrolled && <Progress total={course.lessonCount} completed={course.completedLessons?.length ?? 0} />}
    {!course.publishedAt && <span className="status violet">Draft</span>}
    {course.certificateId && <a className="text-link" href={certificateHref(course.certificateId)}>View certificate</a>}
  </article>;
}

function PathCard({ path }: { path: LearningPath }) {
  return <article className="card content-card learning-path">
    <div className="learning-card-heading"><span className="learning-category-icon"><Route size={22} aria-hidden="true" /></span>
      <h2>{path.title}</h2></div>
    <p className="muted">{path.description}</p>
    <Progress label="Learning path progress" total={path.courses.length} completed={path.courses.filter((course) => course.completed).length} />
    <ol className="learning-path-list">
      {path.courses.map((course) => <li key={course.id}><a href={courseHref(course.id)}>{course.title}</a>
        {course.completed && <span className="status green"><Check size={14} /> Completed</span>}</li>)}
    </ol>
  </article>;
}

function LearningCatalog({ member, tab, setTab }: { member: Me; tab: string; setTab: (tab: string) => void }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [panel, setPanel] = useState<CatalogPanel>(null);
  const [revision, setRevision] = useState(0);
  const snapshot = useResource<Catalog>('learning/catalog', revision);
  const tabs = ['Explore', 'My learning', 'Saved courses', 'Learning paths', ...(member.isLearningInstructor ? ['Instructor studio'] : [])];
  const publishedCourses = snapshot?.data?.courses.filter((course) => course.publishedAt) ?? [];
  const query = search.trim().toLowerCase();
  const matches = publishedCourses.filter((course) => (!category || course.category === category) &&
    `${course.title} ${course.description} ${course.instructor} ${course.category} ${course.skills.join(' ')}`.toLowerCase().includes(query));
  const skills = new Set(member.skills.map((skill) => skill.trim().toLowerCase()));
  const suggested = !query && !category ? matches.filter((course) =>
    !course.enrolled && course.skills.some((skill) => skills.has(skill.toLowerCase()))).slice(0, 3) : [];
  const courseList = tab === 'Explore' ? [...suggested, ...matches.filter((course) => !suggested.includes(course))] :
    tab === 'My learning' ? publishedCourses.filter((course) => course.enrolled) :
    tab === 'Saved courses' ? publishedCourses.filter((course) => course.saved) :
    snapshot?.data?.courses.filter((course) => !course.publishedAt) ?? [];
  const refresh = () => setRevision((value) => value + 1);

  return <div className="learning">
    <div className="learning-banner">
      <div><h1>Learning</h1><p>Build professional skills one lesson at a time.</p></div>
      <GraduationCap size={93} strokeWidth={1.15} className="learning-banner-icon" aria-hidden="true" />
    </div>
    <FilterTabs values={tabs} current={tab} change={(next) => { setTab(next); setPanel(null); }} />
    {!snapshot && <p className="muted" role="status">Loading courses…</p>}
    {snapshot?.error && <div className="card content-card learning-state"><p role="alert">{snapshot.error}</p><button className="button secondary" onClick={refresh}>Try again</button></div>}
    {snapshot?.data && <>
      {tab === 'Explore' && <div className="learning-filters">
        <input type="search" aria-label="Search courses" placeholder="Search courses by title or skill" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Filter courses by category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>}
      {tab === 'Instructor studio' && <>
        <div className="section-heading learning-studio-heading"><h2>Course drafts</h2><div className="learning-actions">
          <button className="button secondary" disabled={publishedCourses.length < 2} onClick={() => setPanel('path')}>Create learning path</button>
          <button className="button primary" onClick={() => setPanel('course')}><Plus size={17} /> Create course</button>
        </div></div>
        {publishedCourses.length < 2 && <p className="muted">Learning paths require at least two published courses.</p>}
        {panel === 'course' && <CourseForm close={() => setPanel(null)} saved={() => { setPanel(null); refresh(); }} />}
        {panel === 'path' && <PathForm courses={publishedCourses} close={() => setPanel(null)} published={() => {
          setPanel(null); refresh(); setTab('Learning paths');
        }} />}
      </>}
      {tab === 'Learning paths'
        ? snapshot.data.paths.length ? <div className="learning-path-grid">{snapshot.data.paths.map((path) => <PathCard key={path.id} path={path} />)}</div>
          : <Empty title="No learning paths yet" />
        : <>
          {tab === 'Explore' && courseList.length > 0 && <h2>Courses</h2>}
          {courseList.length > 0 && <div className="learning-grid">{courseList.map((course) =>
            <CourseCard key={course.id} course={course} recommended={tab === 'Explore' && suggested.includes(course)} />)}</div>}
          {!courseList.length && !panel && <Empty title={
            tab === 'Explore' ? 'No courses found' : tab === 'My learning' ? 'No enrolled courses yet' :
              tab === 'Saved courses' ? 'No saved courses yet' : 'No course drafts yet'
          }>{tab === 'My learning' && 'Enroll in a course to track your progress here.'}</Empty>}
        </>}
    </>}
  </div>;
}

function LessonPlayer({ lesson, done, busy, complete, next }: {
  lesson: CourseLesson; done: boolean; busy: boolean; complete: (answer?: number) => Promise<boolean | undefined>; next?: () => void;
}) {
  const [answer, setAnswer] = useState<number | null>(null);
  const [incorrect, setIncorrect] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const passed = await complete(answer ?? undefined);
    setIncorrect(passed === false);
  }

  return <article className="card content-card learning-lesson">
    <p className="learning-meta">Lesson {lesson.number} · {lesson.minutes} min</p>
    <h2>{lesson.title}</h2>
    {lesson.video && <div className="learning-video"><YouTubeVideo url={lesson.video} title={lesson.title} />
      <a className="text-link" href={lesson.video} target="_blank" rel="noreferrer">Open video on YouTube</a></div>}
    {lesson.notes && <p className="learning-notes">{lesson.notes}</p>}
    {lesson.exercise && <div className="learning-exercise"><h3><ListChecks size={19} /> Practice exercise</h3><p>{lesson.exercise}</p></div>}
    {done ? <div className="learning-actions">
      <span className="status green" role="status"><Check size={16} /> Lesson complete</span>
      {next && <button className="button secondary" onClick={next}>Next lesson</button>}
    </div> : <form className="learning-quiz" onSubmit={submit}>
      {lesson.quiz && <>
        <h3>Quick quiz</h3>
        <fieldset><legend>{lesson.quiz.prompt}</legend>{lesson.quiz.choices.map((choice, index) =>
          <label key={choice} className="learning-check"><input type="radio" name="lesson-answer" value={index} checked={answer === index}
            onChange={() => { setAnswer(index); setIncorrect(false); }} required /> {choice}</label>)}
        </fieldset>
        {incorrect && <p className="dialog-error" role="alert">That answer is incorrect. Review the lesson and try again.</p>}
      </>}
      <button className="button primary" disabled={busy}>{lesson.quiz ? 'Check answer' : 'Mark complete'}</button>
    </form>}
  </article>;
}

function ViewCourse({ id }: { id: number }) {
  const [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const snapshot = useResource<CourseDetail>(`learning/courses/${id}`, revision);
  const refresh = () => setRevision((value) => value + 1);

  async function submit<T>(path: string, body = {}) {
    setError('');
    setBusy(true);
    try {
      const result = await api<T>(`learning/courses/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) });
      refresh();
      return result;
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const course = snapshot?.data;
  const completed = course?.completedLessons ?? [];
  const lesson = course?.lessons.find((item) => item.number === selected) ??
    course?.lessons.find((item) => !completed.includes(item.number)) ?? course?.lessons[0];
  const draft = course && !course.publishedAt;

  return <div className="learning">
    <a className="text-link learning-back" href="#learning">Back to Learning</a>
    {!snapshot && <p className="muted" role="status">Loading course…</p>}
    {snapshot?.error && <div className="card content-card learning-state"><p role="alert">{snapshot.error}</p><button className="button secondary" onClick={refresh}>Try again</button></div>}
    {course && <>
      <section className="card content-card learning-detail">
        <div className="learning-card-heading"><CategoryMark category={course.category} /><span>{course.category} · {course.level}</span>
          {draft && <span className="status violet">Draft</span>}</div>
        <h1>{course.title}</h1>
        <p className="learning-notes">{course.description}</p>
        <p className="learning-meta">With {course.instructor} · {course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'} · {course.minutes} min</p>
        {course.skills.length > 0 && <div className="skill-list">{course.skills.map((skill) => <span className="status violet" key={skill}>{skill}</span>)}</div>}
        {course.enrolled && <Progress total={course.lessonCount} completed={completed.length} />}
        <div className="learning-actions">
          {draft ? <>
            <button className="button secondary" disabled={busy || edit} onClick={() => { setEdit(true); setConfirmPublish(false); }}><Pencil size={16} /> Edit draft</button>
            <button className="button primary" disabled={busy || edit} onClick={() => setConfirmPublish(true)}>Publish course</button>
          </> : <>
            {!course.enrolled && <button className="button primary" disabled={busy} onClick={() => void submit('enroll')}>Enroll in course</button>}
            <button className="button secondary" disabled={busy} aria-pressed={course.saved}
              onClick={() => void submit('bookmark', { active: !course.saved })}>
              <Bookmark size={17} fill={course.saved ? 'currentColor' : 'none'} /> {course.saved ? 'Saved course' : 'Save course'}
            </button>
            {course.certificateId && <a className="button primary" href={certificateHref(course.certificateId)}><Award size={17} /> View certificate</a>}
          </>}
        </div>
        {confirmPublish && draft && <div className="learning-exercise">
          <p>Publishing locks the course so learners keep a stable lesson sequence and completion record.</p>
          <div className="learning-actions">
            <button className="button secondary" disabled={busy} onClick={() => setConfirmPublish(false)}>Cancel</button>
            <button className="button primary" disabled={busy} onClick={async () => { if (await submit('publish')) setConfirmPublish(false); }}>Confirm publication</button>
          </div>
        </div>}
        {error && <p className="dialog-error" role="alert">{error}</p>}
      </section>
      {edit && draft ? <CourseForm draft={course} close={() => setEdit(false)} saved={() => { setEdit(false); refresh(); }} /> :
        <div className={course.enrolled ? 'learning-classroom' : ''}>
          <section className="card content-card learning-outline">
            <h2>Course outline</h2>
            <ol>{course.lessons.map((item) => {
              const done = completed.includes(item.number);
              const Icon = done ? Check : item.video ? CirclePlay : BookOpen;
              const title = <><Icon size={18} /><span>{item.title}</span><small>{item.minutes} min</small></>;
              return <li key={item.number}>{course.enrolled
                ? <button aria-current={item.number === lesson?.number ? 'step' : undefined} onClick={() => setSelected(item.number)}>{title}</button>
                : <div>{title}</div>}</li>;
            })}</ol>
          </section>
          {course.enrolled && lesson && <LessonPlayer key={lesson.number} lesson={lesson} busy={busy} done={completed.includes(lesson.number)}
            complete={async (answer) => {
              setSelected(lesson.number);
              return (await submit<{ passed: boolean }>(`lessons/${lesson.number}/complete`, { answer }))?.passed;
            }} next={lesson.number < course.lessonCount ? () => setSelected(lesson.number + 1) : undefined} />}
        </div>}
    </>}
  </div>;
}

function ViewCertificate({ id }: { id: string }) {
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const snapshot = useResource<CertificateDetail>('learning/certificates/' + encodeURIComponent(id), revision);
  const certificate = snapshot?.data;

  async function setVisibility(active: boolean) {
    setBusy(true);
    setError('');
    try {
      await api('learning/certificates/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ active }) });
      setRevision((value) => value + 1);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="learning">
    <a className="text-link learning-back learning-no-print" href={certificate ? courseHref(certificate.courseId) : '#learning'}>{certificate ? 'Back to course' : 'Back to Learning'}</a>
    {!snapshot && <p className="muted" role="status">Loading certificate…</p>}
    {snapshot?.error && <div className="card content-card learning-state"><p role="alert">{snapshot.error}</p><button className="button secondary" onClick={() => setRevision(revision + 1)}>Try again</button></div>}
    {certificate && <>
      <article className="card learning-certificate">
        <Award size={47} strokeWidth={1.4} aria-hidden="true" />
        <p>Linkedup Pro Learning</p>
        <h1>Certificate of completion</h1>
        <p>Awarded to</p><h2>{certificate.recipient}</h2>
        <p>for completing</p><h3>{certificate.title}</h3>
        <p>{issueDate(certificate.completedAt)} · Instructor {certificate.instructor}</p>
        <small>Certificate ID {certificate.id}</small>
      </article>
      <div className="learning-actions learning-no-print">
        <button className="button secondary" onClick={() => window.print()}><Printer size={17} /> Print certificate</button>
        {certificate.mine && <button className="button primary" disabled={busy} aria-pressed={certificate.onProfile}
          onClick={() => void setVisibility(!certificate.onProfile)}>{certificate.onProfile ? 'Remove from profile' : 'Add to profile'}</button>}
        {certificate.mine && <span className="muted" role="status">{certificate.onProfile ? 'Visible on your profile' : 'Private to you'}</span>}
      </div>
      {error && <p role="alert" className="dialog-error learning-no-print">{error}</p>}
    </>}
  </div>;
}

export function ProfileCertificates({ profileId, close }: { profileId: string; close?: () => void }) {
  const snapshot = useResource<Certificate[]>('learning/certificates/profile/' + encodeURIComponent(profileId), 0);
  const entries = snapshot?.data ?? [];
  if (!entries.length) return null;
  return <section className={close ? 'member-projects learning-profile-certificates' : 'card content-card learning-profile-certificates'}>
    {close ? <h3>Course certificates</h3> : <h2>Course certificates</h2>}
    <ul>{entries.map((certificate) => <li key={certificate.id}><Award size={20} />
      <div><a href={certificateHref(certificate.id)} onClick={close}>{certificate.title}</a>
        <small>Linkedup Pro Learning · {issueDate(certificate.completedAt)}</small></div>
    </li>)}</ul>
  </section>;
}

export function LearningView({ member }: { member: Me }) {
  const [route, setRoute] = useState<LearningRoute | undefined>();
  const [tab, setTab] = useState('Explore');
  useEffect(() => {
    const change = () => {
      setRoute(readRoute());
      if (window.location.hash.startsWith('#learning')) window.scrollTo({ top: 0 });
    };
    change();
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  if (route === undefined) return <p className="muted" role="status">Loading Learning…</p>;
  if (route?.type === 'course') return <ViewCourse key={route.id} id={route.id} />;
  if (route?.type === 'certificate') return <ViewCertificate key={route.id} id={route.id} />;
  return <LearningCatalog member={member} tab={tab} setTab={setTab} />;
}
