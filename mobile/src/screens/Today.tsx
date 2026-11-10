import { useStore, live, dayKey, streakDays, ago, WEEK_TARGET } from '../store';
import { Icon, Screen } from '../ui';
import { useY, type Item } from '../ygg';
import { ActiveTasks, DaysLeft, ReadingTimer, ActivityHeatmap, MentalLightcurve } from './Dashboard';

export default function Today() {
  const s = useStore();
  const items = s.feed?.items || [];
  const done = items.filter((i) => s.decisions[i.id]).length;
  const days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { k: dayKey(d), l: 'SMTWTFS'[d.getDay()], today: i === 6 };
  });
  const pts = days.reduce((a, d) => a + (s.activity[d.k] || 0), 0);
  const streak = streakDays(s);
  const lib = useY<{ books: Item[] }>('/api/reading/library', { books: [] });
  const reading = lib.data.books.filter((p) => p.status === 'reading' && p.has_file)[0];
  const notes = live(s.notes).sort((a, b) => b.updated - a.updated).slice(0, 2);

  return (
    <Screen tab="today">
      <header className="top big">
        <div>
          <span className="logo" role="img" aria-label="Yggdrasil" />
          <h1>Today</h1>
          <div className="sub">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</div>
        </div>
      </header>

      <div className="stack pad">
        <ActiveTasks />
        <DaysLeft />
        <ReadingTimer />

        <section className="card">
          <div className="row between"><b>Daily arXiv</b><span className="muted sm">{items.length ? `${done} of ${items.length} triaged` : 'Not loaded yet'}</span></div>
          <div className="bar"><i style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div>
          <a className="btn primary" href="#/arxiv">{done ? 'Continue triage' : 'Start triage'}</a>
        </section>

        <section className="card">
          <div className="row between"><b>This week</b><span className="muted sm">{streak} day streak</span></div>
          <div className="row between week">
            {days.map((d) => (
              <div key={d.k} className={`day ${d.today ? 'today' : ''}`}>
                <span className={(s.activity[d.k] || 0) >= 3 ? 'filled' : ''} />
                {d.l}
              </div>
            ))}
          </div>
          <div className="row between muted sm mt"><span>Points</span><span>{pts} / {WEEK_TARGET}</span></div>
          <div className="bar"><i style={{ width: `${Math.min(100, (pts / WEEK_TARGET) * 100)}%` }} /></div>
        </section>

        <ActivityHeatmap />
        <MentalLightcurve />

        {reading && (
          <a className="card link" href={`#/read/${encodeURIComponent(reading.slug)}`}>
            <div className="muted sm">Continue reading</div>
            <b className="mt-s">{reading.title}</b>
            <div className="muted sm mt-s">Page {reading.last_page}{reading.total_pages ? ` of ${reading.total_pages}` : ''}</div>
          </a>
        )}

        {notes.length > 0 && (
          <div>
            <div className="label">Recent notes</div>
            {notes.map((n) => (
              <a key={n.id} className="listrow" href={`#/notes/${n.id}`}><span>{n.title || 'Untitled'}</span><span className="muted sm">{ago(n.updated)}</span></a>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}
