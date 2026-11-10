import { getDocs, getState, mergeDocs, update, patchPaper, type ArxivItem, type Docs } from './store';

export const authHeaders = (json = false): Record<string, string> => {
  const h: Record<string, string> = {};
  const t = getState().settings.token;
  if (t) h.authorization = `Bearer ${t}`;
  if (json) h['content-type'] = 'application/json';
  return h;
};

// ---- arXiv ----
export async function loadFeed(cat: string, force = false) {
  const s = getState();
  if (!force && s.feed && s.feed.cat === cat && Date.now() - s.feed.fetched < 3600e3) return;
  const r = await fetch(`/api/arxiv?cat=${encodeURIComponent(cat)}`);
  if (!r.ok) throw new Error('Could not load arXiv');
  const j: { source: 'live' | 'sample'; items: ArxivItem[] } = await r.json();
  update((st) => ({ ...st, feed: { cat, sample: j.source === 'sample', fetched: Date.now(), items: j.items } }));
}

// ---- PDFs: cached in the Cache API for offline reading (needs https or localhost) ----
const pdfUrl = (id: string) => `/api/pdf/${encodeURIComponent(id)}`;
const hasCache = () => typeof caches !== 'undefined';

export async function getPdf(id: string): Promise<ArrayBuffer> {
  const url = pdfUrl(id);
  if (hasCache()) {
    const c = await caches.open('ygg-pdf');
    const hit = await c.match(url);
    if (hit) return hit.arrayBuffer();
    const r = await fetch(url);
    if (!r.ok) throw new Error('PDF unavailable (offline, or arXiv not reachable from the server)');
    await c.put(url, r.clone());
    return r.arrayBuffer();
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error('PDF unavailable (offline, or arXiv not reachable from the server)');
  return r.arrayBuffer();
}
export async function cachePdf(id: string): Promise<boolean> {
  try { await getPdf(id); patchPaper(id, { offline: true }); return true; } catch { return false; }
}

// ---- sync with your own server ----
export async function syncNow(): Promise<void> {
  const r = await fetch('/api/sync', { headers: authHeaders() });
  if (r.status === 401) throw new Error('Wrong sync token');
  if (!r.ok) throw new Error(`Server error ${r.status}`);
  const remote: Partial<Docs> = await r.json();
  const local = getDocs(getState());
  const merged = mergeDocs(local, remote);
  // only touch state when something actually changed, otherwise auto-sync would retrigger itself
  if (JSON.stringify(merged) !== JSON.stringify(local)) update((st) => ({ ...st, ...merged }));
  const p = await fetch('/api/sync', { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(merged) });
  if (!p.ok) throw new Error(`Server error ${p.status}`);
  update((st) => ({ ...st, settings: { ...st.settings, lastSync: Date.now() } }));
}

// ---- LaTeX compile ----
export async function compileTex(source: string): Promise<ArrayBuffer> {
  const r = await fetch('/api/latex/compile', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ source }) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({ error: `Server error ${r.status}` }));
    throw new Error(j.error || 'Compile failed');
  }
  return r.arrayBuffer();
}
