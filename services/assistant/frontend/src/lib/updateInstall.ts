/** In-app update install: starts the background job, follows its progress, then restarts the desktop app. */

export type InstallState = {
  state: "idle" | "downloading" | "installing" | "done" | "error";
  downloaded: number;
  total: number;
  version: string;
  error: string;
  code: number;
};

export class UpdateError extends Error {
  code: number;
  constructor(message: string, code = 0) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const mb = (n: number) => (n / 1048576).toFixed(1);

/** "Downloading 12.3 / 49.8 MB · 25%" / "Installing…" */
export function describeProgress(s: Pick<InstallState, "state" | "downloaded" | "total">): string {
  if (s.state === "installing") return "Installing…";
  if (s.total > 0) return `Downloading ${mb(s.downloaded)} / ${mb(s.total)} MB · ${Math.min(100, Math.round((s.downloaded / s.total) * 100))}%`;
  return s.downloaded > 0 ? `Downloading ${mb(s.downloaded)} MB` : "Starting…";
}

async function detail(r: Response, fallback: string): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { detail?: unknown };
  return typeof j.detail === "string" ? j.detail : fallback;
}

/** Resolves when the update is installed on disk (a restart is still needed); throws UpdateError otherwise. */
export async function runInstall(onProgress: (s: InstallState) => void): Promise<void> {
  const r = await fetch("/api/update/install/start", { method: "POST" });
  if (!r.ok) throw new UpdateError(await detail(r, `Update failed (${r.status})`), r.status);
  let misses = 0;
  for (;;) {
    await sleep(500);
    let s: InstallState;
    try {
      const res = await fetch("/api/update/install/status");
      if (!res.ok) throw new Error(String(res.status));
      s = (await res.json()) as InstallState;
      misses = 0;
    } catch {
      if (++misses > 20) throw new UpdateError("Lost contact with Yggdrasil while updating. Reopen the app and try again.");
      continue;
    }
    onProgress(s);
    if (s.state === "done") return;
    if (s.state === "error") throw new UpdateError(s.error || "Update failed.", s.code);
  }
}

export async function restartDesktopApp(): Promise<void> {
  const r = await fetch("/api/update/restart", { method: "POST" });
  if (!r.ok) throw new UpdateError(await detail(r, "Couldn't restart."), r.status);
}
