import { useEffect, useRef, type ReactNode } from "react";

const MIN_SCALE = 0.3;

/**
 * Fits a dashboard card's content into the height it was dragged to: when the content is taller than
 * the box it is scaled down (width reflows to match) so nothing needs scrolling; when the box is taller,
 * the card simply stretches to fill it.
 */
export default function FitContent({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    let raf = 0;

    const run = () => {
      raf = 0;
      const W = o.clientWidth;
      const A = o.clientHeight;
      if (!W || !A) return;
      i.style.transform = "none";
      i.style.width = `${W}px`;
      i.style.height = "auto";
      const H1 = i.scrollHeight;
      let s = 1;
      let shift = 0;
      let width = W;
      if (H1 > A) {
        // Text-like content reflows to the wider virtual width, so a smaller scale still fills the box.
        s = Math.max(MIN_SCALE, A / H1);
        let fits = false;
        for (let k = 0; k < 6; k++) {
          i.style.width = `${W / s}px`;
          const H = i.scrollHeight;
          if (H * s <= A + 1) { fits = true; break; }
          const next = Math.max(MIN_SCALE, Math.min(s, A / H));
          if (Math.abs(next - s) < 0.005) break;
          s = next;
        }
        width = W / s;
        if (!fits) {
          // Aspect-locked content (charts, dials) never gets shorter by reflowing: scale it as a whole and centre it.
          s = Math.max(MIN_SCALE, A / H1);
          width = W;
          shift = (W - W * s) / 2;
        }
      }
      i.style.width = `${width}px`;
      i.style.height = `${A / s}px`;
      i.style.transform = s < 1 ? `translateX(${shift}px) scale(${s})` : "none";
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(run); };

    const ro = new ResizeObserver(schedule);
    ro.observe(o);
    const mo = new MutationObserver(schedule);
    mo.observe(i, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => { ro.disconnect(); mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  return (
    <div className="fit-outer" ref={outer}>
      <div className="fit-inner" ref={inner}>{children}</div>
    </div>
  );
}
