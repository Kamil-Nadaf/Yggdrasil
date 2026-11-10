import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from './api';
import { getState } from './store';
import { localRequest } from './local';

export const isLocal = () => getState().settings.mode === 'local';

/** Client for the desktop Yggdrasil backend, reached through this server's /ygg proxy. */
export async function yg<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (isLocal()) return localRequest(init.method || 'GET', path, init.body) as Promise<T>;
  const r = await fetch(`/ygg${path}`, {
    method: init.method || 'GET',
    headers: authHeaders(init.body !== undefined),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (r.status === 401) throw new Error('Wrong sync token (gear icon → Connection)');
  if (r.status === 503 || r.status === 502) throw new Error('Yggdrasil backend not reachable from the phone server');
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    const errs = Array.isArray(j?.errors) && j.errors.length ? j.errors.join('\n') : '';
    throw new Error(errs || (typeof j?.detail === 'string' ? j.detail : j?.error || `Error ${r.status}`));
  }
  return r.json();
}

export function useY<T>(path: string | null, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(!!path);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let dead = false;
    setLoading(true);
    yg<T>(path).then((d) => { if (!dead) { setData(d); setErr(''); } }).catch((e) => { if (!dead) setErr(e.message); }).finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [path, n]);
  useEffect(() => { const h = () => setN((x) => x + 1); addEventListener('ygg-sync', h); return () => removeEventListener('ygg-sync', h); }, []);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, err, loading, reload };
}

export interface Topic { id: string; label: string; group: string }
export interface WebPaper { id: string; title: string; authors: string[]; abstract: string; arxiv_url: string; pdf_url: string; categories: string[]; submitted: string }
export interface DCol { id: string; name: string; slugs: string[]; parent?: string; zotero_key?: string }
export interface Item {
  slug: string; title: string; authors: string[]; year?: number | null; status: 'want' | 'reading' | 'done' | string;
  progress: number; last_page: number; total_pages?: number | null; kind: 'paper' | 'book'; arxiv: string;
  has_file: boolean; format: string; venue: string; added?: string;
}

export const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Collections in tree order with depth, so sub-collections show indented under their parent. */
export function flatten(cols: DCol[]): (DCol & { depth: number; path: string })[] {
  const kids = new Map<string, DCol[]>();
  const ids = new Set(cols.map((c) => c.id));
  for (const c of cols) {
    const k = c.parent && ids.has(c.parent) ? c.parent : '';
    kids.set(k, [...(kids.get(k) || []), c]);
  }
  const out: (DCol & { depth: number; path: string })[] = [];
  const walk = (pid: string, depth: number, path: string) => {
    for (const c of (kids.get(pid) || []).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path ? `${path} / ${c.name}` : c.name;
      out.push({ ...c, depth, path: p });
      walk(c.id, depth + 1, p);
    }
  };
  walk('', 0, '');
  return out;
}

export async function saveCollections(cols: DCol[]) {
  return yg<{ collections: DCol[] }>('/api/reading/collections', { method: 'PUT', body: { collections: cols } });
}

/** File an arXiv paper into a desktop collection; also push to Zotero when that collection is linked. */
export async function savePaper(p: WebPaper, col: DCol | null, claim = ''): Promise<{ zotero: 'ok' | 'skipped' | string }> {
  await yg('/api/reading/items', {
    method: 'POST',
    body: {
      kind: 'paper', title: p.title, authors: p.authors, year: Number(p.submitted.slice(0, 4)) || null,
      arxiv: p.id, abstract: p.abstract, url: p.arxiv_url, pdf_url: p.pdf_url, collection: col?.id || null,
      notes: claim ? `Claim: ${claim}` : null, fetch_pdf: true,
    },
  });
  if (!col?.zotero_key) return { zotero: 'skipped' };
  try {
    const r = await yg<{ status: string; message?: string }>('/api/zotero/add-paper', {
      method: 'POST', body: { arxiv_id: p.id, title: p.title, authors: p.authors, pdf_url: p.pdf_url, collection: col.zotero_key },
    });
    return { zotero: r.status === 'ok' ? 'ok' : r.message || 'Zotero failed' };
  } catch (e) {
    return { zotero: e instanceof Error ? e.message : 'Zotero failed' };
  }
}
