'use client';

import { useEffect, useState } from 'react';
import { api } from './data';

export function useApiResource<T>(path: string | null, revision?: number, poll = false) {
  const [generation, setGeneration] = useState(0);
  const [snapshot, setSnapshot] = useState<{ path: string; data: T } | { path: string; error: string }>();
  const refresh = () => setGeneration((value) => value + 1);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void api<T>(path, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setSnapshot({ path, data });
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setSnapshot({ path, error: failure.message });
    });
    return () => controller.abort();
  }, [path, generation, revision]);
  useEffect(() => {
    if (!poll) return;
    const tick = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(tick, 12000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [poll]);
  return { snapshot: snapshot?.path === path ? snapshot : undefined, refresh };
}

export function useApiMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save<T = { ok: boolean }>(path: string, body: object, method = 'POST') {
    if (busy) return undefined;
    setBusy(true);
    setError('');
    try {
      return await api<T>(path, { method, body: body instanceof FormData ? body : JSON.stringify(body) });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, save };
}
