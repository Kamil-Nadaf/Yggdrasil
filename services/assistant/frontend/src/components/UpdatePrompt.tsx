import { useEffect, useState } from "react";
import { UpdateError, describeProgress, restartDesktopApp, runInstall } from "../lib/updateInstall";

type Info = { latest: string; current: string; available: boolean; can_hot_update: boolean; notes?: string; url?: string; installer?: { url?: string } | null };

const KEY = "yggdrasil:update-later";

/** On launch: if a newer release exists, ask "Update now / Later". Later hides it for that version for a day. */
export default function UpdatePrompt() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prog, setProg] = useState("");

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
    setBusy(true); setErr(""); setProg("Starting…");
    try {
      await runInstall((p) => setProg(describeProgress(p)));
      setProg("Installed — restarting…");
      try { await restartDesktopApp(); }
      catch { setErr("Update installed. Please close and reopen Yggdrasil to start using it."); setBusy(false); setProg(""); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed.");
      setBusy(false); setProg("");
      // a release that needs new bundled libraries can only come from the full installer
      if (e instanceof UpdateError && e.code === 409 && /full installer/i.test(e.message) && info!.installer?.url) {
        window.open(info!.installer.url, "_blank", "noopener");
      }
    }
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
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void now()}>{busy ? (prog || "Updating…") : "Update now"}</button>
        </div>
      </div>
    </div>
  );
}
