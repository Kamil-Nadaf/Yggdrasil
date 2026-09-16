import { useEffect, useRef, useState } from "react";
import type { TaskStatusDef } from "../api/client";
import { STATUS_ICON_GLYPH } from "../lib/taskStatuses";

/**
 * ClickUp-style status pill: click opens a dropdown of the other configured
 * statuses. Reads `statuses` from Settings → Task Statuses — nothing here is
 * hardcoded. e-ink theme: the icon/shape is what differentiates status even
 * in grayscale/print; `color` only tints the pill as a secondary accent.
 */
export default function StatusPill({
  statuses,
  statusId,
  onChange,
}: {
  statuses: TaskStatusDef[];
  statusId: string;
  onChange: (statusId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = statuses.find((s) => s.id === statusId) || statuses[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!current) return null;

  return (
    <div className="status-pill-wrap" ref={ref}>
      <button
        type="button"
        className="status-pill"
        style={{ borderColor: current.color, background: `color-mix(in srgb, ${current.color} 14%, transparent)` }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden="true">{STATUS_ICON_GLYPH[current.icon] || "○"}</span>
        <span>{current.name}</span>
      </button>
      {open && (
        <div className="status-pill-dropdown" role="menu" onClick={(e) => e.stopPropagation()}>
          {statuses.filter((s) => s.id !== current.id).map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              className="status-pill-option"
              onClick={() => {
                onChange(s.id);
                setOpen(false);
              }}
            >
              <span aria-hidden="true">{STATUS_ICON_GLYPH[s.icon] || "○"}</span>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
