import { useEffect, useState } from "react";

type Usage = { used?: number; total?: number; free?: number; items?: number | null; error?: string };

function fmt(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function Bar({ name, u, note }: { name: string; u: Usage | null; note?: string }) {
  const ok = !!u && u.used !== undefined && !u.error;
  const pct = ok && u!.total ? Math.min(100, Math.round(((u!.used || 0) / u!.total!) * 100)) : 0;
  return (
    <div className="storage-bar">
      <div className="storage-bar-head"><strong>{name}</strong><span className="muted">{u === null ? "checking…" : ok ? (u!.total ? `${fmt(u!.free || 0)} free of ${fmt(u!.total)}` : "unlimited") : "not connected"}</span></div>
      <div className="storage-bar-track"><div className="storage-bar-fill" style={{ width: `${pct}%` }} /></div>
      <div className="storage-bar-foot muted">{ok ? `${fmt(u!.used || 0)} used${note ? ` · ${note}` : ""}` : (u === null ? "" : u.error || "Connect to see storage")}</div>
    </div>
  );
}

/** Used / free storage for Google Drive and Zotero, shown at the top of Settings → Sync. */
export default function StorageBars() {
  const [drive, setDrive] = useState<Usage | null>(null);
  const [zotero, setZotero] = useState<Usage | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/drivesync/storage").then((r) => r.json()).then((j) => live && setDrive(j)).catch(() => live && setDrive({}));
    fetch("/api/zotero/storage").then((r) => r.json()).then((j) => live && setZotero(j)).catch(() => live && setZotero({}));
    return () => { live = false; };
  }, []);
  return (
    <div className="storage-bars">
      <Bar name="Google Drive" u={drive} note="your whole Google account" />
      <Bar name="Zotero" u={zotero} note={zotero?.items != null ? `${zotero.items} items · files on this device` : "files on this device"} />
    </div>
  );
}
