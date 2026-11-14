import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { ProjectStats } from "../api/client";
import "./slides.css";

type Deck = { name: string; size: number; updated_at: string };
const LAST_KEY = "yggdrasil:slides-last";
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches;

function ls(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function setLs(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

/** The app's current theme colours, sent to the editor so its chrome matches (and follows theme switches). */
function themeVars(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  const bg = v("--bg", "#f8f8f6");
  const surface = v("--surface", "#ffffff");
  return {
    bg,
    surface,
    surface2: `color-mix(in srgb, ${v("--text", "#141414")} 6%, ${surface})`,
    border: v("--border", "#d9d9d4"),
    text: v("--text", "#141414"),
    muted: v("--muted", "#6b6b6b"),
    accent: v("--text", "#141414"),
    accentText: bg,
  };
}

/** PPTist editor (separate static module at /slides, loaded only when a deck is open).
 *  Decks are JSON files in 50-Projects/<slug>/slides. Phones get view + present only. */
export default function SlidesView({ lockedProject }: { lockedProject?: string }) {
  const [projects, setProjects] = useState<ProjectStats[]>([]);
  const [slug, setSlug] = useState<string>(() => lockedProject || ls(`${LAST_KEY}:project`) || "");
  const [decks, setDecks] = useState<Deck[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [err, setErr] = useState("");
  const [full, setFull] = useState(false);
  // A file picked on the Decks list is handed to the editor once it reports "ready" (replaces the new deck's empty slide).
  const pendingImport = useRef<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importMode = useRef<"new" | "append">("append");
  // Inline forms instead of window.prompt/confirm: desktop webviews silently ignore those.
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const phone = isPhone();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sendTheme = useCallback(() => {
    try { frameRef.current?.contentWindow?.postMessage({ source: "yggdrasil-host", type: "theme", vars: themeVars() }, "*"); } catch { /* ignore */ }
  }, []);
  // Re-send when the app theme changes (theme attribute, class or custom properties on <html>).
  useEffect(() => {
    const mo = new MutationObserver(sendTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => mo.disconnect();
  }, [sendTheme]);

  useEffect(() => {
    if (lockedProject) { setSlug(lockedProject); return; }
    api.projects.list().then((r) => {
      setProjects(r.projects);
      setSlug((cur) => (cur && r.projects.some((p) => p.slug === cur) ? cur : r.projects[0]?.slug ?? ""));
    }).catch((e) => setErr(String(e)));
  }, [lockedProject]);

  const refresh = useCallback(() => {
    if (!slug) { setDecks([]); return; }
    api.projects.decks(slug).then((r) => setDecks(r.decks)).catch((e) => setErr(String(e)));
  }, [slug]);
  useEffect(() => { setOpen(null); refresh(); if (slug && !lockedProject) setLs(`${LAST_KEY}:project`, slug); }, [slug, refresh, lockedProject]);

  // The editor tells us when it has saved so the list stays fresh.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.source !== "yggdrasil-slides") return;
      if (e.data.type === "saved") refresh();
      if (e.data.type === "theme-ready") sendTheme();
      if (e.data.type === "fullscreen") setFull(!!e.data.on);
      if (e.data.type === "ready" && pendingImport.current) {
        const file = pendingImport.current;
        pendingImport.current = null;
        try { frameRef.current?.contentWindow?.postMessage({ source: "yggdrasil-host", type: "import", file, cover: true }, "*"); } catch { /* ignore */ }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [refresh, sendTheme]);

  const create = async () => {
    const name = newName.trim();
    if (!name || !slug) return;
    setNaming(false);
    setNewName("");
    try {
      await api.projects.saveDeck(slug, name, { title: name, slides: [{ id: `s${Date.now().toString(36)}`, elements: [] }] });
      refresh();
      setOpen(name);
    } catch (e) { setErr(String(e)); }
  };
  const pickFile = (mode: "new" | "append") => { importMode.current = mode; fileRef.current?.click(); };
  const onFile = async (f: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    if (importMode.current === "append") {
      try { frameRef.current?.contentWindow?.postMessage({ source: "yggdrasil-host", type: "import", file: f, cover: false }, "*"); } catch (e) { setErr(String(e)); }
      return;
    }
    const base = f.name.replace(/\.(pptx|pptist|json)$/i, "").trim() || "Imported deck";
    let name = base;
    for (let i = 2; decks.some((d) => d.name === name); i++) name = `${base} ${i}`;
    try {
      await api.projects.saveDeck(slug, name, { title: name, slides: [{ id: `s${Date.now().toString(36)}`, elements: [] }] });
      pendingImport.current = f;
      refresh();
      setPresent(false);
      setOpen(name);
    } catch (e) { setErr(String(e)); }
  };
  const duplicate = async (name: string) => {
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(slug)}/slides/${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(`Load failed (${r.status})`);
      const deck = await r.json();
      let copy = `${name} copy`;
      for (let i = 2; decks.some((d) => d.name === copy); i++) copy = `${name} copy ${i}`;
      await api.projects.saveDeck(slug, copy, { ...deck, title: copy });
      refresh();
    } catch (e) { setErr(String(e)); }
  };
  const importInput = (
    <input ref={fileRef} type="file" hidden accept=".pptx,.pptist,.json,application/vnd.openxmlformats-officedocument.presentationml.presentation"
      onChange={(e) => void onFile(e.target.files?.[0])} />
  );
  const remove = async (name: string) => {
    setConfirmDel(null);
    try { await api.projects.deleteDeck(slug, name); refresh(); } catch (e) { setErr(String(e)); }
  };

  const src = useMemo(() => {
    if (!open || !slug) return "";
    const q = new URLSearchParams({ project: slug, deck: open });
    if (phone) q.set("mode", "view");
    if (present) q.set("present", "1");
    return `/slides/?${q.toString()}`;
  }, [open, slug, phone, present]);

  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [full]);

  if (open && src) {
    return (
      <div className={`sl-wrap${full ? " sl-full" : ""}`}>
        <div className="sl-bar">
          <button className="btn" onClick={() => { setOpen(null); setPresent(false); setFull(false); refresh(); }}>← Decks</button>
          <span className="sl-title">{open}</span>
          {phone && <span className="sl-hint">View only on phone</span>}
          {!phone && <button className="btn" onClick={() => pickFile("append")} title="Add slides from a .pptx (PowerPoint / Google Slides download), .pptist or .json file">Import slides…</button>}
          {importInput}
          <button className="btn sl-fs" onClick={() => setFull((v) => !v)} title={full ? "Exit full window (Esc)" : "Full window"}>{full ? "Exit full window" : "Full window"}</button>
        </div>
        <iframe ref={frameRef} key={src} className="sl-frame" src={src} title={`Deck ${open}`} allow="fullscreen" onLoad={sendTheme} />
      </div>
    );
  }

  return (
    <div className="sl-wrap">
      <div className="sl-bar">
        {!lockedProject && (
          <select value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Project">
            {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        )}
        {!phone && !naming && <button className="btn" onClick={() => setNaming(true)} disabled={!slug}>+ New deck</button>}
        {!phone && !naming && <button className="btn" onClick={() => pickFile("new")} disabled={!slug} title="Create a deck from a .pptx (PowerPoint, or Google Slides via File → Download → .pptx), .pptist or .json file">Import deck…</button>}
        {importInput}
        {!phone && naming && (
          <form className="sl-new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Deck name" aria-label="Deck name" />
            <button className="btn" type="submit" disabled={!newName.trim()}>Create</button>
            <button className="btn" type="button" onClick={() => { setNaming(false); setNewName(""); }}>Cancel</button>
          </form>
        )}
        {err && <span className="sl-err">{err}</span>}
      </div>
      {decks.length === 0 ? (
        <div className="sl-empty">{slug ? (phone ? "No decks yet. Create one on desktop." : "No decks yet. Create one with “New deck”.") : "Create a project first."}</div>
      ) : (
        <ul className="sl-list">
          {decks.map((d) => (
            <li key={d.name} className="sl-item">
              <button className="sl-name" onClick={() => { setPresent(false); setOpen(d.name); }}>{d.name}</button>
              <span className="sl-meta">{d.updated_at.replace("T", " ")}</span>
              <button className="btn" onClick={() => { setPresent(true); setOpen(d.name); }}>Present</button>
              {!phone && <button className="btn" onClick={() => void duplicate(d.name)} title="Copy this deck (use it as a template)">Duplicate</button>}
              {!phone && (confirmDel === d.name
                ? <><button className="btn" onClick={() => void remove(d.name)}>Really delete?</button><button className="btn" onClick={() => setConfirmDel(null)}>No</button></>
                : <button className="btn" onClick={() => setConfirmDel(d.name)}>Delete</button>)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
