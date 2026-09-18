import { useEffect, useMemo, useRef, useState } from "react";
import { api, type LatexFile } from "../api/client";
import AbstractText from "../components/AbstractText";
import EditableMarkdownPreview from "../components/EditableMarkdownPreview";
import { WorkspaceLayout, WorkspacePanel, WorkspaceResizeHandle } from "../components/WorkspaceLayout";
import { WorkspaceSidebar } from "../components/WorkspaceSidebar";
import {
  WorkspaceMenuBar,
  ViewModeToggle,
  FilesToggleButton,
  type MenuConfig,
} from "../components/WorkspaceMenuBar";
import { LatexPromptModal } from "../components/LatexMenuBar";
import { PreviewToolbar, useFullscreenPane, useZoom } from "../components/WorkspacePreviewPane";
import { markdownToLatexDocument } from "../lib/markdownToLatex";
import { apiErrorMessage } from "../lib/apiError";
import { downloadBase64 } from "../lib/download";

type NotesViewMode = "editor" | "split" | "view" | "present";

function stripFrontmatter(source: string): string {
  return source.replace(/^---[\s\S]*?---\s*/, "");
}

function slugSection(section: string): string {
  return section.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parentOf(relPath: string): string {
  const parts = relPath.split("/");
  parts.pop();
  return parts.join("/");
}

function leafOf(relPath: string): string {
  return relPath.split("/").pop() || relPath;
}

const TEMPLATES: Record<string, string> = {
  "Quick note": "---\ntitle: Quick note\ntags: []\n---\n\n# Quick note\n\n",
  "Meeting minutes":
    "---\ntitle: Meeting minutes\ntags: []\n---\n\n# Meeting minutes\n\n## Date\n\n## Attendees\n\n## Notes\n\n## Actions\n",
  Documentation:
    "---\ntitle: Documentation\ntags: []\n---\n\n# Documentation\n\n## Overview\n\n## Details\n\n## References\n",
};

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Read-only formatted view (headings/lists/math/code, no editor chrome) with the
 * same zoom/fullscreen/Download bottom bar as LaTeX Editor's PDF pane. */
function PresentPane({
  source,
  title,
  onFlash,
}: {
  source: string;
  title: string;
  onFlash: (text: string, ok?: boolean) => void;
}) {
  const { zoom, zoomIn, zoomOut, atMinZoom, atMaxZoom } = useZoom();
  const { fullscreen, setFullscreen } = useFullscreenPane();
  const [exporting, setExporting] = useState(false);
  const body = stripFrontmatter(source);
  const words = useMemo(() => wordCount(body), [body]);

  async function handleDownload() {
    setExporting(true);
    try {
      const tex = markdownToLatexDocument(source, title);
      const result = await api.latex.compile(tex, `${title || "note"}-present`);
      downloadBase64(result.pdf_b64, `${title || "note"}.pdf`, "application/pdf");
      onFlash("Downloaded PDF");
    } catch (error) {
      onFlash(apiErrorMessage(error, "PDF export failed"), false);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`latex-preview-pane${fullscreen ? " is-fullscreen" : ""}`}>
      <PreviewToolbar
        statusLabel={`${words} word${words === 1 ? "" : "s"}`}
        zoom={zoom}
        atMinZoom={atMinZoom}
        atMaxZoom={atMaxZoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        fullscreen={fullscreen}
        onEnterFullscreen={() => setFullscreen(true)}
        onExitFullscreen={() => setFullscreen(false)}
        downloadLabel="Download"
        downloadBusy={exporting}
        onDownload={() => void handleDownload()}
      />
      <div className="notes-present-content">
        <div className="notes-present-scale" style={{ fontSize: `${15 * zoom}px` }}>
          {body.trim() ? (
            <AbstractText text={body} className="notes-present-text" />
          ) : (
            <div className="latex-preview-empty">Nothing to present yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MarkdownNotesTab({ section = "Quick Notes" }: { section?: string }) {
  const rootFolder = section;
  const storageKey = `${slugSection(section)}-sidebar-state`;

  const [files, setFiles] = useState<LatexFile[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [folderRel, setFolderRel] = useState("");
  const [selected, setSelected] = useState(""); // absolute path, "" = unsaved draft
  const [filename, setFilename] = useState(""); // relative-to-section stem, no extension
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<NotesViewMode>("split");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(storageKey) === "collapsed");
  const [renaming, setRenaming] = useState(false);
  const [prompt, setPrompt] = useState<
    | { type: "file" }
    | { type: "folder" }
    | { type: "rename"; src: string; kind: "file" | "folder" }
    | null
  >(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function flash(text: string, ok = true) {
    setSaveMsg({ text, ok });
    window.setTimeout(() => setSaveMsg(null), 2500);
  }

  function setSidebarOpen(open: boolean) {
    setSidebarCollapsed(!open);
    localStorage.setItem(storageKey, open ? "open" : "collapsed");
  }

  async function refresh(preferAbs = selected) {
    try {
      const result = await api.notes.listFiles();
      const prefix = `${rootFolder}/`;
      setFiles(
        result.files
          .filter((f) => f.name.startsWith(prefix))
          .map((f) => ({ ...f, name: f.name.slice(prefix.length) }))
      );
      setFolders(
        result.folders
          .filter((f) => f.startsWith(prefix))
          .map((f) => f.slice(prefix.length))
      );
      if (preferAbs && result.files.some((f) => f.name === preferAbs)) return;
      if (!preferAbs) {
        const firstInSection = result.files.find((f) => f.name.startsWith(prefix));
        if (firstInSection) await openFile(firstInSection.name.slice(prefix.length));
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not load notes", false);
    }
  }

  useEffect(() => {
    setSelected("");
    setFilename("");
    setSource("");
    setFolderRel("");
    api.notes.createFolder(rootFolder).catch(() => {}).finally(() => {
      refresh("").catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFolder]);

  async function openFile(relName: string) {
    try {
      const abs = `${rootFolder}/${relName}`;
      const result = await api.notes.getFile(abs);
      setSelected(abs);
      setFilename(relName.replace(/\.md$/i, ""));
      setFolderRel(parentOf(relName));
      setSource(result.source);
      setDirty(false);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not open note", false);
    }
  }

  function draftName() {
    const base = "untitled";
    const existing = new Set(files.filter((f) => parentOf(f.name) === folderRel).map((f) => leafOf(f.name).replace(/\.md$/i, "")));
    let candidate = base;
    let n = 1;
    while (existing.has(candidate)) candidate = `${base}-${n++}`;
    return candidate;
  }

  async function createFileFromPrompt(typed: string) {
    setPrompt(null);
    const stem = typed.trim().replace(/\.md$/i, "").replace(/^\/+|\/+$/g, "");
    if (!stem) return;
    const rel = folderRel ? `${folderRel}/${stem}` : stem;
    if (files.some((f) => f.name === `${rel}.md`)) {
      await openFile(`${rel}.md`);
      return;
    }
    setSelected("");
    setFilename(rel);
    setSource("---\ntitle: \"\"\ntags: []\n---\n\n# Untitled\n\n");
    setDirty(true);
    setMode((m) => (m === "view" ? "split" : m));
  }

  async function createFolderFromPrompt(typed: string) {
    setPrompt(null);
    const cleaned = typed.trim().replace(/^\/+|\/+$/g, "");
    if (!cleaned) return;
    const rel = folderRel ? `${folderRel}/${cleaned}` : cleaned;
    try {
      await api.notes.createFolder(`${rootFolder}/${rel}`);
      await refresh();
      flash(`Created ${rel}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Folder creation failed", false);
    }
  }

  async function save() {
    const stem = filename.trim();
    if (!stem) return;
    setSaving(true);
    try {
      const abs = `${rootFolder}/${stem}`;
      await api.notes.save(abs, source);
      setDirty(false);
      setSelected(`${abs}.md`);
      await refresh(`${abs}.md`);
      flash("Saved");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Save failed", false);
    } finally {
      setSaving(false);
    }
  }

  async function renamePath(srcAbsRel: string, destTypedName: string, kind: "file" | "folder") {
    const parent = srcAbsRel.includes("/") ? srcAbsRel.slice(0, srcAbsRel.lastIndexOf("/")) : "";
    const cleaned = destTypedName.trim().replace(/^\/+|\/+$/g, "");
    if (!cleaned) return;
    let destRel = cleaned.includes("/") ? cleaned : parent ? `${parent}/${cleaned}` : cleaned;
    if (kind === "file" && !destRel.toLowerCase().endsWith(".md")) destRel += ".md";
    const srcAbs = `${rootFolder}/${srcAbsRel}`;
    const destAbs = `${rootFolder}/${destRel}`;
    if (destAbs === srcAbs) return;
    try {
      await api.notes.rename(srcAbs, destAbs);
      if (selected === srcAbs) {
        setSelected(destAbs);
        if (kind === "file") setFilename(destRel.replace(/\.md$/i, ""));
      }
      if (folderRel === srcAbsRel && kind === "folder") setFolderRel(destRel);
      await refresh(kind === "file" ? destAbs : selected);
      flash(`Renamed → ${destRel}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Rename failed", false);
    }
  }

  function startCenterRename() {
    if (!filename) return;
    setRenaming(true);
  }

  async function commitCenterRename() {
    setRenaming(false);
    if (!selected) {
      // Unsaved draft — just relabel the pending filename, nothing on disk yet.
      return;
    }
    const relBefore = selected.slice(`${rootFolder}/`.length).replace(/\.md$/i, "");
    if (filename.trim() === relBefore) return;
    await renamePath(`${relBefore}.md`, filename.trim(), "file");
  }

  async function deleteFile(relName: string) {
    if (!window.confirm(`Delete ${relName}?`)) return;
    try {
      await api.notes.deleteFile(`${rootFolder}/${relName}`);
      const wasSelected = selected === `${rootFolder}/${relName}`;
      if (wasSelected) {
        setSelected("");
        setFilename("");
        setSource("");
      }
      await refresh(wasSelected ? "" : selected);
      flash("Deleted");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Delete failed", false);
    }
  }

  async function deleteFolder(relPath: string) {
    if (!window.confirm(`Delete folder ${relPath} and everything inside it?`)) return;
    try {
      await api.notes.deleteFolder(`${rootFolder}/${relPath}`);
      if (folderRel === relPath || folderRel.startsWith(`${relPath}/`)) setFolderRel("");
      const selectedInFolder = selected.startsWith(`${rootFolder}/${relPath}/`);
      if (selectedInFolder) {
        setSelected("");
        setFilename("");
        setSource("");
      }
      await refresh(selectedInFolder ? "" : selected);
      flash("Folder deleted");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Folder deletion failed", false);
    }
  }

  async function uploadFiles() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const selectedFiles = Array.from(input.files || []);
      for (const file of selectedFiles) {
        const target = folderRel ? `${rootFolder}/${folderRel}/${file.name}` : `${rootFolder}/${file.name}`;
        const data = await file.arrayBuffer();
        let binary = "";
        for (const byte of new Uint8Array(data)) binary += String.fromCharCode(byte);
        await api.notes.uploadAsset(target, btoa(binary));
      }
      await refresh();
      flash(`Uploaded ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}`);
    };
    input.click();
  }

  async function shareNote() {
    if (!selected && !source) return;
    try {
      const share = (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share;
      if (share) {
        await share({ title: filename || section, text: stripFrontmatter(source) });
        flash("Shared");
      } else {
        await navigator.clipboard.writeText(source);
        flash("Copied note to clipboard");
      }
    } catch {
      flash("Share cancelled", false);
    }
  }

  function insert(before: string, after = "") {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = source.slice(start, end) || "text";
    const next = source.slice(0, start) + before + selectedText + after + source.slice(end);
    setSource(next);
    setDirty(true);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selectedText.length);
    });
  }

  function editAction(action: "undo" | "redo" | "selectAll") {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (action === "selectAll") textarea.select();
    else document.execCommand(action);
    textarea.focus();
  }

  function applyTemplate(label: string) {
    const body = TEMPLATES[label];
    if (!body) return;
    if (dirty && !window.confirm("Replace current content with this template? Unsaved changes will be lost.")) return;
    setSource(body);
    setDirty(true);
  }

  const visibleFolders = useMemo(
    () => folders.filter((path) => parentOf(path) === folderRel && path !== folderRel),
    [folders, folderRel]
  );
  const visibleFiles = useMemo(
    () => files.filter((f) => parentOf(f.name) === folderRel),
    [files, folderRel]
  );
  const filteredFiles = useMemo(
    () => visibleFiles.filter((f) => f.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [visibleFiles, searchTerm]
  );
  const filteredFolders = useMemo(
    () => visibleFolders.filter((f) => f.toLowerCase().includes(searchTerm.toLowerCase())),
    [visibleFolders, searchTerm]
  );

  const menus: MenuConfig[] = [
    {
      id: "file",
      label: "File",
      items: [
        { type: "item", label: "New Markdown file", onClick: () => setPrompt({ type: "file" }) },
        { type: "item", label: "New folder…", onClick: () => setPrompt({ type: "folder" }) },
        { type: "sep" },
        { type: "item", label: "Upload file…", onClick: () => void uploadFiles() },
        { type: "sep" },
        { type: "item", label: "Rename…", disabled: !filename, hint: "Select a note", onClick: startCenterRename },
        { type: "item", label: "Delete", disabled: !selected, hint: "Select a note", onClick: () => selected && void deleteFile(selected.slice(`${rootFolder}/`.length)) },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { type: "item", label: "Undo", shortcut: "Ctrl+Z", onClick: () => editAction("undo") },
        { type: "item", label: "Redo", shortcut: "Ctrl+Y", onClick: () => editAction("redo") },
        { type: "sep" },
        { type: "item", label: "Select all", shortcut: "Ctrl+A", onClick: () => editAction("selectAll") },
      ],
    },
    {
      id: "insert",
      label: "Insert",
      items: [
        { type: "item", label: "Heading", onClick: () => insert("## ") },
        { type: "item", label: "Bold", onClick: () => insert("**", "**") },
        { type: "item", label: "Italic", onClick: () => insert("*", "*") },
        { type: "sep" },
        { type: "item", label: "Link", onClick: () => insert("[", "](url)") },
        { type: "item", label: "Image", onClick: () => void uploadFiles() },
        { type: "item", label: "Code block", onClick: () => insert("```\n", "\n```") },
        { type: "item", label: "Table", onClick: () => insert("| A | B |\n| --- | --- |\n| ", " | |\n") },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { type: "item", label: sidebarCollapsed ? "Show file tree" : "Hide file tree", onClick: () => setSidebarOpen(sidebarCollapsed) },
        { type: "sep" },
        { type: "item", label: mode === "editor" ? "✓ Editor only" : "Editor only", onClick: () => setMode("editor") },
        { type: "item", label: mode === "split" ? "✓ Editor + Preview" : "Editor + Preview", onClick: () => setMode("split") },
        { type: "item", label: mode === "view" ? "✓ Preview only" : "Preview only", onClick: () => setMode("view") },
        { type: "item", label: mode === "present" ? "✓ Present" : "Present", onClick: () => setMode("present") },
      ],
    },
    {
      id: "format",
      label: "Format",
      items: [
        { type: "item", label: "Bold", onClick: () => insert("**", "**") },
        { type: "item", label: "Italic", onClick: () => insert("*", "*") },
        { type: "item", label: "Bullet list", onClick: () => insert("- ") },
        { type: "item", label: "Numbered list", onClick: () => insert("1. ") },
        { type: "item", label: "Quote", onClick: () => insert("> ") },
      ],
    },
    {
      id: "history",
      label: "History",
      panel: (
        <div className="latex-history-panel">
          <div className="latex-history-line muted">No revision history for this note yet.</div>
        </div>
      ),
    },
    {
      id: "templates",
      label: "Templates",
      items: Object.keys(TEMPLATES).map((label) => ({
        type: "item" as const,
        label,
        onClick: () => applyTemplate(label),
      })),
    },
  ];

  const viewModes: { id: NotesViewMode; label: string; title: string }[] = [
    { id: "editor", label: "Editor", title: "Editor only" },
    { id: "split", label: "Split", title: "Editor + Preview" },
    { id: "view", label: "View", title: "Preview only" },
    { id: "present", label: "Present", title: "Present — read-only, zoom, download PDF" },
  ];

  const menuBar = (
    <WorkspaceMenuBar
      menus={menus}
      centerSlot={
        <>
          {renaming ? (
            <input
              autoFocus
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              onBlur={() => void commitCenterRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commitCenterRename(); }
                else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
              }}
              placeholder="path/filename"
              className="mono latex-filename-input"
              title="Enter to save rename, Esc to cancel"
            />
          ) : (
            <span
              className="latex-filename-label mono"
              title="Click to rename"
              role="button"
              tabIndex={0}
              onClick={startCenterRename}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startCenterRename(); } }}
            >
              {filename || "untitled"}
              {dirty ? " *" : ""}
            </span>
          )}
          {saveMsg && (
            <span className={`mono ${saveMsg.ok ? "ok" : "crit"}`} style={{ fontSize: 12 }}>
              {saveMsg.text}
            </span>
          )}
        </>
      }
      rightSlot={
        <>
          <FilesToggleButton collapsed={sidebarCollapsed} onToggle={() => setSidebarOpen(sidebarCollapsed)} />
          <ViewModeToggle modes={viewModes} active={mode} onChange={setMode} />
          <button type="button" className="btn" disabled={!selected && !source} onClick={() => void shareNote()}>Share</button>
          <button type="button" className="btn btn-primary" disabled={saving || !filename.trim()} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    />
  );

  const sidebar = (
    <WorkspaceSidebar
      title={section}
      files={filteredFiles}
      folders={filteredFolders}
      selected={selected ? selected.slice(`${rootFolder}/`.length) : ""}
      currentFolder={folderRel}
      onSelect={(name) => void openFile(name)}
      onOpenFolder={setFolderRel}
      onDelete={(name) => void deleteFile(name)}
      onDeleteFolder={(path) => void deleteFolder(path)}
      onRequestRename={(path, kind) => setPrompt({ type: "rename", src: path, kind: kind === "asset" ? "file" : kind })}
      onNew={() => setPrompt({ type: "file" })}
      onNewFolder={() => setPrompt({ type: "folder" })}
      onUploadFiles={() => void uploadFiles()}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      onCollapse={() => setSidebarOpen(false)}
    />
  );

  return (
    <div className="notes-embedded-shell">
      <WorkspaceLayout
        panelGroupId={`notes-${slugSection(section)}`}
        menuBar={menuBar}
        sidebar={sidebar}
        sidebarCollapsed={sidebarCollapsed}
        onShowSidebar={() => setSidebarOpen(true)}
        sidebarLabel={section}
      >
        {(mode === "editor" || mode === "split") && (
          <>
            <WorkspacePanel id="notes-editor" defaultSize={mode === "split" ? "50" : "100"} minSize="25" className="latex-panel">
              <div className="latex-editor-pane">
                <div className="latex-format-bar" role="toolbar" aria-label="Formatting">
                  <button type="button" className="latex-fmt-btn" title="Heading" onClick={() => insert("## ")}>H</button>
                  <button type="button" className="latex-fmt-btn" title="Bold" onClick={() => insert("**", "**")}><b>B</b></button>
                  <button type="button" className="latex-fmt-btn" title="Italic" onClick={() => insert("*", "*")}><i>I</i></button>
                  <span className="latex-fmt-sep" />
                  <button type="button" className="latex-fmt-btn" title="Bullet list" onClick={() => insert("- ")}>•≡</button>
                  <button type="button" className="latex-fmt-btn" title="Quote" onClick={() => insert("> ")}>”</button>
                  <button type="button" className="latex-fmt-btn" title="Link" onClick={() => insert("[", "](url)")}>🔗</button>
                  <button type="button" className="latex-fmt-btn" title="Code block" onClick={() => insert("```\n", "\n```")}>{"</>"}</button>
                </div>
                {selected || dirty ? (
                  <textarea
                    ref={textareaRef}
                    className="notes-md-editor"
                    value={source}
                    onChange={(e) => { setSource(e.target.value); setDirty(true); }}
                    spellCheck={false}
                  />
                ) : (
                  <div className="latex-preview-empty">Create a Markdown file to start a new note.</div>
                )}
              </div>
            </WorkspacePanel>
            {mode === "split" && <WorkspaceResizeHandle className="latex-resize-handle" />}
          </>
        )}
        {(mode === "split" || mode === "view") && (
          <WorkspacePanel id="notes-preview" defaultSize={mode === "split" ? "50" : "100"} minSize="25" className="latex-panel">
            {selected || dirty ? (
              <EditableMarkdownPreview
                source={stripFrontmatter(source)}
                onChange={(nextBody) => {
                  const fm = source.match(/^---[\s\S]*?---\s*/);
                  setSource((fm ? fm[0] : "") + nextBody);
                  setDirty(true);
                }}
                className="notes-md-preview"
              />
            ) : (
              <div className="latex-preview-empty">No preview — create or open a note.</div>
            )}
          </WorkspacePanel>
        )}
        {mode === "present" && (
          <WorkspacePanel id="notes-present" defaultSize="100" minSize="25" className="latex-panel">
            <PresentPane source={source} title={filename.trim() || leafOf(selected) || section} onFlash={flash} />
          </WorkspacePanel>
        )}
      </WorkspaceLayout>

      <LatexPromptModal
        open={Boolean(prompt)}
        title={prompt?.type === "file" ? "New Markdown file" : prompt?.type === "rename" ? "Rename" : "New folder"}
        label={
          prompt?.type === "file"
            ? `File name${folderRel ? ` (in ${folderRel}/)` : ""}`
            : prompt?.type === "rename"
              ? "New name"
              : "Folder name"
        }
        initial={
          prompt?.type === "file"
            ? draftName()
            : prompt?.type === "rename"
              ? leafOf(prompt.src).replace(/\.md$/i, "")
              : ""
        }
        confirmLabel={prompt?.type === "rename" ? "Rename" : "Create"}
        onClose={() => setPrompt(null)}
        onConfirm={(v) => {
          if (prompt?.type === "file") void createFileFromPrompt(v);
          else if (prompt?.type === "rename") {
            const { src, kind } = prompt;
            setPrompt(null);
            void renamePath(src, v, kind);
          } else void createFolderFromPrompt(v);
        }}
      />
    </div>
  );
}
