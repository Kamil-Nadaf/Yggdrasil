import { useEffect, useState } from "react";
import Nav, { type NotesTab, type TasksTab, type CollectionSection, type PapersSection } from "./components/Nav";
import SettingsPage from "./components/SettingsPage";
import PageThemeDrawer from "./components/PageThemeDrawer";
import CERICEditor from "./views/CERICEditor";
import GraphView from "./views/GraphView";
import AskView from "./views/AskView";
import ScoresView from "./views/ScoresView";
import LaTeXEditor from "./views/LaTeXEditor";
import PapersView from "./views/PapersView";
import BooksView from "./views/BooksView";
import "./subnav-center.css";
import ActivityTimer from "./components/ActivityTimer";
import ManualTimerRunner from "./components/ManualTimerRunner";
import TasksView from "./views/TasksView";
import CalendarView from "./views/CalendarView";
import { applyTheme } from "./lib/theme";
import { APP_WATERMARK } from "./lib/copyright";
import { startSettingsSync } from "./lib/settingsSync";

export type View = "editor" | "graph" | "ask" | "scores" | "latex" | "papers" | "books" | "tasks" | "calendar" | "settings";

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
  const [taskFocus, setTaskFocus] = useState<{ projectSlug: string; mainTaskId: string } | null>(null);

  useEffect(() => {
    if (view !== "settings") applyTheme(view); // Settings keeps the page theme you came from
  }, [view]);

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

  function goView(v: View) {
    if (v === "settings" && view !== "settings") setPrevView(view as Exclude<View, "settings">);
    setView(v);
  }

  function openEditor(citekey: string) {
    setEditorCitekey(citekey);
    setView("editor");
  }

  function openTask(projectSlug: string, mainTaskId: string) {
    setTaskFocus({ projectSlug, mainTaskId });
    setView("tasks");
  }

  return (
    <div className="app-shell">
      <ManualTimerRunner />
      <Nav
        current={view}
        subs={{ notes: notesTab, tasks: tasksTab, collection: colSection, papers: papersSection }}
        onSub={(k, id) => {
          if (k === "notes") setNotesTab(id as NotesTab);
          else if (k === "tasks") setTasksTab(id as TasksTab);
          else if (k === "papers") setPapersSection(id as PapersSection);
          else setColSection(id as CollectionSection);
        }}
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
      <main className={`app-content${view === "latex" || view === "ask" || view === "settings" ? " app-content--flush" : ""}`}>
        {view === "editor" && (
          <CERICEditor
            citekey={editorCitekey}
            requestTab={notesTab}
            onTabChange={setNotesTab}
            onBack={() => setView("papers")}
            onSelectPaper={openEditor}
            onPaperDeleted={() => setEditorCitekey(null)}
          />
        )}
        {view === "tasks" && (
          <TasksView
            focus={taskFocus}
            requestTab={tasksTab}
            onTabChange={setTasksTab}
            onFocusConsumed={() => setTaskFocus(null)}
          />
        )}
        {view === "calendar" && <CalendarView onOpenTask={openTask} />}
        {view === "graph" && <GraphView onOpenEditor={openEditor} />}
        {view === "ask" && <AskView />}
        {view === "scores" && <ScoresView onOpenTask={openTask} onOpenBooks={() => setView("books")} />}
        {view === "latex" && (
          <>
            <ActivityTimer category="writing" />
            <LaTeXEditor />
          </>
        )}
        {view === "papers" && <PapersView requestSection={papersSection} />}
        {view === "books" && <BooksView requestSection={colSection} />}
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
      </div>
      <PageThemeDrawer open={pageEditOpen} page={view === "settings" ? prevView : view} onClose={() => setPageEditOpen(false)} />
      <div className="app-watermark" aria-hidden="true">{APP_WATERMARK}</div>
    </div>
  );
}
