/** Phone-only Google Drive sync: state, sign-in and the sync run itself. */
import { getDB, setDB } from '../local.ts';
import { exportFiles, importFiles, type Files } from './bridge.ts';
import { refreshAccessToken, type Client } from './auth.ts';
import { AuthError, DriveClient, findRoot, listAll, makeFetcher, scanRemote } from './drive.ts';
import { runSync, type Manifest, type SyncResult } from './engine.ts';
import type { Raw } from './bridge.ts';

export interface CloudState {
  clientId: string; clientSecret: string; rootName: string; refresh: string; rootId: string;
  manifest: Manifest; raw: Raw; lastRun: string; lastMessage: string; lastOk: boolean; initialDone: boolean; auto: boolean; intervalMin: number;
}
const KEY = 'ygg.cloud.v1';
const empty = (): CloudState => ({ clientId: '', clientSecret: '', rootName: 'Yggdrasil Vault', refresh: '', rootId: '', manifest: {}, raw: {}, lastRun: '', lastMessage: '', lastOk: true, initialDone: false, auto: false, intervalMin: 15 });

let st: CloudState | null = null;
export function getCloud(): CloudState {
  if (!st) { try { st = { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { st = empty(); } }
  return st!;
}
export function setCloud(patch: Partial<CloudState>): CloudState {
  st = { ...getCloud(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage full: keep in memory */ }
  window.dispatchEvent(new Event('ygg-cloud'));
  return st;
}
export const isCloudConnected = () => !!getCloud().refresh;

let tokenCache = { value: '', until: 0 };
async function accessToken(): Promise<string> {
  if (tokenCache.until > Date.now() + 30_000) return tokenCache.value;
  const s = getCloud();
  const c: Client = { id: s.clientId, secret: s.clientSecret };
  const t = await refreshAccessToken(c, s.refresh);
  tokenCache = { value: t.access_token, until: Date.now() + t.expires_in * 1000 };
  return tokenCache.value;
}

export type CloudRun = Partial<SyncResult> & { ok: boolean; message: string; needsRoot?: boolean; busy?: boolean; firstSync?: boolean };
let running = false;
export const cloudRunning = () => running;

export async function cloudSync(opts: { force?: boolean; createRoot?: boolean } = {}): Promise<CloudRun> {
  if (running) return { ok: false, busy: true, message: 'A sync is already running' };
  const s0 = getCloud();
  if (!s0.refresh) return { ok: false, message: 'Google Drive is not connected' };
  running = true;
  try {
    const f = makeFetcher(accessToken);
    const items = await listAll(f);
    let rootId = s0.rootId && items.some((i) => i.id === s0.rootId) ? s0.rootId : findRoot(items, s0.rootName);
    if (!rootId) {
      if (!opts.createRoot) return { ok: false, needsRoot: true, message: `No “${s0.rootName}” folder was found in this Google account's Drive for this app.` };
      rootId = await DriveClient.createRoot(f, s0.rootName);
      items.push({ id: rootId, name: s0.rootName, mimeType: 'application/vnd.google-apps.folder' });
    }
    const manifest = rootId === s0.rootId ? s0.manifest : {};
    const { files, folders } = scanRemote(items, rootId);
    const before: Files = exportFiles(getDB(), s0.raw);
    const res = await runSync({ local: before, remote: files, manifest, raw: s0.raw, force: opts.force }, new DriveClient(f, rootId, folders));
    if (res.needsConfirm) return { ...res, ok: false };

    // Edits made on the phone while the sync was running stay on top of the synced result (uploaded next time).
    const after = exportFiles(getDB(), s0.raw);
    for (const p of Object.keys(after)) if (after[p].text !== before[p]?.text) res.final[p] = after[p];
    for (const p of Object.keys(before)) if (!(p in after)) delete res.final[p];
    const db = getDB();
    importFiles(db, res.final);
    setDB(db);

    const first = res.ok && !s0.initialDone;
    setCloud({
      rootId, manifest: res.manifest, raw: res.raw, lastRun: new Date().toISOString(), lastOk: res.ok, initialDone: s0.initialDone || res.ok,
      auto: first && !s0.lastRun ? true : s0.auto,
      lastMessage: first && !s0.lastRun ? `First sync done ✓ — ${res.uploaded} files uploaded. Automatic sync is now on.` : res.message,
    });
    window.dispatchEvent(new Event('ygg-sync'));
    return { ...res, firstSync: first && !s0.lastRun, message: getCloud().lastMessage };
  } catch (e) {
    const msg = e instanceof AuthError ? `${e.message}. Sign in again in Settings → Sync.` : e instanceof Error ? e.message : String(e);
    setCloud({ lastRun: new Date().toISOString(), lastOk: false, lastMessage: msg, ...(e instanceof AuthError && /sign in again/i.test(e.message) ? { refresh: '' } : {}) });
    tokenCache = { value: '', until: 0 };
    return { ok: false, message: msg };
  } finally { running = false; }
}

export function cloudDisconnect() { tokenCache = { value: '', until: 0 }; setCloud({ refresh: '', rootId: '', manifest: {}, raw: {}, auto: false }); }
export function cloudDue(): boolean {
  const s = getCloud();
  return !!(s.refresh && s.auto && (!s.lastRun || Date.now() - Date.parse(s.lastRun) >= s.intervalMin * 60_000));
}
