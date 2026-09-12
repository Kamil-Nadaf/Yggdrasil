import { useEffect, useState } from "react";
import Nav from "./components/Nav";
import SettingsDrawer from "./components/SettingsDrawer";
import CERICEditor from "./views/CERICEditor";
import GraphView from "./views/GraphView";
import AskView from "./views/AskView";
import ScoresView from "./views/ScoresView";
import LaTeXEditor from "./views/LaTeXEditor";
import ArxivSearch from "./views/ArxivSearch";
import ArxivBrowser from "./views/ArxivBrowser";
import TasksView from "./views/TasksView";

export type View = "editor" | "graph" | "ask" | "scores" | "latex" | "search" | "browse" | "tasks";

export default function App() {
  const [view, setView] = useState<View>("scores");
  const [editorCitekey, setEditorCitekey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const theme = (localStorage.getItem("theme") || "dark") as string;
    if (theme !== "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, []);

  function openEditor(citekey: string) {
    setEditorCitekey(citekey);
    setView("editor");
  }

  return (
    <div className="app-shell">
      <Nav current={view} onNavigate={setView} onSettingsOpen={() => setSettingsOpen(true)} />
      <main className={`app-content${view === "latex" ? " app-content--flush" : ""}`}>
        {view === "editor" && (
          <CERICEditor
            citekey={editorCitekey}
            onBack={() => setView("search")}
            onSelectPaper={openEditor}
            onPaperDeleted={() => setEditorCitekey(null)}
          />
        )}
        {view === "tasks" && <TasksView />}
        {view === "graph" && <GraphView onOpenEditor={openEditor} />}
        {view === "ask" && <AskView />}
        {view === "scores" && <ScoresView />}
        {view === "latex" && <LaTeXEditor />}
        {view === "search" && <ArxivSearch />}
        {view === "browse" && <ArxivBrowser />}
      </main>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
