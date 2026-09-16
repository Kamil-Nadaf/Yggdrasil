import { useEffect, useState } from "react";

/**
 * The PDF-viewer bottom bar (status label · zoom out · N% · zoom in ·
 * fullscreen · Download) shared by the LaTeX Editor's PDF pane and the Notes
 * workspaces' Present mode. Extracted verbatim from LaTeXEditor.tsx's
 * `PreviewPane` so both mount the same component instead of two copies.
 */

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function useZoom(initial = 1) {
  const [zoom, setZoom] = useState(initial);
  function zoomIn() {
    setZoom((z) => ZOOM_STEPS.find((s) => s > z + 0.001) ?? z);
  }
  function zoomOut() {
    setZoom((z) => [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? z);
  }
  return {
    zoom,
    zoomIn,
    zoomOut,
    atMinZoom: zoom <= ZOOM_STEPS[0],
    atMaxZoom: zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1],
  };
}

/** Escape-to-exit + body-scroll-lock behavior shared by any fullscreen-able pane. */
export function useFullscreenPane() {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);
  return { fullscreen, setFullscreen };
}

/** Magnifying glass with + (zoom in). */
export function IconZoomIn() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
      <path d="M10.5 7.5v6M7.5 10.5h6" />
    </svg>
  );
}

/** Magnifying glass with − (zoom out). */
export function IconZoomOut() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
      <path d="M7.5 10.5h6" />
    </svg>
  );
}

/** Four outward corners — enter fullscreen. */
export function IconFullscreen() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}

/** Four inward corners — exit fullscreen / small screen. */
export function IconExitFullscreen() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
    </svg>
  );
}

export function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L11 12.59V4a1 1 0 0 1 1-1zM5 18a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5z"
      />
    </svg>
  );
}

export function PreviewToolbar({
  statusLabel,
  zoom,
  atMinZoom,
  atMaxZoom,
  onZoomIn,
  onZoomOut,
  fullscreen,
  onEnterFullscreen,
  onExitFullscreen,
  downloadLabel = "Download PDF",
  downloadBusyLabel = "Generating…",
  downloadBusy,
  downloadDisabled,
  onDownload,
}: {
  statusLabel: string;
  zoom: number;
  atMinZoom: boolean;
  atMaxZoom: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  fullscreen: boolean;
  onEnterFullscreen: () => void;
  onExitFullscreen: () => void;
  downloadLabel?: string;
  downloadBusyLabel?: string;
  downloadBusy?: boolean;
  downloadDisabled?: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="latex-preview-toolbar">
      <span className="mono muted">{statusLabel}</span>
      <div className="latex-preview-actions">
        <button
          type="button"
          className="latex-preview-icon-btn"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={atMinZoom}
          onClick={onZoomOut}
        >
          <IconZoomOut />
        </button>
        <span className="latex-preview-zoom-label mono" title="Zoom level">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="latex-preview-icon-btn"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={atMaxZoom}
          onClick={onZoomIn}
        >
          <IconZoomIn />
        </button>
        {fullscreen ? (
          <button
            type="button"
            className="latex-preview-icon-btn"
            title="Exit full screen"
            aria-label="Exit full screen"
            onClick={onExitFullscreen}
          >
            <IconExitFullscreen />
          </button>
        ) : (
          <button
            type="button"
            className="latex-preview-icon-btn"
            title="Full screen"
            aria-label="Full screen"
            onClick={onEnterFullscreen}
          >
            <IconFullscreen />
          </button>
        )}
        <button
          type="button"
          className="latex-preview-download"
          title={downloadLabel}
          aria-label={downloadLabel}
          disabled={downloadDisabled || downloadBusy}
          onClick={onDownload}
        >
          <IconDownload />
          <span>{downloadBusy ? downloadBusyLabel : downloadLabel}</span>
        </button>
      </div>
    </div>
  );
}
