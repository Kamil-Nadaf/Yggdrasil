/**
 * Phone-only mode: a small backend that runs inside the app and stores everything on the phone.
 * It answers the same /api/... requests as the Yggdrasil backend, so the screens work unchanged.
 */
export interface LItem {
  slug: string; title: string; authors: string[]; year: number | null; status: string; progress: number; last_page: number;
  total_pages?: number | null; kind: string; arxiv: string; has_file: boolean; format: string; venue: string; added: string;
  abstract?: string; url?: string; pdf_url?: string; notes?: string | null;
}
interface LCol { id: string; name: string; slugs: string[]; parent?: string; zotero_key?: string }
interface LFile { source: string; modified: string }
export interface LComment { id: string; author: string; at: string; text: string }
export interface LLink { kind: string; ref: string; label: string }
/** Research fields shared by main tasks and subtasks (same names as the desktop backend). */
export interface LExtra {
  stage?: string | null; next_step?: string; waiting_on?: string; milestone?: boolean; estimate_min?: number | null;
  comments?: LComment[]; links?: LLink[];
}
export const EXTRA_KEYS = ['stage', 'next_step', 'waiting_on', 'milestone', 'estimate_min', 'comments', 'links'] as const;
export interface LSub extends LExtra { id: string; name: string; deadline: string | null; status_id: string; done_at?: string }
export interface LMain extends LExtra { id: string; name: string; deadline: string | null; is_active: boolean; subtasks: LSub[] }
interface LProj { slug: string; name: string; pinned: boolean; main: LMain[] }
interface LGoal { id: string; name: string; start_date: string; end_date: string }
export interface LocalDB {
  notes: Record<string, LFile>; tex: Record<string, LFile>; decks: Record<string, LFile>; cols: LCol[]; items: Record<string, LItem>;
  habits: Record<string, Record<string, unknown>>; goals: LGoal[]; projects: LProj[];
  log: Record<string, { papers: number; books: number; writing: number }>;
}

const KEY = 'ygg.local.v1';
const emptyDB = (): LocalDB => ({ notes: {}, tex: {}, decks: {}, cols: [{ id: 'c_inbox', name: 'Inbox', slugs: [] }], items: {}, habits: {}, goals: [], projects: [], log: {} });

let db: LocalDB | null = null;
export function getDB(): LocalDB {
  if (db) return db;
  try { const raw = localStorage.getItem(KEY); db = { ...emptyDB(), ...(raw ? JSON.parse(raw) : {}) }; } catch { db = emptyDB(); }
  return db!;
}
export function setDB(next: LocalDB) { db = next; persist(); }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { throw new Error('Phone storage is full'); } }

const now = () => new Date().toISOString();
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
const dayOf = (iso: string) => iso.slice(0, 10);
const STATUSES = [{ id: 'todo', name: 'To Do', color: '#6B7280' }, { id: 'in_progress', name: 'In Progress', color: '#F59E0B' }, { id: 'done', name: 'Done', color: '#34D399' }];

export const TOPICS = [
  ['Astrophysics', [['astro-ph.HE', 'High Energy Astrophysics'], ['astro-ph.CO', 'Cosmology'], ['astro-ph.GA', 'Galaxies'], ['astro-ph.SR', 'Solar and Stellar'], ['astro-ph.EP', 'Earth and Planetary'], ['astro-ph.IM', 'Instrumentation'], ['gr-qc', 'General Relativity']]],
  ['Physics', [['hep-ph', 'HEP Phenomenology'], ['hep-th', 'HEP Theory'], ['quant-ph', 'Quantum Physics'], ['physics.data-an', 'Data Analysis']]],
  ['Computer science', [['cs.LG', 'Machine Learning'], ['cs.AI', 'Artificial Intelligence'], ['cs.CV', 'Computer Vision'], ['cs.CL', 'Computation and Language'], ['stat.ML', 'Statistics: ML']]],
] as const;

async function arxivFetch(params: string): Promise<{ papers: unknown[]; total: number }> {
  let r: Response;
  try { r = await fetch(`https://export.arxiv.org/api/query?${params}`); } catch { throw new Error('Cannot reach arXiv from here. In a browser this needs a server; the Android app can reach it directly.'); }
  if (!r.ok) throw new Error(`arXiv error ${r.status}`);
  const xml = new DOMParser().parseFromString(await r.text(), 'text/xml');
  const t = (e: Element, n: string) => e.getElementsByTagName(n)[0]?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const papers = [...xml.getElementsByTagName('entry')].map((e) => {
    const abs = t(e, 'id'); const id = abs.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    return {
      id, title: t(e, 'title'), authors: [...e.getElementsByTagName('author')].map((a) => t(a, 'name')), abstract: t(e, 'summary'),
      arxiv_url: `https://arxiv.org/abs/${id}`, pdf_url: `https://arxiv.org/pdf/${id}`,
      categories: [...e.getElementsByTagName('category')].map((c) => c.getAttribute('term') || ''), submitted: t(e, 'published'),
    };
  });
  return { papers, total: Number(t(xml.documentElement, 'opensearch:totalResults')) || papers.length };
}

const folders = (names: string[]) => [...new Set(names.flatMap((n) => { const p = n.split('/'); return p.slice(0, -1).map((_, i) => p.slice(0, i + 1).join('/')); }))].sort();
const fileList = (m: Record<string, LFile>) => Object.entries(m).map(([name, f]) => ({ name, modified: f.modified, size: f.source.length, kind: 'tex' }));
const STAGES = ['read', 'analyse', 'write', 'admin'];
const extraView = (x: LExtra) => ({
  stage: x.stage && STAGES.includes(x.stage) ? x.stage : null, next_step: x.next_step || '', waiting_on: x.waiting_on || '', milestone: !!x.milestone,
  estimate_min: x.estimate_min || null, comments: x.comments || [], links: x.links || [],
  priority_id: null, start: null, tags: [], tracked_sec: 0, timer_started_at: null, relations: [], files: [], has_note: false,
});
/** Copy the research fields present in `body` onto a task; invalid stages are ignored. */
const applyExtra = (t: LExtra, body: any) => {
  if ('stage' in body) { const st = String(body.stage || '').toLowerCase(); t.stage = STAGES.includes(st) ? st : null; }
  if ('next_step' in body) t.next_step = String(body.next_step || '').trim().slice(0, 500);
  if ('waiting_on' in body) t.waiting_on = String(body.waiting_on || '').trim().slice(0, 200);
  if ('milestone' in body) t.milestone = !!body.milestone;
  if ('estimate_min' in body) t.estimate_min = Number(body.estimate_min) > 0 ? Math.round(Number(body.estimate_min)) : null;
  if (Array.isArray(body.links)) t.links = body.links.filter((l: any) => l && ['paper', 'note', 'figure', 'latex'].includes(l.kind) && l.ref).map((l: any) => ({ kind: l.kind, ref: String(l.ref), label: String(l.label || l.ref) }));
};
const subView = (s: LSub, slug: string, mainId: string) => ({ id: s.id, main_task_id: mainId, project_slug: slug, name: s.name, deadline: s.deadline, status_id: s.status_id, done: s.status_id === 'done', completed_at: s.done_at || null, created_at: '', ...extraView(s) });
const mainView = (m: LMain, slug = '') => ({ id: m.id, project_slug: slug, name: m.name, deadline: m.deadline, is_active: m.is_active, status_id: 'todo', created_at: '', subtask_done: m.subtasks.filter((s) => s.status_id === 'done').length, subtask_total: m.subtasks.length, ...extraView(m) });
const addTime = (date: string, cat: 'papers' | 'books' | 'writing', sec: number) => { const d = getDB(); const e = d.log[date] || { papers: 0, books: 0, writing: 0 }; e[cat] += sec; d.log[date] = e; };

export async function localRequest(method: string, rawPath: string, body: any): Promise<any> {
  const u = new URL(rawPath, 'http://x'); const p = u.pathname; const q = u.searchParams; const d = getDB();
  const dec = (s: string) => decodeURIComponent(s);
  let m: RegExpMatchArray | null;
  const save = <T,>(v: T): T => { persist(); return v; };

  if (p === '/api/info') return { vault: 'This phone' };
  if (p === '/api/arxiv/topics') return { topics: TOPICS.flatMap(([group, xs]) => xs.map(([id, label]) => ({ id, label, group }))) };
  if (p === '/api/arxiv/daily') {
    const cat = q.get('cat') || 'astro-ph.HE'; const date = q.get('date');
    const { papers } = await arxivFetch(`search_query=cat:${encodeURIComponent(cat)}&sortBy=submittedDate&sortOrder=descending&max_results=${date ? 200 : 60}`);
    const list = (papers as { submitted: string }[]);
    return { papers: date ? list.filter((x) => dayOf(x.submitted) === date) : list, cat, warning: null };
  }
  if (p === '/api/arxiv/search') {
    const cat = q.get('category'); const text = (q.get('q') || '').trim();
    const parts = [text ? `all:${encodeURIComponent(text)}` : '', cat ? `cat:${encodeURIComponent(cat)}` : ''].filter(Boolean).join('+AND+');
    return arxivFetch(`search_query=${parts || 'all:a'}&sortBy=relevance&max_results=${q.get('max_results') || 40}`);
  }

  if (p === '/api/reading/collections') {
    if (method === 'PUT') { d.cols = body.collections; return save({ ok: true, collections: d.cols }); }
    return { collections: d.cols };
  }
  if (p === '/api/reading/items' && method === 'POST') {
    const dupe = body.arxiv && Object.values(d.items).find((i) => i.arxiv === body.arxiv);
    const slug = dupe ? dupe.slug : `${slugify(body.arxiv || body.title).slice(0, 40)}-${Math.random().toString(36).slice(2, 5)}`;
    if (!dupe) d.items[slug] = { slug, title: body.title, authors: body.authors || [], year: body.year ?? null, status: 'want', progress: 0, last_page: 0, kind: body.kind || 'paper', arxiv: body.arxiv || '', has_file: false, format: 'pdf', venue: '', added: dayOf(now()), abstract: body.abstract, url: body.url, pdf_url: body.pdf_url, notes: body.notes };
    const c = d.cols.find((x) => x.id === body.collection); if (c && !c.slugs.includes(slug)) c.slugs.push(slug);
    return save({ ok: true, book: d.items[slug] });
  }
  if (p === '/api/reading/library') return { books: Object.values(d.items) };
  if (p === '/api/reading/history') return { goal_minutes: 30, days: Object.entries(d.log).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)) };
  if (p === '/api/reading/time' && method === 'POST') { addTime(body.date, body.category, body.seconds); return save({ ok: true }); }
  if (p === '/api/reading/session' && method === 'POST') {
    const it = d.items[body.slug]; addTime(body.date, it?.kind === 'book' ? 'books' : 'papers', body.seconds);
    if (it && body.page) it.last_page = body.page;
    return save({ ok: true });
  }
  if ((m = p.match(/^\/api\/reading\/([^/]+)$/)) && method === 'PATCH') {
    const it = d.items[dec(m[1])]; if (!it) throw new Error('Not found');
    Object.assign(it, body); return save({ ok: true });
  }

  if (p === '/api/settings/goals') {
    if (method === 'PUT' || method === 'POST') { if (body.goals) d.goals = body.goals; return save({ goals: d.goals }); }
    return { goals: d.goals };
  }
  if (p === '/api/calendar/events') return { events: [] };
  if (p === '/api/settings/task-statuses') return { task_statuses: STATUSES };
  if (p === '/api/settings/zotero') return { user_id: '', has_key: false, source: 'none' };
  if (p === '/api/zotero/collections') return { collections: [], error: 'Zotero needs a server connection' };
  if (p === '/api/zotero/add-paper') return { status: 'error', message: 'Zotero needs a server connection' };

  if (p === '/api/habits/range') {
    const s = q.get('start') || '', e = q.get('end') || '9999';
    return { days: Object.keys(d.habits).sort().filter((x) => x >= s && x <= e).map((date) => ({ date, habits: d.habits[date] })) };
  }
  if ((m = p.match(/^\/api\/habits\/(\d{4}-\d{2}-\d{2})$/)) && method === 'POST') { d.habits[m[1]] = { ...(d.habits[m[1]] || {}), ...body.habits }; return save({ ok: true }); }

  if (p === '/api/task-projects') {
    if (method === 'POST') { let s = slugify(body.name); while (d.projects.some((x) => x.slug === s)) s += '-2'; d.projects.push({ slug: s, name: body.name, pinned: false, main: [] }); return save({ ok: true, slug: s }); }
    return { projects: d.projects.map((x) => ({ slug: x.slug, name: x.name, pinned: x.pinned, main_task_count: x.main.length })) };
  }
  if ((m = p.match(/^\/api\/task-projects\/([^/]+)\/main-tasks\/([^/]+)$/)) && method === 'PUT') {
    const mt = d.projects.find((x) => x.slug === dec(m![1]))?.main.find((x) => x.id === m![2]); if (!mt) throw new Error('Task not found');
    if (typeof body.is_active === 'boolean') mt.is_active = body.is_active;
    if (body.name) mt.name = body.name;
    if (body.deadline !== undefined) mt.deadline = body.deadline;
    applyExtra(mt, body);
    return save({ ok: true });
  }
  if ((m = p.match(/^\/api\/task-projects\/([^/]+)\/main-tasks(?:\/([^/]+)\/subtasks(?:\/([^/]+))?)?$/))) {
    const mm = m!; const proj = d.projects.find((x) => x.slug === dec(mm[1])); if (!proj) throw new Error('Project not found');
    if (!mm[2]) {
      if (method === 'POST') { const nm: LMain = { id: uid('mt'), name: body.name, deadline: body.deadline || null, is_active: true, subtasks: [] }; applyExtra(nm, body); proj.main.push(nm); return save({ ok: true, main_task: mainView(nm, proj.slug) }); }
      return { main_tasks: proj.main.map((x) => mainView(x, proj.slug)) };
    }
    const main = proj.main.find((x) => x.id === mm[2]); if (!main) throw new Error('Task not found');
    if (!mm[3]) {
      if (method === 'POST') { const ns: LSub = { id: uid('st'), name: body.name, deadline: body.deadline || null, status_id: 'todo' }; applyExtra(ns, body); main.subtasks.push(ns); return save({ ok: true, subtask: subView(ns, proj.slug, main.id) }); }
      return { subtasks: main.subtasks.map((x) => subView(x, proj.slug, main.id)) };
    }
    const sub = main.subtasks.find((x) => x.id === mm[3]); if (!sub) throw new Error('Subtask not found');
    if (method === 'PUT') { const { stage, next_step, waiting_on, milestone, estimate_min, links, comments, ...plain } = body; Object.assign(sub, plain); applyExtra(sub, { stage, next_step, waiting_on, milestone, estimate_min, links }); sub.done_at = sub.status_id === 'done' ? sub.done_at || now() : undefined; return save({ ok: true }); }
    if (method === 'DELETE') { main.subtasks = main.subtasks.filter((x) => x !== sub); return save({ ok: true }); }
  }
  if ((m = p.match(/^\/api\/task-items\/([^/]+)\/((?:mt|st)-[^/]+)(?:\/(comments)(?:\/([^/]+))?)?$/))) {
    const mm = m!; const proj = d.projects.find((x) => x.slug === dec(mm[1])); if (!proj) throw new Error('Project not found');
    let main: LMain | undefined; let sub: LSub | undefined;
    for (const x of proj.main) { if (x.id === mm[2]) main = x; const s2 = x.subtasks.find((s) => s.id === mm[2]); if (s2) { main = x; sub = s2; } }
    if (!main) throw new Error('Task not found');
    const t: LExtra = sub ?? main;
    const out = () => (sub ? { kind: 'subtask', ...subView(sub, proj.slug, main!.id) } : { kind: 'main', ...mainView(main!, proj.slug) });
    if (mm[3]) {
      if (method === 'POST') {
        const text = String(body.text || '').trim(); if (!text) throw new Error('Comment text is required');
        t.comments = [...(t.comments || []), { id: uid('c'), author: String(body.author || 'me').slice(0, 80), at: now().slice(0, 19), text: text.slice(0, 4000) }];
        return save({ ok: true, comments: t.comments });
      }
      if (method === 'DELETE') { t.comments = (t.comments || []).filter((c) => c.id !== mm[4]); return save({ ok: true, comments: t.comments }); }
    }
    if (method === 'PUT') {
      const { name, deadline, status_id, is_active } = body;
      if (name) (sub ?? main).name = name;
      if (deadline !== undefined) (sub ?? main).deadline = deadline;
      if (sub && status_id) { sub.status_id = status_id; sub.done_at = status_id === 'done' ? sub.done_at || now() : undefined; }
      if (!sub && typeof is_active === 'boolean') main.is_active = is_active;
      applyExtra(t, body);
      return save({ ok: true });
    }
    if (method === 'DELETE') { if (sub) main.subtasks = main.subtasks.filter((x) => x !== sub); else proj.main = proj.main.filter((x) => x !== main); return save({ ok: true }); }
    return { item: out(), note: '' };
  }
  if (p === '/api/tasks/active-summary') {
    return { active: d.projects.flatMap((pr) => pr.main.filter((x) => x.is_active).map((x) => { const v = mainView(x); return { project_slug: pr.slug, project_name: pr.name, main_task_id: x.id, main_task_name: x.name, deadline: x.deadline, subtask_done: v.subtask_done, subtask_total: v.subtask_total }; })) };
  }
  if (p === '/api/tasks/completed-by-day') {
    const c: Record<string, number> = {};
    for (const pr of d.projects) for (const mt of pr.main) for (const s of mt.subtasks) if (s.done_at) c[dayOf(s.done_at)] = (c[dayOf(s.done_at)] || 0) + 1;
    const s = q.get('start') || '', e = q.get('end') || '9999';
    return { days: Object.entries(c).filter(([k]) => k >= s && k <= e).map(([date, count]) => ({ date, count })) };
  }

  const notesLike = (store: Record<string, LFile>, prefix: string, ext: string) => {
    if (p === prefix) {
      if (method === 'POST') { const n = body.filename.endsWith(ext) ? body.filename : body.filename + ext; store[n] = { source: body.source, modified: now() }; return save({ ok: true, path: n }); }
      return { folders: folders(Object.keys(store)), files: fileList(store) };
    }
    if (p.startsWith(prefix + '/')) {
      const raw = dec(p.slice(prefix.length + 1)); const n = store[raw] ? raw : raw + ext;
      if (method === 'DELETE') { delete store[n]; return save({ ok: true }); }
      return { name: n, source: store[n]?.source ?? '' };
    }
    return undefined;
  };
  const n1 = notesLike(d.notes, '/api/notes/files', '.md'); if (n1) return n1;
  const n2 = notesLike(d.tex, '/api/latex/files', '.tex'); if (n2) return n2;
  if (p === '/api/latex/save' && method === 'POST') { const n = body.filename.endsWith('.tex') ? body.filename : body.filename + '.tex'; d.tex[n] = { source: body.source, modified: now() }; return save({ path: n }); }
  if (p === '/api/latex/compile') throw new Error('Compiling needs your Yggdrasil server (LaTeX is not installed on the phone). Your source is saved here.');
  throw new Error(`Not available on this phone: ${p}`);
}
