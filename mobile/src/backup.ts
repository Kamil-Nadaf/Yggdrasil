import { getDB, setDB, type LocalDB } from './local';

const FORMAT = 'yggdrasil-phone-backup';
export const backupName = () => `yggdrasil-phone-${new Date().toISOString().slice(0, 10)}.json`;
export const makeBackup = () => JSON.stringify({ format: FORMAT, version: 1, exported: new Date().toISOString(), db: getDB() });

/** Offer the backup through the system share sheet (Drive, Files, mail…), or download it when sharing is unavailable. */
export async function exportBackup(): Promise<string> {
  const file = new File([makeBackup()], backupName(), { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: object) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: 'Yggdrasil backup' }); return 'Shared'; } catch (e) { if ((e as Error).name === 'AbortError') return 'Cancelled'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  return 'Saved to your downloads';
}

const newer = (a?: { modified: string }, b?: { modified: string }) => !a || (b !== undefined && b.modified > a.modified);

/** Merge a backup into this phone: newer file wins, collections/items/habits/projects are combined, nothing is deleted. */
export function mergeBackup(text: string): string {
  const j = JSON.parse(text) as { format?: string; db?: LocalDB };
  if (j.format !== FORMAT || !j.db) throw new Error('That is not a Yggdrasil phone backup');
  const cur = getDB(); const inc = j.db; let changed = 0;
  for (const k of ['notes', 'tex'] as const) for (const [n, f] of Object.entries(inc[k] || {})) if (newer(cur[k][n], f)) { cur[k][n] = f; changed++; }
  for (const [s, it] of Object.entries(inc.items || {})) if (!cur.items[s]) { cur.items[s] = it; changed++; }
  for (const c of inc.cols || []) {
    const mine = cur.cols.find((x) => x.id === c.id);
    if (!mine) { cur.cols.push(c); changed++; } else { for (const s of c.slugs) if (!mine.slugs.includes(s)) { mine.slugs.push(s); changed++; } }
  }
  for (const [day, h] of Object.entries(inc.habits || {})) cur.habits[day] = { ...h, ...(cur.habits[day] || {}) };
  for (const [day, l] of Object.entries(inc.log || {})) { const c = cur.log[day]; cur.log[day] = c ? { papers: Math.max(c.papers, l.papers), books: Math.max(c.books, l.books), writing: Math.max(c.writing, l.writing) } : l; }
  for (const g of inc.goals || []) if (!cur.goals.some((x) => x.id === g.id)) { cur.goals.push(g); changed++; }
  for (const pr of inc.projects || []) {
    const mine = cur.projects.find((x) => x.slug === pr.slug);
    if (!mine) { cur.projects.push(pr); changed++; continue; }
    for (const mt of pr.main) {
      const mm = mine.main.find((x) => x.id === mt.id);
      if (!mm) { mine.main.push(mt); changed++; continue; }
      for (const st of mt.subtasks) { const ms = mm.subtasks.find((x) => x.id === st.id); if (!ms) { mm.subtasks.push(st); changed++; } else if (st.status_id === 'done' && ms.status_id !== 'done') { Object.assign(ms, st); changed++; } }
    }
  }
  setDB(cur);
  return `Merged ${changed} change${changed === 1 ? '' : 's'}`;
}
