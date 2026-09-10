import { useState } from "react";
import Nav from "./components/Nav";
import Triage from "./views/Triage";
import CERICEditor from "./views/CERICEditor";
import GraphView from "./views/GraphView";
import AskView from "./views/AskView";
import ScoresView from "./views/ScoresView";

export type View = "triage" | "editor" | "graph" | "ask" | "scores";

export default function App() {
  const [view, setView] = useState<View>("triage");
  const [editorCitekey, setEditorCitekey] = useState<string | null>(null);

  function openEditor(citekey: string) {
    setEditorCitekey(citekey);
    setView("editor");
  }

  return (
    <div className="app-shell">
      <Nav current={view} onNavigate={setView} />
      <main className="app-content">
        {view === "triage" && <Triage onOpenEditor={openEditor} />}
        {view === "editor" && <CERICEditor citekey={editorCitekey} onBack={() => setView("triage")} />}
        {view === "graph" && <GraphView onOpenEditor={openEditor} />}
        {view === "ask" && <AskView />}
        {view === "scores" && <ScoresView />}
      </main>
    </div>
  );
}
