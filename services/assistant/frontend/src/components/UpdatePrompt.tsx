import { useEffect, useState } from "react";

type Info = { latest: string; current: string; available: boolean; can_hot_update: boolean; notes?: string; url?: string; installer?: { url?: string } | null };

const KEY = "yggdrasil:update-later";

/** On launch: if a newer release exists, ask "Update now / Later". Later hides it for that version for a day. */
export default function UpdatePrompt() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/update/check");
        if (!r.ok) return;
        const j = (await r.json()) as Info;
        if (!j.available) return;
        const later = JSON.parse(localStorage.getItem(KEY) || "null") as { v: string; at: number } | null;
        if (later && later.v === j.latest && Date.now() - later.at < 864e5) return;
        setInfo(j);
      } catch { /* offline: stay quiet */ }
    }, 3500);
    return () => window.clearTimeout(t);
  }, []);

  if (!info) return null;
  const later = () => { localStorage.setItem(KEY, JSON.stringify({ v: info.latest, at: Date.now() })); setInfo(null); };

  async function now() {
    if (!info!.can_hot_update) {
      window.open(info!.installer?.url || info!.url || "https://github.com/Kamil-Nadaf/Yggdrasil/releases/latest", "_blank", "noopener");
      return;
    }
    setBusy(true); setErr("");
    try {
      const i = await fetch("/api/update/install", { method: "POST" });
      if (!i.ok) throw new Error(((await i.json().catch(() => ({}))) as { detail?: string }).detail || `Update failed (${i.status})`);
      await fetch("/api/update/restart", { method: "POST" }).catch(() => {});
    } catch (e) { setErr(e instanceof Error ? e.message : "Update failed."); setBusy(false); }
  }

  return (
    <div className="update-prompt-wrap" role="dialog" aria-modal="true" aria-label="Update available">
      <div className="update-prompt">
        <h3>Update available</h3>
        <p>Yggdrasil <b>v{info.latest}</b> is ready (you have v{info.current}).</p>
        {info.notes && <pre className="update-prompt-notes">{info.notes.slice(0, 400)}</pre>}
        {!info.can_hot_update && <p className="muted">This update needs the full installer — “Update now” opens the download.</p>}
        {err && <p className="crit">{err}</p>}
        <div className="update-prompt-actions">
          <button type="button" className="btn" disabled={busy} onClick={later}>Later</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void now()}>{busy ? "Updating…" : "Update now"}</button>
        </div>
      </div>
    </div>
  );
}
