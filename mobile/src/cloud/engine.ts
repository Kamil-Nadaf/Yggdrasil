/** Three-way sync of the phone's files with the Drive folder. Same rules as the desktop's drive_sync.py. */
import { kindOf, type Files, type Raw, type VFile } from './bridge.ts';
import { mergeFm, mergeSettings } from './fm.ts';
import { md5Text } from './md5.ts';

export interface RItem { id: string; md5: string; modified: number }
export interface RemoteApi {
  upload(path: string, text: string, fileId?: string): Promise<{ id: string; md5: string }>;
  download(id: string): Promise<string>;
  trash(id: string): Promise<void>;
}
export type Manifest = Record<string, { md5: string; id: string }>;

export interface SyncInput { local: Files; remote: Record<string, RItem>; manifest: Manifest; raw: Raw; force?: boolean }
export interface SyncResult {
  ok: boolean; message: string; uploaded: number; downloaded: number; deleted_local: number; deleted_remote: number;
  conflicts: number; errors: string[]; needsConfirm?: boolean;
  final: Files; manifest: Manifest; raw: Raw;
}

const MIN_DELETE_GUARD = 25;

function conflictName(path: string, device: string): string {
  const i = path.lastIndexOf('.');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
  return `${path.slice(0, i)} (conflict ${device} ${stamp})${path.slice(i)}`;
}

export async function runSync(inp: SyncInput, api: RemoteApi, device = 'phone'): Promise<SyncResult> {
  const local: Files = Object.fromEntries(Object.entries(inp.local).filter(([p]) => kindOf(p)));
  const remote = Object.fromEntries(Object.entries(inp.remote).filter(([p]) => kindOf(p)));
  const manifest = Object.fromEntries(Object.entries(inp.manifest).filter(([p]) => kindOf(p)));
  const res: SyncResult = { ok: false, message: '', uploaded: 0, downloaded: 0, deleted_local: 0, deleted_remote: 0, conflicts: 0, errors: [], final: { ...local }, manifest: {}, raw: { ...inp.raw } };
  const lmd5: Record<string, string> = Object.fromEntries(Object.entries(local).map(([p, f]) => [p, md5Text(f.text)]));

  const ups: [string, string | undefined][] = [];       // path, remote file id to overwrite
  const downs: string[] = [];
  const delLocal: string[] = [], delRemote: [string, string][] = [];
  const conflicts: string[] = [];
  const keep: Manifest = {};
  for (const p of [...new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(manifest)])].sort()) {
    const L = local[p], R = remote[p], B = manifest[p];
    const lm = lmd5[p], rm = R?.md5, bm = B?.md5;
    if (L && R) {
      if (lm === rm) keep[p] = { md5: lm, id: R.id };
      else if (bm === lm) downs.push(p);
      else if (bm === rm) ups.push([p, R.id]);
      else conflicts.push(p);
    } else if (L && !R) { if (B && bm === lm) delLocal.push(p); else ups.push([p, undefined]); }
    else if (R && !L) { if (B && bm === rm) delRemote.push([p, R.id]); else downs.push(p); }
  }

  const nDel = delLocal.length + delRemote.length;
  if (nDel > Math.max(MIN_DELETE_GUARD, Math.floor(0.3 * Object.keys(manifest).length)) && !inp.force) {
    res.needsConfirm = true;
    res.message = `This sync would delete ${nDel} files (${delLocal.length} here, ${delRemote.length} on Drive). If that's expected, run it again and confirm.`;
    res.manifest = inp.manifest;
    return res;
  }

  const newManifest: Manifest = { ...keep };
  const done = (p: string, md5: string, id: string) => { newManifest[p] = { md5, id }; };
  const fail = (p: string, what: string, e: unknown) => {
    res.errors.push(`${what} ${p}: ${e instanceof Error ? e.message : String(e)}`);
    if (manifest[p]) newManifest[p] = manifest[p];
  };

  const download = async (p: string): Promise<string> => {
    const text = await api.download(remote[p].id);
    if (md5Text(text) !== remote[p].md5) throw new Error('checksum mismatch');
    return text;
  };

  for (const p of conflicts) {
    try {
      const kind = kindOf(p);
      const rText = await download(p);
      if (kind === 'structured' || kind === 'settings') {
        const merged = kind === 'settings' ? mergeSettings(inp.raw[p], local[p].text, rText) : mergeFm(inp.raw[p], local[p].text, rText);
        res.final[p] = { text: merged, mtime: remote[p].modified };
        lmd5[p] = md5Text(merged);
        if (lmd5[p] === remote[p].md5) done(p, lmd5[p], remote[p].id); else ups.push([p, remote[p].id]);
      } else {
        const cp = conflictName(p, device);
        if (remote[p].modified > local[p].mtime) {
          res.final[cp] = local[p]; lmd5[cp] = lmd5[p];
          res.final[p] = { text: rText, mtime: remote[p].modified }; lmd5[p] = remote[p].md5;
          done(p, remote[p].md5, remote[p].id);
        } else {
          res.final[cp] = { text: rText, mtime: remote[p].modified }; lmd5[cp] = remote[p].md5;
          ups.push([p, remote[p].id]);
        }
        ups.push([cp, undefined]);
      }
      res.conflicts++;
    } catch (e) { fail(p, 'conflict', e); }
  }

  for (const p of downs) {
    try {
      const text = await download(p);
      res.final[p] = { text, mtime: remote[p].modified } as VFile;
      done(p, remote[p].md5, remote[p].id);
      res.downloaded++;
    } catch (e) { fail(p, 'download', e); }
  }
  for (const [p, id] of ups) {
    try {
      const j = await api.upload(p, res.final[p].text, id);
      done(p, md5Text(res.final[p].text), j.id);
      res.uploaded++;
    } catch (e) { fail(p, 'upload', e); }
  }
  for (const p of delLocal) { delete res.final[p]; res.deleted_local++; }
  for (const [p, id] of delRemote) {
    try { await api.trash(id); res.deleted_remote++; } catch (e) { fail(p, 'delete', e); if (manifest[p]) res.final[p] = res.final[p] ?? local[p]; }
  }

  res.manifest = newManifest;
  res.raw = {};
  for (const [p, f] of Object.entries(res.final)) { const k = kindOf(p); if (k === 'structured' || k === 'settings') res.raw[p] = f.text; }
  res.ok = res.errors.length === 0;
  const parts = [`${res.uploaded} uploaded`, `${res.downloaded} downloaded`];
  if (res.deleted_local + res.deleted_remote) parts.push(`${res.deleted_local + res.deleted_remote} deleted`);
  if (res.conflicts) parts.push(`${res.conflicts} conflict${res.conflicts === 1 ? '' : 's'} resolved`);
  if (res.errors.length) parts.push(`${res.errors.length} failed`);
  res.message = (res.ok ? 'Synced ✓ — ' : 'Synced with problems — ') + parts.join(', ');
  return res;
}
