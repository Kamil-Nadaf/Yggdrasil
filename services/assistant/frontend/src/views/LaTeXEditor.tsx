import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { EditorState, Prec, Transaction } from "@codemirror/state";
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { undo, redo, historyKeymap } from "@codemirror/commands";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { api, type LatexFile } from "../api/client";
import { LATEX_TEMPLATES, type LatexTemplate } from "../lib/latexTemplates";
import {
  LatexMenuBar,
  LatexShareModal,
  LatexPromptModal,
  pressKeepFocus,
  type LatexViewMode,
} from "../components/LatexMenuBar";
import { WorkspaceLayout } from "../components/WorkspaceLayout";
import { WorkspaceSidebar } from "../components/WorkspaceSidebar";
import { PreviewToolbar, useFullscreenPane, useZoom } from "../components/WorkspacePreviewPane";
import { apiErrorMessage } from "../lib/apiError";
import { downloadBlobUrl, downloadBase64 } from "../lib/download";

const LATEX_LANG = StreamLanguage.define(stex);

const DEFAULT_TEMPLATE = LATEX_TEMPLATES[0];

const NEW_FILE_SOURCE = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\begin{document}

\\end{document}
`;

function todayFilename() {
  return `draft-${new Date().toISOString().slice(0, 10)}`;
}

function renameDestination(src: string, typed: string, kind: "file" | "folder" | "asset") {
  const name = typed.trim().replace(/^\/+|\/+$/g, "");
  if (!name) return "";
  const parent = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
  const leaf = name.includes("/") ? name : parent ? `${parent}/${name}` : name;
  if (kind === "file") {
    return leaf.toLowerCase().endsWith(".tex") ? leaf : `${leaf}.tex`;
  }
  if (kind === "asset") {
    const ext = src.match(/\.[^.]+$/)?.[0] || "";
    if (ext && !leaf.toLowerCase().endsWith(ext.toLowerCase())) return `${leaf}${ext}`;
  }
  return leaf;
}

const editorTheme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--bg)", color: "var(--text)" },
    ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--page-accent)" },
    ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--muted)", border: "none" },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--page-accent) 10%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--page-accent) 12%, transparent)" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--page-accent) 28%, transparent) !important" },
    ".cm-scroller": { overflow: "auto" },
  },
  { dark: true }
);

// Theme-aware syntax colors — CodeMirror's default highlight style uses a
// fixed palette (a saturated blue for strings/brackets) that's hard to read
// against this app's darker themes. Drive it off the same CSS variables the
// rest of the UI uses so it adapts to whichever theme is active.
const latexHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--latex-comment)", fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: "var(--latex-keyword)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "var(--latex-string)" },
  { tag: [t.bracket, t.squareBracket, t.paren, t.brace], color: "var(--latex-bracket)" },
  { tag: [t.variableName, t.propertyName, t.className], color: "var(--text)" },
  { tag: [t.number, t.atom, t.bool], color: "var(--latex-number)" },
  { tag: t.operator, color: "var(--text)" },
  { tag: t.invalid, color: "var(--crit)" },
]);

const TEXT_UPLOAD_EXTS = [".tex", ".bib", ".txt", ".sty", ".cls", ".bst", ".csv", ".dat"];
const BINARY_UPLOAD_EXTS = [".png", ".jpg", ".jpeg", ".pdf", ".eps", ".svg"];
const SKIP_UPLOAD_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

type UploadItem = { file: File; relativePath: string };

function isAllowedUpload(name: string): boolean {
  const base = name.split("/").pop()?.toLowerCase() ?? "";
  if (!base || base.startsWith(".") || SKIP_UPLOAD_NAMES.has(base)) return false;
  if (name.split("/").some((part) => part === "__MACOSX" || part.startsWith("."))) return false;
  const lower = base.toLowerCase();
  return TEXT_UPLOAD_EXTS.some((ext) => lower.endsWith(ext)) || BINARY_UPLOAD_EXTS.some((ext) => lower.endsWith(ext));
}

function sanitizeRelPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

function fileListToUploadItems(list: FileList | File[]): UploadItem[] {
  return Array.from(list)
    .map((file) => {
      const withRel = file as File & { webkitRelativePath?: string };
      const relativePath = sanitizeRelPath(withRel.webkitRelativePath || file.name);
      return { file, relativePath };
    })
    .filter((item) => item.relativePath && isAllowedUpload(item.relativePath));
}

async function readDirectoryEntry(
  entry: FileSystemDirectoryEntry,
  prefix: string,
  out: UploadItem[]
): Promise<void> {
  const reader = entry.createReader();
  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  // readEntries may return partial batches — keep reading until empty
  let batch = await readBatch();
  while (batch.length > 0) {
    for (const child of batch) {
      const childPath = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (child as FileSystemFileEntry).file(resolve, reject)
        );
        if (isAllowedUpload(childPath)) {
          out.push({ file, relativePath: sanitizeRelPath(childPath) });
        }
      } else if (child.isDirectory) {
        if (child.name === "__MACOSX" || child.name.startsWith(".")) continue;
        await readDirectoryEntry(child as FileSystemDirectoryEntry, childPath, out);
      }
    }
    batch = await readBatch();
  }
}

async function collectDataTransferFiles(dataTransfer: DataTransfer): Promise<UploadItem[]> {
  const items = Array.from(dataTransfer.items || []);
  if (items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
    const out: UploadItem[] = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) continue;
      if (entry.isFile) {
        const file = item.getAsFile();
        if (file && isAllowedUpload(file.name)) {
          out.push({ file, relativePath: sanitizeRelPath(file.name) });
        }
      } else if (entry.isDirectory) {
        await readDirectoryEntry(entry as FileSystemDirectoryEntry, entry.name, out);
      }
    }
    if (out.length > 0) return out;
  }
  return fileListToUploadItems(dataTransfer.files);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** B/W landscape figure icon. */
function IconFigure() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="10.2" r="1.6" fill="currentColor" />
      <path
        d="M3.5 16.5 8 12.5l3 2.5 4.5-5.5 5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditorPane({
  editorHostRef,
  lineCol,
  onTool,
}: {
  editorHostRef: React.RefObject<HTMLDivElement>;
  lineCol: string;
  onTool: (action: string) => void;
}) {
  return (
    <div className="latex-editor-pane">
      <div className="latex-format-bar" role="toolbar" aria-label="Formatting">
        <button type="button" className="latex-fmt-btn" title="Undo" aria-label="Undo" {...pressKeepFocus(() => onTool("undo"))}>↶</button>
        <button type="button" className="latex-fmt-btn" title="Redo" aria-label="Redo" {...pressKeepFocus(() => onTool("redo"))}>↷</button>
        <span className="latex-fmt-sep" />
        <button type="button" className="latex-fmt-btn" title="Bold" aria-label="Bold" {...pressKeepFocus(() => onTool("bold"))}><b>B</b></button>
        <button type="button" className="latex-fmt-btn" title="Italic" aria-label="Italic" {...pressKeepFocus(() => onTool("italic"))}><i>I</i></button>
        <button type="button" className="latex-fmt-btn" title="Underline" aria-label="Underline" {...pressKeepFocus(() => onTool("underline"))}><u>U</u></button>
        <span className="latex-fmt-sep" />
        <button type="button" className="latex-fmt-btn" title="Section" aria-label="Section" {...pressKeepFocus(() => onTool("section"))}>§</button>
        <button type="button" className="latex-fmt-btn" title="Bullet list" aria-label="Bullet list" {...pressKeepFocus(() => onTool("itemize"))}>•≡</button>
        <button type="button" className="latex-fmt-btn" title="Numbered list" aria-label="Numbered list" {...pressKeepFocus(() => onTool("enumerate"))}>1.</button>
        <span className="latex-fmt-sep" />
        <button type="button" className="latex-fmt-btn" title="Inline math" aria-label="Inline math" {...pressKeepFocus(() => onTool("math"))}>$x$</button>
        <button type="button" className="latex-fmt-btn" title="Display math" aria-label="Display math" {...pressKeepFocus(() => onTool("displaymath"))}>⟦⟧</button>
        <button type="button" className="latex-fmt-btn" title="Cite" aria-label="Cite" {...pressKeepFocus(() => onTool("cite"))}>cite</button>
        <button type="button" className="latex-fmt-btn" title="Label" aria-label="Label" {...pressKeepFocus(() => onTool("label"))}>lbl</button>
        <button type="button" className="latex-fmt-btn" title="Reference" aria-label="Reference" {...pressKeepFocus(() => onTool("ref"))}>ref</button>
        <span className="latex-fmt-sep" />
        <button type="button" className="latex-fmt-btn" title="Link" aria-label="Link" {...pressKeepFocus(() => onTool("href"))}>🔗</button>
        <button type="button" className="latex-fmt-btn" title="Figure" aria-label="Figure" {...pressKeepFocus(() => onTool("figure"))}>
          <IconFigure />
        </button>
        <button type="button" className="latex-fmt-btn" title="Comment" aria-label="Comment" {...pressKeepFocus(() => onTool("comment"))}>%</button>
      </div>
      <div ref={editorHostRef} className="latex-editor-host" />
      <div className="latex-status-bar">{lineCol}</div>
    </div>
  );
}

function PreviewPane({
  pdfUrl,
  pdfName,
  errors,
  compiling,
  pdfOnly,
  onShowEditor,
}: {
  pdfUrl: string | null;
  pdfName: string;
  errors: string[];
  compiling: boolean;
  pdfOnly?: boolean;
  onShowEditor?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const { zoom, zoomIn, zoomOut, atMinZoom, atMaxZoom } = useZoom();
  const { fullscreen, setFullscreen } = useFullscreenPane();

  useEffect(() => {
    const host = hostRef.current;
    if (!pdfUrl || !host) {
      if (host) host.innerHTML = "";
      setPageCount(0);
      setRenderError(null);
      return;
    }

    let cancelled = false;
    host.innerHTML = "";
    setRenderError(null);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const pdf = await pdfjs.getDocument(pdfUrl).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);

        const baseWidth = Math.max((host.clientWidth || paneRef.current?.clientWidth || 480) - 24, 280);
        const width = baseWidth * zoom;
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          const unscaled = page.getViewport({ scale: 1 });
          const scale = width / unscaled.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.className = "latex-pdf-page";
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          host.appendChild(canvas);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setRenderError(e instanceof Error ? e.message : "PDF preview failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl, zoom, fullscreen]);

  return (
    <div
      ref={paneRef}
      className={`latex-preview-pane${fullscreen ? " is-fullscreen" : ""}`}
    >
      {pdfOnly && onShowEditor && !fullscreen && (
        <div className="latex-pdf-only-bar">
          <span>PDF only — the editor is hidden</span>
          <button type="button" className="btn" onClick={onShowEditor}>
            Show editor
          </button>
        </div>
      )}
      {pdfUrl ? (
        <>
          <PreviewToolbar
            statusLabel={pageCount ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : "Rendering…"}
            zoom={zoom}
            atMinZoom={atMinZoom}
            atMaxZoom={atMaxZoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            fullscreen={fullscreen}
            onEnterFullscreen={() => setFullscreen(true)}
            onExitFullscreen={() => setFullscreen(false)}
            downloadLabel="Download PDF"
            onDownload={() =>
              downloadBlobUrl(pdfUrl, pdfName.endsWith(".pdf") ? pdfName : `${pdfName || "document"}.pdf`)
            }
          />
          {renderError ? (
            <div className="latex-preview-empty">Preview error: {renderError}</div>
          ) : (
            <div ref={hostRef} className="latex-pdf-pages" />
          )}
        </>
      ) : (
        <div className="latex-preview-empty">
          {compiling ? "Compiling…" : "No preview — click Recompile"}
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
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pdfObjectUrlRef = useRef<string | null>(null);

  const [files, setFiles] = useState<LatexFile[]>([]);
  const [assets, setAssets] = useState<LatexFile[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState("");
  const [selected, setSelected] = useState("");
  const [filename, setFilename] = useState(todayFilename());
  const [renaming, setRenaming] = useState(false);
  const renameOriginalRef = useRef<string>("");
  const renameKindRef = useRef<"file" | "folder" | "asset">("file");
  const [searchTerm, setSearchTerm] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [lineCol, setLineCol] = useState("Line 1, Col 1");
  const [filesCollapsed, setFilesCollapsed] = useState(() => {
    const next = localStorage.getItem("yggdrasil:latex-sidebar");
    if (next === "collapsed" || next === "open") return next === "collapsed";
    // Older key hid the tree with no visible way to bring it back.
    return false;
  });
  const [viewMode, setViewMode] = useState<LatexViewMode>(() => {
    const saved = localStorage.getItem("yggdrasil:latex-view");
    return saved === "editor" || saved === "pdf" || saved === "split" ? saved : "split";
  });
  const [shareOpen, setShareOpen] = useState(false);
  const [prompt, setPrompt] = useState<
    | { type: "folder" }
    | { type: "file" }
    | { type: "rename"; src: string; fileKind: "file" | "folder" | "asset" }
    | null
  >(null);
  const [historyStatus, setHistoryStatus] = useState<{
    is_repo: boolean;
    remote?: string | null;
    branch?: string | null;
    last_commit?: string | null;
    dirty_files?: number;
  } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyMsg, setHistoryMsg] = useState<string | null>(null);
  const sourceRef = useRef(DEFAULT_TEMPLATE.source);
  const editorVisible = viewMode !== "pdf";

  function clearPdfUrl() {
    if (pdfObjectUrlRef.current) {
      URL.revokeObjectURL(pdfObjectUrlRef.current);
      pdfObjectUrlRef.current = null;
    }
    setPdfUrl(null);
  }

  function setPdfFromBase64(b64: string) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const prev = pdfObjectUrlRef.current;
    pdfObjectUrlRef.current = url;
    setPdfUrl(url);
    if (prev) URL.revokeObjectURL(prev);
  }

  function setFilesOpen(open: boolean) {
    setFilesCollapsed(!open);
    localStorage.setItem("yggdrasil:latex-sidebar", open ? "open" : "collapsed");
  }
  function getSource() {
    if (viewRef.current) {
      sourceRef.current = viewRef.current.state.doc.toString();
    }
    return sourceRef.current;
  }

  function setSource(text: string, opts?: { recordHistory?: boolean }) {
    sourceRef.current = text;
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      ...(opts?.recordHistory === false
        ? { annotations: Transaction.addToHistory.of(false) }
        : {}),
    });
  }

  function wrapOrInsert(before: string, after: string, placeholder = "") {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const selected = view.state.sliceDoc(sel.from, sel.to);
    const inner = selected || placeholder;
    const insert = before + inner + after;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: selected
        ? { anchor: sel.from + before.length, head: sel.from + before.length + inner.length }
        : { anchor: sel.from + before.length, head: sel.from + before.length + inner.length },
    });
    view.focus();
    setDirty(true);
  }

  function insertBlock(text: string) {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const prefix = sel.from > 0 && view.state.sliceDoc(sel.from - 1, sel.from) !== "\n" ? "\n" : "";
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: prefix + text },
      selection: { anchor: sel.from + prefix.length + text.length },
    });
    view.focus();
    setDirty(true);
  }

  function runTool(action: string) {
    const view = viewRef.current;
    if (!view && action !== "undo" && action !== "redo") return;
    switch (action) {
      case "undo":
        if (view) undo(view);
        break;
      case "redo":
        if (view) redo(view);
        break;
      case "bold":
        wrapOrInsert("\\textbf{", "}", "bold");
        break;
      case "italic":
        wrapOrInsert("\\textit{", "}", "italic");
        break;
      case "underline":
        wrapOrInsert("\\underline{", "}", "text");
        break;
      case "section":
        wrapOrInsert("\\section{", "}", "Section title");
        break;
      case "subsection":
        wrapOrInsert("\\subsection{", "}", "Subsection title");
        break;
      case "subsubsection":
        wrapOrInsert("\\subsubsection{", "}", "Subsubsection title");
        break;
      case "itemize":
        insertBlock("\\begin{itemize}\n  \\item \n\\end{itemize}\n");
        break;
      case "enumerate":
        insertBlock("\\begin{enumerate}\n  \\item \n\\end{enumerate}\n");
        break;
      case "math":
        wrapOrInsert("$", "$", "x");
        break;
      case "displaymath":
        insertBlock("\\begin{equation}\n  \n\\end{equation}\n");
        break;
      case "cite":
        wrapOrInsert("\\citep{", "}", "key");
        break;
      case "label":
        wrapOrInsert("\\label{", "}", "sec:id");
        break;
      case "ref":
        wrapOrInsert("\\ref{", "}", "sec:id");
        break;
      case "href":
        wrapOrInsert("\\href{https://example.com}{", "}", "link text");
        break;
      case "figure":
        insertBlock(
          "\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figure.pdf}\n  \\caption{Caption}\\label{fig:id}\n\\end{figure}\n"
        );
        break;
      case "table":
        insertBlock(
          "\\begin{table}[ht]\n  \\centering\n  \\begin{tabular}{cc}\n    A & B \\\\\n    C & D\n  \\end{tabular}\n  \\caption{Caption}\\label{tab:id}\n\\end{table}\n"
        );
        break;
      case "comment": {
        if (!view) return;
        const sel = view.state.selection.main;
        const line = view.state.doc.lineAt(sel.from);
        view.dispatch({
          changes: { from: line.from, insert: "% " },
        });
        view.focus();
        setDirty(true);
        break;
      }
      default:
        break;
    }
  }

  function applyTemplate(tpl: LatexTemplate) {
    if (dirty && !window.confirm("Replace current editor content with this template? Unsaved changes will be lost in the buffer (vault file unchanged until Save).")) {
      return;
    }
    setSource(tpl.source, { recordHistory: false });
    setFilename(tpl.filename);
    setSelected("");
    setDirty(true);
    setSaveMsg({ text: `Loaded template: ${tpl.label}`, ok: true });
    setTimeout(() => setSaveMsg(null), 2500);
  }

  function updateLineCol() {
    const view = viewRef.current;
    if (!view) return;
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos).number;
    const col = pos - view.state.doc.line(line).from + 1;
    setLineCol(`Line ${line}, Col ${col}`);
  }

  function changeViewMode(mode: LatexViewMode) {
    getSource(); // stash doc before possible unmount
    setViewMode(mode);
    localStorage.setItem("yggdrasil:latex-view", mode);
  }

  function uniqueDraftName() {
    const base = todayFilename();
    const existing = new Set(
      files.map((f) => {
        const stem = f.name.replace(/\.tex$/i, "");
        return currentFolder && stem.startsWith(currentFolder + "/")
          ? stem.slice(currentFolder.length + 1)
          : stem.split("/").pop() || stem;
      })
    );
    let candidate = base;
    let suffix = 1;
    while (existing.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  useEffect(() => {
    if (!editorVisible) {
      getSource();
      viewRef.current?.destroy();
      viewRef.current = null;
      return;
    }
    let view: EditorView | null = null;
    const t = window.setTimeout(() => {
      const host = editorHostRef.current;
      if (!host) return;
      host.innerHTML = "";
      view = new EditorView({
        state: EditorState.create({
          doc: sourceRef.current,
          extensions: [
            basicSetup,
            Prec.highest(
              keymap.of([
                ...historyKeymap,
                { key: "Mod-z", run: undo, preventDefault: true },
                { key: "Mod-y", run: redo, preventDefault: true },
                { key: "Mod-Shift-z", run: redo, preventDefault: true },
              ])
            ),
            LATEX_LANG,
            editorTheme,
            syntaxHighlighting(latexHighlightStyle),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                setDirty(true);
                sourceRef.current = update.state.doc.toString();
              }
              if (update.selectionSet) updateLineCol();
            }),
          ],
        }),
        parent: host,
      });
      viewRef.current = view;
      updateLineCol();
      view.requestMeasure();
    }, 0);
    return () => {
      window.clearTimeout(t);
      if (view) {
        sourceRef.current = view.state.doc.toString();
        view.destroy();
      }
      if (viewRef.current === view) viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorVisible]);

  useEffect(() => {
    refreshFiles();
    return () => {
      if (pdfObjectUrlRef.current) {
        URL.revokeObjectURL(pdfObjectUrlRef.current);
        pdfObjectUrlRef.current = null;
      }
    };
  }, []);

  function refreshFiles() {
    api.latex
      .listFiles()
      .then((r) => {
        setFolders((r.folders ?? []).filter((folder) => !folder.startsWith("_")));
        setFiles((r.files ?? []).filter((f) => !f.name.startsWith("_")));
        setAssets((r.assets ?? []).filter((f) => !f.name.startsWith("_")));
      })
      .catch(() => {});
  }

  const visibleFolders = currentFolder
    ? folders.filter((folder) => {
        const relative = folder.slice(currentFolder.length + 1);
        return folder.startsWith(currentFolder + "/") && relative && !relative.includes("/");
      })
    : folders.filter((folder) => !folder.includes("/"));

  const visibleFiles = currentFolder
    ? files.filter((file) => {
        const relative = file.name.slice(currentFolder.length + 1);
        return file.name.startsWith(currentFolder + "/") && relative && !relative.includes("/");
      })
    : files.filter((file) => !file.name.includes("/"));

  const visibleAssets = currentFolder
    ? assets.filter((file) => {
        const relative = file.name.slice(currentFolder.length + 1);
        return file.name.startsWith(currentFolder + "/") && relative && !relative.includes("/");
      })
    : assets.filter((file) => !file.name.includes("/"));

  async function handleSelectFile(name: string) {
    setSelected(name);
    setSaveMsg(null);
    clearPdfUrl();
    setErrors([]);
    if (!name) {
      setFilename(todayFilename());
      setSource(DEFAULT_TEMPLATE.source, { recordHistory: false });
      setDirty(false);
      return;
    }
    const stem = name.replace(/\.tex$/, "");
    setFilename(stem);
    try {
      const r = await api.latex.getFile(stem);
      setSource(r.source, { recordHistory: false });
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
      setPdfFromBase64(r.pdf_b64);
      if (viewMode === "editor") changeViewMode("split");
    } catch (e: unknown) {
      const err = e as Error & { data?: { log?: string; errors?: string[] } };
      clearPdfUrl();
      setErrors(err.data?.errors?.length ? err.data.errors : [err.message || "Compile failed"]);
      if (viewMode === "editor") changeViewMode("split");
    } finally {
      setCompiling(false);
    }
  }

  async function handleDelete(name: string) {
    if (!window.confirm(`Delete ${name}?`)) return;
    try {
      await api.latex.deleteFile(name.replace(/\.tex$/, ""));
      if (selected === name) handleSelectFile("");
      setSaveMsg({ text: `Deleted ${name}`, ok: true });
      refreshFiles();
    } catch {
      setSaveMsg({ text: `Failed to delete ${name}`, ok: false });
    }
  }

  async function handleDeleteFolder(folder: string) {
    if (!window.confirm(`Delete folder "${folder}" and everything inside it?`)) return;
    try {
      await api.latex.deleteFolder(folder);
      if (currentFolder === folder || currentFolder.startsWith(folder + "/")) {
        setCurrentFolder("");
      }
      if (selected.startsWith(folder + "/")) handleSelectFile("");
      setSaveMsg({ text: `Deleted folder ${folder}`, ok: true });
      refreshFiles();
    } catch {
      setSaveMsg({ text: `Failed to delete folder ${folder}`, ok: false });
    }
  }

  async function handleDeleteAsset(name: string) {
    if (!window.confirm(`Delete asset ${name}?`)) return;
    try {
      await api.latex.deleteAsset(name);
      setSaveMsg({ text: `Deleted ${name}`, ok: true });
      refreshFiles();
    } catch {
      setSaveMsg({ text: `Failed to delete ${name}`, ok: false });
    }
  }

  const refreshHistory = useCallback(async () => {
    try {
      const s = await api.vault.gitStatus();
      setHistoryStatus(s);
      setHistoryMsg(null);
    } catch (e: unknown) {
      setHistoryMsg(e instanceof Error ? e.message : "Failed to load git status");
    }
  }, []);

  async function syncHistory() {
    setHistoryBusy(true);
    setHistoryMsg(null);
    try {
      const r = await api.vault.gitSync();
      setHistoryMsg(r.message || (r.ok ? "Synced" : "Sync failed"));
      await refreshHistory();
    } catch (e: unknown) {
      setHistoryMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function handleClipboard(action: "cut" | "copy" | "paste") {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    try {
      if (action === "paste") {
        const text = await navigator.clipboard.readText();
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
        });
        setDirty(true);
      } else {
        const selected = view.state.sliceDoc(sel.from, sel.to);
        if (!selected) return;
        await navigator.clipboard.writeText(selected);
        if (action === "cut") {
          view.dispatch({ changes: { from: sel.from, to: sel.to, insert: "" } });
          setDirty(true);
        }
      }
      view.focus();
    } catch {
      setSaveMsg({ text: "Clipboard permission denied", ok: false });
      setTimeout(() => setSaveMsg(null), 2500);
    }
  }

  function handleDownloadPdf() {
    if (!pdfUrl) return;
    const base = (filename.trim() || selected || "document").replace(/\.tex$/i, "");
    downloadBlobUrl(pdfUrl, `${base}.pdf`);
  }

  async function handleDownloadSource() {
    const target = (selected || filename.trim()).replace(/\.tex$/i, "");
    if (!target) {
      setSaveMsg({ text: "Nothing to download", ok: false });
      setTimeout(() => setSaveMsg(null), 2500);
      return;
    }
    try {
      const zipPath = target.includes("/")
        ? target.slice(0, target.lastIndexOf("/"))
        : target;
      const r = await api.latex.zip(zipPath);
      downloadBase64(r.zip_b64, r.filename, "application/zip");
    } catch {
      // Unsaved buffer — download current .tex
      const source = getSource();
      const base = target.split("/").pop() || "document";
      const url = URL.createObjectURL(new Blob([source], { type: "application/x-tex" }));
      downloadBlobUrl(url, `${base}.tex`);
      URL.revokeObjectURL(url);
      setSaveMsg({ text: "Downloaded current buffer (.tex). Save the project for a full .zip.", ok: true });
      setTimeout(() => setSaveMsg(null), 3500);
    }
  }

  async function handleDeleteSelected() {
    const target = selected || filename.trim().replace(/\.tex$/i, "");
    if (!target) {
      setSaveMsg({ text: "Select a file in the tree to delete", ok: false });
      setTimeout(() => setSaveMsg(null), 2500);
      return;
    }
    // Prefer exact selected name; filename may omit .tex
    const name = selected || (files.some((f) => f.name === target || f.name === `${target}.tex`)
      ? (files.find((f) => f.name === target || f.name === `${target}.tex`)?.name.replace(/\.tex$/, "") ?? target)
      : target);
    await handleDelete(name.replace(/\.tex$/, ""));
  }

  function startRename() {
    if (selected) {
      const fileKind = assets.some((a) => a.name === selected) ? "asset" : "file";
      setPrompt({ type: "rename", src: selected, fileKind });
      return;
    }
    // No tree item selected — this is the currently-open document shown
    // top-center in the toolbar; edit it inline instead of via a modal.
    beginInlineRename();
  }

  /** Inline rename of the top-center filename label — click to edit, Enter to commit. */
  function beginInlineRename() {
    const stem = filename.trim().replace(/\.tex$/i, "");
    let src = `${stem || uniqueDraftName()}.tex`;
    let kind: "file" | "folder" | "asset" = "file";
    const fileMatch = files.find((f) => f.name === stem || f.name === `${stem}.tex`);
    if (fileMatch) {
      src = fileMatch.name;
      kind = "file";
    } else {
      const folderMatch = folders.find((f) => f === stem || f === filename);
      if (folderMatch) {
        src = folderMatch;
        kind = "folder";
      } else {
        const assetMatch = assets.find((a) => a.name === filename);
        if (assetMatch) {
          src = assetMatch.name;
          kind = "asset";
        }
      }
    }
    renameOriginalRef.current = src;
    renameKindRef.current = kind;
    setRenaming(true);
  }

  async function commitInlineRename() {
    if (!renaming) return;
    setRenaming(false);
    const src = renameOriginalRef.current;
    const dest = renameDestination(src, filename, renameKindRef.current);
    if (!dest || dest === src) return;
    await handleRenamePath(src, dest);
  }

  function cancelInlineRename() {
    setRenaming(false);
    setFilename(renameOriginalRef.current.replace(/\.tex$/i, ""));
  }

  function requestTreeRename(path: string, fileKind: "file" | "folder" | "asset") {
    setPrompt({ type: "rename", src: path, fileKind });
  }

  /** Drag a file/asset row onto a folder row to move it there. */
  async function handleMoveIntoFolder(path: string, folder: string) {
    const base = path.split("/").pop() || path;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parent === folder) return; // already there
    const dest = `${folder}/${base}`;
    if (dest === path) return;
    await handleRenamePath(path, dest);
  }

  async function handleRenamePath(src: string, dest: string) {
    if (!dest.trim() || dest === src) return;
    const onDisk =
      files.some((f) => f.name === src) ||
      folders.includes(src) ||
      assets.some((a) => a.name === src);
    if (!onDisk) {
      setFilename(dest.replace(/\.tex$/i, ""));
      setDirty(true);
      setSaveMsg({ text: `Will save as ${dest.replace(/\.tex$/i, "")}.tex`, ok: true });
      setTimeout(() => setSaveMsg(null), 2500);
      return;
    }
    try {
      await api.latex.rename(src, dest);
      const srcStem = src.replace(/\.tex$/i, "");
      const destStem = dest.replace(/\.tex$/i, "");
      if (selected === src || selected === `${srcStem}.tex`) {
        setSelected(dest);
      }
      if (filename === srcStem || filename === src) {
        setFilename(dest.endsWith(".tex") ? destStem : dest);
      }
      if (currentFolder === src) setCurrentFolder(dest);
      else if (currentFolder.startsWith(src + "/")) {
        setCurrentFolder(dest + currentFolder.slice(src.length));
      }
      setSaveMsg({ text: `Renamed → ${dest}`, ok: true });
      refreshFiles();
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (e: unknown) {
      setSaveMsg({ text: apiErrorMessage(e, "Rename failed"), ok: false });
      setTimeout(() => setSaveMsg(null), 2500);
    }
  }

  async function applyPromptRename(typed: string) {
    if (!prompt || prompt.type !== "rename") return;
    const dest = renameDestination(prompt.src, typed, prompt.fileKind);
    setPrompt(null);
    if (!dest || dest === prompt.src) return;
    await handleRenamePath(prompt.src, dest);
  }

  function handleOpenFolder(folder: string) {
    setCurrentFolder(folder);
    setSelected("");
    setSaveMsg(null);
    clearPdfUrl();
    setErrors([]);
  }

  function handleNewFile() {
    setPrompt({ type: "file" });
  }

  async function createFileFromPrompt(raw: string) {
    setPrompt(null);
    const stem = raw.trim().replace(/\.tex$/i, "").replace(/^\/+|\/+$/g, "");
    if (!stem) return;
    const rel = currentFolder ? `${currentFolder}/${stem}` : stem;
    const destName = `${rel}.tex`;
    if (files.some((f) => f.name === destName || f.name === rel)) {
      if (!window.confirm(`${destName} already exists. Open it instead?`)) return;
      await handleSelectFile(destName);
      return;
    }
    if (dirty && !window.confirm("Create a new file? Unsaved editor changes will be lost.")) {
      return;
    }
    try {
      await api.latex.save(rel, NEW_FILE_SOURCE);
      if (viewMode === "pdf") changeViewMode("split");
      setFilename(rel);
      setSelected(destName);
      setSource(NEW_FILE_SOURCE, { recordHistory: false });
      setDirty(false);
      setSaveMsg({ text: `Created ${destName}`, ok: true });
      clearPdfUrl();
      setErrors([]);
      refreshFiles();
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (e: unknown) {
      setSaveMsg({ text: apiErrorMessage(e, "Could not create file"), ok: false });
      setTimeout(() => setSaveMsg(null), 2500);
    }
  }

  async function handleUploadFiles() {
    fileInputRef.current?.click();
  }

  async function handleUploadFolder() {
    folderInputRef.current?.click();
  }

  async function uploadItems(items: UploadItem[]) {
    if (items.length === 0) {
      setSaveMsg({ text: "No supported files (.tex, .bib, images, …)", ok: false });
      return;
    }

    let uploaded = 0;
    let lastTex: string | null = null;
    let projectRoot: string | null = null;

    for (const { file, relativePath } of items) {
      const rel = sanitizeRelPath(relativePath);
      if (!rel || !isAllowedUpload(rel)) continue;

      const targetRel = currentFolder ? `${currentFolder}/${rel}` : rel;
      const lower = rel.toLowerCase();
      const isText = TEXT_UPLOAD_EXTS.some((ext) => lower.endsWith(ext));

      // Track top-level folder of a multi-file / folder upload
      if (rel.includes("/")) {
        const top = (currentFolder ? `${currentFolder}/${rel}` : rel).split("/")[0];
        projectRoot = projectRoot ?? top;
      }

      try {
        if (isText && lower.endsWith(".tex")) {
          const source = await file.text();
          const stem = targetRel.replace(/\.tex$/i, "");
          await api.latex.save(stem, source);
          lastTex = `${stem}.tex`;
        } else if (isText) {
          const source = await file.text();
          const b64 = btoa(unescape(encodeURIComponent(source)));
          await api.latex.uploadAsset(targetRel, b64);
        } else {
          const b64 = await fileToBase64(file);
          await api.latex.uploadAsset(targetRel, b64);
        }
        uploaded += 1;
      } catch {
        setSaveMsg({ text: `Upload failed: ${rel}`, ok: false });
        refreshFiles();
        return;
      }
    }

    refreshFiles();

    if (lastTex) {
      const stem = lastTex.replace(/\.tex$/, "");
      // Prefer main.tex when a project folder was uploaded
      const preferred = items
        .map((i) => sanitizeRelPath(i.relativePath))
        .find((p) => /(^|\/)main\.tex$/i.test(p));
      const openStem = preferred
        ? (currentFolder ? `${currentFolder}/${preferred}` : preferred).replace(/\.tex$/i, "")
        : stem;
      try {
        const r = await api.latex.getFile(openStem);
        setFilename(openStem);
        setSelected(`${openStem}.tex`);
        setSource(r.source, { recordHistory: false });
        setDirty(false);
        if (openStem.includes("/")) {
          const parent = openStem.split("/").slice(0, -1).join("/");
          setCurrentFolder(parent);
        } else if (projectRoot) {
          setCurrentFolder(projectRoot);
        }
      } catch {
        /* listing refresh is enough */
      }
    } else if (projectRoot) {
      setCurrentFolder(projectRoot);
    }

    setSaveMsg({
      text: uploaded === 1 ? `Uploaded ${uploaded} file` : `Uploaded ${uploaded} files`,
      ok: true,
    });
  }

  async function handleNewFolder() {
    setPrompt({ type: "folder" });
  }

  async function createFolderFromPrompt(trimmed: string) {
    setPrompt(null);
    if (!trimmed) return;
    const cleaned = trimmed.replace(/^\/+|\/+$/g, "");
    if (!cleaned) return;
    const folderPath = currentFolder ? `${currentFolder}/${cleaned}` : cleaned;
    try {
      await api.latex.createFolder(folderPath);
      setSaveMsg({ text: `Created ${folderPath}`, ok: true });
      refreshFiles();
    } catch (e: unknown) {
      setSaveMsg({ text: apiErrorMessage(e, "Folder creation failed"), ok: false });
    }
  }

  async function handleDroppedFiles(dataTransfer: DataTransfer) {
    const items = await collectDataTransferFiles(dataTransfer);
    await uploadItems(items);
  }

  async function onUploadFile(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    await uploadItems(fileListToUploadItems(event.target.files));
    event.target.value = "";
  }

  async function onUploadFolder(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    await uploadItems(fileListToUploadItems(event.target.files));
    event.target.value = "";
  }

  const filteredFiles = visibleFiles.filter((f) => f.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredAssets = visibleAssets.filter((f) => f.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredFolders = visibleFolders.filter((folder) => folder.toLowerCase().includes(searchTerm.toLowerCase()));

  const menuBar = (
      <LatexMenuBar
        filename={filename}
        renaming={renaming}
        onStartRename={startRename}
        onFilenameChange={setFilename}
        onCommitRename={commitInlineRename}
        onCancelRename={cancelInlineRename}
        dirty={dirty}
        saveMsg={saveMsg}
        compiling={compiling}
        saving={saving}
        viewMode={viewMode}
        filesCollapsed={filesCollapsed}
        canDelete={
          Boolean(selected) ||
          files.some(
            (f) =>
              f.name === filename.trim() ||
              f.name === `${filename.trim().replace(/\.tex$/i, "")}.tex`
          )
        }
        canDownloadPdf={Boolean(pdfUrl)}
        canDownloadSource={Boolean(filename.trim() || selected)}
        templates={LATEX_TEMPLATES.map((t) => ({ id: t.id, label: t.label }))}
        onCompile={handleCompile}
        onSave={handleSave}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onUploadFiles={() => fileInputRef.current?.click()}
        onUploadFolder={() => folderInputRef.current?.click()}
        onDownloadPdf={handleDownloadPdf}
        onDownloadSource={handleDownloadSource}
        onDelete={handleDeleteSelected}
        onUndo={() => runTool("undo")}
        onRedo={() => runTool("redo")}
        onCut={() => void handleClipboard("cut")}
        onCopy={() => void handleClipboard("copy")}
        onPaste={() => void handleClipboard("paste")}
        onTool={runTool}
        onViewMode={changeViewMode}
        onToggleFiles={() => setFilesOpen(filesCollapsed)}
        onTemplate={(id) => {
          const tpl = LATEX_TEMPLATES.find((t) => t.id === id);
          if (tpl) applyTemplate(tpl);
        }}
        onHistoryRefresh={refreshHistory}
        onHistorySync={syncHistory}
        historyStatus={historyStatus}
        historyBusy={historyBusy}
        historyMsg={historyMsg}
        onShare={() => setShareOpen(true)}
      />
  );

  const sidebar = (
    <WorkspaceSidebar
      files={filteredFiles}
      assets={filteredAssets}
      folders={filteredFolders}
      selected={selected}
      currentFolder={currentFolder}
      onSelect={handleSelectFile}
      onOpenFolder={handleOpenFolder}
      onDelete={handleDelete}
      onDeleteFolder={handleDeleteFolder}
      onDeleteAsset={handleDeleteAsset}
      onRequestRename={requestTreeRename}
      onNew={handleNewFile}
      onNewFolder={handleNewFolder}
      onUploadFiles={handleUploadFiles}
      onUploadFolder={handleUploadFolder}
      onDropFiles={handleDroppedFiles}
      onMoveIntoFolder={handleMoveIntoFolder}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      onCollapse={() => setFilesOpen(false)}
    />
  );

  return (
    <>
      <LatexShareModal open={shareOpen} onClose={() => setShareOpen(false)} />
      <LatexPromptModal
        open={Boolean(prompt)}
        title={
          prompt?.type === "file"
            ? "New file"
            : prompt?.type === "rename"
              ? "Rename"
              : "New folder"
        }
        label={
          prompt?.type === "file"
            ? `File name${currentFolder ? ` (in ${currentFolder}/)` : ""}`
            : prompt?.type === "rename"
              ? "New name"
              : "Folder name"
        }
        initial={
          prompt?.type === "file"
            ? uniqueDraftName()
            : prompt?.type === "rename"
              ? prompt.src.split("/").pop() || prompt.src
              : ""
        }
        confirmLabel={prompt?.type === "rename" ? "Rename" : "Create"}
        onClose={() => setPrompt(null)}
        onConfirm={(v) => {
          if (prompt?.type === "file") void createFileFromPrompt(v);
          else if (prompt?.type === "rename") void applyPromptRename(v);
          else void createFolderFromPrompt(v);
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".tex,.bib,.txt,.png,.jpg,.jpeg,.pdf,.eps,.svg,.sty,.cls,.bst,.csv"
        multiple
        style={{ display: "none" }}
        onChange={onUploadFile}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={onUploadFolder}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
      />

      <WorkspaceLayout
        panelGroupId="latex"
        menuBar={menuBar}
        sidebar={sidebar}
        sidebarCollapsed={filesCollapsed}
        onShowSidebar={() => setFilesOpen(true)}
        sidebarSize={{ default: 22, min: 16, max: 40 }}
      >
        {editorVisible && (
          <>
            <Panel
              id="latex-editor"
              defaultSize={
                viewMode === "split"
                  ? filesCollapsed ? "55" : "50"
                  : filesCollapsed ? "100" : "82"
              }
              minSize="25"
              className="latex-panel"
            >
              <EditorPane editorHostRef={editorHostRef} lineCol={lineCol} onTool={runTool} />
            </Panel>
            {viewMode === "split" && <PanelResizeHandle className="latex-resize-handle" />}
          </>
        )}

        {viewMode !== "editor" && (
          <Panel
            id="latex-preview"
            defaultSize={
              viewMode === "split"
                ? filesCollapsed ? "45" : "32"
                : filesCollapsed ? "100" : "82"
            }
            minSize="25"
            className="latex-panel"
          >
            <PreviewPane
              pdfUrl={pdfUrl}
              pdfName={filename.trim() || selected || "document"}
              errors={errors}
              compiling={compiling}
              pdfOnly={viewMode === "pdf"}
              onShowEditor={() => changeViewMode("split")}
            />
          </Panel>
        )}
      </WorkspaceLayout>
    </>
  );
}
