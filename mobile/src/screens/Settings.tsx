import { useState } from 'react';
import { isLocal, useY, yg } from '../ygg';
import { ago, syncAll, type DriveState, type ZoteroState } from '../syncAll';
import { useStore, update, type ThemeName } from '../store';
import { ACCENTS, THEMES } from '../theme';
import { Icon, Screen, Top } from '../ui';

async function checkUpdate(): Promise<string> {
  const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not reach the app server');
  const { build } = (await r.json()) as { build: string };
  if (build === __BUILD__) return 'You have the latest version.';
  const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
  await Promise.all(regs.map((g) => g.unregister()));
  for (const k of await caches.keys()) if (k !== 'ygg-pdf') await caches.delete(k);
  location.reload();
  return 'Updating…';
}

async function addGoal() {
  const name = prompt('Goal name (e.g. Thesis)')?.trim(); if (!name) return;
  const iso = (x: string | null | undefined) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x.trim()) ? x.trim() : '');
  const end = iso(prompt('Deadline (YYYY-MM-DD)')); if (!end) { alert('Use the format YYYY-MM-DD'); return; }
  const start = iso(prompt('Start date (YYYY-MM-DD), empty for today')) || new Date().toISOString().slice(0, 10);
  const g = await yg<{ goals: unknown[] }>('/api/settings/goals');
  await yg('/api/settings/goals', { method: 'PUT', body: { goals: [...g.goals, { id: `g-${Date.now()}`, name, start_date: start, end_date: end }] } });
  dispatchEvent(new Event('ygg-sync'));
}

export default function Settings() {
  const s = useStore();
  const set = (p: Partial<typeof s.settings>) => update((st) => ({ ...st, settings: { ...st.settings, ...p } }));
  const cur = THEMES.find((t) => t.id === s.settings.theme) || THEMES[0];
  return (
    <Screen>
      <Top back="today" title={<h1 className="h2">Settings</h1>} />
      <div className="stack pad">
        <section className="card">
          <b>Appearance</b>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} className={`theme-tile ${s.settings.theme === t.id ? 'on' : ''}`} aria-pressed={s.settings.theme === t.id} onClick={() => set({ theme: t.id as ThemeName })}>
                <div className="prev" style={{ background: t.bg }}>
                  <i style={{ width: '55%', background: t.ink }} />
                  <i style={{ width: '80%', background: t.surface, border: `1px solid ${t.ink}33`, height: 16 }} />
                  <i style={{ width: '30%', background: s.settings.accent || t.accent }} />
                </div>
                <div className="nm"><span>{t.name}</span>{s.settings.theme === t.id && <Icon name="check" size={16} />}</div>
              </button>
            ))}
          </div>
          {s.settings.theme !== 'paper' && <>
            <div className="muted sm" style={{ marginTop: 14 }}>Accent colour</div>
            <div className="swatches">
              {ACCENTS.map((a) => (
                <button key={a.name} aria-label={a.name} aria-pressed={s.settings.accent === a.value} className={`swatch ${s.settings.accent === a.value ? 'on' : ''}`} style={{ background: a.value || cur.accent }} onClick={() => set({ accent: a.value })} />
              ))}
            </div>
          </>}
        </section>
        <section className="card">
          <b>Reading and display</b>
          <div className="muted sm" style={{ marginTop: 10 }}>Text size</div>
          <div className="seg" role="group" aria-label="Text size">
            {[[90, 'Small'], [100, 'Normal'], [112, 'Large'], [125, 'Larger']].map(([v, l]) => (
              <button key={v} className={`segbtn ${(s.settings.textScale || 100) === v ? 'on' : ''}`} aria-pressed={(s.settings.textScale || 100) === v} onClick={() => set({ textScale: v as number })}>{l}</button>
            ))}
          </div>
          <label className="muted sm" htmlFor="arxiv-topic" style={{ display: 'block', marginTop: 14 }}>Daily arXiv topic</label>
          <input id="arxiv-topic" className="select" value={s.settings.category} onChange={(e) => set({ category: e.target.value.trim() })} placeholder="astro-ph.HE" autoCapitalize="off" autoCorrect="off" />
        </section>
        {isLocal() ? <LocalSync /> : <ServerSync />}
        <AboutCard />
      </div>
    </Screen>
  );
}

function ServerSync() {
  const drive = useY<DriveState | null>('/api/drivesync/status', null);
  const zot = useY<ZoteroState>('/api/settings/zotero', { has_key: false, user_id: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const d = drive.data;
  const go = async () => {
    setBusy(true); setMsg('');
    const problems = await syncAll();
    dispatchEvent(new Event('ygg-sync'));
    setMsg(problems.length ? problems.join(' · ') : 'Everything is up to date.');
    setBusy(false);
  };
  const driveLine = !d ? (drive.err ? 'Not reachable' : 'Checking…')
    : d.needs_reconnect ? 'Sign in again on the desktop (Settings → Sync)'
    : d.connected ? `Connected · last sync ${ago(d.last_run)}${d.last_result && !d.last_result.ok ? ' · last run had problems' : ''}`
    : 'Not set up. On the desktop: Settings → Sync';
  const driveOk = !!d?.connected && !d.needs_reconnect && (d.last_result?.ok ?? true);
  return (
    <section className="card">
      <b>Sync</b>
      <div className="row gap sm" style={{ marginTop: 10, alignItems: 'flex-start' }}><span className={`dot ${driveOk ? '' : 'bad'}`} style={{ marginTop: 6 }} /><span><b>Google Drive</b> <span className="muted">notes, tasks, goals, app data — {driveLine}</span></span></div>
      <div className="row gap sm" style={{ marginTop: 8, alignItems: 'flex-start' }}><span className={`dot ${zot.data.has_key ? '' : 'bad'}`} style={{ marginTop: 6 }} /><span><b>Zotero</b> <span className="muted">papers and books — {zot.data.has_key ? 'keys saved' : 'add your keys under Connection'}</span></span></div>
      <button className="btn primary" onClick={go} disabled={busy} style={{ marginTop: 14, width: '100%' }}><Icon name="sync" size={16} /> {busy ? 'Syncing…' : 'Sync now'}</button>
      {msg && <p className="sm" role="status">{msg}</p>}
      <div className="group" style={{ marginTop: 10 }}>
        <a className="grow" href="#/sync" style={{ padding: 0 }}><span className="f1">Connection, token and Zotero keys</span><Icon name="next" size={18} /></a>
      </div>
    </section>
  );
}

function LocalSync() {
  return (
    <section className="card group">
      <a className="grow" href="#/sync"><span className="f1">Google Drive sync and backup</span><Icon name="next" size={18} /></a>
      <button className="grow plainbtn" onClick={addGoal}><span className="f1">Add a goal (days-left card)</span><Icon name="plus" size={18} /></button>
    </section>
  );
}

function AboutCard() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg('');
    try { setMsg(await checkUpdate()); } catch (e) { setMsg(e instanceof Error ? e.message : 'Check failed'); }
    setBusy(false);
  };
  return (
    <section className="card">
      <b>About</b>
      <div className="row gap" style={{ marginTop: 8 }}><span className="f1">Yggdrasil</span><span className="right muted">v{__APP_VERSION__}</span></div>
      <div className="muted sm">Built {new Date(__BUILD__).toLocaleString()}</div>
      <p className="sm" style={{ margin: '10px 0 0' }}>© 2026 Kamil Nadaf · <a href="https://github.com/Kamil-Nadaf/Yggdrasil/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a></p>
      <button className="btn" onClick={go} disabled={busy} style={{ marginTop: 12, width: '100%' }}><Icon name="sync" size={16} /> {busy ? 'Checking…' : 'Check for updates'}</button>
      <button className="btn" onClick={async () => { for (const k of await caches.keys()) if (k !== 'ygg-pdf') await caches.delete(k); setMsg('Offline cache cleared.'); }} style={{ marginTop: 8, width: '100%' }}>Clear offline cache</button>
      {msg && <p className="sm" role="status">{msg}</p>}
    </section>
  );
}
