import { useCallback, useEffect, useState } from "react";

export interface Addon {
  id: string;
  name: string;
  desc: string;
  size_mb: number;
  installed: boolean;
  version: string;
  state: "idle" | "installing" | "done" | "error" | "cancelled";
  message: string;
  log: string[];
  elapsed: number;
  error: string;
}

async function call(path: string, method = "GET"): Promise<Addon | { addons: Addon[] }> {
  const r = await fetch(`/api/addons${path}`, { method });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { detail?: string }).detail || `Request failed (${r.status})`);
  return j;
}

/** Live state of one optional add-on (see addons.py). Polls while it is installing. */
export function useAddon(id: string, onChange?: (a: Addon) => void) {
  const [addon, setAddon] = useState<Addon | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = (await call("")) as { addons: Addon[] };
      const a = r.addons.find((x) => x.id === id) ?? null;
      setAddon(a);
      return a;
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return null; }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const installing = addon?.state === "installing";
  useEffect(() => {
    if (!installing) return;
    const t = window.setInterval(() => { void load().then((a) => { if (a && a.state !== "installing") onChange?.(a); }); }, 1500);
    return () => window.clearInterval(t);
  }, [installing, load, onChange]);

  const act = async (path: string, method: string) => {
    setErr("");
    try { const a = (await call(`/${id}${path}`, method)) as Addon; setAddon(a); onChange?.(a); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return {
    addon, err,
    install: () => act("/install", "POST"),
    cancel: () => act("/cancel", "POST"),
    remove: () => act("", "DELETE"),
  };
}

function sizeText(mb: number) { return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`; }
function clock(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

/** Download / progress / remove for one add-on. `compact` is the short form used inside a tool. */
export default function AddonCard({ id, compact = false, onChange }: { id: string; compact?: boolean; onChange?: (a: Addon) => void }) {
  const { addon, err, install, cancel, remove } = useAddon(id, onChange);
  if (!addon) return err ? <div className="tl-err">{err}</div> : null;
  const busy = addon.state === "installing";
  const error = err || (addon.state === "error" ? addon.error : "");
  return (
    <div className={`ad-card${compact ? " ad-card--compact" : ""}`}>
      <div className="ad-head">
        <span className="ad-name">{addon.name}</span>
        <span className={`ad-badge${addon.installed ? " ad-badge--on" : ""}`}>{addon.installed ? `Installed${addon.version ? ` · ${addon.version}` : ""}` : `Not installed · ${sizeText(addon.size_mb)}`}</span>
      </div>
      {!compact && <div className="ad-desc">{addon.desc}</div>}
      {busy && (
        <div className="ad-progress">
          <div className="ad-bar"><span /></div>
          <div className="ad-msg">{addon.message || "Working…"} · {clock(addon.elapsed)}</div>
          <div className="ad-hint">Keep the app open. Large downloads can take several minutes.</div>
        </div>
      )}
      {error && <div className="tl-err">{error}</div>}
      <div className="ad-actions">
        {!addon.installed && !busy && <button className="btn" onClick={() => void install()}>{addon.state === "error" ? "Try again" : `Install ${addon.name}`}</button>}
        {busy && <button className="btn" onClick={() => void cancel()}>Cancel</button>}
        {addon.installed && !busy && <button className="btn" onClick={() => { if (window.confirm(`Remove ${addon.name}? You can install it again later.`)) void remove(); }}>Remove</button>}
      </div>
    </div>
  );
}
