import { useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { api, type LatexFile } from "../api/client";

const LATEX_LANG = StreamLanguage.define(stex);

const TEMPLATE = `\\documentclass[12pt]{article}
\\usepackage{amsmath, amssymb, graphicx, hyperref}
\\title{Your Title}
\\author{Your Name}
\\date{\\today}
\\begin{document}
\\maketitle
\\section{Introduction}
\\end{document}
`;

function todayFilename() {
  return `draft-${new Date().toISOString().slice(0, 10)}`;
}

const editorTheme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--bg)", color: "var(--text)" },
    ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--accent)" },
    ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--muted)", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(79,195,247,0.06)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(79,195,247,0.08)" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "rgba(79,195,247,0.25) !important" },
    ".cm-scroller": { overflow: "auto" },
  },
  { dark: true }
);

type FileTreeNode = LatexFile & { isActive?: boolean };

function FileTree({
  files,
  folders,
  selected,
  currentFolder,
  onSelect,
  onOpenFolder,
  onDelete,
  onNew,
  onNewFolder,
  onUpload,
  onDropFiles,
  searchTerm,
  onSearchChange,
}: {
  files: LatexFile[];
  folders: string[];
  selected: string;
  currentFolder: string;
  onSelect: (name: string) => void;
  onOpenFolder: (folder: string) => void;
  onDelete: (name: string) => void;
  onNew: () => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onDropFiles: (files: FileList | File[]) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="latex-file-tree">
      <div className="latex-tree-header">
        <div className="latex-tree-header-row">
          <span className="latex-tree-title">Files</span>
          <div className="latex-tree-actions">
            <button className="latex-tree-action" onClick={onNew}>New</button>
            <button className="latex-tree-action" onClick={onNewFolder}>Folder</button>
            <button className="latex-tree-action" onClick={onUpload}>Upload</button>
          </div>
        </div>
        <div className="latex-tree-search-wrap">
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files"
            className="latex-tree-search"
          />
        </div>
      </div>
      <div
        className="latex-tree-list"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) {
            onDropFiles(e.dataTransfer.files);
          }
        }}
      >
        <div className="latex-tree-breadcrumbs">
          <button className={`latex-tree-breadcrumb${currentFolder === "" ? " active" : ""}`} onClick={() => onOpenFolder("")}>
            root
          </button>
          {currentFolder && (
            <>
              <span className="latex-tree-breadcrumb-sep">/</span>
              {currentFolder.split("/").map((part, index, parts) => {
                const path = parts.slice(0, index + 1).join("/");
                return (
                  <button
                    key={path}
                    className={`latex-tree-breadcrumb${index === parts.length - 1 ? " active" : ""}`}
                    onClick={() => onOpenFolder(path)}
                  >
                    {part}
                  </button>
                );
              })}
            </>
          )}
        </div>

        {folders.length > 0 && (
          <div className="latex-tree-section">
            {folders.map((folder) => (
              <div key={folder} className="latex-tree-folder" onClick={() => onOpenFolder(folder)}>
                <div className="latex-tree-folder-name">{folder}</div>
              </div>
            ))}
          </div>
        )}

        {files.length === 0 ? (
          <div className="latex-tree-empty">No files</div>
        ) : (
          files.map((f) => (
            <div
              key={f.name}
              className={`latex-tree-item${selected === f.name ? " active" : ""}`}
              onClick={() => onSelect(f.name)}
            >
              <div className="latex-tree-name">{f.name}</div>
              <div className="latex-tree-meta">
                {(f.size / 1024).toFixed(1)} KB · {new Date(f.modified).toLocaleDateString()}
              </div>
              <button
                className="latex-tree-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(f.name);
                }}
                title="Delete file"
              >×</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EditorPane({ editorHostRef, lineCol }: {
  editorHostRef: React.RefObject<HTMLDivElement>;
  lineCol: string;
}) {
  return (
    <div className="latex-editor-pane">
      <div ref={editorHostRef} className="latex-editor-host" />
      <div className="latex-status-bar">{lineCol}</div>
    </div>
  );
}

function PreviewPane({ pdfUrl, errors, compiling }: {
  pdfUrl: string | null;
  errors: string[];
  compiling: boolean;
}) {
  return (
    <div className="latex-preview-pane">
      {pdfUrl ? (
        <iframe title="PDF preview" src={pdfUrl} className="latex-pdf-frame" />
      ) : (
        <div className="latex-preview-empty">
          {compiling ? "Compiling…" : "No preview — click Compile"}
        </div>
      )}
      {errors.length > 0 && (
        <div className="latex-error-log">
          <div className="latex-error-header">Errors</div>
          <div className="latex-error-list">
            {errors.map((e, i) => (
              <div key={i} className="latex-error-item">{e}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LaTeXEditor() {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const [files, setFiles] = useState<LatexFile[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState("");
  const [selected, setSelected] = useState("");
  const [filename, setFilename] = useState(todayFilename());
  const [searchTerm, setSearchTerm] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [lineCol, setLineCol] = useState("Line 1, Col 1");

  function getSource() {
    return viewRef.current?.state.doc.toString() ?? "";
  }

  function setSource(text: string) {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }

  function updateLineCol() {
    const view = viewRef.current;
    if (!view) return;
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos).number;
    const col = pos - view.state.doc.line(line).from + 1;
    setLineCol(`Line ${line}, Col ${col}`);
  }

  function uniqueDraftName() {
    const base = todayFilename();
    const existing = new Set(files.map((f) => f.name.replace(/\.tex$/, "")));
    let candidate = base;
    let suffix = 1;
    while (existing.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: TEMPLATE,
        extensions: [
          basicSetup,
          LATEX_LANG,
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDirty(true);
            if (update.selectionSet) updateLineCol();
          }),
        ],
      }),
      parent: editorHostRef.current!,
    });
    viewRef.current = view;
    updateLineCol();
    return () => view.destroy();
  }, []);

  useEffect(() => {
    refreshFiles();
  }, []);

  function refreshFiles() {
    api.latex
      .listFiles()
      .then((r) => {
        setFolders((r.folders ?? []).filter((folder) => !folder.startsWith("_")));
        setFiles((r.files ?? []).filter((f) => !f.name.startsWith("_")));
      })
      .catch(() => {});
  }

  const visibleFolders = currentFolder
    ? folders.filter((folder) => {
        const relative = folder.slice(currentFolder.length + 1);
        return relative && !relative.includes("/");
      })
    : folders.filter((folder) => !folder.includes("/"));

  const visibleFiles = currentFolder
    ? files.filter((file) => {
        const relative = file.name.slice(currentFolder.length + 1);
        return relative && !relative.includes("/");
      })
    : files.filter((file) => !file.name.includes("/"));

  async function handleSelectFile(name: string) {
    setSelected(name);
    setSaveMsg(null);
    setPdfUrl(null);
    setErrors([]);
    if (!name) {
      setFilename(todayFilename());
      setSource(TEMPLATE);
      setDirty(false);
      return;
    }
    const stem = name.replace(/\.tex$/, "");
    setFilename(stem);
    try {
      const r = await api.latex.getFile(stem);
      setSource(r.source);
      setDirty(false);
    } catch {
      setSaveMsg({ text: "Failed to load file", ok: false });
    }
  }

  async function handleSave() {
    const stem = filename.trim();
    if (!stem) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await api.latex.save(stem, getSource());
      setDirty(false);
      setSaveMsg({ text: "Saved", ok: true });
      setSelected(`${stem}.tex`);
      refreshFiles();
    } catch {
      setSaveMsg({ text: "Save failed", ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function handleCompile() {
    setCompiling(true);
    setErrors([]);
    try {
      const r = await api.latex.compile(getSource(), filename.trim() || "draft");
      setPdfUrl(`data:application/pdf;base64,${r.pdf_b64}`);
    } catch (e: unknown) {
      const err = e as Error & { data?: { log?: string; errors?: string[] } };
      setPdfUrl(null);
      setErrors(err.data?.errors?.length ? err.data.errors : [err.message || "Compile failed"]);
    } finally {
      setCompiling(false);
    }
  }

  async function handleDelete(name: string) {
    if (!window.confirm(`Delete ${name}?`)) return;
    await api.latex.deleteFile(name.replace(/\.tex$/, ""));
    if (selected === name) handleSelectFile("");
    refreshFiles();
  }

  async function handleDeleteSelected() {
    if (!selected) return;
    await handleDelete(selected);
  }

  function handleOpenFolder(folder: string) {
    setCurrentFolder(folder);
    setSelected("");
    setSaveMsg(null);
    setPdfUrl(null);
    setErrors([]);
  }

  function handleNewFile() {
    const nextName = uniqueDraftName();
    setSelected("");
    setFilename(currentFolder ? `${currentFolder}/${nextName}` : nextName);
    setSource(TEMPLATE);
    setDirty(true);
    setSaveMsg(null);
    setPdfUrl(null);
    setErrors([]);
  }

  async function handleUpload() {
    fileInputRef.current?.click();
  }

  async function handleNewFolder() {
    const nextFolder = window.prompt("Folder name (for example: notes or sections)");
    if (!nextFolder) return;

    const trimmed = nextFolder.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed) return;

    const folderPath = currentFolder ? `${currentFolder}/${trimmed}` : trimmed;

    try {
      await api.latex.createFolder(folderPath);
      setSaveMsg({ text: `Created ${folderPath}`, ok: true });
      refreshFiles();
    } catch {
      setSaveMsg({ text: "Folder creation failed", ok: false });
    }
  }

  async function handleDroppedFiles(filesToUpload: FileList | File[]) {
    const incoming = Array.from(filesToUpload).filter((file) => file.name.toLowerCase().endsWith(".tex") || file.name.toLowerCase().endsWith(".bib") || file.name.toLowerCase().endsWith(".txt"));

    if (incoming.length === 0) {
      setSaveMsg({ text: "Only .tex, .bib, and .txt files can be uploaded", ok: false });
      return;
    }

    for (const file of incoming) {
      const source = await file.text();
      const stem = file.name.replace(/\.tex$/i, "") || todayFilename();
      const targetName = currentFolder ? `${currentFolder}/${stem}` : stem;

      try {
        await api.latex.save(targetName, source);
        setFilename(targetName);
        setSelected(`${targetName}.tex`);
        setSource(source);
        setDirty(false);
        setSaveMsg({ text: `Uploaded ${file.name}`, ok: true });
      } catch {
        setSaveMsg({ text: "Upload failed", ok: false });
        return;
      }
    }

    refreshFiles();
  }

  async function onUploadFile(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;

    await handleDroppedFiles(event.target.files);

    event.target.value = "";
  }

  const filteredFiles = visibleFiles.filter((f) => f.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredFolders = visibleFolders.filter((folder) => folder.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)" }}>
      {/* Toolbar */}
      <div className="card latex-toolbar">
        <input
          type="text"
          value={filename}
          onChange={(e) => { setFilename(e.target.value); setDirty(true); }}
          placeholder="filename"
          className="mono"
        />
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !filename.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn" onClick={handleCompile} disabled={compiling}>
          {compiling ? "Compiling…" : "Compile"}
        </button>
        <button className="btn" onClick={handleDeleteSelected} disabled={!selected}>
          Delete
        </button>
        {dirty && !saveMsg && <span className="muted mono" style={{ fontSize: 12 }}>unsaved</span>}
        {saveMsg && <span className={`mono ${saveMsg.ok ? "ok" : "crit"}`} style={{ fontSize: 12 }}>{saveMsg.text}</span>}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".tex,.bib,.txt"
        style={{ display: "none" }}
        onChange={onUploadFile}
      />

      {/* 3-Pane Resizable Layout */}
      <PanelGroup orientation="horizontal" className="latex-panel-group">
        {/* Left: File Tree */}
        <Panel defaultSize={15} minSize={12} className="latex-panel">
          <FileTree
            files={filteredFiles}
            folders={filteredFolders}
            selected={selected}
            currentFolder={currentFolder}
            onSelect={handleSelectFile}
            onOpenFolder={handleOpenFolder}
            onDelete={handleDelete}
            onNew={handleNewFile}
            onNewFolder={handleNewFolder}
            onUpload={handleUpload}
            onDropFiles={handleDroppedFiles}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
        </Panel>

        <PanelResizeHandle className="latex-resize-handle" />

        {/* Center: Editor */}
        <Panel defaultSize={50} minSize={30} className="latex-panel">
          <EditorPane editorHostRef={editorHostRef} lineCol={lineCol} />
        </Panel>

        <PanelResizeHandle className="latex-resize-handle" />

        {/* Right: Preview */}
        <Panel defaultSize={35} minSize={25} className="latex-panel">
          <PreviewPane pdfUrl={pdfUrl} errors={errors} compiling={compiling} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
