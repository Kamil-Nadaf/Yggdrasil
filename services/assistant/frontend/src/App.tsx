import { useEffect, useRef, useState, type ReactNode } from "react";
import Nav, { type NotesTab, type TasksTab, type CollectionSection, type PapersSection } from "./components/Nav";
import SettingsPage from "./components/SettingsPage";
import UpdatePrompt from "./components/UpdatePrompt";
import PageThemeDrawer from "./components/PageThemeDrawer";
import PaneHeader from "./components/PaneHeader";
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
import CalendarView from "./views/CalendarView";
import { applyTheme } from "./lib/theme";
import { APP_WATERMARK } from "./lib/copyright";
import { startSettingsSync } from "./lib/settingsSync";

export type View = "editor" | "graph" | "ask" | "scores" | "latex" | "papers" | "books" | "tasks" | "calendar" | "settings";

type SplitableView = Exclude<View, "settings">;
const SPLIT_KEY = "yggdrasil:split-view";
const SPLIT_RATIO_KEY = "yggdrasil:split-ratio";
const SPLITTABLE: SplitableView[] = ["editor", "graph", "ask", "scores", "latex", "papers", "books", "tasks", "calendar"];
function loadSplit(): SplitableView | null {
  try {
    const v = localStorage.getItem(SPLIT_KEY) as SplitableView | null;
    return v && SPLITTABLE.includes(v) ? v : null;
  } catch { return null; }
}
function loadRatio(): number {
  try {
    const r = Number(localStorage.getItem(SPLIT_RATIO_KEY));
    return r >= 0.2 && r <= 0.8 ? r : 0.5;
  } catch { return 0.5; }
}
/** A sensible partner for the page you are on (papers↔collection, notes↔LaTeX, …). */
function defaultPartner(v: View): SplitableView {
  const pairs: Partial<Record<View, SplitableView>> = { papers: "books", books: "editor", editor: "latex", latex: "editor", scores: "tasks", tasks: "scores" };
  return pairs[v] ?? "editor";
}

export default function App() {
  const [view, setView] = useState<View>("scores");
  const [editorCitekey, setEditorCitekey] = useState<string | null>(null);
  const [prevView, setPrevView] = useState<Exclude<View, "settings">>("scores");
  const [notesTab, setNotesTab] = useState<NotesTab>("collection");
  const [tasksTab, setTasksTab] = useState<TasksTab>("planner");
  const [papersSection, setPapersSection] = useState<PapersSection>("daily");
  const [colSection, setColSection] = useState<CollectionSection>("all");
  const [pageEditOpen, setPageEditOpen] = useState(false);
  const [firstRunData, setFirstRunData] = useState(false);
  const [reinstallBanner, setReinstallBanner] = useState<string | null>(null);
  const [split, setSplit] = useState<SplitableView | null>(() => loadSplit());
  const [focusSide, setFocusSide] = useState<"left" | "right">("left");
  const [splitRatio, setSplitRatio] = useState<number>(() => loadRatio());
  const splitRef = useRef<HTMLDivElement>(null);
  const [splitW, setSplitW] = useState(0);
  const [taskFocus, setTaskFocus] = useState<{ projectSlug: string; mainTaskId: string } | null>(null);

  useEffect(() => {
    if (view === "settings") return; // Settings keeps the page theme you came from
    applyTheme(split && focusSide === "right" ? split : view);
  }, [view, split, focusSide]);

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

  const splitOn = !!split && view !== "settings";
  useEffect(() => {
    const el = splitRef.current;
    if (!splitOn || !el) return;
    const ro = new ResizeObserver(() => setSplitW(el.offsetWidth));
    ro.observe(el);
    setSplitW(el.offsetWidth);
    return () => ro.disconnect();
  }, [splitOn]);
  /** Narrow panes shrink their content (text, buttons, panels) so pages built for full width still fit. */
  const paneZoom = (frac: number) => Math.round(Math.min(1, Math.max(0.6, ((splitW - 6) * frac) / 1250)) * 100) / 100;

  function persistSplit(v: SplitableView | null) {
    setSplit(v);
    try { v ? localStorage.setItem(SPLIT_KEY, v) : localStorage.removeItem(SPLIT_KEY); } catch { /* ignore */ }
  }

  function goView(v: View, opts?: { side?: boolean }) {
    if (v === "settings" && view !== "settings") setPrevView(view as Exclude<View, "settings">);
    if (v !== "settings" && split) {
      if (opts?.side) { // Shift-click: open on the right
        if (v !== view) persistSplit(v);
        return;
      }
      if (v === split) { // already open on the right → swap sides instead of showing it twice
        persistSplit(view as SplitableView);
        setView(v);
        return;
      }
    } else if (v !== "settings" && opts?.side && v !== view) {
      persistSplit(v);
      return;
    }
    setView(v);
  }

  function toggleSplit() {
    if (split || view === "settings") { persistSplit(null); return; }
    persistSplit(defaultPartner(view));
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
        {v === "calendar" && <CalendarView onOpenTask={openTask} />}
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
  const flushView = (v: View) => v === "latex" || v === "ask" || v === "settings";
  const splitActive = !!split && view !== "settings";

  return (
    <div className="app-shell">
      <ManualTimerRunner />
      <UpdatePrompt />
      <Nav
        current={view}
        subs={{ notes: notesTab, tasks: tasksTab, collection: colSection, papers: papersSection }}
        onSub={setSub}
        split={view === "settings" ? null : split}
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
      {splitActive && split ? (
        <div className="app-split" ref={splitRef}>
          <div className={`split-pane${focusSide === "left" ? " is-focus" : ""}`} style={{ flexBasis: `${splitRatio * 100}%`, ["--split-zoom" as string]: paneZoom(splitRatio) } as React.CSSProperties} onPointerDownCapture={() => setFocusSide("left")}>
            <PaneHeader view={view} other={split} sub={subOf(view)} onSub={setSub} onView={(v) => goView(v)} onSwap={() => { const l = view; setView(split); persistSplit(l as SplitableView); }} />
            <main className={`app-content${flushView(view) ? " app-content--flush" : ""}`}>{renderView(view)}</main>
          </div>
          <div className="split-divider" onPointerDown={startDivider} role="separator" aria-orientation="vertical" title="Drag to resize · double-click to reset" onDoubleClick={() => { setSplitRatio(0.5); try { localStorage.setItem(SPLIT_RATIO_KEY, "0.5"); } catch { /* ignore */ } }} />
          <div className={`split-pane${focusSide === "right" ? " is-focus" : ""}`} style={{ flexBasis: `${(1 - splitRatio) * 100}%`, ["--split-zoom" as string]: paneZoom(1 - splitRatio) } as React.CSSProperties} onPointerDownCapture={() => setFocusSide("right")}>
            <PaneHeader view={split} other={view as SplitableView} sub={subOf(split)} onSub={setSub} onView={(v) => persistSplit(v as SplitableView)} onClose={() => persistSplit(null)} />
            <main className={`app-content${flushView(split) ? " app-content--flush" : ""}`}>{renderView(split)}</main>
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
