import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Nav, { type NotesTab, type TasksTab, type CollectionSection, type PapersSection } from "./components/Nav";
import SettingsPage from "./components/SettingsPage";
import UpdatePrompt from "./components/UpdatePrompt";
import PageThemeDrawer from "./components/PageThemeDrawer";
import PaneHeader from "./components/PaneHeader";
import SplitLayoutBar, { layoutDims, type SplitLayout } from "./components/SplitLayoutBar";
import SlidesView from "./views/SlidesView";
import CERICEditor from "./views/CERICEditor";
import GraphView from "./views/GraphView";
import AskView from "./views/AskView";
import ScoresView from "./views/ScoresView";
import LaTeXEditor from "./views/LaTeXEditor";
import PapersView from "./views/PapersView";
import BooksView from "./views/BooksView";
import "./subnav-center.css";
import "./split-view.css";
import ActivityTimer from "./components/ActivityTimer";
import ManualTimerRunner from "./components/ManualTimerRunner";
import TasksView from "./views/TasksView";
import ProjectsView from "./views/ProjectsView";
import CalendarView from "./views/CalendarView";
import { applyTheme } from "./lib/theme";
import { APP_WATERMARK } from "./lib/copyright";
import { startSettingsSync } from "./lib/settingsSync";

export type View = "editor" | "graph" | "ask" | "scores" | "latex" | "papers" | "books" | "tasks" | "projects" | "calendar" | "slides" | "settings";

const SPLIT_KEY = "yggdrasil:split-view"; // older single-partner key, still read once
const LAYOUT_KEY = "yggdrasil:split-layout";
const PANES_KEY = "yggdrasil:split-panes";
const SPLIT_RATIO_KEY = "yggdrasil:split-ratio";
/** Every section a pane can show, Settings included, in the order new panes pick their defaults. */
const ALL_VIEWS: View[] = ["editor", "scores", "tasks", "papers", "books", "latex", "calendar", "projects", "slides", "graph", "ask", "settings"];
const LAYOUT_IDS: SplitLayout[] = ["1x2", "2x1", "2x2", "1x3", "3x1", "2x3", "3x2", "1x4"];
const paneCount = (l: SplitLayout) => { const [r, c] = layoutDims(l); return r * c; };

/** Fill `extras` (panes after the first) up to `n - 1` entries with sections not already open. */
function fitExtras(first: View, extras: View[], n: number): View[] {
  const out: View[] = [];
  for (const v of extras) if (ALL_VIEWS.includes(v)) out.push(v); // the same section may be open in several panes
  out.length = Math.min(out.length, n - 1);
  for (const v of ALL_VIEWS) {
    if (out.length >= n - 1) break;
    if (v !== first && v !== "settings" && !out.includes(v)) out.push(v);
  }
  return out;
}
function loadSplit(first: View): { layout: SplitLayout; extras: View[] } | null {
  try {
    const l = localStorage.getItem(LAYOUT_KEY) as SplitLayout | null;
    if (l && LAYOUT_IDS.includes(l)) {
      const raw = JSON.parse(localStorage.getItem(PANES_KEY) || "[]");
      return { layout: l, extras: fitExtras(first, Array.isArray(raw) ? raw : [], paneCount(l)) };
    }
    const old = localStorage.getItem(SPLIT_KEY) as View | null; // one partner from before layouts existed
    if (old && ALL_VIEWS.includes(old)) return { layout: "1x2", extras: fitExtras(first, [old], 2) };
  } catch { /* ignore */ }
  return null;
}
function loadRatio(): number {
  try {
    const r = Number(localStorage.getItem(SPLIT_RATIO_KEY));
    return r >= 0.2 && r <= 0.8 ? r : 0.5;
  } catch { return 0.5; }
}
/** A sensible partner for the page you are on (papers↔collection, notes↔LaTeX, …). */
function defaultPartner(v: View): View {
  const pairs: Partial<Record<View, View>> = { papers: "books", books: "editor", editor: "latex", latex: "editor", scores: "tasks", tasks: "scores" };
  return pairs[v] ?? (v === "editor" ? "latex" : "editor");
}

export default function App() {
  const [view, setView] = useState<View>("scores");
  const [editorCitekey, setEditorCitekey] = useState<string | null>(null);
  const [prevView, setPrevView] = useState<Exclude<View, "settings">>("scores");
  const [notesTab, setNotesTab] = useState<NotesTab>("collection");
  const [tasksTab, setTasksTab] = useState<TasksTab>("list");
  const [papersSection, setPapersSection] = useState<PapersSection>("daily");
  const [colSection, setColSection] = useState<CollectionSection>("all");
  const [pageEditOpen, setPageEditOpen] = useState(false);
  const [firstRunData, setFirstRunData] = useState(false);
  const [reinstallBanner, setReinstallBanner] = useState<string | null>(null);
  const [splitState, setSplitState] = useState<{ layout: SplitLayout; extras: View[] } | null>(() => loadSplit("scores"));
  const layout = splitState?.layout ?? null;
  const extras = splitState?.extras ?? [];
  /** Which pane has focus (0 = the first pane, which is also what the sidebar highlights). */
  const [focusIdx, setFocusIdx] = useState(0);
  /** A pane that is currently enlarged to fill the whole split area (null = normal grid). */
  const [maxIdx, setMaxIdx] = useState<number | null>(null);
  const [splitRatio, setSplitRatio] = useState<number>(() => loadRatio());
  const splitRef = useRef<HTMLDivElement>(null);
  const [splitW, setSplitW] = useState(0);
  const [taskFocus, setTaskFocus] = useState<{ projectSlug: string; mainTaskId: string } | null>(null);

  useEffect(() => {
    const shown = layout && focusIdx > 0 ? extras[focusIdx - 1] ?? view : view;
    if (shown === "settings") return; // Settings keeps the page theme you came from
    applyTheme(shown);
  }, [view, layout, extras.join(","), focusIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => startSettingsSync(), []);

  useEffect(() => {
    fetch("/api/info")
      .then((r) => r.json())
      .then((info: {
        desktop?: boolean;
        dataPathChosen?: boolean;
        existingData?: boolean;
        reinstall?: { from: string; to: string } | null;
      }) => {
        if (info.desktop && info.dataPathChosen === false) {
          setFirstRunData(true);
          setView("settings");
        }
        if (info.desktop && info.existingData && info.reinstall) {
          const { from, to } = info.reinstall;
          setReinstallBanner(
            `Existing Yggdrasil data found (v${from} → v${to}). Your notes and files are intact.`
          );
        }
      })
      .catch(() => {});
  }, []);

  const splitOn = !!layout;
  useEffect(() => {
    const el = splitRef.current;
    if (!splitOn || !el) return;
    const ro = new ResizeObserver(() => setSplitW(el.offsetWidth));
    ro.observe(el);
    setSplitW(el.offsetWidth);
    return () => ro.disconnect();
  }, [splitOn, layout]);
  const [rows, cols] = layout ? layoutDims(layout) : [1, 1];
  /** Narrow panes shrink their content (text, buttons, panels) so pages built for full width still fit. */
  const paneZoom = (frac: number) => Math.round(Math.min(1, Math.max(0.6, ((splitW - 6) * frac) / 1250)) * 100) / 100;

  const panes: View[] = layout ? [view, ...extras] : [view];

  function persistSplit(next: { layout: SplitLayout; extras: View[] } | null) {
    setSplitState(next);
    try {
      if (next) {
        localStorage.setItem(LAYOUT_KEY, next.layout);
        localStorage.setItem(PANES_KEY, JSON.stringify(next.extras));
      } else {
        localStorage.removeItem(LAYOUT_KEY);
        localStorage.removeItem(PANES_KEY);
      }
      localStorage.removeItem(SPLIT_KEY);
    } catch { /* ignore */ }
  }

  /** Show `v` in pane `i`. Any section can be open in any pane, also in several panes at once. */
  function assign(i: number, v: View) {
    if (!layout) { setView(v); return; }
    const all = [...panes];
    if (all[i] === v) return;
    all[i] = v;
    if (v === "settings" && i === 0 && view !== "settings") setPrevView(view as Exclude<View, "settings">);
    setView(all[0]);
    persistSplit({ layout, extras: all.slice(1) });
  }

  /** The section a pane returns to when its Settings page is closed. */
  function backFrom(i: number): View {
    if (i === 0 && !extras.includes(prevView)) return prevView;
    return ALL_VIEWS.find((x) => x !== "settings" && !panes.includes(x)) ?? "scores";
  }

  function changeLayout(l: SplitLayout) {
    persistSplit({ layout: l, extras: fitExtras(view, extras, paneCount(l)) });
    setFocusIdx(0);
    setMaxIdx(null);
  }

  /** Remove pane `i`; the layout shrinks to fit the panes that are left (one pane left = leave split view). */
  function closePane(i: number) {
    if (!layout || panes.length <= 1) return;
    const rest = panes.filter((_, k) => k !== i);
    setMaxIdx(null);
    setFocusIdx(0);
    if (rest.length === 1) {
      setView(rest[0]);
      persistSplit(null);
      return;
    }
    const next: SplitLayout = rest.length === 2 ? "1x2" : rest.length === 3 ? "1x3" : rest.length === 4 ? "2x2" : "2x3";
    setView(rest[0]);
    persistSplit({ layout: next, extras: fitExtras(rest[0], rest.slice(1), paneCount(next)) });
  }

  function goView(v: View, opts?: { side?: boolean }) {
    if (v === "settings" && view !== "settings") setPrevView(view as Exclude<View, "settings">);
    if (layout) {
      if (v === "settings") { assign(Math.min(focusIdx, panes.length - 1), "settings"); return; } // gear: Settings opens in the focused pane
      if (opts?.side) { assign(1, v); return; } // Shift-click: open in the second pane
      assign(Math.min(focusIdx, panes.length - 1), v); // sidebar opens the section in the pane you last clicked
      return;
    }
    if (opts?.side && v !== view && v !== "settings") {
      persistSplit({ layout: "1x2", extras: [v] });
      return;
    }
    setView(v);
  }

  function toggleSplit() {
    if (layout) { persistSplit(null); return; }
    persistSplit({ layout: "1x2", extras: fitExtras(view, [defaultPartner(view)], 2) });
  }

  function setSub(k: "notes" | "tasks" | "collection" | "papers", id: string) {
    if (k === "notes") setNotesTab(id as NotesTab);
    else if (k === "tasks") setTasksTab(id as TasksTab);
    else if (k === "papers") setPapersSection(id as PapersSection);
    else setColSection(id as CollectionSection);
  }
  const subOf = (v: View): string | undefined =>
    v === "editor" ? notesTab : v === "tasks" ? tasksTab : v === "papers" ? papersSection : v === "books" ? colSection : undefined;

  function startDivider(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const box = splitRef.current;
    if (!box) return;
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);
    const rect = box.getBoundingClientRect();
    let r = splitRatio;
    const move = (ev: PointerEvent) => {
      r = Math.max(0.2, Math.min(0.8, (ev.clientX - rect.left) / rect.width));
      setSplitRatio(r);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      try { localStorage.setItem(SPLIT_RATIO_KEY, String(r)); } catch { /* ignore */ }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  function openEditor(citekey: string) {
    setEditorCitekey(citekey);
    goView("editor");
  }

  function openTask(projectSlug: string, mainTaskId: string) {
    setTaskFocus({ projectSlug, mainTaskId });
    goView("tasks");
  }

  function renderView(v: View): ReactNode {
    return (
      <>
        {v === "editor" && (
          <CERICEditor
            citekey={editorCitekey}
            requestTab={notesTab}
            onTabChange={setNotesTab}
            onBack={() => goView("papers")}
            onSelectPaper={openEditor}
            onPaperDeleted={() => setEditorCitekey(null)}
          />
        )}
        {v === "tasks" && (
          <TasksView
            focus={taskFocus}
            requestTab={tasksTab}
            onTabChange={setTasksTab}
            onFocusConsumed={() => setTaskFocus(null)}
          />
        )}
        {v === "projects" && <ProjectsView onOpenLatex={() => goView("latex")} />}
        {v === "calendar" && <CalendarView onOpenTask={openTask} />}
        {v === "slides" && <SlidesView />}
        {v === "graph" && <GraphView onOpenEditor={openEditor} />}
        {v === "ask" && <AskView />}
        {v === "scores" && <ScoresView onOpenTask={openTask} onOpenBooks={() => goView("books")} />}
        {v === "latex" && (
          <>
            <ActivityTimer category="writing" />
            <LaTeXEditor />
          </>
        )}
        {v === "papers" && <PapersView requestSection={papersSection} />}
        {v === "books" && <BooksView requestSection={colSection} />}
      </>
    );
  }
  const flushView = (v: View) => v === "latex" || v === "ask" || v === "settings" || v === "slides";
  const settingsPage = (i: number) => (
    <SettingsPage
      firstRun={firstRunData}
      onClose={() => assign(i, backFrom(i))}
      onDataPathSaved={() => {
        setFirstRunData(false);
        window.location.reload();
      }}
    />
  );

  return (
    <div className="app-shell">
      <ManualTimerRunner />
      <UpdatePrompt />
      <Nav
        current={view}
        subs={{ notes: notesTab, tasks: tasksTab, collection: colSection, papers: papersSection }}
        onSub={setSub}
        split={layout ? extras : null}
        onSplitToggle={toggleSplit}
        onNavigate={goView}
        onSettingsOpen={() => { setPageEditOpen(false); goView("settings"); }}
        onPageEdit={() => { if (view === "settings") setView(prevView); setPageEditOpen(true); }}
        pageEditOpen={pageEditOpen}
      />
      <div className="app-body">
      {reinstallBanner && (
        <div className="data-restore-banner" role="status">
          <span>{reinstallBanner}</span>
          <button type="button" className="loki-ghost" onClick={() => setReinstallBanner(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {layout ? (
        <div className="app-split-wrap">
          <SplitLayoutBar layout={layout} onPick={changeLayout} onClose={() => persistSplit(null)} />
          <div
            className={`app-split${layout === "1x2" ? "" : " is-grid"}`}
            ref={splitRef}
            style={{
              gridTemplateColumns: maxIdx !== null ? "minmax(0, 1fr)" : layout === "1x2" ? `${splitRatio}fr 6px ${1 - splitRatio}fr` : `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: maxIdx !== null ? "minmax(0, 1fr)" : `repeat(${rows}, minmax(0, 1fr))`,
              gap: layout === "1x2" ? 0 : 6,
            }}
          >
            {panes.map((pv, i) => (
              <Fragment key={i}>
                {layout === "1x2" && i === 1 && maxIdx === null && (
                  <div className="split-divider" onPointerDown={startDivider} role="separator" aria-orientation="vertical" title="Drag to resize · double-click to reset" onDoubleClick={() => { setSplitRatio(0.5); try { localStorage.setItem(SPLIT_RATIO_KEY, "0.5"); } catch { /* ignore */ } }} />
                )}
                <div
                  className={`split-pane${focusIdx === i ? " is-focus" : ""}${maxIdx === i ? " is-max" : ""}${maxIdx !== null && maxIdx !== i ? " is-hidden" : ""}`}
                  style={{ ["--split-zoom" as string]: paneZoom(maxIdx === i ? 1 : layout === "1x2" ? (i === 0 ? splitRatio : 1 - splitRatio) : 1 / cols) } as React.CSSProperties}
                  onPointerDownCapture={() => setFocusIdx(i)}
                >
                  <PaneHeader
                    view={pv}
                    n={i + 1}
                    sub={subOf(pv)}
                    onSub={setSub}
                    onView={(v) => assign(i, v)}
                    onSwap={panes.length === 2 && maxIdx === null ? () => assign(0, panes[1]) : undefined}
                    maximized={maxIdx === i}
                    onMax={() => setMaxIdx(maxIdx === i ? null : i)}
                    onClose={() => closePane(i)}
                  />
                  <main className={`app-content${flushView(pv) ? " app-content--flush" : ""}`}>
                    {pv === "settings" ? settingsPage(i) : renderView(pv)}
                  </main>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
      <main className={`app-content${flushView(view) ? " app-content--flush" : ""}`}>
        {renderView(view)}
        {view === "settings" && (
          <SettingsPage
            firstRun={firstRunData}
            onClose={() => setView(prevView)}
            onDataPathSaved={() => {
              setFirstRunData(false);
              window.location.reload();
            }}
          />
        )}
      </main>
      )}
      </div>
      <PageThemeDrawer open={pageEditOpen} page={view === "settings" ? prevView : view} onClose={() => setPageEditOpen(false)} />
      <div className="app-watermark" aria-hidden="true">{APP_WATERMARK}</div>
    </div>
  );
}
