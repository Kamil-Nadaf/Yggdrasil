import { useEffect, useState } from "react";
import { latexAssetUrl } from "../api/client";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "svg", "tif", "tiff"];
const TEXT_EXTS = ["bib", "bst", "bbl", "cls", "clo", "sty", "def", "cfg", "ist", "txt", "csv", "dat", "md", "json", "tikz", "pgf"];

export function assetExt(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

/** Preview of an imported project file (image / PDF / text) in place of the compiled PDF. */
export default function LatexAssetViewer({
  path,
  onClose,
  onInsert,
}: {
  path: string;
  onClose: () => void;
  /** Offered for graphics LaTeX can include (png/jpg/pdf/eps). */
  onInsert?: (path: string) => void;
}) {
  const ext = assetExt(path);
  const url = latexAssetUrl(path);
  const isImage = IMAGE_EXTS.includes(ext);
  const isPdf = ext === "pdf";
  const isText = TEXT_EXTS.includes(ext);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState(true);
  const base = path.split("/").pop() || path;

  useEffect(() => {
    setText(null);
    setFailed(false);
    setFit(true);
    if (!isText) return;
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => { if (!cancelled) setText(t); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url, isText]);

  return (
    <div className="latex-preview-pane latex-asset-viewer">
      <div className="latex-asset-viewer-bar">
        <span className="latex-asset-viewer-name" title={path}>{base}</span>
        <span className="latex-asset-viewer-actions">
          {onInsert && ["png", "jpg", "jpeg", "pdf", "eps"].includes(ext) && (
            <button type="button" className="btn" onClick={() => onInsert(path)}>Insert in document</button>
          )}
          <a className="btn" href={url} download={base}>Download</a>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </span>
      </div>
      <div className="latex-asset-viewer-body">
        {isImage && (
          <img
            src={url}
            alt={base}
            className={fit ? "is-fit" : "is-full"}
            onClick={() => setFit((f) => !f)}
            onError={() => setFailed(true)}
            title={fit ? "Click for actual size" : "Click to fit"}
          />
        )}
        {isPdf && <iframe src={url} title={base} className="latex-asset-viewer-pdf" />}
        {isText && (failed ? <div className="latex-preview-empty">Could not load file.</div> : <pre>{text ?? "Loading…"}</pre>)}
        {!isImage && !isPdf && !isText && (
          <div className="latex-preview-empty">No preview for .{ext || "this"} files. Use Download to open it.</div>
        )}
        {isImage && failed && <div className="latex-preview-empty">Could not load image.</div>}
      </div>
    </div>
  );
}
