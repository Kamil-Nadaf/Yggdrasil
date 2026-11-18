/**
 * Markdown → LaTeX conversion used for the Notes workspaces' "Export as PDF".
 * Goes through the existing `/api/latex/compile` pipeline (scratch dir, never
 * touches the vault).
 *
 * Page breaks: a line containing only `---` (three or more dashes, after the
 * frontmatter) starts a new PDF page. Everything else maps to ordinary
 * structure: headings, nested lists, task lists, tables, images, code, quotes /
 * alerts, inline math, links and emphasis.
 */
import { stripFrontmatter } from "./noteTags";

const LATEX_SPECIALS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "$": "\\$",
  "&": "\\&",
  "#": "\\#",
  "_": "\\_",
  "%": "\\%",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

/** Characters pdfLaTeX can't read directly → math-mode commands (no surrounding $). */
const UNICODE_MATH: Record<string, string> = {
  "→": "\\to ", "←": "\\leftarrow ", "↔": "\\leftrightarrow ", "⇒": "\\Rightarrow ", "⇐": "\\Leftarrow ",
  "≥": "\\geq ", "≤": "\\leq ", "≈": "\\approx ", "≠": "\\neq ", "∞": "\\infty ", "∼": "\\sim ",
  "×": "\\times ", "±": "\\pm ", "∝": "\\propto ", "∂": "\\partial ", "∇": "\\nabla ", "∑": "\\sum ",
  "∫": "\\int ", "√": "\\surd ", "⊙": "\\odot ", "°": "^{\\circ}", "−": "-",
  "α": "\\alpha ", "β": "\\beta ", "γ": "\\gamma ", "δ": "\\delta ", "ε": "\\epsilon ", "ζ": "\\zeta ",
  "η": "\\eta ", "θ": "\\theta ", "κ": "\\kappa ", "λ": "\\lambda ", "μ": "\\mu ", "ν": "\\nu ",
  "ξ": "\\xi ", "π": "\\pi ", "ρ": "\\rho ", "σ": "\\sigma ", "τ": "\\tau ", "φ": "\\phi ",
  "χ": "\\chi ", "ψ": "\\psi ", "ω": "\\omega ", "Γ": "\\Gamma ", "Δ": "\\Delta ", "Θ": "\\Theta ",
  "Λ": "\\Lambda ", "Σ": "\\Sigma ", "Φ": "\\Phi ", "Ψ": "\\Psi ", "Ω": "\\Omega ",
};

/** Anything above Latin-1 that isn't mapped above would abort a pdfLaTeX run — drop it. */
function foldUnicode(text: string, math: boolean): string {
  let out = "";
  for (const ch of text) {
    const mapped = UNICODE_MATH[ch];
    if (mapped !== undefined) out += math ? mapped : `$${mapped}$`;
    else if (ch.charCodeAt(0) > 0xff) out += ch === "–" || ch === "—" ? "-" : ch === "‘" || ch === "’" ? "'" : ch === "“" || ch === "”" ? '"' : "";
    else out += ch;
  }
  return out;
}

function escapeLatex(text: string): string {
  return foldUnicode(text.replace(/[\\{}$&#_%~^]/g, (ch) => LATEX_SPECIALS[ch] ?? ch), false);
}

/** Escapes plain text while leaving `$..$` math spans untouched. */
function escapeInline(text: string): string {
  const parts = text.split(/(\$[^$]+\$)/g);
  return parts
    .map((part) => (part.startsWith("$") && part.endsWith("$") ? part : escapeLatex(part)))
    .join("");
}

export interface ExportContext {
  /** Markdown image src → file name shipped alongside the .tex (png/jpg/pdf only). */
  images: Record<string, string>;
}

const IMG_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

function imageLatex(src: string, alt: string, ctx: ExportContext): string {
  const file = ctx.images[src];
  if (!file) return `\\textit{[image: ${escapeLatex(alt || (src.startsWith("data:") ? "figure" : src))}]}`;
  return `\\includegraphics[width=\\linewidth,height=0.6\\textheight,keepaspectratio]{${file}}`;
}

/** Inline markdown → LaTeX: bold, italic, strike, inline code, links, images, math. */
function convertInline(text: string, ctx: ExportContext): string {
  const stash: string[] = [];
  const hold = (s: string) => {
    stash.push(s);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let t = text;
  t = t.replace(/`([^`]+)`/g, (_m, code) => hold(`\\texttt{${escapeLatex(code)}}`));
  t = t.replace(/\$\$([^$]+)\$\$/g, (_m, m) => hold(`\\[${foldUnicode(m, true)}\\]`));
  t = t.replace(/\$([^$\n]+)\$/g, (_m, m) => hold(`$${foldUnicode(m, true)}$`));
  t = t.replace(/\\\((.+?)\\\)/g, (_m, m) => hold(`$${foldUnicode(m, true)}$`));
  t = t.replace(IMG_RE, (_m, alt, src) => hold(imageLatex(src, alt, ctx)));
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) =>
    hold(`\\href{${String(url).replace(/([%#])/g, "\\$1")}}{${escapeLatex(label)}}`)
  );
  t = t.replace(/~~(.+?)~~/g, "\u0001s\u0001$1\u0001/s\u0001");

  t = escapeLatex(t);
  t = t.replace(/\u0001s\u0001(.*?)\u0001\/s\u0001/g, "\\sout{$1}");
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, "\\textbf{\\textit{$1}}");
  t = t.replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}");
  t = t.replace(/__([^_]+)__/g, "\\textbf{$1}");
  t = t.replace(/\*([^*]+)\*/g, "\\textit{$1}");

  return t.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)]);
}

type ListItem = { indent: number; ordered: boolean; text: string; task: "" | " " | "x" };

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; lines: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "list"; items: ListItem[] }
  | { type: "table"; header: string[]; aligns: ("l" | "c" | "r")[]; rows: string[][] }
  | { type: "display-math"; lines: string[] }
  | { type: "paragraph"; text: string }
  | { type: "toc" }
  | { type: "hr" }
  | { type: "pagebreak" };

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function startsBlock(line: string, next?: string): boolean {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^```/.test(line) ||
    /^>\s?/.test(line) ||
    LIST_RE.test(line) ||
    /^\s*(\*\*\*|___)\s*$/.test(line) ||
    line.trim() === "$$" ||
    (line.includes("|") && next !== undefined && TABLE_SEP_RE.test(next) && next.includes("-"))
  );
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim() || /^\s*<\/?details>\s*$/i.test(line)) {
      i++;
      continue;
    }

    const summary = line.match(/^\s*<summary>(.*?)<\/summary>\s*$/i);
    if (summary) {
      blocks.push({ type: "paragraph", text: `**${summary[1]}**` });
      i++;
      continue;
    }

    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", lang: fence[1] || "", lines: codeLines });
      continue;
    }

    if (line.trim() === "$$") {
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") {
        mathLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "display-math", lines: mathLines });
      continue;
    }

    if (/^\s*(\[TOC\]|\[\[_TOC_\]\])\s*$/i.test(line)) {
      blocks.push({ type: "toc" });
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim().replace(/\s+#+\s*$/, "") });
      i++;
      continue;
    }

    // `---` on its own line (not directly under a text line — that is a setext heading) = new page.
    if (/^\s{0,3}-{3,}\s*$/.test(line)) {
      blocks.push({ type: "pagebreak" });
      i++;
      continue;
    }
    if (/^\s*(\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "c" : c.endsWith(":") ? "r" : "l")) as ("l" | "c" | "r")[];
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, aligns, rows });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    if (LIST_RE.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_RE);
        if (!m) break;
        const task = m[3].match(/^\[( |x|X)\]\s+(.*)$/);
        items.push({
          indent: m[1].replace(/\t/g, "    ").length,
          ordered: /\d/.test(m[2]),
          text: task ? task[2] : m[3],
          task: task ? (task[1] === " " ? " " : "x") : "",
        });
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1]) && !/^\s*<\/?details>|^\s*<summary>/i.test(lines[i])) {
      // Setext heading: "Title" followed by === or ---
      if (paraLines.length > 0 && /^(=+|-+)\s*$/.test(lines[i])) break;
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0 && i < lines.length && /^(=+|-+)\s*$/.test(lines[i])) {
      blocks.push({ type: "heading", level: lines[i].startsWith("=") ? 1 : 2, text: paraLines.join(" ") });
      i++;
      continue;
    }
    if (paraLines.length === 0) {
      paraLines.push(line);
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" ") });
  }

  return blocks;
}

const HEADING_CMD = ["\\section*", "\\subsection*", "\\subsubsection*", "\\paragraph*", "\\subparagraph*", "\\subparagraph*"];
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO)\]\s*$/i;

function listToLatex(items: ListItem[], ctx: ExportContext): string {
  const out: string[] = [];
  const stack: { indent: number; env: string }[] = [];
  for (const it of items) {
    const env = it.ordered ? "enumerate" : "itemize";
    while (stack.length && it.indent < stack[stack.length - 1].indent) out.push(`\\end{${stack.pop()!.env}}`);
    if (!stack.length || (it.indent > stack[stack.length - 1].indent && stack.length < 4)) {
      stack.push({ indent: it.indent, env });
      out.push(`\\begin{${env}}`);
    } else if (stack[stack.length - 1].env !== env) {
      out.push(`\\end{${stack.pop()!.env}}`);
      stack.push({ indent: it.indent, env });
      out.push(`\\begin{${env}}`);
    }
    const label = it.task ? `[${it.task === "x" ? "$\\boxtimes$" : "$\\square$"}]` : "";
    out.push(`  \\item${label} ${convertInline(it.text, ctx)}`);
  }
  while (stack.length) out.push(`\\end{${stack.pop()!.env}}`);
  return out.join("\n");
}

function blockToLatex(block: Block, ctx: ExportContext, headings: { level: number; text: string }[]): string {
  switch (block.type) {
    case "heading":
      return `${HEADING_CMD[Math.min(block.level, HEADING_CMD.length) - 1]}{${convertInline(block.text, ctx)}}`;
    case "paragraph": {
      const onlyImage = block.text.trim().match(new RegExp(`^${IMG_RE.source}$`));
      if (onlyImage) return `\\begin{center}\n${imageLatex(onlyImage[2], onlyImage[1], ctx)}\n\\end{center}`;
      return convertInline(block.text, ctx);
    }
    case "hr":
      return "\\bigskip\\hrule\\bigskip";
    case "pagebreak":
      return "\\newpage";
    case "toc":
      return listToLatex(
        headings.map((h) => ({ indent: (h.level - 1) * 2, ordered: false, text: h.text, task: "" as const })),
        ctx
      );
    case "quote": {
      const alert = block.lines[0]?.trim().match(ALERT_RE);
      const body = (alert ? block.lines.slice(1) : block.lines).map((l) => convertInline(l, ctx)).join(" \\\\\n");
      const title = alert ? `\\textbf{${alert[1][0].toUpperCase()}${alert[1].slice(1).toLowerCase()}}\\\\\n` : "";
      return `\\begin{quote}\n${title}${body}\n\\end{quote}`;
    }
    case "list":
      return listToLatex(block.items, ctx);
    case "table": {
      const cols = Math.max(block.header.length, ...block.rows.map((r) => r.length));
      const pad = (row: string[]) => Array.from({ length: cols }, (_, c) => convertInline(row[c] ?? "", ctx));
      const spec = Array.from({ length: cols }, (_, c) => {
        const a = block.aligns[c] ?? "l";
        return `>{${a === "c" ? "\\centering" : a === "r" ? "\\raggedleft" : "\\raggedright"}\\arraybackslash}X`;
      }).join("|");
      const head = pad(block.header).map((c) => `\\textbf{${c}}`).join(" & ");
      const rows = block.rows.map((r) => `${pad(r).join(" & ")} \\\\ \\hline`).join("\n");
      return `{\\small\\noindent\\begin{tabularx}{\\linewidth}{|${spec}|}\n\\hline\n${head} \\\\ \\hline\n${rows}\n\\end{tabularx}}`;
    }
    case "code":
      return `{\\small\\begin{verbatim}\n${block.lines.join("\n").replace(/[^\x00-\x7f]/g, "?")}\n\\end{verbatim}}`;
    case "display-math":
      return `\\[\n${foldUnicode(block.lines.join("\n"), true)}\n\\]`;
    default:
      return "";
  }
}

/** Image sources (`![](src)`) referenced by a note, in order of appearance, de-duplicated. */
export function listNoteImages(markdownSource: string): string[] {
  const body = stripFrontmatter(markdownSource);
  const found = new Set<string>();
  for (const m of body.matchAll(IMG_RE)) found.add(m[2]);
  return [...found];
}

/** Number of PDF pages a note will produce (`---` separators + 1, ignoring empty pages). */
export function countPdfPages(markdownSource: string): number {
  const pages = parseBlocks(stripFrontmatter(markdownSource)).reduce<Block[][]>(
    (acc, b) => {
      if (b.type === "pagebreak") acc.push([]);
      else acc[acc.length - 1].push(b);
      return acc;
    },
    [[]]
  );
  return Math.max(1, pages.filter((p) => p.length > 0).length);
}

/** Builds a standalone, compilable .tex document from a note's markdown body. */
export function markdownToLatexDocument(
  markdownSource: string,
  title: string,
  ctx: ExportContext = { images: {} }
): string {
  const blocks = parseBlocks(stripFrontmatter(markdownSource));
  const headings = blocks
    .filter((b): b is Extract<Block, { type: "heading" }> => b.type === "heading")
    .map((b) => ({ level: b.level, text: b.text }));

  // Collapse leading/trailing/duplicate page breaks so we never emit blank pages.
  const cleaned: Block[] = [];
  for (const b of blocks) {
    if (b.type === "pagebreak" && (cleaned.length === 0 || cleaned[cleaned.length - 1].type === "pagebreak")) continue;
    cleaned.push(b);
  }
  while (cleaned.length && cleaned[cleaned.length - 1].type === "pagebreak") cleaned.pop();

  const rendered = cleaned.map((b) => blockToLatex(b, ctx, headings)).filter(Boolean).join("\n\n");

  return `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb,graphicx,array,tabularx}
\\usepackage[normalem]{ulem}
\\usepackage[margin=1in]{geometry}
\\usepackage{hyperref}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.7em}
\\title{${escapeInline(title || "Untitled")}}
\\date{}
\\begin{document}
\\maketitle

${rendered || "% (empty note)"}

\\end{document}
`;
}
