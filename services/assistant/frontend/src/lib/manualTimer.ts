import { useSyncExternalStore } from "react";
import { reading, type TimeCategory } from "../api/reading";

/**
 * Manual start/stop timer (Reading goals card). It lives outside React so it keeps running while you
 * move between pages, survives a reload, and adds up on the same day: every stop/restart simply
 * adds more seconds to that day's total for the chosen category.
 */
const KEY = "yggdrasil:manual-timer";
const CAT_KEY = "yggdrasil:manual-timer-cat";
const FLUSH_MS = 60_000;
const STALE_MS = 2 * 60_000; // a timer left running while the app was closed only counts up to its last heartbeat

export interface ManualTimerState {
  running: boolean;
  category: TimeCategory;
  startedAt: number;
  flushedUntil: number;
  beat: number;
}

export function lastCategory(): TimeCategory {
  try {
    const c = localStorage.getItem(CAT_KEY);
    if (c === "books" || c === "papers" || c === "writing") return c;
  } catch { /* ignore */ }
  return "papers";
}

function load(): ManualTimerState {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null") as ManualTimerState | null;
    if (p && p.running && typeof p.startedAt === "number") return p;
  } catch { /* ignore */ }
  return { running: false, category: lastCategory(), startedAt: 0, flushedUntil: 0, beat: 0 };
}

let state: ManualTimerState = load();
const listeners = new Set<() => void>();
const flushedCbs = new Set<() => void>();
let flushing: Promise<void> | null = null;

function commit(next: ManualTimerState) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function getManualTimer(): ManualTimerState { return state; }
export function isManualRunning(category: TimeCategory): boolean { return state.running && state.category === category; }
export function subscribeManualTimer(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function onManualFlushed(cb: () => void) { flushedCbs.add(cb); return () => { flushedCbs.delete(cb); }; }
export function useManualTimer(): ManualTimerState { return useSyncExternalStore(subscribeManualTimer, getManualTimer, getManualTimer); }

/** Send whole seconds from flushedUntil up to `upTo` (ms) to the server. */
async function flushUpTo(upTo: number): Promise<void> {
  if (flushing) await flushing;
  const s = state;
  let seconds = Math.floor((upTo - s.flushedUntil) / 1000);
  if (seconds < 1) return;
  const category = s.category;
  flushing = (async () => {
    while (seconds >= 1) {
      const chunk = Math.min(3600, seconds);
      try {
        await reading.addTime(category, chunk);
      } catch {
        return; // keep flushedUntil: it is retried on the next beat
      }
      seconds -= chunk;
      commit({ ...state, flushedUntil: state.flushedUntil + chunk * 1000 });
    }
    flushedCbs.forEach((cb) => cb());
  })();
  await flushing;
  flushing = null;
}

export function startManualTimer(category: TimeCategory) {
  if (state.running) return;
  try { localStorage.setItem(CAT_KEY, category); } catch { /* ignore */ }
  const now = Date.now();
  commit({ running: true, category, startedAt: now, flushedUntil: now, beat: now });
}

export async function stopManualTimer() {
  if (!state.running) return;
  await flushUpTo(Date.now());
  commit({ ...state, running: false });
  flushedCbs.forEach((cb) => cb());
}

/** Called every few seconds by <ManualTimerRunner/>. */
export function manualTimerBeat() {
  if (!state.running) return;
  const now = Date.now();
  commit({ ...state, beat: now });
  if (now - state.flushedUntil >= FLUSH_MS) void flushUpTo(now);
}

/** On app start: close a timer that was left running while the app was shut. */
export async function restoreManualTimer() {
  if (!state.running) return;
  if (Date.now() - state.beat > STALE_MS) {
    await flushUpTo(state.beat);
    commit({ ...state, running: false });
    flushedCbs.forEach((cb) => cb());
  }
}

/** Best-effort send of the unsent tail when the page is closing. */
export function manualTimerUnloadFlush() {
  if (!state.running) return;
  const seconds = Math.min(3600, Math.floor((Date.now() - state.flushedUntil) / 1000));
  if (seconds < 1) return;
  void fetch("/api/reading/time", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ category: state.category, seconds, date: new Date().toLocaleDateString("sv-SE") }),
  }).catch(() => {});
  commit({ ...state, flushedUntil: state.flushedUntil + seconds * 1000 });
}
