import { useEffect, useRef, useState } from "react";
import { reading, type AnnotationSyncStatus } from "../../api/reading";

/** Two-way sync of annotations (highlights, underlines, notes, text, drawings) between this app and Zotero. Starts on open. */
export default function AnnotationSync({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<AnnotationSyncStatus | null>(null);
  const [err, setErr] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const started = useRef(false);

  const running = !!st && (st.running || !["done", "error", "idle"].includes(st.phase));
  const done = st?.phase === "done";

  function poll() {
    window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      try {
        const s = await reading.annotationSyncStatus();
        setSt(s);
        if (!s.running && (s.phase === "done" || s.phase === "error")) {
          window.clearInterval(timer.current);
          if (s.phase === "error") setErr(s.error);
        }
      } catch { /* keep polling */ }
    }, 900);
  }

  async function start() {
    setErr("");
    try {
      setSt(await reading.syncAnnotations());
      poll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the sync");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
    return () => window.clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !running) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onClose]);

  const changes = st ? st.pulled + st.pushed + st.updated_local + st.updated_remote + st.deleted_local + st.deleted_remote : 0;

  return (
    <div className="bk-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="bk-modal card" role="dialog" aria-modal="true" aria-label="Sync annotations with Zotero">
        <div className="bk-modal-head">
          <h2 style={{ margin: 0 }}>Sync annotations with Zotero</h2>
          <button type="button" className="btn" onClick={onClose} disabled={running} aria-label="Close">✕</button>
        </div>
        <p className="muted" style={{ margin: 0 }}>Highlights, underlines, notes, text and drawings on items linked to Zotero are matched both ways, so what you mark up on your iPad shows up here and the other way round. If both sides changed the same annotation, Zotero’s version wins.</p>
        {st && (
          <div className="zi-progress" role="status">
            <div className="muted">{done ? (changes ? "Done." : "Done — already in sync.") : st.phase === "error" ? "Stopped." : running ? (st.phase === "syncing" ? `Syncing items… ${st.done}/${st.total}` : "Reading your Zotero library…") : ""}</div>
            {st.total > 0 && running && <div className="bk-bar"><span style={{ width: `${Math.round((st.done / st.total) * 100)}%` }} /></div>}
            {(done || st.failed > 0) && (
              <div className="muted" style={{ display: "grid", gap: 2 }}>
                <span>From Zotero: {st.pulled} new · {st.updated_local} updated · {st.deleted_local} removed</span>
                <span>To Zotero: {st.pushed} new · {st.updated_remote} updated · {st.deleted_remote} removed</span>
                {st.needs_open > 0 && <span>{st.needs_open} annotation{st.needs_open === 1 ? "" : "s"} wait for you to open that PDF once (the app needs its page sizes) — then sync again.</span>}
                {st.unsupported > 0 && <span>{st.unsupported} area box{st.unsupported === 1 ? "" : "es"} stay in this app only (Zotero image annotations aren’t supported).</span>}
                {st.unlinked > 0 && <span>{st.unlinked} item{st.unlinked === 1 ? "" : "s"} with annotations aren’t linked to a Zotero item — use “Import from Zotero” or add them to Zotero first.</span>}
                {st.no_pdf > 0 && <span>{st.no_pdf} linked item{st.no_pdf === 1 ? " has" : "s have"} no PDF in Zotero.</span>}
              </div>
            )}
          </div>
        )}
        {(err || st?.error) && <div className="bk-error" role="alert">{err || st?.error}</div>}
        <div className="bk-modal-foot">
          {!running && <button type="button" className="btn" onClick={() => void start()}>Sync again</button>}
          <button type="button" className="btn btn-primary" onClick={onClose} disabled={running}>{done ? "Close" : "Cancel"}</button>
        </div>
      </div>
    </div>
  );
}
