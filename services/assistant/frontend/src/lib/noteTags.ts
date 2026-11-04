/** Read/write the `tags:` field in a note's YAML frontmatter without a YAML library. */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export function parseTags(source: string): string[] {
  const m = source.match(FM_RE);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => /^tags:/.test(l));
  if (idx < 0) return [];
  const inline = lines[idx].replace(/^tags:/, "").trim();
  let items: string[] = [];
  if (inline.startsWith("[")) {
    items = splitList(inline.replace(/^\[/, "").replace(/\]\s*$/, ""));
  } else if (inline) {
    items = splitList(inline);
  } else {
    for (let i = idx + 1; i < lines.length; i++) {
      const b = lines[i].match(/^\s*-\s+(.*)$/);
      if (!b) break;
      items.push(b[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return [...new Set(items.map(normalizeTag).filter(Boolean))];
}

function yamlItem(tag: string): string {
  return /^[0-9]+$|^(true|false|yes|no|null|on|off)$/i.test(tag) ? `"${tag}"` : tag;
}

export function setTags(source: string, tags: string[]): string {
  const line = `tags: [${tags.map(yamlItem).join(", ")}]`;
  const m = source.match(FM_RE);
  if (!m) return `---\n${line}\n---\n\n${source}`;
  const lines = m[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => /^tags:/.test(l));
  if (idx < 0) {
    lines.push(line);
  } else {
    let end = idx + 1;
    if (!lines[idx].replace(/^tags:/, "").trim()) {
      while (end < lines.length && /^\s*-\s+/.test(lines[end])) end++;
    }
    lines.splice(idx, end - idx, line);
  }
  return `---\n${lines.join("\n")}\n---${m[2] || "\n"}${source.slice(m[0].length)}`;
}

/** If the frontmatter title is empty, fill it from the first markdown heading. */
export function ensureTitle(source: string): string {
  const m = source.match(FM_RE);
  if (!m) return source;
  const lines = m[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => /^title:/.test(l));
  const current = idx >= 0 ? lines[idx].replace(/^title:/, "").trim().replace(/^["']|["']$/g, "") : "";
  if (current) return source;
  const body = source.slice(m[0].length);
  const h = body.match(/^#{1,6}\s+(.+)$/m);
  if (!h) return source;
  const titleLine = `title: "${h[1].trim().replace(/"/g, '\\"')}"`;
  if (idx >= 0) lines[idx] = titleLine;
  else lines.unshift(titleLine);
  return `---\n${lines.join("\n")}\n---${m[2] || "\n"}${body}`;
}
