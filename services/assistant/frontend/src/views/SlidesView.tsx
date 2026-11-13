import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { ProjectStats } from "../api/client";
import "./slides.css";

type Deck = { name: string; size: number; updated_at: string };
const LAST_KEY = "yggdrasil:slides-last";
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches;

function ls(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function setLs(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

/** PPTist editor (separate static module at /slides, loaded only when a deck is open).
 *  Decks are JSON files in 50-Projects/<slug>/slides. Phones get view + present only. */
export default function SlidesView({ lockedProject }: { lockedProject?: string }) {
  const [projects, setProjects] = useState<ProjectStats[]>([]);
  const [slug, setSlug] = useState<string>(() => lockedProject || ls(`${LAST_KEY}:project`) || "");
  const [decks, setDecks] = useState<Deck[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [err, setErr] = useState("");
  const phone = isPhone();

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
    const onMsg = (e: MessageEvent) => { if (e.data?.source === "yggdrasil-slides" && e.data.type === "saved") refresh(); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [refresh]);

  const create = async () => {
    const name = (window.prompt("Deck name") || "").trim();
    if (!name || !slug) return;
    try {
      await api.projects.saveDeck(slug, name, { title: name, slides: [{ id: `s${Date.now().toString(36)}`, elements: [] }] });
      refresh();
      setOpen(name);
    } catch (e) { setErr(String(e)); }
  };
  const remove = async (name: string) => {
    if (!window.confirm(`Delete deck "${name}"?`)) return;
    try { await api.projects.deleteDeck(slug, name); refresh(); } catch (e) { setErr(String(e)); }
  };

  const src = useMemo(() => {
    if (!open || !slug) return "";
    const q = new URLSearchParams({ project: slug, deck: open });
    if (phone) q.set("mode", "view");
    if (present) q.set("present", "1");
    return `/slides/?${q.toString()}`;
  }, [open, slug, phone, present]);

  if (open && src) {
    return (
      <div className="sl-wrap">
        <div className="sl-bar">
          <button className="btn" onClick={() => { setOpen(null); setPresent(false); refresh(); }}>← Decks</button>
          <span className="sl-title">{open}</span>
          {phone && <span className="sl-hint">View only on phone</span>}
        </div>
        <iframe key={src} className="sl-frame" src={src} title={`Deck ${open}`} allow="fullscreen" />
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
        {!phone && <button className="btn" onClick={create} disabled={!slug}>+ New deck</button>}
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
              {!phone && <button className="btn" onClick={() => remove(d.name)}>Delete</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
