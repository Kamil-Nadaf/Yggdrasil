import { useEffect } from "react";
import { manualTimerBeat, manualTimerUnloadFlush, restoreManualTimer } from "../lib/manualTimer";

/** Always mounted (in App) so the manual timer keeps counting on every page. */
export default function ManualTimerRunner() {
  useEffect(() => {
    void restoreManualTimer();
    const t = window.setInterval(manualTimerBeat, 5000);
    window.addEventListener("pagehide", manualTimerUnloadFlush);
    return () => { window.clearInterval(t); window.removeEventListener("pagehide", manualTimerUnloadFlush); };
  }, []);
  return null;
}
