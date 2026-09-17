import { useEffect, useState } from "react";
import Nav from "./components/Nav";
import SettingsDrawer from "./components/SettingsDrawer";
import PageThemeDrawer from "./components/PageThemeDrawer";
import CERICEditor from "./views/CERICEditor";
import GraphView from "./views/GraphView";
import AskView from "./views/AskView";
import ScoresView from "./views/ScoresView";
import LaTeXEditor from "./views/LaTeXEditor";
import ArxivSearch from "./views/ArxivSearch";
import ArxivBrowser from "./views/ArxivBrowser";
import TasksView from "./views/TasksView";
import { applyTheme } from "./lib/theme";
import { APP_WATERMARK } from "./lib/copyright";
import { startSettingsSync } from "./lib/settingsSync";

export type View = "editor" | "graph" | "ask" | "scores" | "latex" | "search" | "browse" | "tasks";

export default function App() {
  const [view, setView] = useState<View>("scores");
  const [editorCitekey, setEditorCitekey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pageEditOpen, setPageEditOpen] = useState(false);
  const [firstRunData, setFirstRunData] = useState(false);
  const [reinstallBanner, setReinstallBanner] = useState<string | null>(null);
  const [taskFocus, setTaskFocus] = useState<{ projectSlug: string; mainTaskId: string } | null>(null);

  useEffect(() => {
    applyTheme(view);
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
          setSettingsOpen(true);
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
      {reinstallBanner && (
        <div className="data-restore-banner" role="status">
          <span>{reinstallBanner}</span>
          <button type="button" className="loki-ghost" onClick={() => setReinstallBanner(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <Nav
        current={view}
        onNavigate={setView}
        onSettingsOpen={() => { setPageEditOpen(false); setSettingsOpen(true); }}
        onPageEdit={() => { setSettingsOpen(false); setPageEditOpen(true); }}
        pageEditOpen={pageEditOpen}
      />
      <main className={`app-content${view === "latex" || view === "ask" ? " app-content--flush" : ""}`}>
        {view === "editor" && (
          <CERICEditor
            citekey={editorCitekey}
            onBack={() => setView("search")}
            onSelectPaper={openEditor}
            onPaperDeleted={() => setEditorCitekey(null)}
          />
        )}
        {view === "tasks" && (
          <TasksView
            focus={taskFocus}
            onFocusConsumed={() => setTaskFocus(null)}
          />
        )}
        {view === "graph" && <GraphView onOpenEditor={openEditor} />}
        {view === "ask" && <AskView />}
        {view === "scores" && <ScoresView onOpenTask={openTask} />}
        {view === "latex" && <LaTeXEditor />}
        {view === "search" && <ArxivSearch />}
        {view === "browse" && <ArxivBrowser />}
      </main>
      <SettingsDrawer
        open={settingsOpen}
        firstRun={firstRunData}
        onClose={() => setSettingsOpen(false)}
        onDataPathSaved={() => {
          setFirstRunData(false);
          window.location.reload();
        }}
      />
      <PageThemeDrawer open={pageEditOpen} page={view} onClose={() => setPageEditOpen(false)} />
      <div className="app-watermark" aria-hidden="true">{APP_WATERMARK}</div>
    </div>
  );
}
