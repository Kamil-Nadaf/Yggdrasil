/**
 * Mirrors client-side settings (theme, AI provider config incl. API keys, fonts, …)
 * to the backend, and rehydrates localStorage from it on boot.
 *
 * The desktop app's WKWebView storage is not reliably persisted across relaunches
 * (per-launch browser storage identity is not guaranteed stable there), so the
 * backend-persisted copy is the durable source of truth.
 */
import { api } from "../api/client";

const PERSISTED_KEYS = [
  "theme",
  "yggdrasil:page-themes",
  "yggdrasil:theme-mode",
  "yggdrasil:tactile-accent",
  "yggdrasil:theme-accents",
  "yggdrasil:custom-theme",
  "yggdrasil:app-fonts",
  "yggdrasil:ai-providers",
  "yggdrasil:ai-active-provider",
  "yggdrasil:mcp-connections",
  "yggdrasil:loki-brand",
];

let lastPushed = "";

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PERSISTED_KEYS) {
    const v = localStorage.getItem(key);
    if (v != null) out[key] = v;
  }
  return out;
}

export async function hydrateSettingsFromBackend(): Promise<void> {
  try {
    const { prefs } = await api.clientPrefs.get();
    for (const [key, value] of Object.entries(prefs || {})) {
      if (localStorage.getItem(key) == null) {
        localStorage.setItem(key, value);
      }
    }
  } catch {
    // Offline or first run — fall back to whatever localStorage already has.
  }
  lastPushed = JSON.stringify(snapshot());
}

function pushSettingsToBackend(): void {
  const current = snapshot();
  const serialized = JSON.stringify(current);
  if (serialized === lastPushed) return;
  lastPushed = serialized;
  api.clientPrefs.save(current).catch(() => {
    // best-effort; will retry on the next flush tick
    lastPushed = "";
  });
}

/** Force an immediate push — call right after a settings save action. */
export function flushSettingsNow(): void {
  pushSettingsToBackend();
}

export function startSettingsSync(): () => void {
  const interval = window.setInterval(pushSettingsToBackend, 3000);
  const flush = () => pushSettingsToBackend();
  window.addEventListener("beforeunload", flush);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("beforeunload", flush);
    window.removeEventListener("pagehide", flush);
  };
}
