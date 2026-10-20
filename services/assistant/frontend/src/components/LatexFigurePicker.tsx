import { useMemo, useState } from "react";
import { latexAssetUrl, type LatexFile } from "../api/client";
import { assetExt } from "./LatexAssetViewer";

/** Graphics pdfLaTeX's \includegraphics can use directly. */
const GRAPHIC_EXTS = ["png", "jpg", "jpeg", "pdf", "eps"];
const THUMB_EXTS = ["png", "jpg", "jpeg"];

function dirOf(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/**
 * Overleaf-style "insert figure" dialog. Lists the images/PDFs that belong to the
 * open document's project (same folder tree, subfolders included) and hands back
 * paths relative to the .tex file, ready for \includegraphics.
 */
export default function LatexFigurePicker({
  open,
  filename,
  assets,
  onClose,
  onInsert,
  onUpload,
}: {
  open: boolean;
  /** Stem of the open document, e.g. "APJL/main" or "draft". */
  filename: string;
  assets: LatexFile[];
  onClose: () => void;
  onInsert: (relPaths: string[]) => void;
  onUpload: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const parts = filename.split("/");
  const project = parts.length > 1 ? parts[0] : "";
  // Folders between the project root and the .tex file ("chapters/" for APJL/chapters/a.tex).
  const texDepth = parts.length > 2 ? parts.length - 2 : 0;

  const items = useMemo(() => {
    return assets
      .filter((a) => GRAPHIC_EXTS.includes(assetExt(a.name)))
      // A project folder is compiled whole; a loose root-level .tex only sees root-level siblings.
      .filter((a) => (project ? a.name.startsWith(`${project}/`) : !a.name.includes("/")))
      .map((a) => {
        const inside = project ? a.name.slice(project.length + 1) : a.name;
        return { asset: a, inside, rel: "../".repeat(texDepth) + inside, folder: dirOf(inside) };
      })
      .filter((i) => i.inside.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => a.folder.localeCompare(b.folder) || a.inside.localeCompare(b.inside));
  }, [assets, project, texDepth, query]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const it of items) map.set(it.folder, [...(map.get(it.folder) ?? []), it]);
    return [...map.entries()];
  }, [items]);

  if (!open) return null;

  function toggle(rel: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  }

  function toggleGroup(rels: string[]) {
    setPicked((prev) => {
      const next = new Set(prev);
      const all = rels.every((r) => next.has(r));
      for (const r of rels) {
        if (all) next.delete(r);
        else next.add(r);
      }
      return next;
    });
  }

  function close() {
    setPicked(new Set());
    setQuery("");
    onClose();
  }

  const count = [...picked].filter((r) => items.some((i) => i.rel === r)).length;

  return (
    <div className="latex-template-modal-backdrop" onClick={close}>
      <div className="card latex-template-modal latex-figure-picker" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Insert figure</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          {project ? `Images in ${project}/ (including subfolders)` : "Images in the project root"}
        </div>
        <div className="latex-figure-picker-tools">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search images…"
            aria-label="Search images"
          />
          <button type="button" className="btn" onClick={onUpload}>Upload new…</button>
        </div>
        <div className="latex-figure-picker-list">
          {items.length === 0 && (
            <div className="latex-preview-empty">
              No images or PDFs here yet. Use “Upload new…” (or drop files onto the file list).
            </div>
          )}
          {groups.map(([folder, list]) => {
            const rels = list.map((i) => i.rel);
            const allPicked = rels.every((r) => picked.has(r));
            return (
              <div key={folder || "__root"} className="latex-figure-group">
                <div className="latex-figure-group-head">
                  <span className="mono">{folder ? `${folder}/` : project ? `${project}/` : "root"}</span>
                  <button type="button" className="btn" onClick={() => toggleGroup(rels)}>
                    {allPicked ? "Clear" : `Select all (${list.length})`}
                  </button>
                </div>
                {list.map((it) => {
                  const ext = assetExt(it.asset.name);
                  return (
                    <label key={it.rel} className="latex-figure-row">
                      <input type="checkbox" checked={picked.has(it.rel)} onChange={() => toggle(it.rel)} />
                      {THUMB_EXTS.includes(ext) ? (
                        <img src={latexAssetUrl(it.asset.name)} alt="" loading="lazy" className="latex-figure-thumb" />
                      ) : (
                        <span className="latex-figure-thumb latex-figure-thumb--doc mono">{ext.toUpperCase()}</span>
                      )}
                      <span className="latex-figure-name" title={it.rel}>{it.inside.split("/").pop()}</span>
                      <span className="muted latex-figure-size">{(it.asset.size / 1024).toFixed(0)} KB</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="latex-figure-picker-foot">
          <span className="muted">{count} selected</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={count === 0}
              onClick={() => {
                onInsert(items.filter((i) => picked.has(i.rel)).map((i) => i.rel));
                close();
              }}
            >
              Insert{count > 0 ? ` ${count}` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
