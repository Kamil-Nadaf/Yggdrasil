import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type LatexDiagnostic, type LatexVersionMeta } from "../api/client";
import { diffLines, diffStats, toHunks } from "../lib/lineDiff";

export type SideTab = "problems" | "history" | "log";

function fmtTime(ts: number): string {
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return same ? `Today ${t}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${t}`;
}

interface Props {
  tab: SideTab;
  onTab: (t: SideTab) => void;
  onCollapse: () => void;
  diagnostics: LatexDiagnostic[];
  log: string;
  compiling: boolean;
  compiled: boolean;
  mainFile: string;
  onJump: (file: string, line: number | null) => void;
  /** Stem of the file being edited (no .tex). */
  filename: string;
  getSource: () => string;
  onRestore: (source: string) => void;
  /** Bump to reload the history list (after a save). */
  historyTick: number;
}

export default function LatexSidePanel(p: Props) {
  const errs = p.diagnostics.filter((d) => d.kind === "error");
  const warns = p.diagnostics.filter((d) => d.kind === "warning");
  const tsets = p.diagnostics.filter((d) => d.kind === "typesetting");
  return (
    <div className="latex-side">
      <div className="latex-side-tabs">
        <button className={p.tab === "problems" ? "on" : ""} onClick={() => p.onTab("problems")}>
          Problems
          {errs.length > 0 && <span className="badge err">{errs.length}</span>}
          {warns.length > 0 && <span className="badge warn">{warns.length}</span>}
        </button>
        <button className={p.tab === "history" ? "on" : ""} onClick={() => p.onTab("history")}>History</button>
        <button className={p.tab === "log" ? "on" : ""} onClick={() => p.onTab("log")}>Log</button>
        <button className="latex-side-close" title="Collapse sidebar" onClick={p.onCollapse}>✕</button>
      </div>
      <div className="latex-side-body">
        {p.tab === "problems" && (
          <ProblemsList {...p} errs={errs} warns={warns} tsets={tsets} />
        )}
        {p.tab === "history" && <HistoryTab {...p} />}
        {p.tab === "log" && (
          <pre className="latex-side-log">{p.log || (p.compiling ? "Compiling…" : "No compile log yet — press Cmd/Ctrl+S.")}</pre>
        )}
      </div>
    </div>
  );
}

function ProblemsList({
  errs, warns, tsets, compiling, compiled, onJump, mainFile,
}: Props & { errs: LatexDiagnostic[]; warns: LatexDiagnostic[]; tsets: LatexDiagnostic[] }) {
  const [showTs, setShowTs] = useState(false);
  if (compiling) return <div className="latex-side-empty">Compiling…</div>;
  if (!compiled) return <div className="latex-side-empty">Compile (Cmd/Ctrl+S) to see errors and warnings here.</div>;
  if (!errs.length && !warns.length && !tsets.length)
    return <div className="latex-side-empty ok">No problems — compiled cleanly.</div>;
  const item = (d: LatexDiagnostic, i: number) => {
    const file = d.file || mainFile;
    return (
      <button key={`${d.kind}${i}`} className={`latex-diag ${d.kind}`} onClick={() => onJump(file, d.line)}>
        <div className="latex-diag-head">
          <span className="latex-diag-kind">{d.kind === "typesetting" ? "layout" : d.kind}</span>
          <span className="latex-diag-loc">{file}{d.line ? `:${d.line}` : ""}</span>
        </div>
        <div className="latex-diag-msg">{d.message}</div>
        {d.context && <pre className="latex-diag-ctx">{d.context}</pre>}
        {d.hint && <div className="latex-diag-hint">💡 {d.hint}</div>}
      </button>
    );
  };
  return (
    <div className="latex-diag-list">
      {errs.length > 0 && <div className="latex-side-sec">Errors ({errs.length})</div>}
      {errs.map(item)}
      {warns.length > 0 && <div className="latex-side-sec">Warnings ({warns.length})</div>}
      {warns.map(item)}
      {tsets.length > 0 && (
        <>
          <button className="latex-side-sec toggle" onClick={() => setShowTs(!showTs)}>
            {showTs ? "▾" : "▸"} Layout notes ({tsets.length})
          </button>
          {showTs && tsets.map(item)}
        </>
      )}
    </div>
  );
}

function HistoryTab({ filename, getSource, onRestore, historyTick }: Props) {
  const [versions, setVersions] = useState<LatexVersionMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [selSource, setSelSource] = useState<string | null>(null);
  const [prevSource, setPrevSource] = useState<string | null>(null);
  const [against, setAgainst] = useState<"current" | "previous">("current");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const name = filename.trim();

  const load = useCallback(() => {
    if (!name) { setVersions([]); return; }
    api.latex.versions(name)
      .then((r) => setVersions([...(r.versions ?? [])].sort((a, b) => b.ts - a.ts)))
      .catch(() => setVersions([]));
  }, [name]);

  useEffect(() => { load(); }, [load, historyTick]);
  useEffect(() => { setSel(null); setSelSource(null); }, [name]);

  useEffect(() => {
    if (!sel || !name) { setSelSource(null); setPrevSource(null); return; }
    let live = true;
    api.latex.getVersion(sel, name).then((v) => live && setSelSource(v.source)).catch(() => live && setSelSource(null));
    const idx = versions.findIndex((v) => v.id === sel);
    const prev = idx >= 0 ? versions[idx + 1] : undefined;
    if (prev) api.latex.getVersion(prev.id, name).then((v) => live && setPrevSource(v.source)).catch(() => live && setPrevSource(""));
    else setPrevSource("");
    return () => { live = false; };
  }, [sel, name, versions]);

  const hunks = useMemo(() => {
    if (selSource == null) return null;
    const ops =
      against === "current"
        ? diffLines(selSource, getSource())
        : diffLines(prevSource ?? "", selSource);
    return { ops, hunks: toHunks(ops), stats: diffStats(ops) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selSource, prevSource, against, historyTick]);

  async function saveNow() {
    if (!name) return;
    const label = window.prompt("Name this version (optional):", "") ?? null;
    if (label === null) return;
    setBusy(true);
    try {
      await api.latex.saveVersion(name, getSource(), label.trim());
      setMsg("Version saved");
      load();
    } catch { setMsg("Could not save version"); }
    setBusy(false);
  }

  async function restore() {
    if (selSource == null || !name) return;
    if (!window.confirm("Restore this version into the editor? Your current text is saved as a version first.")) return;
    try {
      await api.latex.saveVersion(name, getSource(), "before restore");
    } catch { /* continue */ }
    onRestore(selSource);
    setMsg("Restored — press Cmd/Ctrl+S to save and compile");
    load();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this saved version?")) return;
    try { await api.latex.deleteVersion(id, name); } catch { /* ignore */ }
    if (sel === id) setSel(null);
    load();
  }

  if (!name) return <div className="latex-side-empty">Save the file to start its history.</div>;
  return (
    <div className="latex-hist">
      <div className="latex-hist-bar">
        <button className="btn" disabled={busy} onClick={saveNow}>Save version…</button>
        {msg && <span className="latex-hist-msg">{msg}</span>}
      </div>
      {versions.length === 0 && (
        <div className="latex-side-empty">No versions yet. A snapshot is stored every time you save (Cmd/Ctrl+S) and the text changed.</div>
      )}
      <div className="latex-hist-list">
        {versions.map((v) => (
          <div key={v.id} className={`latex-hist-item ${sel === v.id ? "on" : ""}`}>
            <button className="latex-hist-main" onClick={() => setSel(sel === v.id ? null : v.id)}>
              <span className="latex-hist-time">{fmtTime(v.ts)}</span>
              {v.label && <span className="latex-hist-label">{v.label}</span>}
            </button>
            <button className="latex-hist-del" title="Delete version" onClick={() => remove(v.id)}>🗑</button>
          </div>
        ))}
      </div>
      {sel && hunks && (
        <div className="latex-hist-diff">
          <div className="latex-hist-diffbar">
            <select value={against} onChange={(e) => setAgainst(e.target.value as "current" | "previous")}>
              <option value="current">Changes since this version</option>
              <option value="previous">Changes made in this version</option>
            </select>
            <span className="plus">+{hunks.stats.added}</span>
            <span className="minus">−{hunks.stats.removed}</span>
            <button className="btn btn-primary" onClick={restore}>Restore</button>
          </div>
          {hunks.hunks.length === 0 && <div className="latex-side-empty">No differences.</div>}
          {hunks.hunks.map((h, i) => (
            <pre key={i} className="latex-hunk">
              <div className="latex-hunk-head">@@ line {h.oldStart} @@</div>
              {h.ops.map((o, j) => (
                <div key={j} className={`dl ${o.t === "+" ? "add" : o.t === "-" ? "del" : ""}`}>
                  {o.t === " " ? "  " : o.t + " "}{o.text}
                </div>
              ))}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}
