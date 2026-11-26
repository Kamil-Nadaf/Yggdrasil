import type { PDFDocumentProxy } from "pdfjs-dist";
import { buildOutline, scanPdfLines, type Heading } from "./pdfOutline";

/** A chapter / section of the paper, in reading order. `level` 1 = chapter, 2 = section, ... */
export type Sec = Heading;

// Same cache key the Contents sidebar uses, so a paper is scanned at most once.
const AUTO_KEY = "yggdrasil:pdf-outline:v2:";

interface RawNode { title: string; dest: unknown; items?: RawNode[] }

/** Flat, ordered list of the paper's sections: embedded PDF outline if present, else detected from the text. */
export async function loadSections(pdf: PDFDocumentProxy, dead: () => boolean): Promise<Sec[]> {
  let outline: RawNode[] = [];
  try { outline = ((await pdf.getOutline()) as unknown as RawNode[] | null) || []; } catch { outline = []; }
  if (dead()) return [];
  if (outline.length > 0) {
    const out: Sec[] = [];
    const walk = async (nodes: RawNode[], level: number) => {
      for (const n of nodes) {
        if (dead()) return;
        try {
          const d = typeof n.dest === "string" ? await pdf.getDestination(n.dest) : (n.dest as unknown[] | null);
          if (d) {
            const ref = d[0] as { num: number; gen: number } | number;
            const idx = typeof ref === "object" ? await pdf.getPageIndex(ref) : ref;
            out.push({ title: (n.title || "").replace(/\s+/g, " ").trim(), page: idx + 1, level });
          }
        } catch { /* unresolved destination: skip */ }
        if (n.items?.length) await walk(n.items, level + 1);
      }
    };
    await walk(outline, 1);
    return out.filter((s) => s.title);
  }
  const key = AUTO_KEY + (pdf.fingerprints?.[0] ?? "");
  try {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached) as Sec[];
  } catch { /* ignore a bad cache entry */ }
  try {
    const { lines, pageCount } = await scanPdfLines(pdf, () => {}, dead);
    if (dead()) return [];
    const hs = buildOutline(lines, pageCount);
    try { localStorage.setItem(key, JSON.stringify(hs)); } catch { /* cache is optional */ }
    return hs;
  } catch { return []; }
}

/** Index of the section the reader is in on `page` (the last one starting on or before it), or -1. */
export function sectionAt(secs: Sec[], page: number): number {
  let best = -1;
  for (let i = 0; i < secs.length; i++) if (secs[i].page <= page) best = i;
  return best;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const mdLevel = (s: Sec) => Math.min(6, s.level + 1); // note title is H1-ish frontmatter; chapters -> ##

interface NoteHead { line: number; start: number; end: number; level: number; text: string }

function noteHeadings(src: string): NoteHead[] {
  const out: NoteHead[] = [];
  let pos = 0, inFence = false, inFm = false;
  const lines = src.split("\n");
  lines.forEach((ln, i) => {
    const start = pos;
    pos += ln.length + 1;
    if (i === 0 && ln.trim() === "---") { inFm = true; return; }
    if (inFm) { if (ln.trim() === "---") inFm = false; return; }
    if (/^\s*(```|~~~)/.test(ln)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = ln.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ line: i, start, end: start + ln.length, level: m[1].length, text: norm(m[2]) });
  });
  return out;
}

/**
 * Add `text` under the heading for section `idx` (creating the heading in reading order if the note
 * doesn't have it yet). Returns the new source and the caret position just after the inserted text.
 */
export function addUnderSection(src: string, secs: Sec[], idx: number, text: string): { src: string; caret: number } {
  const sec = secs[idx];
  const heads = noteHeadings(src);
  const mine = heads.findIndex((h) => h.text === norm(sec.title));
  if (mine >= 0) {
    const next = heads[mine + 1];
    const limit = next ? next.start : src.length;
    // end of this section's own content (before the next heading), ignoring trailing blank lines
    const body = src.slice(heads[mine].end, limit).replace(/\s+$/, "");
    const at = heads[mine].end + body.length;
    const ins = `\n\n${text}`;
    const tail = src.slice(at);
    const rest = next ? "\n\n" + tail.replace(/^\s+/, "") : tail.replace(/^\s+$/, "\n");
    return { src: src.slice(0, at) + ins + rest, caret: at + ins.length };
  }
  // new heading: place before the first note heading that belongs later in the paper
  const order = (t: string) => secs.findIndex((s) => norm(s.title) === t);
  const later = heads.find((h) => { const o = order(h.text); return o > idx; });
  const block = `${"#".repeat(mdLevel(sec))} ${sec.title}\n\n${text}`;
  if (later) {
    const out = src.slice(0, later.start) + block + "\n\n" + src.slice(later.start);
    return { src: out, caret: later.start + block.length };
  }
  const base = src.replace(/\s+$/, "");
  const out = `${base}\n\n${block}\n`;
  return { src: out, caret: base.length + 2 + block.length };
}
