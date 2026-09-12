import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type LatexViewMode = "editor" | "split" | "pdf";

type MenuId = "file" | "edit" | "insert" | "view" | "format" | "history" | "templates" | null;

type MenuItem =
  | {
      type: "item";
      label: string;
      shortcut?: string;
      disabled?: boolean;
      hint?: string;
      onClick: () => void;
    }
  | { type: "sep" };

/**
 * Format-bar only: keep CodeMirror focused.
 * Do not use on menus / Share / Save — preventDefault on pointerdown swallows
 * click, which Safari needs for file pickers and which makes buttons look dead.
 */
export function pressKeepFocus(handler: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = e.currentTarget as HTMLButtonElement;
      if (el.disabled) return;
      e.preventDefault();
      handler();
    },
  };
}

function MenuDropdown({
  id,
  label,
  open,
  onOpen,
  items,
  align = "left",
  panel,
}: {
  id: MenuId;
  label: string;
  open: MenuId;
  onOpen: (id: MenuId) => void;
  items?: MenuItem[];
  align?: "left" | "right";
  panel?: ReactNode;
}) {
  const active = open === id;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!active || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const width = 240;
    let left = align === "right" ? r.right - width : r.left;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    setPos({ top: r.bottom + 4, left });
  }, [active, align]);

  return (
    <div className={`latex-menu${active ? " open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="latex-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={active}
        onClick={() => onOpen(active ? null : id)}
        onMouseEnter={() => {
          if (open) onOpen(id);
        }}
      >
        {label}
      </button>
      {active &&
        createPortal(
          <div
            className="latex-menu-dropdown"
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {panel
              ? panel
              : items?.map((item, i) =>
                  item.type === "sep" ? (
                    <div key={`sep-${i}`} className="latex-menu-sep" />
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      className="latex-menu-item"
                      disabled={item.disabled}
                      title={item.disabled ? item.hint : item.shortcut}
                      onClick={() => {
                        if (item.disabled) return;
                        item.onClick();
                        onOpen(null);
                      }}
                    >
                      <span>{item.label}</span>
                      {(item.disabled ? item.hint : item.shortcut) && (
                        <span className="latex-menu-shortcut">
                          {item.disabled ? item.hint : item.shortcut}
                        </span>
                      )}
                    </button>
                  )
                )}
          </div>,
          document.body
        )}
    </div>
  );
}

export function LatexMenuBar({
  filename,
  renaming,
  onStartRename,
  onFilenameChange,
  onCommitRename,
  onCancelRename,
  dirty,
  saveMsg,
  compiling,
  saving,
  viewMode,
  filesCollapsed,
  canDelete,
  canDownloadPdf,
  canDownloadSource,
  templates,
  onCompile,
  onSave,
  onNewFile,
  onNewFolder,
  onUploadFiles,
  onUploadFolder,
  onDownloadPdf,
  onDownloadSource,
  onDelete,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onTool,
  onViewMode,
  onToggleFiles,
  onTemplate,
  onHistoryRefresh,
  onHistorySync,
  historyStatus,
  historyBusy,
  historyMsg,
  onShare,
}: {
  filename: string;
  renaming: boolean;
  onStartRename: () => void;
  onFilenameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  dirty: boolean;
  saveMsg: { text: string; ok: boolean } | null;
  compiling: boolean;
  saving: boolean;
  viewMode: LatexViewMode;
  filesCollapsed: boolean;
  canDelete: boolean;
  canDownloadPdf: boolean;
  canDownloadSource: boolean;
  templates: { id: string; label: string }[];
  onCompile: () => void;
  onSave: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onDownloadPdf: () => void;
  onDownloadSource: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onTool: (action: string) => void;
  onViewMode: (mode: LatexViewMode) => void;
  onToggleFiles: () => void;
  onTemplate: (id: string) => void;
  onHistoryRefresh: () => void;
  onHistorySync: () => void;
  historyStatus: {
    is_repo: boolean;
    remote?: string | null;
    branch?: string | null;
    last_commit?: string | null;
    dirty_files?: number;
  } | null;
  historyBusy: boolean;
  historyMsg: string | null;
  onShare: () => void;
}) {
  const [open, setOpen] = useState<MenuId>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (barRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest(".latex-menu-dropdown")) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open === "history") onHistoryRefresh();
  }, [open, onHistoryRefresh]);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl+";
  const displayName = filename.trim() || "untitled";

  const fileItems: MenuItem[] = [
    { type: "item", label: "New file", onClick: onNewFile },
    { type: "item", label: "New folder…", onClick: onNewFolder },
    { type: "sep" },
    { type: "item", label: "Upload file…", onClick: onUploadFiles },
    { type: "item", label: "Upload folder…", onClick: onUploadFolder },
    { type: "sep" },
    { type: "item", label: "Rename…", onClick: onStartRename },
    {
      type: "item",
      label: "Download PDF",
      disabled: !canDownloadPdf,
      hint: "Recompile first",
      onClick: onDownloadPdf,
    },
    {
      type: "item",
      label: "Download source (.zip)",
      disabled: !canDownloadSource,
      hint: "Save or select a file",
      onClick: onDownloadSource,
    },
    { type: "sep" },
    {
      type: "item",
      label: "Delete",
      disabled: !canDelete,
      hint: "Select a file",
      onClick: onDelete,
    },
  ];

  const editItems: MenuItem[] = [
    { type: "item", label: "Undo", shortcut: `${mod}Z`, onClick: onUndo },
    { type: "item", label: "Redo", shortcut: isMac ? "⇧⌘Z" : "Ctrl+Y", onClick: onRedo },
    { type: "sep" },
    { type: "item", label: "Cut", shortcut: `${mod}X`, onClick: onCut },
    { type: "item", label: "Copy", shortcut: `${mod}C`, onClick: onCopy },
    { type: "item", label: "Paste", shortcut: `${mod}V`, onClick: onPaste },
  ];

  const insertItems: MenuItem[] = [
    { type: "item", label: "Section", onClick: () => onTool("section") },
    { type: "item", label: "Subsection", onClick: () => onTool("subsection") },
    { type: "item", label: "Subsubsection", onClick: () => onTool("subsubsection") },
    { type: "sep" },
    { type: "item", label: "Bold", onClick: () => onTool("bold") },
    { type: "item", label: "Italic", onClick: () => onTool("italic") },
    { type: "sep" },
    { type: "item", label: "Inline math", onClick: () => onTool("math") },
    { type: "item", label: "Display math", onClick: () => onTool("displaymath") },
    { type: "sep" },
    { type: "item", label: "Figure", onClick: () => onTool("figure") },
    { type: "item", label: "Table", onClick: () => onTool("table") },
    { type: "item", label: "Citation", onClick: () => onTool("cite") },
    { type: "item", label: "Link", onClick: () => onTool("href") },
    { type: "item", label: "Comment", onClick: () => onTool("comment") },
  ];

  const viewItems: MenuItem[] = [
    {
      type: "item",
      label: filesCollapsed ? "Show file tree" : "Hide file tree",
      onClick: onToggleFiles,
    },
    { type: "sep" },
    {
      type: "item",
      label: viewMode === "editor" ? "✓ Editor only" : "Editor only",
      onClick: () => onViewMode("editor"),
    },
    {
      type: "item",
      label: viewMode === "split" ? "✓ Editor + PDF" : "Editor + PDF",
      onClick: () => onViewMode("split"),
    },
    {
      type: "item",
      label: viewMode === "pdf" ? "✓ PDF only" : "PDF only",
      onClick: () => onViewMode("pdf"),
    },
    { type: "sep" },
    {
      type: "item",
      label: "Download PDF",
      disabled: !canDownloadPdf,
      hint: "Recompile first",
      onClick: onDownloadPdf,
    },
  ];

  const formatItems: MenuItem[] = [
    { type: "item", label: "Bold", onClick: () => onTool("bold") },
    { type: "item", label: "Italic", onClick: () => onTool("italic") },
    { type: "item", label: "Underline", onClick: () => onTool("underline") },
    { type: "sep" },
    { type: "item", label: "Bullet list", onClick: () => onTool("itemize") },
    { type: "item", label: "Numbered list", onClick: () => onTool("enumerate") },
    { type: "sep" },
    { type: "item", label: "Section", onClick: () => onTool("section") },
    { type: "item", label: "Subsection", onClick: () => onTool("subsection") },
    { type: "item", label: "Subsubsection", onClick: () => onTool("subsubsection") },
  ];

  const templateItems: MenuItem[] = templates.map((t) => ({
    type: "item" as const,
    label: t.label,
    onClick: () => onTemplate(t.id),
  }));

  const historyPanel = (
    <div className="latex-history-panel">
      {!historyStatus ? (
        <div className="latex-history-line muted">Loading vault git status…</div>
      ) : !historyStatus.is_repo ? (
        <div className="latex-history-line muted">
          Vault is not a git repo. Configure remote under Settings → Data Sync (Git).
        </div>
      ) : (
        <>
          <div className="latex-history-line">
            Branch: <span className="mono">{historyStatus.branch || "—"}</span>
          </div>
          <div className="latex-history-line muted">{historyStatus.last_commit || "No commits yet"}</div>
          <div className="latex-history-line muted">
            Remote: {historyStatus.remote || "none"}
            {typeof historyStatus.dirty_files === "number" ? ` · ${historyStatus.dirty_files} dirty` : ""}
          </div>
        </>
      )}
      {historyMsg && <div className="latex-history-line">{historyMsg}</div>}
      <div className="latex-history-actions">
        <button type="button" className="btn" disabled={historyBusy} onClick={onHistoryRefresh}>
          Refresh
        </button>
        <button type="button" className="btn btn-primary" disabled={historyBusy} onClick={onHistorySync}>
          {historyBusy ? "Syncing…" : "Sync Now"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="latex-menubar-wrap" ref={barRef}>
      <div className="latex-menubar">
        <MenuDropdown id="file" label="File" open={open} onOpen={setOpen} items={fileItems} />
        <MenuDropdown id="edit" label="Edit" open={open} onOpen={setOpen} items={editItems} />
        <MenuDropdown id="insert" label="Insert" open={open} onOpen={setOpen} items={insertItems} />
        <MenuDropdown id="view" label="View" open={open} onOpen={setOpen} items={viewItems} />
        <MenuDropdown id="format" label="Format" open={open} onOpen={setOpen} items={formatItems} />
        <MenuDropdown id="history" label="History" open={open} onOpen={setOpen} panel={historyPanel} />
        <MenuDropdown id="templates" label="Templates" open={open} onOpen={setOpen} items={templateItems} />
      </div>

      <div className="latex-toolbar-center">
        {renaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={filename}
            onChange={(e) => onFilenameChange(e.target.value)}
            onBlur={() => onCommitRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename();
              }
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
            onClick={onStartRename}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onStartRename();
              }
            }}
          >
            {displayName}
            {dirty ? " *" : ""}
          </span>
        )}
        {saveMsg && (
          <span className={`mono ${saveMsg.ok ? "ok" : "crit"}`} style={{ fontSize: 12 }}>
            {saveMsg.text}
          </span>
        )}
      </div>

      <div className="latex-toolbar-right">
        <div className="latex-layout-seg" role="group" aria-label="Layout">
          {(
            [
              { id: "editor" as const, label: "Editor", title: "Editor only" },
              { id: "split" as const, label: "Split", title: "Editor + PDF" },
              { id: "pdf" as const, label: "PDF", title: "PDF only" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              className={`latex-layout-btn${viewMode === m.id ? " active" : ""}`}
              title={m.title}
              aria-pressed={viewMode === m.id}
              onClick={() => {
                setOpen(null);
                onViewMode(m.id);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setOpen(null);
            onShare();
          }}
        >
          Share
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={compiling}
          onClick={() => {
            setOpen(null);
            onCompile();
          }}
        >
          {compiling ? "Compiling…" : "Recompile"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving || !filename.trim()}
          title={!filename.trim() ? "Name the file first" : "Save to vault"}
          onClick={() => {
            setOpen(null);
            onSave();
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export function LatexShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;
  const link = typeof window !== "undefined" ? `${window.location.origin}/#latex` : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="latex-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="latex-modal"
        role="dialog"
        aria-labelledby="latex-share-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="latex-modal-header">
          <h2 id="latex-share-title">Share</h2>
          <button type="button" className="latex-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Yggdrasil is self-hosted. There are no Overleaf-style email invites — share access via your
          network and vault sync.
        </p>
        <label className="latex-share-label">App link</label>
        <div className="latex-share-row">
          <input className="mono" readOnly value={link} />
          <button type="button" className="btn btn-primary" onClick={copyLink}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <ul className="latex-share-list">
          <li>
            <strong>Tailscale</strong> — anyone on your tailnet can open this URL on port 8000.
          </li>
          <li>
            <strong>Git</strong> — Settings → Data Sync (Git) to push the vault (including{" "}
            <code>70-LaTeX/</code>).
          </li>
          <li>
            <strong>WebDAV</strong> — Settings → Data Sync (Cloud) for Nextcloud / ownCloud / Koofr.
          </li>
        </ul>
      </div>
    </div>
  );
}

export function LatexPromptModal({
  open,
  title,
  label,
  initial = "",
  confirmLabel = "Create",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, initial]);

  if (!open) return null;

  return (
    <div className="latex-modal-backdrop" onClick={onClose} role="presentation">
      <div className="latex-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="latex-modal-header">
          <h2>{title}</h2>
          <button type="button" className="latex-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <label className="latex-share-label">{label}</label>
        <div className="latex-share-row">
          <input
            ref={inputRef}
            className="mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) {
                onConfirm(value.trim());
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!value.trim()}
            onClick={() => onConfirm(value.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
