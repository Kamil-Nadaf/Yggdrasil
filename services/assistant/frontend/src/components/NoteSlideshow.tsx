import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AbstractText from "./AbstractText";

/** Split a Markdown note into slides: a new slide starts at every heading (#, ##) and at every `---` line.
 *  Fenced code blocks are left alone. Empty slides are dropped. */
export function splitIntoSlides(md: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = "";
  const flush = () => {
    const t = cur.join("\n").trim();
    if (t) out.push(t);
    cur = [];
  };
  for (const line of md.split("\n")) {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = "";
      cur.push(line);
      continue;
    }
    if (!fence) {
      if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); continue; }
      if (/^#{1,2}\s+\S/.test(line)) { flush(); cur.push(line); continue; }
    }
    cur.push(line);
  }
  flush();
  return out;
}

const BASE_W = 960;

/** Full-pane slideshow of a note. Each slide is laid out at a fixed width and then scaled as a whole
 *  so long text, images, flowcharts and tables always fit the screen. */
export default function NoteSlideshow({ body, imageBase, onClose }: { body: string; imageBase?: string; onClose: () => void }) {
  const slides = useMemo(() => splitIntoSlides(body), [body]);
  const [i, setI] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const n = slides.length;
  const idx = Math.min(i, Math.max(0, n - 1));

  const fit = useCallback(() => {
    const box = boxRef.current, inner = innerRef.current;
    if (!box || !inner) return;
    const h = inner.scrollHeight || 1;
    const w = BASE_W;
    const s = Math.min(box.clientWidth / w, box.clientHeight / h);
    setScale(Math.max(0.2, Math.min(s, 1.6)));
  }, []);

  useLayoutEffect(() => { fit(); }, [fit, idx, slides]);
  useEffect(() => {
    const box = boxRef.current, inner = innerRef.current;
    if (!box || !inner) return;
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    ro.observe(inner); // images / diagrams finishing loading change the height
    return () => ro.disconnect();
  }, [fit, idx]);

  const go = useCallback((d: number) => setI((c) => Math.max(0, Math.min(n - 1, c + d))), [n]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); go(-1); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
      else if (e.key === "Escape") onClose();
      else if (e.key === "f" || e.key === "F") {
        const el = boxRef.current?.parentElement;
        if (!el) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void el.requestFullscreen?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, n, onClose]);

  if (n === 0) {
    return <div className="nss-root"><div className="latex-preview-empty">Nothing to present yet.</div><button type="button" className="btn" onClick={onClose}>Close</button></div>;
  }

  return (
    <div className="nss-root" tabIndex={-1}>
      <div className="nss-stage" ref={boxRef} onClick={() => go(1)}>
        <div className="nss-slide" style={{ width: BASE_W, transform: `translate(-50%, -50%) scale(${scale})` }}>
          <div ref={innerRef} className="nss-inner">
            <AbstractText key={idx} text={slides[idx]} className="notes-present-text nss-text" imageBase={imageBase} />
          </div>
        </div>
      </div>
      <div className="nss-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn" onClick={onClose}>← Exit</button>
        <button type="button" className="btn" onClick={() => go(-1)} disabled={idx === 0} aria-label="Previous slide">‹</button>
        <span className="nss-count">{idx + 1} / {n}</span>
        <button type="button" className="btn" onClick={() => go(1)} disabled={idx >= n - 1} aria-label="Next slide">›</button>
        <span className="nss-hint">← → to move · F fullscreen · Esc exit</span>
      </div>
    </div>
  );
}
