/** Parse/serialize GFM pipe tables so they can be edited as a grid instead of raw `| --- |` syntax. */

export type TableAlign = "left" | "center" | "right" | null;

export interface ParsedTable {
  /** Char offset in the source string where the table starts (inclusive). */
  start: number;
  /** Char offset where the table ends (exclusive, no trailing newline). */
  end: number;
  header: string[];
  aligns: TableAlign[];
  rows: string[][];
}

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === "\\" && l[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const SEP_CELL_RE = /^:?-+:?$/;

function isSeparatorLine(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => SEP_CELL_RE.test(c.trim()));
}

function alignFromSep(cell: string): TableAlign {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/** Find every GFM pipe table in a markdown string, in document order. */
export function findTables(source: string): ParsedTable[] {
  const lines = source.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const tables: ParsedTable[] = [];
  let i = 0;
  while (i < lines.length - 1) {
    const headerLine = lines[i];
    const sepLine = lines[i + 1];
    if (
      headerLine.includes("|") &&
      isSeparatorLine(sepLine) &&
      splitRow(headerLine).length === splitRow(sepLine).length
    ) {
      const header = splitRow(headerLine);
      const aligns = splitRow(sepLine).map(alignFromSep);
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
        rows.push(splitRow(lines[j]));
        j++;
      }
      const start = lineOffsets[i];
      const lastLineIdx = j - 1;
      const end = lineOffsets[lastLineIdx] + lines[lastLineIdx].length;
      tables.push({ start, end, header, aligns, rows });
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

function padCell(value: string, width: number, align: TableAlign): string {
  const v = value || "";
  const pad = Math.max(0, width - v.length);
  if (align === "right") return " ".repeat(pad) + v;
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + v + " ".repeat(pad - left);
  }
  return v + " ".repeat(pad);
}

function sepCell(width: number, align: TableAlign): string {
  if (align === "center") return ":" + "-".repeat(Math.max(1, width - 2)) + ":";
  if (align === "right") return "-".repeat(Math.max(1, width - 1)) + ":";
  if (align === "left") return ":" + "-".repeat(Math.max(1, width - 1));
  return "-".repeat(width);
}

export function serializeTable(t: { header: string[]; aligns: TableAlign[]; rows: string[][] }): string {
  const cols = t.header.length;
  const widths = Array.from({ length: cols }, (_, c) => {
    let w = (t.header[c] || "").length;
    for (const r of t.rows) w = Math.max(w, (r[c] || "").length);
    return Math.max(w, 3);
  });
  const headerLine = "| " + t.header.map((c, ci) => padCell(c, widths[ci], t.aligns[ci])).join(" | ") + " |";
  const sepLine = "| " + widths.map((w, ci) => sepCell(w, t.aligns[ci])).join(" | ") + " |";
  const rowLines = t.rows.map(
    (r) => "| " + widths.map((w, ci) => padCell(r[ci] || "", w, t.aligns[ci])).join(" | ") + " |"
  );
  return [headerLine, sepLine, ...rowLines].join("\n");
}
