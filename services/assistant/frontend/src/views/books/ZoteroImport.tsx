import { useEffect, useRef, useState } from "react";
import { reading, type ZoteroImportStatus } from "../../api/reading";

const PHASE: Record<string, string> = { starting: "Connecting to Zotero…", collections: "Reading collections…", notes: "Reading notes and attachments…", items: "Importing items…", pdfs: "Downloading PDFs…" };

/** One-click import of your whole Zotero library (items, tags, notes, collections with sub-collections, optionally PDFs). */
export default function ZoteroImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [withPdfs, setWithPdfs] = useState(true);
  const [st, setSt] = useState<ZoteroImportStatus | null>(null);
  const [err, setErr] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const running = !!st && (st.running || ["starting", "collections", "notes", "items", "pdfs"].includes(st.phase));
  const finished = st?.phase === "done";

  useEffect(() => () => window.clearInterval(timer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !running) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onClose]);

  function poll() {
    window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      try {
        const s = await reading.zoteroStatus();
        setSt(s);
        if (!s.running && (s.phase === "done" || s.phase === "error")) {
          window.clearInterval(timer.current);
          if (s.phase === "error") setErr(s.error);
          onDone();
        }
      } catch { /* keep polling */ }
    }, 1200);
  }

  async function start() {
    setErr("");
    try {
      setSt(await reading.importZotero(withPdfs));
      poll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the import");
    }
  }

  return (
    <div className="bk-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="bk-modal card" role="dialog" aria-modal="true" aria-label="Import from Zotero">
        <div className="bk-modal-head">
          <h2 style={{ margin: 0 }}>Import from Zotero</h2>
          <button type="button" className="btn" onClick={onClose} disabled={running} aria-label="Close">✕</button>
        </div>
        <p className="muted" style={{ margin: 0 }}>Brings in your items, tags, notes and collections (with sub-collections) through your Zotero connection. Running it again only adds what is new.</p>
        <label className="ii-cols" style={{ flexDirection: "row", gap: 8 }}>
          <input type="checkbox" checked={withPdfs} disabled={running || finished} onChange={(e) => setWithPdfs(e.target.checked)} />
          Also download PDFs stored in Zotero (can take a while)
        </label>
        {st && (
          <div className="zi-progress" role="status">
            <div className="muted">{finished ? "Done." : PHASE[st.phase] || st.phase}</div>
            {st.total > 0 && <div className="bk-bar"><span style={{ width: `${Math.round((st.done / st.total) * 100)}%` }} /></div>}
            <div className="muted">{st.added} added · {st.duplicates} already here · {st.collections} collections · {st.pdfs} PDFs</div>
          </div>
        )}
        {err && <div className="bk-error" role="alert">{err}</div>}
        <div className="bk-modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={running}>{finished ? "Close" : "Cancel"}</button>
          {!finished && <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={running}>{running ? "Importing…" : "Start import"}</button>}
        </div>
      </div>
    </div>
  );
}
