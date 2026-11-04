import { useEffect } from "react";
import { reading, type TimeCategory } from "../api/reading";
import { isManualRunning } from "../lib/manualTimer";

const IDLE_LIMIT_MS = 3 * 60 * 1000; // stop counting after 3 minutes without input
const FLUSH_EVERY_S = 60;

/**
 * Invisible timer: while it is mounted it counts *active* time (tab visible, window focused, input in the
 * last 3 minutes) and reports it to the dashboard statistics under `category` every minute.
 * Mount it where the work happens: an open paper PDF -> "papers", the LaTeX editor -> "writing".
 */
export default function ActivityTimer({ category }: { category: TimeCategory }) {
  useEffect(() => {
    let pending = 0;
    let flushing = false;
    let lastInput = Date.now();
    const touch = () => { lastInput = Date.now(); };
    const evts: (keyof WindowEventMap)[] = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"];
    evts.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));

    async function flush() {
      if (flushing || pending < 1) return;
      const seconds = Math.min(3600, Math.floor(pending));
      flushing = true;
      pending -= seconds;
      try {
        await reading.addTime(category, seconds);
      } catch {
        pending += seconds; // try again next tick
      } finally {
        flushing = false;
      }
    }

    const tick = window.setInterval(() => {
      const active = document.visibilityState === "visible" && document.hasFocus() && Date.now() - lastInput < IDLE_LIMIT_MS;
      if (!active || isManualRunning(category)) return; // the manual timer is already counting this category
      pending += 1;
      if (pending >= FLUSH_EVERY_S) void flush();
    }, 1000);
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      window.clearInterval(tick);
      evts.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      document.removeEventListener("visibilitychange", onHide);
      if (pending >= 1) {
        void fetch("/api/reading/time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ category, seconds: Math.min(3600, Math.floor(pending)), date: new Date().toLocaleDateString("sv-SE") }),
        }).catch(() => {});
      }
    };
  }, [category]);

  return null;
}
