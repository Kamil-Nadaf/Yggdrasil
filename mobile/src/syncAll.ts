import { isLocal, yg } from './ygg';

export interface DriveState {
  connected: boolean; needs_reconnect: boolean; running: boolean; last_run: string | null;
  last_result: { ok: boolean; message: string } | null;
}
export interface ZoteroState { has_key: boolean; user_id: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs the backend's Google Drive sync when it is set up. Returns a problem message, or '' when fine / not set up. */
export async function syncDrive(): Promise<string> {
  if (isLocal()) return '';
  try {
    const st = await yg<DriveState>('/api/drivesync/status');
    if (!st.connected || st.running) return '';
    const r = await yg<{ result: { ok: boolean; message: string; needs_confirm?: boolean; busy?: boolean } }>('/api/drivesync/run', { method: 'POST', body: {} });
    return r.result.ok || r.result.busy ? '' : `Drive: ${r.result.message}`;
  } catch {
    return ''; // older backend without Drive sync: nothing to do
  }
}

/** Pulls new items/collections from Zotero into the vault (metadata; PDFs are left to the desktop import). */
export async function syncZotero(): Promise<string> {
  if (isLocal()) return '';
  try {
    const z = await yg<ZoteroState>('/api/settings/zotero');
    if (!z.has_key) return '';
    await yg('/api/reading/import-zotero', { method: 'POST', body: { with_pdfs: false } });
    for (let i = 0; i < 60; i++) {
      await sleep(1500);
      const s = await yg<{ running: boolean; phase: string; error?: string }>('/api/reading/import-zotero/status');
      if (!s.running && (s.phase === 'done' || s.phase === 'error')) return s.phase === 'error' ? `Zotero: ${s.error || 'failed'}` : '';
    }
    return ''; // still running on the server; it will finish in the background
  } catch (e) {
    return `Zotero: ${e instanceof Error ? e.message : 'failed'}`;
  }
}

/** Drive first (so the vault is current), then Zotero. Returns the problems, if any. */
export async function syncAll(): Promise<string[]> {
  const out: string[] = [];
  for (const f of [syncDrive, syncZotero]) { const p = await f(); if (p) out.push(p); }
  return out;
}

export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
