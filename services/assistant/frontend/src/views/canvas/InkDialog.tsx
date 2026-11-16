import { useEffect } from "react";
import { createPortal } from "react-dom";
import CanvasView from "../CanvasView";
import "./canvas.css";

interface Props {
  title: string;
  insertLabel: string;
  insertAllLabel?: string;
  onInsert: (latex: string, which: "block" | "all") => void;
  onClose: () => void;
}

/** Full-window drawing surface used from the LaTeX and Slides editors. */
export default function InkDialog({ title, insertLabel, insertAllLabel, onInsert, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="cv-dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="cv-dialog">
        <CanvasView embedded title={title} insertLabel={insertLabel} insertAllLabel={insertAllLabel} onInsert={onInsert} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}
