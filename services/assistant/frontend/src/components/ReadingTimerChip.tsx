import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { formatClock, reading } from "../api/reading";
import { isManualRunning } from "../lib/manualTimer";

const IDLE_LIMIT_MS = 3 * 60 * 1000; // stop counting after 3 minutes without input
const FLUSH_EVERY_S = 60;

/**
 * Counts *active* reading time while a book is open (tab visible, window focused, recent input)
 * and reports it to the server every minute. Owns its own state so the reader never re-renders.
 */
export default function ReadingTimerChip({ slug, pageRef }: { slug: string; pageRef: MutableRefObject<number | undefined> }) {
  const [baseToday, setBaseToday] = useState(0);
  const [goalMinutes, setGoalMinutes] = useState(30);
  const [session, setSession] = useState(0);
  const pending = useRef(0);
  const sessionRef = useRef(0);
  const lastInput = useRef(Date.now());
  const flushing = useRef(false);

  useEffect(() => {
    let dead = false;
    reading.goal()
      .then((g) => { if (!dead) { setBaseToday(g.today_seconds); setGoalMinutes(g.goal_minutes); } })
      .catch(() => {});
    return () => { dead = true; };
  }, [slug]);

  useEffect(() => {
    const touch = () => { lastInput.current = Date.now(); };
    const evts: (keyof WindowEventMap)[] = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"];
    evts.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));

    async function flush() {
      if (flushing.current || pending.current < 1) return;
      const seconds = Math.min(3600, Math.floor(pending.current));
      flushing.current = true;
      pending.current -= seconds;
      try {
        await reading.session(slug, seconds, pageRef.current);
      } catch {
        pending.current += seconds; // try again next tick
      } finally {
        flushing.current = false;
      }
    }

    const tick = window.setInterval(() => {
      const active = document.visibilityState === "visible" && document.hasFocus() && Date.now() - lastInput.current < IDLE_LIMIT_MS;
      if (!active || isManualRunning("books")) return; // the manual timer is already counting books
      pending.current += 1;
      sessionRef.current += 1;
      setSession(sessionRef.current);
      if (pending.current >= FLUSH_EVERY_S) void flush();
    }, 1000);

    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      window.clearInterval(tick);
      evts.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      document.removeEventListener("visibilitychange", onHide);
      // best effort on close: send whatever is left
      if (pending.current >= 1) {
        void fetch("/api/reading/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ slug, seconds: Math.min(3600, Math.floor(pending.current)), page: pageRef.current, date: new Date().toLocaleDateString("sv-SE") }),
        }).catch(() => {});
        pending.current = 0;
      }
    };
  }, [slug, pageRef]);

  const total = baseToday + session;
  const goalS = goalMinutes * 60;
  const met = total >= goalS;
  return (
    <span className={`rd-timer${met ? " met" : ""}`} title="Active reading time today. Counts while this tab is focused and you are interacting.">
      <span className="rd-timer-dot" aria-hidden="true" />
      <span className="mono">{formatClock(total)}</span>
      <span className="muted">/ {goalMinutes} min</span>
      {met && <span className="rd-timer-ok">goal reached ✓</span>}
    </span>
  );
}
