import { useState } from 'react';
import { isLocal, yg } from '../ygg';
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
          <b>Theme</b>
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
        </section>
        {s.settings.theme !== 'paper' && <section className="card">
          <b>Accent colour</b>
          <div className="muted sm">Applies on top of the {cur.name} theme.</div>
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button key={a.name} aria-label={a.name} aria-pressed={s.settings.accent === a.value} className={`swatch ${s.settings.accent === a.value ? 'on' : ''}`} style={{ background: a.value || cur.accent }} onClick={() => set({ accent: a.value })} />
            ))}
          </div>
        </section>}
        <UpdateCard />
        <section className="card group">
          <a className="grow" href="#/sync"><span className="f1">Connection and token</span><Icon name="next" size={18} /></a>
          <a className="grow" href="#/tasks"><span className="f1">Tasks</span><Icon name="next" size={18} /></a>
          {isLocal() && <button className="grow plainbtn" onClick={addGoal}><span className="f1">Add a goal (days-left card)</span><Icon name="plus" size={18} /></button>}
          <div className="grow"><span className="f1">arXiv topic</span><span className="muted sm">{s.settings.category}</span></div>
        </section>
      </div>
    </Screen>
  );
}

function UpdateCard() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg('');
    try { setMsg(await checkUpdate()); } catch (e) { setMsg(e instanceof Error ? e.message : 'Check failed'); }
    setBusy(false);
  };
  return (
    <section className="card">
      <b>App version</b>
      <div className="muted sm">Built {new Date(__BUILD__).toLocaleString()}</div>
      <button className="btn" onClick={go} disabled={busy} style={{ marginTop: 12, width: '100%' }}><Icon name="sync" size={16} /> {busy ? 'Checking…' : 'Check for updates'}</button>
      {msg && <p className="sm" role="status">{msg}</p>}
    </section>
  );
}
