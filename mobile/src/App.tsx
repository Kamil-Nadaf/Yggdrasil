import { useEffect, useState } from 'react';
import Today from './screens/Today';
import { NotesList, NoteEditor } from './screens/Notes';
import { ArxivFeed, Abstract } from './screens/ArXiv';
import { Library, Collection, Reader } from './screens/Library';
import { Projects, LatexEditor } from './screens/Write';
import Sync from './screens/Sync';
import { Tasks } from './screens/Tasks';
import Settings from './screens/Settings';
import { isLocal } from './ygg';
import { cloudDue, cloudSync } from './cloud/cloud';

function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => { setHash(location.hash); document.querySelector('.screen')?.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
}

export default function App() {
  const [a, b] = useRoute();
  useEffect(() => {
    // phone-only mode: keep Google Drive in sync while the app is open
    const tick = () => { if (isLocal() && !document.hidden && cloudDue()) void cloudSync(); };
    const t = setInterval(tick, 60_000);
    const first = setTimeout(tick, 4000);
    addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); clearTimeout(first); removeEventListener('visibilitychange', tick); };
  }, []);

  switch (a) {
    case 'notes': return b ? <NoteEditor id={b} /> : <NotesList />;
    case 'arxiv': return b ? <Abstract id={b} /> : <ArxivFeed />;
    case 'library': return b ? <Collection id={b} /> : <Library />;
    case 'read': return <Reader id={b} />;
    case 'write': return b ? <LatexEditor id={b} /> : <Projects />;
    case 'tasks': return <Tasks slug={b} />;
    case 'settings': return <Settings />;
    case 'sync': return <Sync />;
    default: return <Today />;
  }
}
