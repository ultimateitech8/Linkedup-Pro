'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink } from 'lucide-react';
import { useApiMutation } from './api-resource';
import { BrandAvatar, Dialog } from './components';
import { api, type Me } from './data';
import type { AdObjective, FeedAd } from './ad-data';

function LeadForm({ ad, member, close, sent }: { ad: FeedAd; member: Me; close: () => void; sent: () => void }) {
  const { busy, error, save } = useApiMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (await save(`advertising/deliveries/${ad.id}/lead`, { consent: fields.has('consent'), message: fields.get('message') })) sent();
  }
  return <Dialog title={`Contact ${ad.company.name}`} close={close} error={error}>
    <form className="field-form" onSubmit={submit}>
      <p className="muted">Your contact information will be shared with {ad.company.name} so they can respond.</p>
      <div className="ad-contact"><strong>{member.name}</strong><span>{member.email}</span></div>
      <label>Message <small>Optional</small><textarea name="message" rows={3} maxLength={500} /></label>
      <label className="ad-check"><input type="checkbox" name="consent" required /> I agree to share my name, email, and message with {ad.company.name}.</label>
      <div className="dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy ? 'Sending…' : 'Send my information'}</button></div>
    </form>
  </Dialog>;
}

export function SponsoredPlacement({ member }: { member: Me }) {
  const slot = useRef<HTMLDivElement>(null);
  const [ad, setAd] = useState<FeedAd | null>(null);
  const [form, setForm] = useState(false);
  const { busy, error, save } = useApiMutation();

  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    const controller = new AbortController();
    let observer: IntersectionObserver | undefined;
    const request = () => {
      observer?.disconnect();
      void api<{ ad: FeedAd | null }>('advertising/feed/claim', { method: 'POST', signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) setAd(result.ad); })
        .catch(() => { /* The organic feed loads independently of sponsored placements. */ });
    };
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) request(); });
      observer.observe(element);
    } else request();
    return () => { observer?.disconnect(); controller.abort(); };
  }, []);

  async function activate() {
    if (!ad) return;
    const next = await save<{ objective: AdObjective; destination: string | null; companyId: number }>(
      `advertising/deliveries/${ad.id}/click`, {}
    );
    if (next?.objective === 'lead') setForm(true);
    if (next?.objective === 'company') window.location.hash = `companies?company=${next.companyId}`;
    if (next?.objective === 'website' && next.destination) window.location.assign(next.destination);
  }

  return <div ref={slot} className="ad-feed-slot">{ad && <>
    <article className="card ad-feed-card" aria-label={`Sponsored by ${ad.company.name}`}>
      <header className="ad-feed-header"><BrandAvatar brand={ad.company} size={42} />
        <div><strong>{ad.company.name}</strong><small>Sponsored</small></div>
      </header>
      {ad.headline && <h3>{ad.headline}</h3>}
      <p className="ad-creative-body">{ad.body}</p>
      {ad.hasImage && <img className="ad-feed-image" src={`/api/advertising/deliveries/${ad.id}/image`} alt={ad.imageAlt} />}
      {ad.converted ? <p className="ad-form-status" role="status">Your information was shared with {ad.company.name}.</p> :
        <button className="button secondary" disabled={busy} onClick={() => void activate()}>
          {ad.buttonLabel}{ad.objective === 'website' && <ExternalLink size={15} aria-hidden="true" />}
        </button>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
    </article>
    {form && <LeadForm ad={ad} member={member} close={() => setForm(false)} sent={() => {
      setAd({ ...ad, converted: true }); setForm(false);
    }} />}
  </>}</div>;
}
