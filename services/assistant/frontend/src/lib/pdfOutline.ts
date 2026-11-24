/**
 * Builds a contents list for PDFs that carry no embedded outline.
 *
 * Two strategies, both working on text lines read with pdf.js:
 *  1. The printed "Contents" page: entries like "2.1 Data ........ 14" are parsed and the printed page
 *     numbers are mapped to PDF pages by matching a few entries against headings found in the body.
 *  2. Heading detection: numbered / well-known section names and lines set larger than the body text.
 * The pure functions (detectHeadings, parseContentsPage) take plain line objects so they can be tested
 * without pdf.js; scanPdfLines() is the only part that touches a document.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface RawLine {
  page: number;
  /** distance from the top of the page, in PDF points */
  y: number;
  x: number;
  size: number;
  text: string;
  pageH: number;
}
export interface Heading { title: string; page: number; level: number }

const MAX_PAGES = 900;
const NUM = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(?=[A-Z][A-Za-z])/;
const CHAPTER = /^(chapter|part)\s+(\d+|[IVXL]+)\b/i;
const APPENDIX = /^appendix\s+[A-Z0-9]\b/i;
const NAMED = /^(abstract|introduction|conclusions?|conclusions? and (outlook|discussion)|summary|acknowledg(e)?ments?|references|bibliography|discussion|results|methods?|methodology|data|preface|contents|table of contents|list of (figures|tables)|appendix|appendices)\s*$/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const norm = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function bodySizeOf(lines: RawLine[]): number {
  const weight = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    weight.set(k, (weight.get(k) ?? 0) + l.text.length);
  }
  let best = 10, bw = -1;
  for (const [k, w] of weight) if (w > bw) { best = k; bw = w; }
  return best;
}

/** Reading order for one page: two-column pages are read left column first, then right. */
function readingOrder(ls: RawLine[]): RawLine[] {
  const byY = (a: RawLine, b: RawLine) => a.y - b.y || a.x - b.x;
  if (ls.length < 12) return [...ls].sort(byY);
  const buckets = new Map<number, number>();
  for (const l of ls) { const k = Math.round(l.x / 10) * 10; buckets.set(k, (buckets.get(k) ?? 0) + 1); }
  const ranked = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  const [x1, n1] = ranked[0];
  const second = ranked.find(([x]) => Math.abs(x - x1) >= 120);
  if (!second || second[1] < n1 * 0.3) return [...ls].sort(byY);
  // Lines that start at the second column's left edge are the right column; everything else (centred titles,
  // full-width lines, the left column) is read top to bottom first.
  const right = Math.max(x1, second[0]);
  const col = (l: RawLine) => (Math.abs(l.x - right) <= 25 ? 1 : 0);
  return [...ls].sort((a, b) => col(a) - col(b) || byY(a, b));
}

/** Headings from numbered / named sections and from lines set larger than the body text. */
export function detectHeadings(all: RawLine[]): Heading[] {
  if (all.length === 0) return [];
  const body = bodySizeOf(all);
  const byPage = new Map<number, RawLine[]>();
  for (const l of all) {
    const arr = byPage.get(l.page) ?? [];
    arr.push(l);
    byPage.set(l.page, arr);
  }
  // Running headers/footers: the same text (digits ignored) on many pages.
  const seen = new Map<string, number>();
  for (const l of all) {
    const k = norm(l.text.replace(/\d+/g, ""));
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }

  type Cand = Heading & { size: number; kind: "num" | "plain"; y: number; x: number; top?: number; weak?: boolean };
  const cands: Cand[] = [];
  for (const [page, ls] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const ordered = readingOrder(ls);
    let prevY = -Infinity;
    let prevBottomSize = body;
    let last: Cand | null = null;
    for (const l of ordered) {
      const text = clean(l.text);
      const rawGap = l.y - prevY;
      const gap = rawGap < 0 ? Infinity : rawGap; // jumped to the top of the next column
      const prevSize = prevBottomSize;
      prevY = l.y;
      prevBottomSize = l.size;
      if (text.length < 2 || text.length > 120) { last = null; continue; }
      if (l.y < l.pageH * 0.06 || l.y > l.pageH * 0.94) { last = null; continue; }
      if (/^\d+$/.test(text)) { last = null; continue; }
      const ratio = l.size / body;
      const spaced = !isFinite(gap) || gap >= Math.max(l.size, prevSize) * 1.45;
      const repeated = (seen.get(norm(text.replace(/\d+/g, ""))) ?? 0) >= 4;

      // A wrapped heading: continue the previous candidate when the size matches and the gap is tight.
      if (last && last.page === page && Math.abs(l.size - last.size) < 0.6 && Math.abs(l.x - last.x) < 40 && gap < l.size * 1.5 && !NUM.test(text) && !CHAPTER.test(text) && last.title.length + text.length < 160 && !/[.:]$/.test(last.title)) {
        last.title = clean(`${last.title} ${text}`);
        continue;
      }
      let kind: "num" | "plain" | null = null;
      let level = 1;
      let weak = false;
      const m = NUM.exec(text);
      // Not a sentence or a footnote: short, and a bare "1 Since ..." in the lower part of the page is a footnote.
      const numOk = !!m && text.length <= 100 && text.split(" ").length <= 12 && !/[.,;]$/.test(text.replace(/\.$/, ""))
        && !(l.y > l.pageH * 0.78 && !/^\d+(\.\d+)*\.\s/.test(text) && ratio < 1.15);
      if (m && numOk && (ratio >= 1.04 || spaced)) {
        kind = "num";
        level = Math.min(3, m[1].split(".").length);
      } else if (m && numOk && /^\d+(\.\d+)*\.\s/.test(text) && !/[-\u2010\u00ad]$/.test(text) && text.length <= 80 && text.split(" ").length <= 12 && ratio >= 0.9) {
        // Same size as the body (bold only) but written "2. Title" / "2.1. Title": keep it if the numbering fits (below).
        // Bare "1 Since the ..." lines are footnotes, so they need the larger size to count.
        kind = "num";
        weak = true;
        level = Math.min(3, m[1].split(".").length);
      } else if ((CHAPTER.test(text) || APPENDIX.test(text)) && text.length <= 100 && (ratio >= 1.04 || spaced)) {
        kind = "num";
        level = 1;
      } else if (NAMED.test(text) && (ratio >= 1.04 || spaced)) {
        kind = "num";
        level = 1;
      } else if (ratio >= 1.25 && text.length <= 100 && !/[,;]$/.test(text) && /^[A-Z0-9(]/.test(text) && /[A-Za-z]{3}/.test(text) && !repeated) {
        kind = "plain";
      }
      if (!kind) { last = null; continue; }
      if (repeated && kind !== "num") { last = null; continue; }
      const c: Cand = { title: text, page, level, size: l.size, kind, y: l.y, x: l.x, weak, top: m ? Number(m[1].split(".")[0]) : undefined };
      cands.push(c);
      last = c;
    }
  }

  // Weak numbered headings count only when the numbering continues the sequence (1, 2, 3 ...).
  {
    let lastTop = 0;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (c.kind !== "num" || c.top === undefined) continue;
      if (!c.weak) { lastTop = c.top; continue; }
      if (c.top === lastTop || c.top === lastTop + 1) lastTop = c.top;
      else { cands.splice(i, 1); i--; }
    }
  }

  // Plain (size-only) headings: level by size rank among them.
  const plainSizes = [...new Set(cands.filter((c) => c.kind === "plain").map((c) => Math.round(c.size)))].sort((a, b) => b - a);
  for (const c of cands) {
    if (c.kind === "plain") c.level = Math.min(3, plainSizes.indexOf(Math.round(c.size)) + 1);
  }
  const out: Heading[] = [];
  for (const c of cands) {
    const prev = out[out.length - 1];
    if (prev && prev.page === c.page && norm(prev.title) === norm(c.title)) continue;
    out.push({ title: c.title, page: c.page, level: c.level });
  }
  if (out.length < 3) return [];
  return out.slice(0, 3000);
}

interface TocEntry { title: string; printed: number; level: number }

/** Entries of a printed contents page: "<title> .... <page>", leader dots optional. */
export function parseContentsPage(lines: RawLine[]): TocEntry[] {
  const entries: { title: string; printed: number; x: number }[] = [];
  for (const l of [...lines].sort((a, b) => a.y - b.y)) {
    const t = clean(l.text);
    const m = /^(.*?[A-Za-z].*?)\s*(?:(?:\.\s*){3,}|·{2,}|\s{1,})(\d{1,4})$/.exec(t.replace(/\s*(?:\.\s){2,}/g, " ...... "));
    if (!m) continue;
    const title = clean(m[1].replace(/[.\s·]+$/, ""));
    const printed = Number(m[2]);
    if (title.length < 3 || title.length > 140 || !printed) continue;
    if (/^(contents|table of contents|page)$/i.test(title)) continue;
    entries.push({ title, printed, x: l.x });
  }
  if (entries.length < 3) return [];
  const xs = [...new Set(entries.map((e) => Math.round(e.x / 8)))].sort((a, b) => a - b);
  return entries.map((e) => {
    const num = NUM.exec(e.title);
    const level = num ? Math.min(3, num[1].split(".").length) : Math.min(3, xs.indexOf(Math.round(e.x / 8)) + 1);
    return { title: e.title, printed: e.printed, level };
  });
}

/** Contents-page strategy; returns [] when no usable contents page or page mapping is found. */
export function headingsFromContentsPage(all: RawLine[], pageCount: number): Heading[] {
  const limit = Math.min(pageCount, 40);
  let start = 0;
  for (const l of all) {
    if (l.page <= limit && /^(table of contents|contents)$/i.test(clean(l.text)) && l.y < l.pageH * 0.4) { start = l.page; break; }
  }
  if (!start) return [];
  const entries: TocEntry[] = [];
  for (let p = start; p <= Math.min(pageCount, start + 30); p++) {
    const got = parseContentsPage(all.filter((l) => l.page === p));
    if (got.length === 0 && p > start) break;
    entries.push(...got);
  }
  if (entries.length < 4) return [];
  // Map printed numbers to PDF pages: find some entries as headings in the body and take the common offset.
  const bodyLines = all.filter((l) => l.page > start);
  const votes = new Map<number, number>();
  for (const e of entries.slice(0, 25)) {
    const key = norm(e.title).slice(0, 28);
    if (key.length < 5) continue;
    const hit = bodyLines.find((l) => norm(l.text).startsWith(key) && l.page >= e.printed);
    if (hit) votes.set(hit.page - e.printed, (votes.get(hit.page - e.printed) ?? 0) + 1);
  }
  let offset = NaN, best = 0;
  for (const [o, v] of votes) if (v > best) { offset = o; best = v; }
  if (!(best >= 2)) return [];
  return entries
    .map((e) => ({ title: e.title, page: Math.min(pageCount, Math.max(1, e.printed + offset)), level: e.level }))
    .slice(0, 3000);
}

export function buildOutline(lines: RawLine[], pageCount: number): Heading[] {
  const fromToc = headingsFromContentsPage(lines, pageCount);
  if (fromToc.length >= 4) return fromToc;
  return detectHeadings(lines);
}

/** Reads every page's text as lines (largest font size per line, top-down y). */
export async function scanPdfLines(pdf: PDFDocumentProxy, onProgress: (done: number, total: number) => void, dead: () => boolean): Promise<{ lines: RawLine[]; pageCount: number }> {
  const total = Math.min(pdf.numPages, MAX_PAGES);
  const lines: RawLine[] = [];
  for (let n = 1; n <= total; n++) {
    if (dead()) break;
    const page = await pdf.getPage(n);
    const view = page.view; // [x0, y0, x1, y1]
    const pageH = view[3] - view[1];
    const tc = await page.getTextContent();
    let cur: { y: number; x: number; size: number; text: string; end: number } | null = null;
    const flush = () => {
      if (cur && cur.text.trim()) lines.push({ page: n, y: cur.y, x: cur.x, size: cur.size, text: cur.text, pageH });
      cur = null;
    };
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const tr = it.transform as number[];
      const size = it.height || Math.hypot(tr[2], tr[3]) || 10;
      const y = pageH - (tr[5] - view[1]);
      if (cur && Math.abs(y - cur.y) > Math.max(2, size * 0.5)) flush();
      // Two-column pages: text on the same baseline but across a column gap (or jumping back left) is a new line.
      // A lone page number after a gap stays on the line, so "Title      12" in a contents page is kept together.
      if (cur && it.str.trim() && !/^[\divxlcdm]+$/i.test(it.str.trim()) && (tr[4] - cur.end > size * 2.2 || tr[4] < cur.end - size * 3)) flush();
      if (!cur) cur = { y, x: tr[4], size, text: "", end: tr[4] };
      cur.text += it.str;
      cur.end = Math.max(cur.end, tr[4] + (it.width || 0));
      if (size > cur.size) cur.size = size;
      if ((it as { hasEOL?: boolean }).hasEOL) flush();
    }
    flush();
    if (n % 5 === 0) {
      onProgress(n, total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress(total, total);
  return { lines, pageCount: pdf.numPages };
}
