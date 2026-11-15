import { useSyncExternalStore } from "react";

/**
 * How the main navigation is shown (Settings → Appearance → Navigation bar).
 *  fixed    – a docked bar that takes up space (left / right / top / bottom)
 *  floating – a compact dock floating over the page, like the macOS Dock or a Linux panel
 *  hidden   – out of the way; move the mouse to the screen edge (or press Ctrl/Cmd+\) to bring it back
 */
export type NavMode = "fixed" | "floating" | "hidden";
export type NavEdge = "left" | "right" | "top" | "bottom";

export interface NavPrefs {
  mode: NavMode;
  edge: NavEdge;
  /** Floating or fixed bar that slides away until the pointer touches its edge. */
  autoHide: boolean;
  /** What "hidden" goes back to when un-hidden. */
  last: "fixed" | "floating";
}

const KEY = "yggdrasil:nav-prefs";
const DEFAULTS: NavPrefs = { mode: "fixed", edge: "left", autoHide: false, last: "fixed" };

function load(): NavPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (p && typeof p === "object") {
      return {
        mode: ["fixed", "floating", "hidden"].includes(p.mode) ? p.mode : DEFAULTS.mode,
        edge: ["left", "right", "top", "bottom"].includes(p.edge) ? p.edge : DEFAULTS.edge,
        autoHide: !!p.autoHide,
        last: p.last === "floating" ? "floating" : "fixed",
      };
    }
  } catch { /* storage blocked or corrupt */ }
  return DEFAULTS;
}

let cache: NavPrefs = load();
const subs = new Set<() => void>();

export function setNavPrefs(patch: Partial<NavPrefs>) {
  const next = { ...cache, ...patch };
  if (patch.mode && patch.mode !== "hidden") next.last = patch.mode;
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function toggleNavHidden() {
  if (cache.mode === "hidden") setNavPrefs({ mode: cache.last });
  else setNavPrefs({ mode: "hidden", last: cache.mode });
}

export function useNavPrefs(): NavPrefs {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => cache,
  );
}
