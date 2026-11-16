import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  DOT, GRID, PAGE_W, PAPER, boundsOf, drawStroke, pageHeight, strokeNear, strokesInLasso,
  type Box, type Stroke, type Tool,
} from "./ink";

interface Props {
  strokes: Stroke[];
  selection: number[];
  tool: Tool;
  color: string;
  width: number;
  scale: number;
  /** Touch draws only when this is on and no pen has been seen (palm rejection). Otherwise touch pans. */
  fingerDraws: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  nextId: () => number;
  onStroke: (s: Stroke) => void;
  onErase: (ids: number[]) => void;
  onLasso: (ids: number[]) => void;
}

type Gesture =
  | { kind: "pan"; id: number; x: number; y: number; sl: number; st: number }
  | { kind: "draw"; id: number; tool: "pen" | "highlighter"; pts: number[] }
  | { kind: "erase"; id: number; hit: Set<number> }
  | { kind: "lasso"; id: number; poly: number[] };

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function InkSurface(p: Props) {
  const { strokes, selection, tool, color, width, scale, fingerDraws, scrollRef } = p;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ w: 800, h: 600 });
  const gesture = useRef<Gesture | null>(null);
  const penSeen = useRef(false);
  const raf = useRef(0);
  const boxCache = useRef(new WeakMap<Stroke, Box | null>());
  const accent = useRef("#C97B4A");
  const latest = useRef(p);
  latest.current = p;

  const pageH = pageHeight(strokes);

  const box = (s: Stroke) => {
    let b = boxCache.current.get(s);
    if (b === undefined) {
      b = boundsOf([s]);
      boxCache.current.set(s, b);
    }
    return b;
  };

  const draw = useCallback(() => {
    raf.current = 0;
    const cv = canvasRef.current;
    const sc = scrollRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !sc || !ctx) return;
    const { strokes: all, selection: sel, scale: k } = latest.current;
    const dpr = window.devicePixelRatio || 1;
    const vw = cv.clientWidth;
    const vh = cv.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#D8D4C8";
    ctx.fillRect(0, 0, vw, vh);

    const ph = pageHeight(all);
    const ox = Math.max(0, (vw - PAGE_W * k) / 2);
    const left = ox - sc.scrollLeft;
    const top = -sc.scrollTop;
    ctx.fillStyle = PAPER;
    ctx.fillRect(left, top, PAGE_W * k, ph * k);

    // Dot grid, only the part on screen.
    ctx.fillStyle = DOT;
    const gx0 = Math.max(0, Math.floor((-left / k) / GRID));
    const gx1 = Math.min(Math.floor(PAGE_W / GRID), Math.ceil((vw - left) / k / GRID));
    const gy0 = Math.max(0, Math.floor((-top / k) / GRID));
    const gy1 = Math.min(Math.floor(ph / GRID), Math.ceil((vh - top) / k / GRID));
    const dot = Math.max(1.5, 1.6 * k);
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) ctx.fillRect(left + gx * GRID * k - dot / 2, top + gy * GRID * k - dot / 2, dot, dot);

    ctx.save();
    ctx.translate(left, top);
    ctx.scale(k, k);
    const g = gesture.current;
    const hidden = g && g.kind === "erase" ? g.hit : null;
    const vx0 = -left / k, vy0 = -top / k, vx1 = (vw - left) / k, vy1 = (vh - top) / k;
    for (const s of all) {
      if (hidden && hidden.has(s.id)) continue;
      const b = box(s);
      if (b && (b.x > vx1 || b.y > vy1 || b.x + b.w < vx0 || b.y + b.h < vy0)) continue;
      drawStroke(ctx, s, 1);
    }
    if (g && g.kind === "draw") {
      drawStroke(ctx, { id: -1, tool: g.tool, color: latest.current.color, w: g.tool === "highlighter" ? latest.current.width * 5 : latest.current.width, pts: g.pts }, 1);
    }
    if (sel.length) {
      const b = boundsOf(all.filter((s) => sel.includes(s.id)));
      if (b) {
        ctx.strokeStyle = accent.current;
        ctx.fillStyle = accent.current + "14";
        ctx.lineWidth = 2 / k;
        ctx.setLineDash([8 / k, 6 / k]);
        ctx.beginPath();
        ctx.roundRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28, 14);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (g && g.kind === "lasso" && g.poly.length >= 4) {
      ctx.strokeStyle = accent.current;
      ctx.lineWidth = 2 / k;
      ctx.setLineDash([8 / k, 6 / k]);
      ctx.beginPath();
      ctx.moveTo(g.poly[0], g.poly[1]);
      for (let i = 2; i < g.poly.length; i += 2) ctx.lineTo(g.poly[i], g.poly[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }, [scrollRef]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  // Canvas matches the visible area; the page scrolls underneath it.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const ro = new ResizeObserver(() => setView({ w: sc.clientWidth, h: sc.clientHeight }));
    ro.observe(sc);
    setView({ w: sc.clientWidth, h: sc.clientHeight });
    return () => ro.disconnect();
  }, [scrollRef]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(view.w * dpr));
    cv.height = Math.max(1, Math.round(view.h * dpr));
    schedule();
  }, [view, schedule]);

  useEffect(() => {
    accent.current = (getComputedStyle(document.documentElement).getPropertyValue("--page-accent") || "").trim() || "#C97B4A";
    if (!/^#[0-9a-fA-F]{6}$/.test(accent.current)) accent.current = "#C97B4A";
    schedule();
  }, [strokes, selection, scale, schedule]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const toPage = (clientX: number, clientY: number): [number, number] => {
    const cv = canvasRef.current!;
    const sc = scrollRef.current!;
    const r = cv.getBoundingClientRect();
    const ox = Math.max(0, (cv.clientWidth - PAGE_W * scale) / 2);
    return [(clientX - r.left + sc.scrollLeft - ox) / scale, (clientY - r.top + sc.scrollTop) / scale];
  };

  const erase = (g: Extract<Gesture, { kind: "erase" }>, x: number, y: number) => {
    const rad = 14 / scale;
    for (const s of strokes) if (!g.hit.has(s.id) && strokeNear(s, x, y, rad)) g.hit.add(s.id);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gesture.current) return; // one pointer at a time: a resting palm or second finger is ignored
    const t = e.pointerType;
    if (t === "pen") penSeen.current = true;
    if (t === "mouse" && e.button !== 0) return;
    const sc = scrollRef.current!;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone: draw anyway */ }
    e.preventDefault();

    if (t === "touch" && !(fingerDraws && !penSeen.current)) {
      gesture.current = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      return;
    }
    const eff: Tool = t === "pen" && e.buttons & 32 ? "eraser" : tool; // barrel-end eraser where the stylus reports it
    const [x, y] = toPage(e.clientX, e.clientY);
    const pr = e.pressure > 0 ? r2(e.pressure) : 0.5;
    if (eff === "pen" || eff === "highlighter") {
      gesture.current = { kind: "draw", id: e.pointerId, tool: eff, pts: [r1(x), r1(y), pr] };
    } else if (eff === "eraser") {
      const g: Gesture = { kind: "erase", id: e.pointerId, hit: new Set() };
      gesture.current = g;
      erase(g, x, y);
    } else {
      gesture.current = { kind: "lasso", id: e.pointerId, poly: [x, y] };
    }
    schedule();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.kind === "pan") {
      const sc = scrollRef.current!;
      sc.scrollLeft = g.sl - (e.clientX - g.x);
      sc.scrollTop = g.st - (e.clientY - g.y);
      return;
    }
    const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const list = evs.length ? evs : [e.nativeEvent];
    for (const ev of list) {
      const [x, y] = toPage(ev.clientX, ev.clientY);
      if (g.kind === "draw") {
        const n = g.pts.length;
        if (Math.hypot(x - g.pts[n - 3], y - g.pts[n - 2]) < 0.6) continue;
        g.pts.push(r1(x), r1(y), ev.pressure > 0 ? r2(ev.pressure) : 0.5);
      } else if (g.kind === "erase") {
        erase(g, x, y);
      } else {
        g.poly.push(x, y);
      }
    }
    schedule();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!cancelled) {
      if (g.kind === "draw") {
        p.onStroke({ id: p.nextId(), tool: g.tool, color, w: g.tool === "highlighter" ? width * 5 : width, pts: g.pts });
      } else if (g.kind === "erase") {
        if (g.hit.size) p.onErase([...g.hit]);
      } else if (g.kind === "lasso") {
        p.onLasso(strokesInLasso(strokes, g.poly));
      }
    }
    schedule();
  };

  return (
    <div className="cv-scroll" ref={scrollRef} onScroll={schedule}>
      <div className="cv-spacer" style={{ width: PAGE_W * scale, height: pageH * scale }}>
        <canvas
          ref={canvasRef}
          className="cv-canvas"
          style={{ width: view.w, height: view.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => finish(e, false)}
          onPointerCancel={(e) => finish(e, true)}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}
