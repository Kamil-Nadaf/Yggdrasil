/**
 * pdfMdAlign.ts — finds where each block of converted Markdown sits in the original PDF.
 *
 * MinerU's CLI gives us text, not positions, so this matches the words of every Markdown block
 * against the PDF's own text layer (pdf.js), reading both in order. It works for any tier and does
 * not depend on MinerU's output format. Blocks it cannot place (figures, equations) inherit the
 * position of the block before them.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface Rect { x: number; y: number; w: number; h: number } // fractions of the page (0..1), y from the top
export interface BlockPos { page: number; rects: Rect[] } // rects are on `page`; empty = only the page is known

const WORD = /[\p{L}\p{N}]{3,}/gu;
const norm = (s: string) => s.normalize("NFKC").toLowerCase();

/** Embedded figures (data: URIs) make the Markdown tab unreadable; show a short stand-in instead. */
export function hideEmbeddedImages(md: string): string {
  let n = 0;
  return md.replace(/!\[([^\]]*)\]\(data:[^)]*\)/g, (_m, alt: string) => `![${alt || `figure ${++n}`}](embedded image)`);
}

/** Blocks separated by blank lines; fenced code, $$ math and HTML tables stay in one piece. */
export function splitBlocks(md: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  let math = false;
  let table = false;
  const flush = () => { const t = cur.join("\n").trim(); if (t) out.push(t); cur = []; };
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!math && !table && /^(```|~~~)/.test(t)) fence = !fence;
    else if (!fence && !table && t.startsWith("$$") && !(t.length > 2 && t.endsWith("$$"))) math = !math;
    else if (!fence && !math) {
      if (/<table/i.test(t) && !/<\/table>/i.test(t)) table = true;
      else if (table && /<\/table>/i.test(t)) table = false;
    }
    if (t === "" && !fence && !math && !table) flush();
    else cur.push(line);
  }
  flush();
  return out;
}

export function anchors(text: string): string[] {
  const t = norm(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  return t.match(WORD) ?? [];
}

interface PageWords { words: string[]; item: number[]; rects: Rect[]; line: number[] }

async function pageWords(pdf: PDFDocumentProxy, n: number): Promise<PageWords> {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const words: string[] = [];
  const item: number[] = [];
  const rects: Rect[] = [];
  const line: number[] = [];
  for (const it of tc.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const tr = it.transform as number[];
    const h = Math.abs(it.height || tr[3] || 10);
    const idx = rects.length;
    rects.push({ x: tr[4] / vp.width, y: (vp.height - tr[5] - h * 0.9) / vp.height, w: Math.max(it.width, 1) / vp.width, h: (h * 1.2) / vp.height });
    line.push(Math.round(tr[5]));
    for (const w of norm(it.str).match(WORD) ?? []) { words.push(w); item.push(idx); }
  }
  return { words, item, rects, line };
}

function find(words: string[], seq: string[], from: number, to = words.length): number {
  const last = Math.min(to, words.length) - seq.length;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    for (let j = 0; j < seq.length; j++) if (words[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

function lineRects(pw: PageWords, s: number, e: number): Rect[] {
  const out: Rect[] = [];
  let prevItem = -1;
  for (let k = s; k <= e && k < pw.item.length; k++) {
    const idx = pw.item[k];
    if (idx === prevItem) continue;
    prevItem = idx;
    const r = pw.rects[idx];
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < r.h * 0.6 && r.x >= last.x - 0.01 && r.x - (last.x + last.w) < 0.06) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      last.x = Math.min(last.x, r.x); last.w = right - last.x; last.h = Math.max(last.h, r.h);
    } else out.push({ ...r });
  }
  return out;
}

/** One entry per block, or null when the PDF has no text layer (scans). `isCancelled` lets callers abort. */
export async function alignBlocks(pdf: PDFDocumentProxy, blocks: string[], isCancelled: () => boolean = () => false): Promise<BlockPos[] | null> {
  const pages: PageWords[] = [];
  let total = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    if (isCancelled()) return null;
    const pw = await pageWords(pdf, n);
    total += pw.words.length;
    pages.push(pw);
  }
  if (total < 50) return null;

  const result: BlockPos[] = [];
  let curPage = 0;
  let curPos = 0;
  let prev: BlockPos = { page: 1, rects: [] };
  for (const b of blocks) {
    const a = anchors(b);
    let found: BlockPos | null = null;
    if (a.length >= 2) {
      for (const k of [Math.min(5, a.length), Math.min(3, a.length), 2]) {
        const seq = a.slice(0, k);
        // forward from the cursor first, then the rest of the document
        const order: [number, number][] = [];
        for (let p = curPage; p < Math.min(pages.length, curPage + 4); p++) order.push([p, p === curPage ? curPos : 0]);
        for (let p = 0; p < pages.length; p++) if (!order.some((o) => o[0] === p)) order.push([p, 0]);
        for (const [p, from] of order) {
          let s = find(pages[p].words, seq, from);
          if (s < 0 && from > 0) s = find(pages[p].words, seq, 0);
          if (s < 0) continue;
          const tail = a.slice(-Math.min(4, a.length));
          let e = find(pages[p].words, tail, s, s + a.length * 3 + 40);
          e = e >= 0 ? e + tail.length - 1 : Math.min(pages[p].words.length - 1, s + a.length);
          found = { page: p + 1, rects: lineRects(pages[p], s, e) };
          curPage = p; curPos = e + 1;
          break;
        }
        if (found) break;
      }
    }
    prev = found ?? { page: prev.page, rects: [] };
    result.push(prev);
  }
  return result;
}
