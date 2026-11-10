import { useSyncExternalStore } from 'react';

export type Status = 'unread' | 'reading' | 'done';
export type Decision = 'skip' | 'later' | 'saved';
export interface Base { id: string; updated: number; deleted?: boolean }
export interface Note extends Base { title: string; body: string; folder: string }
export interface Paper extends Base {
  title: string; authors: string; abstract: string; year: string;
  status: Status; collections: string[]; offline: boolean; claim: string; page: number;
}
export interface Collection extends Base { name: string }
export interface Project extends Base { name: string; source: string }
export interface ArxivItem { id: string; title: string; abstract: string; authors: string[]; published: string; pdf: string }
export interface Feed { cat: string; sample: boolean; fetched: number; items: ArxivItem[] }
export type ThemeName = 'dark' | 'light' | 'paper' | 'notebook';
export interface Settings { theme: ThemeName; accent: string; category: string; autoSync: boolean; token: string; lastSync: number; defaultCollection: string }
export interface State {
  notes: Note[]; papers: Paper[]; collections: Collection[]; projects: Project[];
  decisions: Record<string, Decision>;
  feed: Feed | null;
  activity: Record<string, number>;
  settings: Settings;
}
export type Docs = Pick<State, 'notes' | 'papers' | 'collections' | 'projects'>;

export const DAILY = 'c-daily';
export const GRB = 'c-grb';
export const WEEK_TARGET = 55;

const SAMPLE_TEX = '\\documentclass{article}\n\\usepackage{amsmath}\n\\title{Untitled}\n\\begin{document}\n\\maketitle\n\\section{Method}\nWe model each pulse as\n\\begin{equation}\n  I(t) = A \\exp\\left[-\\frac{|t-t_0|^{\\nu}}{\\sigma^{\\nu}}\\right]\n\\end{equation}\n\\end{document}\n';

const defaults = (): State => ({
  notes: [],
  papers: [],
  collections: [
    { id: GRB, name: 'GRB prompt emission', updated: 0 },
    { id: DAILY, name: 'Daily arXiv reads', updated: 0 },
  ],
  projects: [{ id: 'p-start', name: 'Untitled paper', source: SAMPLE_TEX, updated: 0 }],
  decisions: {},
  feed: null,
  activity: {},
  settings: { theme: 'dark', accent: '', category: 'astro-ph.HE', autoSync: true, token: '', lastSync: 0, defaultCollection: GRB },
});

const KEY = 'ygg.v1';
function load(): State {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    }
  } catch { /* corrupted or unavailable storage: start fresh */ }
  return d;
}

let state: State = load();
const subs = new Set<() => void>();
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const getState = () => state;
export function update(fn: (s: State) => State) {
  state = fn(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode */ }
  subs.forEach((f) => f());
}
export function useStore(): State {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => state);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const live = <T extends Base>(xs: T[]) => xs.filter((x) => !x.deleted);
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function ago(ts: number) {
  const d = Math.floor((Date.now() - ts) / 86400e3);
  if (dayKey(new Date(ts)) === dayKey()) return 'Today';
  if (d < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---- points & streak (weights follow the reading plan: triage 1, claim 2, note 5, finished paper 5) ----
export function addPoints(n: number) {
  update((s) => { const k = dayKey(); return { ...s, activity: { ...s.activity, [k]: (s.activity[k] || 0) + n } }; });
}
export function streakDays(s: State) {
  let n = 0;
  const d = new Date();
  if ((s.activity[dayKey(d)] || 0) < 3) d.setDate(d.getDate() - 1);
  while ((s.activity[dayKey(d)] || 0) >= 3 && n < 3650) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// ---- sync merge: newest `updated` wins per id (deletes are soft, so they propagate) ----
export function mergeList<T extends Base>(a: T[], b: T[]): T[] {
  const m = new Map<string, T>();
  for (const x of [...a, ...b]) {
    const y = m.get(x.id);
    if (!y || x.updated >= y.updated) m.set(x.id, x);
  }
  return [...m.values()];
}
export const getDocs = (s: State): Docs => ({ notes: s.notes, papers: s.papers, collections: s.collections, projects: s.projects });
export function mergeDocs(a: Docs, b: Partial<Docs>): Docs {
  return {
    notes: mergeList(a.notes, b.notes || []),
    papers: mergeList(a.papers, b.papers || []),
    collections: mergeList(a.collections, b.collections || []),
    projects: mergeList(a.projects, b.projects || []),
  };
}

// ---- notes ----
export function newNote(folder = 'Research', title = '', body = '', id = uid()): string {
  update((s) => ({ ...s, notes: [...s.notes, { id, title, body, folder, updated: Date.now() }] }));
  addPoints(5);
  return id;
}
export function patchNote(id: string, p: Partial<Pick<Note, 'title' | 'body' | 'folder'>>) {
  update((s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, ...p, updated: Date.now() } : n)) }));
}
export function deleteNote(id: string) {
  update((s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, deleted: true, updated: Date.now() } : n)) }));
}

// ---- collections & papers ----
export function newCollection(name: string) {
  update((s) => ({ ...s, collections: [...s.collections, { id: uid(), name, updated: Date.now() }] }));
}
export function patchPaper(id: string, p: Partial<Paper>) {
  update((s) => ({ ...s, papers: s.papers.map((x) => (x.id === id ? { ...x, ...p, updated: Date.now() } : x)) }));
}
export function decide(item: ArxivItem, d: Decision, cids?: string[], claim?: string) {
  update((s) => {
    let papers = s.papers;
    if (d !== 'skip') {
      const cols = d === 'later' ? [DAILY] : cids && cids.length ? cids : [s.settings.defaultCollection];
      const ex = s.papers.find((p) => p.id === item.id);
      const base: Paper = ex || {
        id: item.id, title: item.title, authors: item.authors.join(', '), abstract: item.abstract,
        year: item.published.slice(0, 4), status: 'unread', collections: [], offline: false, claim: '', page: 1, updated: 0,
      };
      const p: Paper = {
        ...base, deleted: false, collections: [...new Set([...base.collections, ...cols])],
        claim: claim ?? base.claim, updated: Date.now(),
      };
      papers = ex ? s.papers.map((x) => (x.id === item.id ? p : x)) : [...s.papers, p];
    }
    return { ...s, papers, decisions: { ...s.decisions, [item.id]: d } };
  });
  addPoints(1 + (claim ? 2 : 0));
}
export function markDecision(id: string, d: Decision | null) {
  update((s) => {
    const decisions = { ...s.decisions };
    if (d) decisions[id] = d; else delete decisions[id];
    return { ...s, decisions };
  });
  if (d) addPoints(1);
}

export function undoDecision(id: string) {
  update((s) => { const { [id]: _, ...rest } = s.decisions; return { ...s, decisions: rest }; });
}

// ---- LaTeX projects ----
export function newProject(name: string): string {
  const id = uid();
  update((s) => ({ ...s, projects: [...s.projects, { id, name, source: SAMPLE_TEX.replace('Untitled', name), updated: Date.now() }] }));
  return id;
}
export function patchProject(id: string, p: Partial<Pick<Project, 'name' | 'source'>>) {
  update((s) => ({ ...s, projects: s.projects.map((x) => (x.id === id ? { ...x, ...p, updated: Date.now() } : x)) }));
}
