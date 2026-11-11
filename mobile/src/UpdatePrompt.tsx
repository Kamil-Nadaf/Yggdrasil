import { useEffect, useState } from 'react';

const KEY = 'ygg-update-later';

/** On launch: if the server has a newer build than this one, offer Update now / Later. */
export default function UpdatePrompt() {
  const [ver, setVer] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { build: string; version?: string };
        if (!j.build || j.build === __BUILD__) return;
        const later = JSON.parse(localStorage.getItem(KEY) || 'null') as { b: string; at: number } | null;
        if (later && later.b === j.build && Date.now() - later.at < 864e5) return;
        setVer(j.version ? `v${j.version}` : 'a newer version');
        localStorage.setItem('ygg-update-build', j.build);
      } catch { /* offline */ }
    }, 2500);
    return () => clearTimeout(t);
  }, []);
  if (!ver) return null;
  const later = () => { localStorage.setItem(KEY, JSON.stringify({ b: localStorage.getItem('ygg-update-build'), at: Date.now() })); setVer(''); };
  const now = async () => {
    setBusy(true);
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((g) => g.unregister()));
    for (const k of await caches.keys()) if (k !== 'ygg-pdf') await caches.delete(k);
    location.reload();
  };
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label="Update available" style={{ alignItems: 'center' }}>
      <div className="sheet" style={{ borderRadius: 20, maxWidth: 360, margin: '0 16px' }}>
        <b>Update available</b>
        <p className="sm" style={{ margin: '8px 0 14px' }}>Yggdrasil {ver} is ready. Update now to get the latest features and fixes.</p>
        <div className="row gap">
          <button className="btn f1" disabled={busy} onClick={later}>Later</button>
          <button className="btn primary f1" disabled={busy} onClick={now}>{busy ? 'Updating…' : 'Update now'}</button>
        </div>
      </div>
    </div>
  );
}
