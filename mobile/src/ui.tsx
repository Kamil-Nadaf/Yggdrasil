import { useState } from 'react';
import type { ReactNode } from 'react';
import { syncAll } from './syncAll';

const P: Record<string, ReactNode> = {
  today: <><path d="M4 11l8-7 8 7v9H4z" /><path d="M10 20v-6h4v6" /></>,
  notes: <><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h5" /></>,
  arxiv: <><path d="M4 5h12v14H6a2 2 0 0 1-2-2z" /><path d="M16 9h4v8a2 2 0 0 1-2 2h-2" /><path d="M7 9h6M7 13h6" /></>,
  library: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  projects: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 11h18" /></>,
  write: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  play: <path d="M7 5l12 7-12 7z" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  sync: <><path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

const TABS = [
  { to: 'today', label: 'Today' },
  { to: 'projects', label: 'Projects' },
  { to: 'notes', label: 'Notes' },
  { to: 'arxiv', label: 'arXiv' },
  { to: 'library', label: 'Library' },
  { to: 'write', label: 'Write' },
];

export function TabBar({ active }: { active: string }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <a key={t.to} href={`#/${t.to}`} className={t.to === active ? 'on' : ''} aria-current={t.to === active ? 'page' : undefined}>
          <Icon name={t.to} />
          {t.label}
        </a>
      ))}
    </nav>
  );
}

export function Top({ back, title, right }: { back?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <header className="top">
      {back && <a href={`#/${back}`} className="iconbtn" aria-label="Back"><Icon name="back" /></a>}
      <div className="top-title">{title}</div>
      {right}
    </header>
  );
}

function SyncBtn() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const go = async () => {
    if (busy) return;
    setBusy(true); setMsg('');
    const problem = (await syncAll()).join(' · ');
    dispatchEvent(new Event('ygg-sync'));
    setBusy(false);
    if (problem) { setMsg(problem); setTimeout(() => setMsg(''), 8000); }
  };
  return (
    <>
      <button className={`iconbtn ${busy ? 'spin' : ''}`} aria-label="Sync now" title="Sync now (Google Drive + Zotero)" onClick={go}><Icon name="sync" /></button>
      {msg && <div className="syncmsg" role="status" onClick={() => setMsg('')}>{msg}</div>}
    </>
  );
}

export function Screen({ tab, children }: { tab?: string; children: ReactNode }) {
  return (
    <>
      <main className="screen">{tab && <div className="topbtns"><SyncBtn /><a href="#/settings" className="iconbtn gear" aria-label="Settings"><Icon name="gear" /></a></div>}{children}</main>
      {tab && <TabBar active={tab} />}
    </>
  );
}

export function Dot({ status }: { status: 'unread' | 'reading' | 'done' }) {
  const c = status === 'unread' ? '#E6B673' : status === 'reading' ? '#8DB8FF' : '#7FD6A4';
  return <span className="dot" style={{ background: c }} />;
}
export const STATUS_LABEL = { unread: 'Unread', reading: 'Reading', done: 'Done' } as const;
