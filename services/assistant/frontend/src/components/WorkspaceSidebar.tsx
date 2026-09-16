import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Collapsible file-tree sidebar shared by the LaTeX Editor and the Notes
 * workspaces (Quick Notes / Documentation / Meeting Minutes). This is the
 * literal component both mount — not a re-implementation with matching
 * CSS classes. It's a superset of what used to be LaTeXEditor.tsx's local
 * `FileTree`: assets / folder-upload / drag-to-move are optional props that
 * the Notes sections simply don't pass.
 */

export interface WorkspaceFile {
  name: string;
  size?: number;
  modified?: string;
}

const DRAG_MIME = "application/x-yggdrasil-workspace-path";

/** Folder outline with up-arrow (upload-folder). */
function IconUploadFolder() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
      />
      <path
        fill="var(--surface, #161B27)"
        d="M12 17c-.55 0-1-.45-1-1v-3.17l-.88.88a.996.996 0 1 1-1.41-1.41l2.59-2.59c.39-.39 1.02-.39 1.41 0l2.59 2.59a.996.996 0 1 1-1.41 1.41L13 12.83V16c0 .55-.45 1-1 1z"
      />
    </svg>
  );
}

export function WorkspaceSidebar({
  title = "Files",
  files,
  assets = [],
  folders,
  selected,
  currentFolder,
  onSelect,
  onOpenFolder,
  onDelete,
  onDeleteFolder,
  onDeleteAsset,
  onRequestRename,
  onNew,
  onNewFolder,
  onUploadFiles,
  onUploadFolder,
  onDropFiles,
  onMoveIntoFolder,
  searchTerm,
  onSearchChange,
  onCollapse,
}: {
  title?: string;
  files: WorkspaceFile[];
  assets?: WorkspaceFile[];
  folders: string[];
  selected: string;
  currentFolder: string;
  onSelect: (name: string) => void;
  onOpenFolder: (folder: string) => void;
  onDelete: (name: string) => void;
  onDeleteFolder: (folder: string) => void;
  onDeleteAsset?: (name: string) => void;
  onRequestRename: (path: string, kind: "file" | "folder" | "asset") => void;
  onNew: () => void;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder?: () => void;
  onDropFiles?: (dataTransfer: DataTransfer) => void;
  onMoveIntoFolder?: (path: string, folder: string) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onCollapse: () => void;
}) {
  const [ctx, setCtx] = useState<{ x: number; y: number; path: string; kind: "file" | "folder" | "asset" } | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  function displayName(full: string) {
    if (!currentFolder) return full;
    return full.startsWith(currentFolder + "/") ? full.slice(currentFolder.length + 1) : full;
  }

  function requestRename(path: string, kind: "file" | "folder" | "asset") {
    setCtx(null);
    onRequestRename(path, kind);
  }

  useEffect(() => {
    if (!ctx) return;
    const close = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(".latex-ctx-menu")) return;
      setCtx(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [ctx]);

  function openCtx(e: React.MouseEvent, path: string, kind: "file" | "folder" | "asset") {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, path, kind });
  }

  return (
    <div className="latex-file-tree">
      <div className="latex-tree-header">
        <div className="latex-tree-header-row">
          <span className="latex-tree-title">{title}</span>
          <div className="latex-tree-actions">
            <button type="button" className="latex-tree-action" onClick={onNew} title="New file" aria-label="New file">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm1 7V3.5L18.5 9H15zM8 13h8v2H8v-2zm0 4h8v2H8v-2zm0-8h5v2H8V9z"/>
              </svg>
            </button>
            <button type="button" className="latex-tree-action" onClick={onNewFolder} title="New folder" aria-label="New folder">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2zm1 5h2v3h3v2h-3v3h-2v-3H8v-2h3V9z"/>
              </svg>
            </button>
            <button type="button" className="latex-tree-action" onClick={onUploadFiles} title="Upload files" aria-label="Upload files">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path fill="currentColor" d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
              </svg>
            </button>
            {onUploadFolder && (
              <button type="button" className="latex-tree-action" onClick={onUploadFolder} title="Upload folder / project" aria-label="Upload folder">
                <IconUploadFolder />
              </button>
            )}
            <button type="button" className="latex-tree-action" onClick={onCollapse} title="Collapse files" aria-label="Collapse files">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
              </svg>
            </button>
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
        onDragOver={onDropFiles ? (e) => e.preventDefault() : undefined}
        onDrop={
          onDropFiles
            ? (e) => {
                e.preventDefault();
                onDropFiles(e.dataTransfer);
              }
            : undefined
        }
      >
        <div className="latex-breadcrumb">
          <button
            type="button"
            className={`latex-breadcrumb-item${currentFolder === "" ? " active" : ""}`}
            onClick={() => onOpenFolder("")}
          >
            root
          </button>
          {currentFolder && (
            <>
              <span className="latex-breadcrumb-sep">/</span>
              {currentFolder.split("/").map((part, index, parts) => {
                const path = parts.slice(0, index + 1).join("/");
                return (
                  <span key={path} className="latex-breadcrumb-crumb">
                    <button
                      type="button"
                      className={`latex-breadcrumb-item${index === parts.length - 1 ? " active" : ""}`}
                      onClick={() => onOpenFolder(path)}
                    >
                      {part}
                    </button>
                    {index < parts.length - 1 && <span className="latex-breadcrumb-sep">/</span>}
                  </span>
                );
              })}
            </>
          )}
        </div>

        {folders.length > 0 && (
          <div className="latex-tree-section">
            {folders.map((folder) => (
              <div
                key={folder}
                className={`latex-tree-folder${dragOverFolder === folder ? " drop-target" : ""}`}
                onClick={() => onOpenFolder(folder)}
                onContextMenu={(e) => openCtx(e, folder, "folder")}
                onClickCapture={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    requestRename(folder, "folder");
                  }
                }}
                onDragOver={
                  onMoveIntoFolder
                    ? (e) => {
                        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverFolder(folder);
                      }
                    : undefined
                }
                onDragLeave={onMoveIntoFolder ? () => setDragOverFolder((f) => (f === folder ? null : f)) : undefined}
                onDrop={
                  onMoveIntoFolder
                    ? (e) => {
                        const path = e.dataTransfer.getData(DRAG_MIME);
                        setDragOverFolder(null);
                        if (!path) return; // not an internal drag — let it fall through to onDropFiles (OS upload)
                        e.preventDefault();
                        e.stopPropagation();
                        onMoveIntoFolder(path, folder);
                      }
                    : undefined
                }
              >
                <div className="latex-tree-folder-icon" aria-hidden>📁</div>
                <div className="latex-tree-name" title={`${displayName(folder)} — right-click to rename`}>
                  {displayName(folder)}
                </div>
                <div className="latex-tree-folder-actions">
                  <button
                    type="button"
                    className="latex-tree-folder-btn delete"
                    title="Delete folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteFolder(folder);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {files.length === 0 && assets.length === 0 ? (
          <div className="latex-tree-empty">No files here yet</div>
        ) : (
          <>
            {files.map((f) => (
              <div
                key={f.name}
                className={`latex-tree-item${selected === f.name ? " active" : ""}`}
                draggable={Boolean(onMoveIntoFolder)}
                onDragStart={
                  onMoveIntoFolder
                    ? (e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData(DRAG_MIME, f.name);
                      }
                    : undefined
                }
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    requestRename(f.name, "file");
                    return;
                  }
                  onSelect(f.name);
                }}
                onContextMenu={(e) => openCtx(e, f.name, "file")}
              >
                <div className="latex-tree-name" title={`${displayName(f.name)} — right-click to rename`}>
                  {displayName(f.name)}
                </div>
                {typeof f.size === "number" && (
                  <div className="latex-tree-meta">{(f.size / 1024).toFixed(1)} KB</div>
                )}
                <button
                  className="latex-tree-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(f.name);
                  }}
                  title="Delete file"
                >×</button>
              </div>
            ))}
            {assets.map((a) => (
              <div
                key={a.name}
                className="latex-tree-item latex-tree-asset"
                draggable={Boolean(onMoveIntoFolder)}
                onDragStart={
                  onMoveIntoFolder
                    ? (e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData(DRAG_MIME, a.name);
                      }
                    : undefined
                }
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    requestRename(a.name, "asset");
                  }
                }}
                onContextMenu={(e) => openCtx(e, a.name, "asset")}
              >
                <div className="latex-tree-name" title={`${displayName(a.name)} — right-click to rename`}>
                  {displayName(a.name)}
                </div>
                <div className="latex-tree-meta">asset</div>
                <button
                  className="latex-tree-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAsset?.(a.name);
                  }}
                  title="Delete asset"
                >×</button>
              </div>
            ))}
          </>
        )}
      </div>
      {ctx && createPortal(
        <div
          className="latex-ctx-menu"
          style={{ top: ctx.y, left: ctx.x }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              requestRename(ctx.path, ctx.kind);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={(e) => {
              e.stopPropagation();
              setCtx(null);
              if (ctx.kind === "folder") onDeleteFolder(ctx.path);
              else if (ctx.kind === "asset") onDeleteAsset?.(ctx.path);
              else onDelete(ctx.path);
            }}
          >
            Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

/** Thin collapsed rail with a single ▶-style button, shown when the sidebar is hidden. */
export function SidebarRail({ label = "Files", onShow }: { label?: string; onShow: () => void }) {
  return (
    <button
      type="button"
      className="latex-files-rail"
      title={`Show ${label.toLowerCase()}`}
      aria-label={`Show ${label.toLowerCase()}`}
      onClick={onShow}
    >
      {label}
    </button>
  );
}
