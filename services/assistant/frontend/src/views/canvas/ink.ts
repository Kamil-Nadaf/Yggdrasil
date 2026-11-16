/** Ink model and drawing helpers for the Canvas view. No React in here. */

export type Tool = "pen" | "highlighter" | "eraser" | "lasso";

export interface Stroke {
  id: number;
  tool: "pen" | "highlighter";
  color: string;
  /** Base width in page pixels. */
  w: number;
  /** Flat list: x, y, pressure, x, y, pressure, … (page pixels, pressure 0–1). */
  pts: number[];
}

export interface Block {
  id: number;
  latex: string;
  engine: string;
  ms: number;
  warnings: string[];
  strokeIds: number[];
  at: number;
}

export interface PageData {
  v: 1;
  strokes: Stroke[];
  blocks: Block[];
  nextId: number;
}

export const PAGE_W = 1400;
export const MIN_PAGE_H = 1800;
export const PAPER = "#FBFAF6";
export const DOT = "#D9D5C8";
export const GRID = 28;

export function emptyPage(): PageData {
  return { v: 1, strokes: [], blocks: [], nextId: 1 };
}

export function pageHeight(strokes: Stroke[]): number {
  let maxY = 0;
  for (const s of strokes) for (let i = 1; i < s.pts.length; i += 3) if (s.pts[i] > maxY) maxY = s.pts[i];
  return Math.max(MIN_PAGE_H, Math.ceil((maxY + 800) / GRID) * GRID);
}

const penWidth = (s: Stroke, p: number) => Math.max(0.8, s.w * (0.35 + 0.9 * p));

/** Draw one stroke. `scale` multiplies coordinates and widths; `color` overrides the stroke colour. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale = 1, color?: string) {
  const n = s.pts.length / 3;
  if (n === 0) return;
  const x = (i: number) => s.pts[i * 3] * scale;
  const y = (i: number) => s.pts[i * 3 + 1] * scale;
  const p = (i: number) => s.pts[i * 3 + 2];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color ?? s.color;
  ctx.fillStyle = color ?? s.color;
  if (s.tool === "highlighter") {
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = s.w * scale;
    ctx.beginPath();
    ctx.moveTo(x(0), y(0));
    for (let i = 1; i < n; i++) ctx.lineTo(x(i), y(i));
    if (n === 1) ctx.lineTo(x(0) + 0.01, y(0));
    ctx.stroke();
  } else if (n === 1) {
    ctx.beginPath();
    ctx.arc(x(0), y(0), (penWidth(s, p(0)) * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Quadratic segments through midpoints; width follows pressure per segment.
    for (let i = 1; i < n; i++) {
      const sx = i === 1 ? x(0) : (x(i - 1) + x(i - 2)) / 2;
      const sy = i === 1 ? y(0) : (y(i - 1) + y(i - 2)) / 2;
      const ex = i === n - 1 ? x(i) : (x(i) + x(i - 1)) / 2;
      const ey = i === n - 1 ? y(i) : (y(i) + y(i - 1)) / 2;
      ctx.lineWidth = penWidth(s, (p(i) + p(i - 1)) / 2) * scale;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(x(i - 1), y(i - 1), ex, ey);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** True when any part of the stroke is within r of (px, py). */
export function strokeNear(s: Stroke, px: number, py: number, r: number): boolean {
  const n = s.pts.length / 3;
  const r2 = r * r;
  for (let i = 0; i < n; i++) {
    const ax = s.pts[i * 3];
    const ay = s.pts[i * 3 + 1];
    if (i === 0) {
      if ((ax - px) ** 2 + (ay - py) ** 2 <= r2) return true;
      continue;
    }
    const bx = s.pts[(i - 1) * 3];
    const by = s.pts[(i - 1) * 3 + 1];
    const dx = ax - bx;
    const dy = ay - by;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - bx) * dx + (py - by) * dy) / len2));
    const cx = bx + t * dx;
    const cy = by + t * dy;
    if ((cx - px) ** 2 + (cy - py) ** 2 <= r2) return true;
  }
  return false;
}

/** Ray-casting point-in-polygon. `poly` is a flat x,y list. */
export function inPolygon(poly: number[], px: number, py: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ids of strokes with at least half of their points inside the lasso. */
export function strokesInLasso(strokes: Stroke[], poly: number[]): number[] {
  if (poly.length < 6) return [];
  const out: number[] = [];
  for (const s of strokes) {
    const n = s.pts.length / 3;
    let inside = 0;
    for (let i = 0; i < n; i++) if (inPolygon(poly, s.pts[i * 3], s.pts[i * 3 + 1])) inside++;
    if (n > 0 && inside / n >= 0.5) out.push(s.id);
  }
  return out;
}

export interface Box { x: number; y: number; w: number; h: number }

export function boundsOf(strokes: Stroke[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const half = s.w / 2;
    for (let i = 0; i < s.pts.length; i += 3) {
      x0 = Math.min(x0, s.pts[i] - half);
      y0 = Math.min(y0, s.pts[i + 1] - half);
      x1 = Math.max(x1, s.pts[i] + half);
      y1 = Math.max(y1, s.pts[i + 1] + half);
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Render the strokes as black ink on white — what the recognition engines get. Highlighter is left out. */
export function renderCrop(strokes: Stroke[], maxSide = 1600): string | null {
  const ink = strokes.filter((s) => s.tool === "pen");
  const b = boundsOf(ink);
  if (!b) return null;
  const pad = 32;
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  // Small crops are enlarged so thin handwriting stays readable; big ones are capped.
  let scale = Math.min(maxSide / Math.max(w, h), 3);
  if (Math.max(w, h) * scale < 480) scale = Math.min(480 / Math.max(w, h), 3);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * scale));
  cv.height = Math.max(1, Math.round(h * scale));
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.translate((pad - b.x) * scale, (pad - b.y) * scale);
  for (const s of ink) drawStroke(ctx, { ...s, w: Math.max(s.w, 2.2) }, scale, "#000");
  return cv.toDataURL("image/png");
}

/** Wrap a bare expression so it compiles; leave anything that already has math delimiters or an environment alone. */
export function asDisplayLatex(src: string): string {
  const s = src.trim();
  if (!s) return s;
  if (/\\begin\{|\\\[|\$/.test(s)) return s;
  return `\\[\n${s}\n\\]`;
}

export function pageSlug(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "page";
}

/** Same rule as the server: starts with a letter or digit, then letters, digits, space . _ -, at most 80. */
export const PAGE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;
