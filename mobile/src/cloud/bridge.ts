/**
 * Translates between the phone's own database (local.ts) and the desktop vault's files, so the phone can
 * sync with the same Drive folder as the desktop app: notes, LaTeX, habits, tasks and goals.
 */
import type { LocalDB } from '../local.ts';
import { canonicalJson, parseFm, patchFm, same } from './fm.ts';

export interface VFile { text: string; mtime: number }
export type Files = Record<string, VFile>;
/** Last synced text of every structured file (tasks, habits, settings): the base of the next three-way merge. */
export type Raw = Record<string, string>;

export const NOTES = '60-Meta/Notes/';
export const TEX = '70-LaTeX/';
export const TASKS = '80-Tasks/';
export const DAILY_RE = /^60-Meta\/Daily-(\d{4}-\d{2}-\d{2})\.md$/;
export const TASK_RE = /^80-Tasks\/([^/]+)\/(_project|mt-[^/]+|st-[^/]+)\.md$/;
export const SETTINGS = '_app/settings.json';
export const PINNED = '_daily-habits';

export type Kind = 'note' | 'tex' | 'structured' | 'settings';
/** Which synced paths the phone understands (everything else in the vault is left alone). */
export function kindOf(path: string): Kind | null {
  if (path === SETTINGS) return 'settings';
  if (DAILY_RE.test(path) || TASK_RE.test(path)) return 'structured';
  if (path.startsWith(NOTES) && path.endsWith('.md') && !path.split('/').some((p, i) => i > 0 && p.startsWith('.'))) return 'note';
  if (path.startsWith(TEX) && path.endsWith('.tex')) return 'tex';
  return null;
}

const ms = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const nowIso = () => new Date().toISOString().slice(0, 19);

export function exportFiles(db: LocalDB, raw: Raw): Files {
  const out: Files = {};
  for (const [name, f] of Object.entries(db.notes)) out[NOTES + (name.endsWith('.md') ? name : `${name}.md`)] = { text: f.source, mtime: ms(f.modified) };
  for (const [name, f] of Object.entries(db.tex)) out[TEX + (name.endsWith('.tex') ? name : `${name}.tex`)] = { text: f.source, mtime: ms(f.modified) };

  for (const [day, habits] of Object.entries(db.habits)) {
    const p = `60-Meta/Daily-${day}.md`;
    out[p] = { text: patchFm(raw[p], { date: day, habits }), mtime: 0 };
  }
  for (const pr of db.projects) {
    const dir = `${TASKS}${pr.slug}/`;
    out[`${dir}_project.md`] = { text: patchFm(raw[`${dir}_project.md`], { type: 'project', name: pr.name }, { created_at: nowIso() }), mtime: 0 };
    for (const mt of pr.main) {
      const p = `${dir}${mt.id}.md`;
      out[p] = { text: patchFm(raw[p], { type: 'main_task', name: mt.name, deadline: mt.deadline || null, is_active: mt.is_active }, { status_id: 'todo', created_at: nowIso() }), mtime: 0 };
      for (const st of mt.subtasks) {
        const sp = `${dir}${st.id}.md`;
        out[sp] = {
          text: patchFm(raw[sp], { type: 'subtask', main_task_id: mt.id, name: st.name, deadline: st.deadline || null, status_id: st.status_id, completed_at: st.status_id === 'done' ? st.done_at || nowIso() : null }, { created_at: nowIso() }),
          mtime: 0,
        };
      }
    }
  }
  if (raw[SETTINGS] !== undefined || db.goals.length) {
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(raw[SETTINGS] ?? '{}'); } catch { /* start fresh */ }
    out[SETTINGS] = { text: same(cur.goals ?? [], db.goals) && raw[SETTINGS] !== undefined ? raw[SETTINGS] : canonicalJson({ ...cur, goals: db.goals }), mtime: 0 };
  }
  return out;
}

/** Rebuild the phone's notes, LaTeX, habits, tasks and goals from the final synced file set. */
export function importFiles(db: LocalDB, files: Files): void {
  db.notes = {}; db.tex = {}; db.habits = {};
  const projects = new Map<string, { slug: string; name: string; pinned: boolean; main: Map<string, { id: string; name: string; deadline: string | null; is_active: boolean; created: string; subtasks: { id: string; name: string; deadline: string | null; status_id: string; done_at?: string; created: string }[] }> }>();
  const subs: { slug: string; main: string; sub: { id: string; name: string; deadline: string | null; status_id: string; done_at?: string; created: string } }[] = [];
  const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
  for (const [path, f] of Object.entries(files)) {
    const k = kindOf(path);
    if (k === 'note') db.notes[path.slice(NOTES.length)] = { source: f.text, modified: new Date(f.mtime || Date.now()).toISOString() };
    else if (k === 'tex') db.tex[path.slice(TEX.length)] = { source: f.text, modified: new Date(f.mtime || Date.now()).toISOString() };
    else if (k === 'settings') { try { const g = JSON.parse(f.text).goals; if (Array.isArray(g)) db.goals = g; } catch { /* keep goals */ } }
    else if (k === 'structured') {
      const d = DAILY_RE.exec(path);
      const { meta } = parseFm(f.text);
      if (d) { const h = meta.habits; db.habits[d[1]] = h && typeof h === 'object' ? (h as Record<string, unknown>) : {}; continue; }
      const m = TASK_RE.exec(path)!; const [, slug, file] = m;
      const pr = projects.get(slug) ?? { slug, name: slug, pinned: slug === PINNED, main: new Map() };
      projects.set(slug, pr);
      if (file === '_project') pr.name = str(meta.name) || slug;
      else if (file.startsWith('mt-')) pr.main.set(file, { id: file, name: str(meta.name) || file, deadline: str(meta.deadline), is_active: !!meta.is_active, created: str(meta.created_at) || '', subtasks: [] });
      else subs.push({ slug, main: String(meta.main_task_id || ''), sub: { id: file, name: str(meta.name) || file, deadline: str(meta.deadline), status_id: str(meta.status_id ?? meta.status) || 'todo', done_at: str(meta.completed_at) || undefined, created: str(meta.created_at) || '' } });
    }
  }
  for (const s of subs) projects.get(s.slug)?.main.get(s.main)?.subtasks.push(s.sub);
  const byCreated = <T extends { created: string; name: string }>(a: T, b: T) => a.created.localeCompare(b.created) || a.name.localeCompare(b.name);
  db.projects = [...projects.values()]
    .map((p) => ({
      slug: p.slug, name: p.name, pinned: p.pinned,
      main: [...p.main.values()].sort(byCreated).map((mt) => ({ id: mt.id, name: mt.name, deadline: mt.deadline, is_active: mt.is_active, subtasks: mt.subtasks.sort(byCreated).map(({ created: _c, ...s }) => s) })),
    }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
}
