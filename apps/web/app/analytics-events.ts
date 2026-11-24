'use client';

import { useEffect, useRef } from 'react';
import { api } from './data';

export function sendAnalyticsEvent(event: 'profile' | 'search' | 'post', data: object) {
  void api(`analytics/events/${event}`, { method: 'POST', body: JSON.stringify(data), keepalive: true }).catch(() => {});
}

const pending = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;

function onVisibilityChange() {
  if (document.hidden || !observer) return;
  for (const element of pending.keys()) {
    observer.unobserve(element);
    observer.observe(element);
  }
}

function stopWatching(element: Element) {
  pending.delete(element);
  observer?.unobserve(element);
  if (!pending.size) {
    observer?.disconnect();
    observer = undefined;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
}

function watchPost(element: Element, record: () => void) {
  if (!('IntersectionObserver' in window)) return;
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      if (document.hidden) return;
      for (const entry of entries) {
        const onView = pending.get(entry.target);
        if (!onView || !entry.isIntersecting || entry.intersectionRatio < 0.15) continue;
        stopWatching(entry.target);
        onView();
      }
    }, { threshold: 0.15 });
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  pending.set(element, record);
  observer.observe(element);
  return () => stopWatching(element);
}

export function usePostImpression(id: number, viewerId: string, enabled: boolean) {
  const post = useRef<HTMLElement>(null);
  useEffect(() => {
    if (enabled && post.current) return watchPost(post.current, () => sendAnalyticsEvent('post', { id }));
  }, [id, viewerId, enabled]);
  return post;
}
