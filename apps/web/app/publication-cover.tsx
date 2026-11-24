'use client';

import { useEffect, useId, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { CoverSelection } from './publications-data';

export function CoverPicker({ value, update, existing, label = 'Cover image', altLabel = 'Image description',
  removeLabel = 'Remove cover', maxMb = 5, previewClass = '', optional = true }: {
  value: CoverSelection; update: (next: CoverSelection) => void; existing?: string;
  label?: string; altLabel?: string; removeLabel?: string; maxMb?: number; previewClass?: string; optional?: boolean;
}) {
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const hint = useId();
  useEffect(() => {
    if (!value.file) { setPreview(''); return; }
    const url = URL.createObjectURL(value.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value.file]);

  const image = preview || (!value.remove ? existing : undefined);
  return <fieldset className="publication-cover-picker">
    <legend><ImagePlus size={17} /> {label} {optional && <small>Optional</small>}</legend>
    {image && <img src={image} alt={value.alt} className={`publication-cover-preview ${previewClass}`} />}
    <div className="cover-controls">
      <input className="resume-input" aria-label={label} type="file" accept="image/jpeg,image/png,image/webp"
        aria-describedby={hint}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > maxMb * 1024 * 1024) {
            setError(`Choose an image up to ${maxMb} MB.`);
            event.target.value = '';
            return;
          }
          setError('');
          update({ ...value, file, remove: false });
        }} />
      {image && optional && <button className="text-link" type="button" onClick={(event) => {
        const input = event.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[type=file]');
        if (input) input.value = '';
        setError('');
        update({ ...value, file: null, remove: true });
      }}>{removeLabel}</button>}
    </div>
    <p id={hint} className={error ? 'form-error' : 'field-hint'} role={error ? 'alert' : undefined}>{error || `JPEG, PNG, or WebP up to ${maxMb} MB.`}</p>
    {image && <label>{altLabel}<input value={value.alt} required={!optional} onChange={(event) => update({ ...value, alt: event.target.value })}
      placeholder="Describe the image for readers with screen readers" maxLength={240} /></label>}
  </fieldset>;
}
