/** Google Drive v3 client for the phone (drive.file scope): list, upload, download, trash. */
import { kindOf } from './bridge.ts';
import type { RemoteApi, RItem } from './engine.ts';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

export class DriveError extends Error {}
export class AuthError extends Error {}

export interface DItem { id: string; name: string; mimeType: string; parents?: string[]; md5Checksum?: string; modifiedTime?: string; createdTime?: string }

async function check(r: Response, what: string): Promise<void> {
  if (r.ok) return;
  if (r.status === 401) throw new AuthError('Google sign-in expired');
  let reason = '';
  try { const j = await r.clone().json(); reason = j?.error?.errors?.[0]?.reason || j?.error?.message || ''; } catch { /* not JSON */ }
  if (reason === 'storageQuotaExceeded') throw new DriveError('Google Drive is full');
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') throw new DriveError('Turn on the Google Drive API for your Google Cloud project');
  throw new DriveError(`${what}: HTTP ${r.status} ${reason}`.trim());
}

export function makeFetcher(token: () => Promise<string>, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
  return async (url: string, what: string, init: RequestInit = {}): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${await token()}` } });
      if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise((ok) => setTimeout(ok, Math.min(2 ** attempt, 8) * 1000)); continue; }
      await check(r, what);
      return r;
    }
  };
}

export async function listAll(f: ReturnType<typeof makeFetcher>): Promise<DItem[]> {
  const out: DItem[] = []; let page = '';
  for (;;) {
    const q = new URLSearchParams({ q: 'trashed=false', pageSize: '1000', spaces: 'drive', fields: 'nextPageToken,files(id,name,mimeType,parents,md5Checksum,modifiedTime,createdTime)' });
    if (page) q.set('pageToken', page);
    const j = await (await f(`${API}/files?${q}`, 'list files')).json();
    out.push(...(j.files || []));
    page = j.nextPageToken || '';
    if (!page) return out;
  }
}

const safeName = (n: string) => !!n && n !== '.' && n !== '..' && !/[/\\\0]/.test(n);

/** Paths of files and folders below the root, as the desktop sees them. */
export function scanRemote(items: DItem[], rootId: string): { files: Record<string, RItem>; folders: Record<string, string> } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const cache = new Map<string, string | null>();
  const pathOf = (id: string, seen = new Set<string>()): string | null => {
    if (id === rootId) return '';
    if (cache.has(id)) return cache.get(id)!;
    const it = byId.get(id);
    let out: string | null = null;
    if (it && !seen.has(id) && safeName(it.name) && it.parents?.[0]) {
      seen.add(id);
      const parent = pathOf(it.parents[0], seen);
      if (parent !== null) out = parent ? `${parent}/${it.name}` : it.name;
    }
    cache.set(id, out);
    return out;
  };
  const files: Record<string, RItem> = {}; const folders: Record<string, string> = {};
  for (const i of items) {
    if (i.id === rootId) continue;
    const p = pathOf(i.id);
    if (p === null) continue;
    if (i.mimeType === FOLDER) { folders[p] = i.id; continue; }
    if (i.mimeType.startsWith('application/vnd.google-apps') || !i.md5Checksum) continue;
    const modified = Date.parse(i.modifiedTime || '') || 0;
    const old = files[p];
    if (old && old.modified >= modified) continue;  // duplicate name: keep the newest
    files[p] = { id: i.id, md5: i.md5Checksum, modified };
  }
  return { files, folders };
}

export function findRoot(items: DItem[], name: string): string | null {
  const ids = new Set(items.map((i) => i.id));
  const c = items.filter((i) => i.mimeType === FOLDER && i.name === name && !(i.parents?.[0] && ids.has(i.parents[0])));
  c.sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''));
  return c[0]?.id ?? null;
}

export class DriveClient implements RemoteApi {
  folders: Record<string, string>;
  f: ReturnType<typeof makeFetcher>;
  rootId: string;
  constructor(f: ReturnType<typeof makeFetcher>, rootId: string, folders: Record<string, string> = {}) { this.f = f; this.rootId = rootId; this.folders = { ...folders }; }

  static async createRoot(f: ReturnType<typeof makeFetcher>, name: string): Promise<string> {
    const r = await f(`${API}/files?fields=id`, 'create folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER }) });
    return (await r.json()).id;
  }

  private async ensureFolder(parts: string[]): Promise<string> {
    let parent = this.rootId, built = '';
    for (const part of parts) {
      built = built ? `${built}/${part}` : part;
      if (!this.folders[built]) {
        const r = await this.f(`${API}/files?fields=id`, `create folder ${part}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: part, mimeType: FOLDER, parents: [parent] }) });
        this.folders[built] = (await r.json()).id;
      }
      parent = this.folders[built];
    }
    return parent;
  }

  async upload(path: string, text: string, fileId?: string): Promise<{ id: string; md5: string }> {
    const parts = path.split('/'); const name = parts.pop()!;
    const meta = fileId ? {} : { name, parents: [await this.ensureFolder(parts)] };
    const boundary = `ygg${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${text}\r\n--${boundary}--`;
    const url = `${UPLOAD}/files${fileId ? `/${fileId}` : ''}?uploadType=multipart&fields=id,md5Checksum`;
    const r = await this.f(url, `upload ${name}`, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    const j = await r.json();
    return { id: j.id, md5: j.md5Checksum };
  }

  async download(id: string): Promise<string> { return (await this.f(`${API}/files/${id}?alt=media`, 'download')).text(); }
  async trash(id: string): Promise<void> { await this.f(`${API}/files/${id}`, 'move to bin', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); }
}

export const interesting = (path: string) => kindOf(path) !== null;
