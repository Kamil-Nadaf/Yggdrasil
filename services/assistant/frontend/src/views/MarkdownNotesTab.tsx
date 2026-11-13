import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type LatexFile } from "../api/client";
import AbstractText from "../components/AbstractText";
import EditableMarkdownPreview from "../components/EditableMarkdownPreview";
import { WorkspaceLayout, WorkspacePanel } from "../components/WorkspaceLayout";
import { WorkspaceSidebar } from "../components/WorkspaceSidebar";
import { WorkspaceMenuBar, FilesToggleButton, type MenuConfig } from "../components/WorkspaceMenuBar";
import { LatexPromptModal } from "../components/LatexMenuBar";
import { PreviewToolbar, useFullscreenPane, useZoom } from "../components/WorkspacePreviewPane";
import { countPdfPages } from "../lib/markdownToLatex";
import { exportNoteToPdf } from "../lib/exportNotePdf";
import IconFigure from "../components/IconFigure";
import NoteTagsButton from "../components/NoteTagsButton";
import { ensureTitle, getTitle, normalizeTag, parseTags, setTags, setTitle, stripFrontmatter } from "../lib/noteTags";
import { findTables, serializeTable } from "../lib/mdTable";
import { apiErrorMessage } from "../lib/apiError";
import { downloadBase64 } from "../lib/download";
import { fileToBase64, imageFileName, imageFilesFrom } from "../lib/pastedImages";

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

/** "5 Dec 2024" from whatever the notes API returns for `modified` (ISO string or epoch seconds/ms). */
function formatEdited(modified: string | number | undefined): string {
  if (modified === undefined || modified === "") return "";
  let d: Date;
  if (typeof modified === "number" || /^\d+(\.\d+)?$/.test(String(modified))) {
    const n = Number(modified);
    d = new Date(n < 1e11 ? n * 1000 : n);
  } else {
    d = new Date(modified);
  }
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── tiny inline icons for the wiki-style toolbar ───────────────────────────────
function Ico({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const IcoLink = () => <Ico><path d="M6.6 9.4l2.8-2.8M5.3 7.7L4.2 8.8a2.4 2.4 0 003.4 3.4l1.1-1.1M10.7 8.3l1.1-1.1a2.4 2.4 0 00-3.4-3.4L7.3 4.9" /></Ico>;
const IcoBullets = () => <Ico><circle cx="3" cy="4" r=".6" fill="currentColor" /><circle cx="3" cy="8" r=".6" fill="currentColor" /><circle cx="3" cy="12" r=".6" fill="currentColor" /><path d="M6 4h8M6 8h8M6 12h8" /></Ico>;
const IcoNumbers = () => <Ico><path d="M7 4h7M7 8h7M7 12h7M2.5 3l1-.6V6M2.2 9.5c.3-.9 1.8-.9 1.8 0 0 .7-1.8 1.3-1.8 2h1.9" /></Ico>;
const IcoChecklist = () => <Ico><path d="M2 4l1.2 1.2L5.4 3M2 9l1.2 1.2L5.4 8M7.5 4.5H14M7.5 9.5H14M2.5 13h2.5M7.5 13H14" /></Ico>;
const IcoDiagram = () => <Ico><rect x="1.5" y="2" width="5" height="3.5" rx="0.8" /><rect x="9.5" y="2" width="5" height="3.5" rx="0.8" /><rect x="5.5" y="10.5" width="5" height="3.5" rx="0.8" /><path d="M4 5.5v2.5h8V5.5M8 8v2.5" /></Ico>;
const IcoTable = () => <Ico><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2 7h12M2 10h12M7 3v10" /></Ico>;
const IcoPlus = () => <Ico><path d="M8 3v10M3 8h10" /></Ico>;
const IcoChevron = () => <Ico><path d="M4.5 6.5L8 10l3.5-3.5" /></Ico>;
const IcoDots = () => <Ico><circle cx="8" cy="3.5" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="12.5" r=".9" fill="currentColor" /></Ico>;
const IcoPdf = () => <Ico><path d="M4 1.5h5.5L13 5v9.5H4z M9.5 1.5V5H13M6 9h4M6 11.5h4" /></Ico>;

/** Small popover menu that closes on outside click / Escape. */
function Popover({
  open,
  onClose,
  align = "left",
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={`notes-pop notes-pop-${align}`} role="menu">
      {children}
    </div>
  );
}

function PopItem({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" className="notes-pop-item" disabled={disabled} onClick={onClick}>
      <span className="notes-pop-icon">{icon}</span>
      <span className="notes-pop-label">
        {label}
        {hint && <span className="notes-pop-hint">{hint}</span>}
      </span>
    </button>
  );
}

/** Read-only formatted view (headings/lists/math/code, no editor chrome) with the
 * same zoom/fullscreen/Download bottom bar as LaTeX Editor's PDF pane. */
function PresentPane({
  source,
  title,
  imageBase,
  onFlash,
  onClose,
}: {
  source: string;
  title: string;
  imageBase?: string;
  onFlash: (text: string, ok?: boolean) => void;
  onClose: () => void;
}) {
  const { zoom, zoomIn, zoomOut, atMinZoom, atMaxZoom } = useZoom();
  const { fullscreen, setFullscreen } = useFullscreenPane();
  const [exporting, setExporting] = useState(false);
  const body = stripFrontmatter(source);
  const words = useMemo(() => wordCount(body), [body]);

  async function handleDownload() {
    setExporting(true);
    try {
      const b64 = await exportNoteToPdf(source, title, imageBase ?? "");
      downloadBase64(b64, `${title || "note"}.pdf`, "application/pdf");
      onFlash("Downloaded PDF");
    } catch (error) {
      onFlash(apiErrorMessage(error, "PDF export failed"), false);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`latex-preview-pane${fullscreen ? " is-fullscreen" : ""}`}>
      <div className="notes-present-back">
        <button type="button" className="btn" onClick={onClose}>← Back to page</button>
      </div>
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
            <AbstractText text={body} className="notes-present-text" imageBase={imageBase} />
          ) : (
            <div className="latex-preview-empty">Nothing to present yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MarkdownNotesTab({
  section = "Quick Notes",
  rootFolder: rootFolderProp,
}: {
  /** Display name (and, without rootFolder, the folder under the notes workspace). */
  section?: string;
  /** Folder under the notes workspace when it differs from the name, e.g. "Projects/my-paper". */
  rootFolder?: string;
}) {
  const rootFolder = rootFolderProp ?? section;
  const storageKey = `${slugSection(rootFolder)}-sidebar-state`;

  const [files, setFiles] = useState<LatexFile[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [folderRel, setFolderRel] = useState("");
  const [selected, setSelected] = useState(""); // absolute path, "" = unsaved draft
  const [filename, setFilename] = useState(""); // relative-to-section stem, no extension
  const [source, setSource] = useState("");
  const [savedSource, setSavedSource] = useState("");
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [tagging, setTagging] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(storageKey) === "collapsed");
  const [renaming, setRenaming] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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
        if (firstInSection) await openFile(firstInSection.name.slice(prefix.length), true);
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not load notes", false);
    }
  }

  useEffect(() => {
    setSelected("");
    setFilename("");
    setSource("");
    setSavedSource("");
    setEditing(false);
    setPresenting(false);
    setFolderRel("");
    api.notes.createFolder(rootFolder).catch(() => {}).finally(() => {
      refresh("").catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFolder]);

  async function openFile(relName: string, force = false) {
    if (!force && editing && dirty && !window.confirm("Discard unsaved changes to this note?")) return;
    try {
      const abs = `${rootFolder}/${relName}`;
      const result = await api.notes.getFile(abs);
      setSelected(abs);
      setFilename(relName.replace(/\.md$/i, ""));
      setFolderRel(parentOf(relName));
      setSource(result.source);
      setSavedSource(result.source);
      setDirty(false);
      setEditing(false);
      setPreviewing(false);
      setPresenting(false);
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
    const fresh = "---\ntitle: \"\"\ntags: []\n---\n\n# Untitled\n\n";
    setSource(fresh);
    setSavedSource("");
    setDirty(true);
    setEditing(true);
    setPreviewing(false);
    setPresenting(false);
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

  const tags = useMemo(() => parseTags(source), [source]);

  function addTags(raw: string) {
    const incoming = raw.split(",").map(normalizeTag).filter(Boolean);
    if (!incoming.length) return;
    setSource((prev) => setTags(prev, [...new Set([...parseTags(prev), ...incoming])]));
    setDirty(true);
  }

  function removeTag(tag: string) {
    setSource((prev) => setTags(prev, parseTags(prev).filter((t) => t !== tag)));
    setDirty(true);
  }

  /** Extract keyword tags, merge them with the user's own, fill an empty title, and save. */
  async function autoTag() {
    if (!filename.trim()) return;
    setTagging(true);
    try {
      const { tags: suggested } = await api.notes.suggestTags(source);
      const merged = [...new Set([...parseTags(source), ...suggested])];
      const next = ensureTitle(setTags(source, merged));
      setSource(next);
      await save(next, { close: false });
      flash(suggested.length ? `Tagged: ${suggested.length} keywords` : "No keywords found");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Auto-tag failed", false);
    } finally {
      setTagging(false);
    }
  }

  async function save(nextSource: string = source, opts: { close?: boolean } = { close: true }) {
    let stem = filename.trim();
    if (!stem) {
      flash("Give the note a file name first", false);
      return;
    }
    setSaving(true);
    try {
      // Changing the page title renames the file too, so the sidebar shows the new name.
      const title = getTitle(nextSource).trim();
      if (title && title !== getTitle(savedSource).trim()) {
        const leaf = title.replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/^[-.\s]+|[-.\s]+$/g, "").slice(0, 80);
        if (leaf) {
          const parent = parentOf(stem);
          const base = parent ? `${parent}/${leaf}` : leaf;
          let cand = base;
          let n = 1;
          while (cand !== stem && files.some((f) => f.name === `${cand}.md`)) cand = `${base}-${n++}`;
          if (cand !== stem) {
            if (selected) await api.notes.rename(selected, `${rootFolder}/${cand}.md`);
            stem = cand;
            setFilename(cand);
          }
        }
      }
      const abs = `${rootFolder}/${stem}`;
      await api.notes.save(abs, nextSource);
      setDirty(false);
      setSavedSource(nextSource);
      setSelected(`${abs}.md`);
      await refresh(`${abs}.md`);
      if (opts.close) {
        setEditing(false);
        setPreviewing(false);
      }
      flash("Saved");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Save failed", false);
    } finally {
      setSaving(false);
    }
  }

  function startEditing() {
    setPresenting(false);
    setEditing(true);
    setPreviewing(false);
  }

  function cancelEditing() {
    if (dirty && !window.confirm("Discard your changes?")) return;
    setSource(savedSource);
    setDirty(false);
    setEditing(false);
    setPreviewing(false);
    if (!selected) {
      // Never-saved draft: nothing on disk to fall back to.
      setFilename("");
      setSource("");
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
        setSavedSource("");
        setEditing(false);
        setDirty(false);
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
        setSavedSource("");
        setEditing(false);
        setDirty(false);
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

  /** Folder (inside the notes vault) of the open note; relative image links resolve against it. */
  const noteDir = selected
    ? selected.split("/").slice(0, -1).join("/")
    : folderRel
      ? `${rootFolder}/${folderRel}`
      : rootFolder;

  // ── editor primitives ────────────────────────────────────────────────────────

  /** Replace [start,end) through the browser's edit pipeline so Ctrl+Z keeps working. */
  function replaceRange(start: number, end: number, text: string, selStart = start + text.length, selEnd = selStart) {
    const ta = textareaRef.current;
    if (!ta) {
      setSource((prev) => prev.slice(0, start) + text + prev.slice(end));
      setDirty(true);
      return;
    }
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }
    if (!ok) {
      setSource((prev) => prev.slice(0, start) + text + prev.slice(end));
      setDirty(true);
    }
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  }

  function selection(): { start: number; end: number } {
    const ta = textareaRef.current;
    return { start: ta?.selectionStart ?? source.length, end: ta?.selectionEnd ?? source.length };
  }

  function wrap(before: string, after = before, placeholder = "text") {
    const { start, end } = selection();
    const picked = source.slice(start, end) || placeholder;
    replaceRange(start, end, before + picked + after, start + before.length, start + before.length + picked.length);
  }

  /** Apply `fn` to every line touched by the selection. */
  function mapLines(fn: (line: string, index: number, all: string[]) => string) {
    const { start, end } = selection();
    const blockStart = source.lastIndexOf("\n", start - 1) + 1;
    const nl = source.indexOf("\n", end);
    const blockEnd = nl === -1 ? source.length : nl;
    const lines = source.slice(blockStart, blockEnd).split("\n");
    const next = lines.map(fn).join("\n");
    replaceRange(blockStart, blockEnd, next, blockStart, blockStart + next.length);
  }

  function cycleHeading() {
    mapLines((line) => {
      const m = line.match(/^(#{1,6})\s+/);
      if (!m) return `## ${line}`;
      const level = m[1].length;
      return level >= 2 && level < 4 ? `${"#".repeat(level + 1)} ${line.slice(m[0].length)}` : line.slice(m[0].length);
    });
  }

  const LIST_PREFIX = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;

  function toggleList(kind: "bullet" | "number" | "task") {
    const testers = {
      bullet: /^\s*[-*+]\s+(?!\[[ xX]\])/,
      number: /^\s*\d+[.)]\s+/,
      task: /^\s*[-*+]\s+\[[ xX]\]\s+/,
    };
    mapLines((line, i, all) => {
      const nonEmpty = all.filter((l) => l.trim());
      const allHave = nonEmpty.length > 0 && nonEmpty.every((l) => testers[kind].test(l));
      const stripped = line.replace(LIST_PREFIX, "$1");
      if (allHave) return stripped;
      if (!line.trim()) return line;
      const prefix = kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${i + 1}. `;
      const indent = stripped.match(/^\s*/)?.[0] ?? "";
      return `${indent}${prefix}${stripped.slice(indent.length)}`;
    });
  }

  function insertCode() {
    const { start, end } = selection();
    const picked = source.slice(start, end);
    if (picked.includes("\n")) insertBlock("```\n" + picked + "\n```");
    else wrap("`", "`", "code");
  }

  function insertLink() {
    const { start, end } = selection();
    const label = source.slice(start, end) || "text";
    const text = `[${label}](url)`;
    const urlStart = start + label.length + 3;
    replaceRange(start, end, text, urlStart, urlStart + 3);
  }

  /** Insert a block on its own lines (blank line before when needed); `select` is the part to highlight afterwards. */
  function insertBlock(text: string, select?: string) {
    const { start, end } = selection();
    const head = source.slice(0, start);
    const lead = start === 0 || head.endsWith("\n\n") ? "" : head.endsWith("\n") ? "\n" : "\n\n";
    const tail = "\n";
    const full = lead + text + tail;
    const at = select ? text.indexOf(select) : -1;
    const base = start + lead.length;
    if (at >= 0 && select) replaceRange(start, end, full, base + at, base + at + select.length);
    else replaceRange(start, end, full);
  }

  /** A ```mermaid block with a starter diagram selected, so pasting your own Mermaid code replaces it. */
  function insertDiagram() {
    insertBlock("```mermaid\nflowchart TB\n  A[Start] --> B[Next step]\n```", "flowchart TB\n  A[Start] --> B[Next step]");
  }

  function insertTable() {
    insertBlock("| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |", "Column 1");
  }

  function reformatTables() {
    const tables = findTables(source);
    if (tables.length === 0) {
      flash("No tables to reformat", false);
      return;
    }
    let next = source;
    for (const t of [...tables].reverse()) next = next.slice(0, t.start) + serializeTable(t) + next.slice(t.end);
    replaceRange(0, source.length, next, 0);
    flash(`Reformatted ${tables.length} table${tables.length === 1 ? "" : "s"}`);
  }

  /** Save pasted / dropped images to <section>/assets/ and insert ![](relative/link) at the cursor. */
  async function insertImages(imageFiles: File[]) {
    if (imageFiles.length === 0) return;
    const { start, end } = selection();
    const depth = noteDir.split("/").length - rootFolder.split("/").length;
    const up = "../".repeat(Math.max(0, depth));
    try {
      let snippet = "";
      for (let i = 0; i < imageFiles.length; i++) {
        const name = imageFileName(imageFiles[i], i);
        await api.notes.uploadAsset(`${rootFolder}/assets/${name}`, await fileToBase64(imageFiles[i]));
        snippet += `${i > 0 ? "\n" : ""}![${name.replace(/\.[^.]+$/, "")}](${up}assets/${name})`;
      }
      replaceRange(start, end, snippet);
      flash(`Added ${imageFiles.length} image${imageFiles.length === 1 ? "" : "s"}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Image upload failed", false);
    }
  }

  function pickImages() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => void insertImages(imageFilesFrom({ files: input.files } as unknown as DataTransfer));
    input.click();
  }

  function onEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      void save(source, { close: false });
      return;
    }
    if (mod && key === "b") {
      e.preventDefault();
      wrap("**");
      return;
    }
    if (mod && key === "i") {
      e.preventDefault();
      wrap("*");
      return;
    }
    if (mod && key === "k") {
      e.preventDefault();
      insertLink();
      return;
    }
    // Enter on a list line continues the list (and an empty item ends it).
    if (e.key === "Enter" && !e.shiftKey && !mod && !e.nativeEvent.isComposing) {
      const ta = e.currentTarget;
      if (ta.selectionStart !== ta.selectionEnd) return;
      const pos = ta.selectionStart;
      const lineStart = source.lastIndexOf("\n", pos - 1) + 1;
      const nl = source.indexOf("\n", pos);
      const lineEnd = nl === -1 ? source.length : nl;
      if (pos !== lineEnd) return;
      const m = source.slice(lineStart, lineEnd).match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
      if (!m) return;
      e.preventDefault();
      if (!m[4].trim()) {
        replaceRange(lineStart, lineEnd, "");
        return;
      }
      const marker = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}${m[2].slice(-1)}` : m[2];
      replaceRange(pos, pos, `\n${m[1]}${marker} ${m[3] ? "[ ] " : ""}`);
    }
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

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(source);
      flash("Copied markdown");
    } catch {
      flash("Copy failed", false);
    }
  }

  const pageTitle = getTitle(source) || leafOf(filename) || "Untitled";

  /** Export the open note (including unsaved edits) to PDF — each `---` line starts a new page. */
  async function exportPdf() {
    if (!stripFrontmatter(source).trim()) {
      flash("Nothing to export yet", false);
      return;
    }
    setExporting(true);
    flash("Generating PDF…");
    try {
      const b64 = await exportNoteToPdf(source, pageTitle, noteDir);
      const safe = (leafOf(filename) || pageTitle).replace(/[^A-Za-z0-9._ -]+/g, "-");
      downloadBase64(b64, `${safe}.pdf`, "application/pdf");
      const pages = countPdfPages(source);
      flash(`Exported PDF · ${pages} page${pages === 1 ? "" : "s"}`);
    } catch (error) {
      flash(apiErrorMessage(error, "PDF export failed"), false);
    } finally {
      setExporting(false);
    }
  }

  function applyTemplate(label: string) {
    const body = TEMPLATES[label];
    if (!body) return;
    if (dirty && !window.confirm("Replace current content with this template? Unsaved changes will be lost.")) return;
    setSource(body);
    setDirty(true);
    setEditing(true);
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

  const hasNote = Boolean(selected || dirty || filename);
  const lastEdited = selected ? formatEdited(files.find((f) => `${rootFolder}/${f.name}` === selected)?.modified) : "";

  const menus: MenuConfig[] = [
    {
      id: "file",
      label: "File",
      items: [
        { type: "item", label: "New Markdown file", onClick: () => setPrompt({ type: "file" }) },
        { type: "item", label: "New folder…", onClick: () => setPrompt({ type: "folder" }) },
        { type: "sep" },
        { type: "item", label: "Save", shortcut: "Ctrl+S", disabled: !editing, hint: "Click Edit first", onClick: () => void save(source, { close: false }) },
        { type: "item", label: "Export as PDF…", hint: "A line with --- starts a new page", disabled: !hasNote || exporting, onClick: () => void exportPdf() },
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
        { type: "item", label: "Edit page", disabled: !hasNote || editing, onClick: startEditing },
        { type: "sep" },
        { type: "item", label: "Undo", shortcut: "Ctrl+Z", disabled: !editing, onClick: () => { textareaRef.current?.focus(); document.execCommand("undo"); } },
        { type: "item", label: "Redo", shortcut: "Ctrl+Y", disabled: !editing, onClick: () => { textareaRef.current?.focus(); document.execCommand("redo"); } },
        { type: "sep" },
        { type: "item", label: "Select all", shortcut: "Ctrl+A", disabled: !editing, onClick: () => { textareaRef.current?.select(); } },
      ],
    },
    {
      id: "insert",
      label: "Insert",
      items: [
        { type: "item", label: "Heading", disabled: !editing, onClick: cycleHeading },
        { type: "item", label: "Link", disabled: !editing, onClick: insertLink },
        { type: "item", label: "Image…", disabled: !editing, onClick: pickImages },
        { type: "item", label: "Table", disabled: !editing, onClick: insertTable },
        { type: "item", label: "Code block", disabled: !editing, onClick: () => insertBlock("```\ncode\n```", "code") },
        { type: "item", label: "Diagram / mind map", hint: "Paste Mermaid code inside", disabled: !editing, onClick: insertDiagram },
        { type: "item", label: "Page break (---)", disabled: !editing, onClick: () => insertBlock("---") },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { type: "item", label: sidebarCollapsed ? "Show file tree" : "Hide file tree", onClick: () => setSidebarOpen(sidebarCollapsed) },
        { type: "sep" },
        { type: "item", label: presenting ? "✓ Present" : "Present", hint: "Read-only, zoom, download PDF", disabled: !hasNote, onClick: () => setPresenting((p) => !p) },
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
          <NoteTagsButton
            tags={tags}
            disabled={!filename.trim()}
            busy={tagging}
            onAdd={addTags}
            onRemove={removeTag}
            onAuto={() => void autoTag()}
          />
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

  // ── wiki-style page: read view ──────────────────────────────────────────────
  const readView = (
    <div className="notes-wiki">
      <div className="notes-wiki-scroll">
        <div className="notes-wiki-head">
          <div className="notes-wiki-titleblock">
            <h1 className="notes-wiki-title">{pageTitle}</h1>
            <div className="notes-wiki-meta">
              {lastEdited ? <>Last edited <strong>{lastEdited}</strong></> : <>Not saved yet</>}
              {tags.length > 0 && (
                <span className="notes-wiki-tags">
                  {tags.map((t) => <span key={t} className="notes-wiki-tag">#{t}</span>)}
                </span>
              )}
            </div>
          </div>
          <div className="notes-wiki-actions">
            <button type="button" className="notes-wiki-btn" onClick={startEditing}>Edit</button>
            <button type="button" className="notes-wiki-btn" disabled={exporting} onClick={() => void exportPdf()} title="Export as PDF — a line with --- starts a new page">
              <IcoPdf /> {exporting ? "Exporting…" : "PDF"}
            </button>
            <div className="notes-pop-anchor">
              <button type="button" className="notes-wiki-btn notes-wiki-icon" aria-label="More actions" onClick={() => setMoreOpen((o) => !o)}>
                <IcoDots />
              </button>
              <Popover open={moreOpen} onClose={() => setMoreOpen(false)} align="right">
                <PopItem icon={<IcoPdf />} label="Export as PDF" hint="--- starts a new page" disabled={exporting} onClick={() => { setMoreOpen(false); void exportPdf(); }} />
                <PopItem label="Present" onClick={() => { setMoreOpen(false); setPresenting(true); }} />
                <PopItem label="Share" onClick={() => { setMoreOpen(false); void shareNote(); }} />
                <PopItem label="Copy markdown" onClick={() => { setMoreOpen(false); void copyMarkdown(); }} />
                <PopItem label="Rename" disabled={!filename} onClick={() => { setMoreOpen(false); startCenterRename(); }} />
                <PopItem label="Delete" disabled={!selected} onClick={() => { setMoreOpen(false); selected && void deleteFile(selected.slice(`${rootFolder}/`.length)); }} />
              </Popover>
            </div>
          </div>
        </div>
        {stripFrontmatter(source).trim() ? (
          <AbstractText text={stripFrontmatter(source)} className="notes-wiki-body" imageBase={noteDir} />
        ) : (
          <div className="latex-preview-empty">This page is empty. Click Edit to start writing.</div>
        )}
      </div>
    </div>
  );

  // ── wiki-style page: edit view ──────────────────────────────────────────────
  const noSel = previewing;
  const fmt = (label: string, onClick: () => void, child: ReactNode, extra = "") => (
    <button
      type="button"
      className={`notes-tb-btn${extra ? ` ${extra}` : ""}`}
      title={label}
      aria-label={label}
      disabled={noSel}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {child}
    </button>
  );

  const editView = (
    <div className="notes-wiki">
      <div className="notes-wiki-edit-head">
        <input
          className="notes-wiki-title-input"
          value={getTitle(source)}
          placeholder={leafOf(filename) || "Untitled"}
          onChange={(e) => { setSource((prev) => setTitle(prev, e.target.value)); setDirty(true); }}
          aria-label="Page title"
        />
        <div className="notes-wiki-actions">
          <div className="notes-save-group">
            <button type="button" className="notes-wiki-btn notes-wiki-btn-primary" disabled={saving || !filename.trim()} onClick={() => void save(source, { close: true })}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <div className="notes-pop-anchor">
              <button type="button" className="notes-wiki-btn notes-wiki-btn-primary notes-save-caret" aria-label="More save options" onClick={() => setSaveOpen((o) => !o)}>
                <IcoChevron />
              </button>
              <Popover open={saveOpen} onClose={() => setSaveOpen(false)} align="right">
                <PopItem label="Save and keep editing" hint="Ctrl+S" onClick={() => { setSaveOpen(false); void save(source, { close: false }); }} />
                <PopItem label="Discard changes" onClick={() => { setSaveOpen(false); cancelEditing(); }} />
              </Popover>
            </div>
          </div>
          <button type="button" className="notes-wiki-btn" onClick={cancelEditing}>Cancel</button>
        </div>
      </div>

      <div className="notes-tb" role="toolbar" aria-label="Formatting">
        <button type="button" className={`notes-tb-text${previewing ? " is-on" : ""}`} onClick={() => setPreviewing((p) => !p)} title="Toggle preview">
          {previewing ? "Edit" : "Preview"}
        </button>
        <span className="notes-tb-sep" />
        {fmt("Bold (Ctrl+B)", () => wrap("**"), <b>B</b>)}
        {fmt("Italic (Ctrl+I)", () => wrap("*"), <i>I</i>)}
        {fmt("Strikethrough", () => wrap("~~"), <s>S</s>)}
        <span className="notes-tb-sep" />
        {fmt("Heading (click again for smaller)", cycleHeading, <span className="notes-tb-glyph">H</span>)}
        {fmt("Code", insertCode, <span className="notes-tb-glyph">{"</>"}</span>)}
        {fmt("Link (Ctrl+K)", insertLink, <IcoLink />)}
        {fmt("Bulleted list", () => toggleList("bullet"), <IcoBullets />)}
        {fmt("Numbered list", () => toggleList("number"), <IcoNumbers />)}
        {fmt("Task list", () => toggleList("task"), <IcoChecklist />)}
        <span className="notes-tb-sep" />
        {fmt("Table", insertTable, <IcoTable />)}
        {fmt("Diagram / mind map (Mermaid)", insertDiagram, <IcoDiagram />)}
        {fmt("Insert image (or paste / drop one into the editor)", pickImages, <IconFigure />)}
        <span className="notes-tb-sep" />
        <div className="notes-pop-anchor">
          <button
            type="button"
            className="notes-tb-btn notes-tb-wide"
            title="Insert…"
            aria-label="Insert more"
            disabled={noSel}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPlusOpen((o) => !o)}
          >
            <IcoPlus /><IcoChevron />
          </button>
          <Popover open={plusOpen} onClose={() => setPlusOpen(false)}>
            <PopItem label="Alert" hint="Note / warning callout" onClick={() => { setPlusOpen(false); insertBlock("> [!NOTE]\n> Write your note here", "Write your note here"); }} />
            <PopItem label="Code block" onClick={() => { setPlusOpen(false); insertBlock("```\ncode\n```", "code"); }} />
            <PopItem label="Diagram / mind map" hint="Paste Mermaid code inside; renders in preview" onClick={() => { setPlusOpen(false); insertDiagram(); }} />
            <PopItem label="Collapsible section" onClick={() => { setPlusOpen(false); insertBlock("<details>\n<summary>Title</summary>\n\nContent\n\n</details>", "Title"); }} />
            <PopItem label="Math block" onClick={() => { setPlusOpen(false); insertBlock("$$\nE = mc^2\n$$", "E = mc^2"); }} />
            <PopItem label="Horizontal rule / page break" hint="--- starts a new page in the PDF" onClick={() => { setPlusOpen(false); insertBlock("---"); }} />
            <PopItem label="Table of contents" onClick={() => { setPlusOpen(false); insertBlock("[TOC]"); }} />
            <PopItem label="Reformat table" onClick={() => { setPlusOpen(false); reformatTables(); }} />
          </Popover>
        </div>
        <span className="notes-tb-spacer" />
        <button type="button" className="notes-tb-text" disabled={exporting} onClick={() => void exportPdf()} title="Export as PDF — a line with --- starts a new page">
          <IcoPdf /> {exporting ? "Exporting…" : "Export PDF"}
        </button>
      </div>

      {previewing ? (
        <div className="notes-wiki-scroll">
          <EditableMarkdownPreview
            source={stripFrontmatter(source)}
            onChange={(nextBody) => {
              const fm = source.slice(0, source.length - stripFrontmatter(source).length);
              setSource(fm + nextBody);
              setDirty(true);
            }}
            className="notes-wiki-body"
            imageBase={noteDir}
          />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="notes-md-editor notes-wiki-textarea"
          value={source}
          autoFocus
          onChange={(e) => { setSource(e.target.value); setDirty(true); }}
          onKeyDown={onEditorKeyDown}
          onPaste={(e) => {
            const images = imageFilesFrom(e.clipboardData);
            if (images.length === 0) return;
            e.preventDefault();
            void insertImages(images);
          }}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            const images = imageFilesFrom(e.dataTransfer);
            if (images.length === 0) return;
            e.preventDefault();
            void insertImages(images);
          }}
          spellCheck={false}
        />
      )}
    </div>
  );

  return (
    <div className="notes-embedded-shell">
      <WorkspaceLayout
        panelGroupId={`notes-${slugSection(rootFolder)}`}
        menuBar={menuBar}
        sidebar={sidebar}
        sidebarCollapsed={sidebarCollapsed}
        onShowSidebar={() => setSidebarOpen(true)}
        sidebarLabel={section}
      >
        <WorkspacePanel id="notes-page" defaultSize="100" minSize="25" className="latex-panel">
          {!hasNote ? (
            <div className="latex-preview-empty">Create a Markdown file to start a new note.</div>
          ) : presenting ? (
            <PresentPane
              source={source}
              title={pageTitle}
              imageBase={noteDir}
              onFlash={flash}
              onClose={() => setPresenting(false)}
            />
          ) : editing ? (
            editView
          ) : (
            readView
          )}
        </WorkspacePanel>
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
