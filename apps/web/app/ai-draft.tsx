'use client';

import { useState } from 'react';
import { Clipboard, Sparkles, X } from 'lucide-react';
import { useApiMutation } from './api-resource';
import { writingTasks, type AiDraft, type TextTask } from './ai-data';

export function AiDraftResult({ text, apply, title = 'AI suggestion' }: {
  text: string; apply?: (text: string) => void; title?: string;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  return <section className="ai-output" aria-label={title}>
    <h3>{title}</h3>
    <p className="ai-output-text">{text}</p>
    <div className="ai-action-row">
      {apply && <button className="button primary" type="button" onClick={() => apply(text)}>Use draft</button>}
      <button className="button secondary" type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopyStatus('Copied.'); }
        catch { setCopyStatus('Select the suggestion text to copy it.'); }
      }}><Clipboard size={16} /> Copy</button>
      {copyStatus && <span className="muted" role="status">{copyStatus}</span>}
    </div>
  </section>;
}

export function DraftEditor({ task, initial = '', enabled = true, apply, onDone }: {
  task: TextTask; initial?: string; enabled?: boolean; apply?: (text: string) => void; onDone?: () => void;
}) {
  const [input, setInput] = useState(initial.slice(0, 4000));
  const [draft, setDraft] = useState('');
  const { save, busy, error } = useApiMutation();
  const placeholder = task === 'career' ? 'Describe your current role, the goal you’re working toward, and the time you have.' : writingTasks[task].placeholder;
  const label = task === 'career' ? 'Create a plan' : 'Generate suggestion';

  async function generate() {
    setDraft('');
    const result = await save<AiDraft>('ai/generate', { task, input });
    if (result) setDraft(result.text);
    onDone?.();
  }

  return <div className="ai-editor">
    <label>Text for AI<textarea rows={4} value={input} maxLength={4000} disabled={!enabled || busy}
      placeholder={placeholder} onChange={(event) => { setInput(event.target.value); setDraft(''); }} /></label>
    <p className="ai-note">Generating sends the text above to OpenAI.</p>
    <div className="ai-action-row"><button className="button primary" type="button" disabled={busy || !enabled || input.trim().length < 2}
      onClick={() => void generate()}><Sparkles size={17} /> {busy ? 'Generating…' : label}</button></div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    {draft && <AiDraftResult key={draft} text={draft} apply={apply} title={task === 'career' ? 'Career plan' : undefined} />}
  </div>;
}

export function InlineAiDraft({ task, label, context, apply }: {
  task: Exclude<TextTask, 'career'>; label: string; context: () => string; apply: (value: string) => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  if (source === null) return <button className="text-link ai-inline-trigger" type="button" onClick={() => setSource(context())}><Sparkles size={15} /> {label}</button>;
  return <section className="ai-inline-panel" aria-label={label}>
    <div className="section-heading"><strong>{label}</strong><button className="icon-btn" type="button" aria-label="Close AI drafting"
      onClick={() => setSource(null)}><X size={17} /></button></div>
    <DraftEditor task={task} initial={source} apply={(value) => { apply(value); setSource(null); }} />
  </section>;
}
