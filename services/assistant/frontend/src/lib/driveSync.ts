import { useSyncExternalStore } from "react";

export interface DriveResult {
  ok: boolean;
  message: string;
  uploaded?: number;
  downloaded?: number;
  deleted_local?: number;
  deleted_remote?: number;
  conflicts?: number;
  errors?: string[];
  needs_confirm?: boolean;
  pending_deletions?: number;
  busy?: boolean;
  seconds?: number;
}

export interface DriveStatus {
  connected: boolean;
  needs_reconnect: boolean;
  connected_at: string;
  client_id: string;
  has_secret: boolean;
  uses_task_sync_credentials: boolean;
  root_name: string;
  sync_papers_books: boolean;
  auto: boolean;
  interval_minutes: number;
  last_run: string | null;
  last_result: DriveResult | null;
  tracked_files: number;
  running: boolean;
  redirect_uri: string;
}

export interface DriveToast {
  kind: "ok" | "warn" | "error" | "confirm";
  text: string;
  reload?: boolean;
}

interface Snap {
  status: DriveStatus | null;
  running: boolean;
  toast: DriveToast | null;
}

let snap: Snap = { status: null, running: false, toast: null };
const listeners = new Set<() => void>();
let toastTimer: number | null = null;
let pollTimer: number | null = null;

function set(patch: Partial<Snap>) {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}

export async function driveApi<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  const r = await fetch(`/api/drivesync/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || `Request failed (${r.status})`);
  return j as T;
}

export function setDriveStatus(s: DriveStatus) {
  set({ status: s, running: s.running || snap.running });
}

export async function refreshDriveStatus() {
  try {
    const s = await driveApi<DriveStatus>("status");
    set({ status: s, running: s.running });
  } catch {
    /* offline / server restarting: keep the last known state */
  }
}

/** Keep the status fresh (background auto-sync runs on the server too). Returns a stop function. */
export function startDrivePolling(): () => void {
  void refreshDriveStatus();
  if (pollTimer === null) pollTimer = window.setInterval(() => { if (!document.hidden) void refreshDriveStatus(); }, 30000);
  return () => { /* shared timer for the app's lifetime */ };
}

export function dismissDriveToast() {
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = null;
  set({ toast: null });
}

function showToast(t: DriveToast, ms = 7000) {
  if (toastTimer) window.clearTimeout(toastTimer);
  set({ toast: t });
  toastTimer = t.kind === "confirm" || t.kind === "error" ? null : window.setTimeout(dismissDriveToast, t.reload ? 12000 : ms);
}

export async function runDriveSync(force = false) {
  if (snap.running) return;
  set({ running: true, toast: null });
  try {
    const r = await driveApi<{ result: DriveResult } & DriveStatus>("run", "POST", { force });
    const { result, ...status } = r;
    set({ status: status as DriveStatus, running: false });
    const pulled = (result.downloaded || 0) + (result.deleted_local || 0) + (result.conflicts || 0);
    if (result.busy) showToast({ kind: "warn", text: "A sync is already running." });
    else if (result.needs_confirm) showToast({ kind: "confirm", text: result.message });
    else if (!result.ok) showToast({ kind: "error", text: [result.message, ...(result.errors || []).slice(0, 2)].filter(Boolean).join(" — ") });
    else if (pulled > 0) {
      showToast({ kind: "ok", text: result.message, reload: true });
      window.dispatchEvent(new CustomEvent("ygg:vault-synced", { detail: result }));
    } else showToast({ kind: "ok", text: (result.uploaded || 0) + (result.deleted_remote || 0) > 0 ? result.message : "Everything is up to date." });
  } catch (e) {
    set({ running: false });
    showToast({ kind: "error", text: e instanceof Error ? e.message : String(e) });
  }
}

// Lets the nav's Sync button open Settings straight on a given section.
let pendingSection: string | null = null;
export function requestSettingsSection(id: string) {
  pendingSection = id;
  window.dispatchEvent(new CustomEvent("ygg:settings-section", { detail: id }));
}
export function consumePendingSettingsSection(): string | null {
  const p = pendingSection;
  pendingSection = null;
  return p;
}

export function useDriveSync(): Snap {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => snap,
  );
}
