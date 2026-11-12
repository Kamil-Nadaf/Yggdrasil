import { useEffect, useState } from 'react';
import { applyReload, checkForUpdate, openExternal, type UpdateCheck } from './update';

const KEY = 'ygg-update-later';

/** On launch: if a newer app (or server build) exists, offer Update now / Later. */
export default function UpdatePrompt() {
  const [up, setUp] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const tag = (u: UpdateCheck) => (u.kind === 'app' ? u.release.version : 'build');
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await checkForUpdate();
        if (r.kind === 'latest') return;
        const later = JSON.parse(localStorage.getItem(KEY) || 'null') as { v: string; at: number } | null;
        if (later && later.v === tag(r) && Date.now() - later.at < 864e5) return;
        setUp(r);
      } catch { /* offline */ }
    }, 2500);
    return () => clearTimeout(t);
  }, []);
  if (!up) return null;
  const later = () => { localStorage.setItem(KEY, JSON.stringify({ v: tag(up), at: Date.now() })); setUp(null); };
  const now = async () => {
    if (up.kind === 'app') { openExternal(up.release.apk || up.release.url); setUp(null); return; }
    setBusy(true); await applyReload();
  };
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label="Update available" style={{ alignItems: 'center' }}>
      <div className="sheet" style={{ borderRadius: 20, maxWidth: 360, margin: '0 16px' }}>
        <b>Update available</b>
        <p className="sm" style={{ margin: '8px 0 14px' }}>
          {up.kind === 'app' ? `Yggdrasil v${up.release.version} is ready (you have v${__APP_VERSION__}). Update now downloads it; open the file to install over this version. Your data stays.` : 'A newer version of Yggdrasil is ready. Update now to get the latest features and fixes.'}
        </p>
        <div className="row gap">
          <button className="btn f1" disabled={busy} onClick={later}>Later</button>
          <button className="btn primary f1" disabled={busy} onClick={now}>{busy ? 'Updating…' : 'Update now'}</button>
        </div>
      </div>
    </div>
  );
}
