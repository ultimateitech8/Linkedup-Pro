'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from './data';
import { categories, courseHref, levels, type Course, type CourseDetail, type LessonInput } from './learning-data';

function LessonFields({ number, position, value, remove }: {
  number: number; position: number; value?: LessonInput; remove?: () => void;
}) {
  const [hasQuiz, setHasQuiz] = useState(Boolean(value?.quiz));
  return <fieldset className="learning-editor-lesson">
    <legend>Lesson {position}</legend>
    {remove && <button type="button" className="text-link learning-remove" onClick={remove}><Trash2 size={15} /> Remove lesson</button>}
    <div className="field-grid">
      <label>Lesson title<input name={`title-${number}`} defaultValue={value?.title} required maxLength={100} /></label>
      <label>Duration in minutes<input type="number" name={`minutes-${number}`} defaultValue={value?.minutes ?? 5} required min={1} max={240} /></label>
    </div>
    <label>YouTube video URL <small>Optional</small><input type="url" name={`video-${number}`} defaultValue={value?.video} maxLength={2048} /></label>
    <label>Lesson notes <small>Required without a video</small><textarea name={`notes-${number}`} defaultValue={value?.notes} rows={3} maxLength={1800} /></label>
    <label>Practice exercise <small>Optional</small><textarea name={`exercise-${number}`} defaultValue={value?.exercise} rows={2} maxLength={600} /></label>
    <label className="learning-check"><input type="checkbox" checked={hasQuiz} onChange={(event) => setHasQuiz(event.target.checked)} /> Include a quiz</label>
    {hasQuiz && <div className="learning-quiz-fields">
      <label>Quiz question<input name={`prompt-${number}`} defaultValue={value?.quiz?.prompt} required maxLength={240} /></label>
      {[0, 1, 2].map((index) => <label key={index}>Option {index + 1}
        <input name={`choice-${number}-${index}`} defaultValue={value?.quiz?.choices[index]} required maxLength={140} /></label>)}
      <label>Correct option<select name={`answer-${number}`} defaultValue={value?.quiz?.answer ?? ''} required>
        <option value="">Select the correct option</option><option value="0">Option 1</option><option value="1">Option 2</option><option value="2">Option 3</option>
      </select></label>
    </div>}
  </fieldset>;
}

export function CourseForm({ draft, close, saved }: { draft?: CourseDetail; close: () => void; saved: () => void }) {
  const [keys, setKeys] = useState(() => draft?.draftLessons?.map((_, index) => index) ?? [0]);
  const nextKey = useRef(keys.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const fields = new FormData(event.currentTarget);
    const get = (key: string) => String(fields.get(key) ?? '').trim();
    const lessons = keys.map((key): LessonInput => ({
      title: get(`title-${key}`), minutes: Number(get(`minutes-${key}`)), video: get(`video-${key}`),
      notes: get(`notes-${key}`), exercise: get(`exercise-${key}`),
      quiz: fields.has(`prompt-${key}`) ? {
        prompt: get(`prompt-${key}`), choices: [0, 1, 2].map((index) => get(`choice-${key}-${index}`)),
        answer: Number(get(`answer-${key}`))
      } : null
    }));
    const body = { title: get('title'), description: get('description'), category: get('category'),
      level: get('level'), skills: get('skills').split(',').map((skill) => skill.trim()).filter(Boolean), lessons };
    try {
      const result = await api<{ id: number }>(draft ? `learning/courses/${draft.id}` : 'learning/courses', {
        method: draft ? 'PATCH' : 'POST', body: JSON.stringify(body)
      });
      saved();
      window.location.hash = courseHref(result.id);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="card content-card learning-form-card">
    <h2>{draft ? 'Edit course draft' : 'Create a course'}</h2>
    <form className="field-form" onSubmit={submit}>
      <label>Course title<input name="title" defaultValue={draft?.title} required maxLength={120} /></label>
      <label>Course description<textarea name="description" defaultValue={draft?.description} required rows={3} maxLength={1000} /></label>
      <div className="field-grid">
        <label>Category<select name="category" defaultValue={draft?.category ?? categories[0]}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Difficulty<select name="level" defaultValue={draft?.level ?? levels[0]}>{levels.map((level) => <option key={level}>{level}</option>)}</select></label>
      </div>
      <label>Skills <small>Up to 8, separated with commas</small><input name="skills" defaultValue={draft?.skills.join(', ')} maxLength={336} /></label>
      {keys.map((key, index) => <LessonFields key={key} number={key} position={index + 1} value={draft?.draftLessons?.[key]}
        remove={keys.length > 1 ? () => setKeys(keys.filter((item) => item !== key)) : undefined} />)}
      {keys.length < 16 && <button type="button" className="button secondary learning-add" onClick={() => {
        setKeys([...keys, nextKey.current++]);
      }}><Plus size={17} /> Add lesson</button>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button></div>
    </form>
  </section>;
}

export function PathForm({ courses, close, published }: { courses: Course[]; close: () => void; published: () => void }) {
  const [selection, setSelection] = useState<number[]>([0, 0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      await api('learning/paths', { method: 'POST', body: JSON.stringify({
        title: data.get('title'), description: data.get('description'), courses: selection
      }) });
      published();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="card content-card learning-form-card">
    <h2>Create a learning path</h2>
    <form className="field-form" onSubmit={submit}>
      <label>Path title<input name="title" required maxLength={120} /></label>
      <label>Path description<textarea name="description" required rows={3} maxLength={600} /></label>
      {selection.map((id, index) => <label key={index}>Course {index + 1}
        <select value={id || ''} required onChange={(event) => setSelection(selection.map((value, position) => position === index ? Number(event.target.value) : value))}>
          <option value="">Select a published course</option>{courses.filter((course) => course.id === id || !selection.includes(course.id)).map((course) =>
            <option value={course.id} key={course.id}>{course.title}</option>)}
        </select>
      </label>)}
      <div className="button-row">
        {selection.length < Math.min(8, courses.length) && <button type="button" className="button secondary" onClick={() => setSelection([...selection, 0])}><Plus size={17} /> Add course</button>}
        {selection.length > 2 && <button type="button" className="text-link" onClick={() => setSelection(selection.slice(0, -1))}>Remove last course</button>}
      </div>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy ? 'Publishing…' : 'Publish learning path'}</button></div>
    </form>
  </section>;
}
