import { useEffect, useRef, useState } from 'react';

/** Debounced save with flush on unmount/hide. `save` must be stable enough to call with the latest text. */
export function useAutosave(text: string | null, loadedFrom: string | null, save: (t: string) => Promise<void>, delay = 1200) {
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved');
  const latest = useRef(text);
  const base = useRef(loadedFrom);
  const saver = useRef(save);
  saver.current = save;
  latest.current = text;
  const run = async () => {
    const t = latest.current;
    if (t === null || t === base.current) return;
    setState('saving');
    try { await saver.current(t); base.current = t; setState('saved'); } catch { setState('error'); }
  };
  useEffect(() => {
    if (text === null || text === base.current) return;
    setState('saving');
    const h = setTimeout(run, delay);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'hidden') void run(); };
    document.addEventListener('visibilitychange', f);
    return () => { document.removeEventListener('visibilitychange', f); void run(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { state, flush: run, reset: (t: string) => { base.current = t; } };
}
