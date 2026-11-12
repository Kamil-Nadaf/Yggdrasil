import { parse, stringify } from 'yaml';

export type Meta = Record<string, unknown>;

/** Split a vault Markdown file into its YAML front matter and body (same layout python-frontmatter writes). */
export function parseFm(text: string): { meta: Meta; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  let meta: unknown = {};
  try { meta = parse(m[1]) ?? {}; } catch { return { meta: {}, body: text }; }
  return { meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Meta) : {}, body: m[2] };
}

export function dumpFm(meta: Meta, body: string): string {
  const y = stringify(meta, { version: '1.1', sortMapEntries: true, lineWidth: 0, indentSeq: false }).replace(/\n+$/, '');
  return `---\n${y}\n---\n${body}`;
}

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Meta)[k])]));
  return v;
}

/** Byte-for-byte what the desktop writes for its shared settings (json.dumps(sort_keys=True, indent=1, ensure_ascii=False)). */
export const canonicalJson = (v: unknown) => JSON.stringify(sortKeys(v), null, 1);

/** Patch only the given keys of a front-matter file; returns the original text untouched when nothing changed. */
export function patchFm(raw: string | undefined, want: Meta, base: Meta = {}): string {
  const { meta, body } = parseFm(raw ?? '');
  let changed = raw === undefined;
  const next: Meta = { ...base, ...meta };
  for (const [k, v] of Object.entries(want)) if (!same(next[k], v) || !(k in next)) { next[k] = v; changed = true; }
  return changed ? dumpFm(next, body) : (raw as string);
}

/** Three-way merge of two edited versions of one front-matter file (key by key; the other side wins a true clash). */
export function mergeFm(base: string | undefined, local: string, remote: string): string {
  const b = parseFm(base ?? ''), l = parseFm(local), r = parseFm(remote);
  const out: Meta = {};
  for (const k of new Set([...Object.keys(b.meta), ...Object.keys(l.meta), ...Object.keys(r.meta)])) {
    const [bv, lv, rv] = [b.meta[k], l.meta[k], r.meta[k]];
    let v = rv;
    if (same(lv, rv)) v = lv;
    else if (base !== undefined && same(bv, lv)) v = rv;
    else if (base !== undefined && same(bv, rv)) v = lv;
    else if (k === 'status_id' || k === 'status') v = lv === 'done' ? lv : rv;
    if (v !== undefined) out[k] = v;
  }
  const body = same(l.body, r.body) ? l.body : base !== undefined && b.body === l.body ? r.body : base !== undefined && b.body === r.body ? l.body : r.body;
  return dumpFm(out, body);
}

/** Merge two versions of the shared settings JSON: goals combine by id, everything else follows the usual three-way rule. */
export function mergeSettings(base: string | undefined, local: string, remote: string): string {
  const p = (s?: string): Record<string, unknown> => { try { const j = JSON.parse(s ?? '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };
  const [b, l, r] = [p(base), p(local), p(remote)];
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    let v = r[k];
    if (k === 'goals') {
      type G = { id: string };
      const mapOf = (x: unknown) => new Map(((x as G[]) || []).map((g) => [g.id, g]));
      const [bm, lm, rm] = [mapOf(b[k]), mapOf(l[k]), mapOf(r[k])];
      v = [...new Set([...lm.keys(), ...rm.keys()])]
        .filter((id) => !(bm.has(id) && (!lm.has(id) || !rm.has(id))))  // deleted on either side since the last sync
        .map((id) => { const lg = lm.get(id), rg = rm.get(id); return lg && rg ? (same(bm.get(id), lg) ? rg : same(bm.get(id), rg) ? lg : rg) : (lg ?? rg); });
    } else if (same(l[k], r[k])) v = l[k];
    else if (same(b[k], l[k])) v = r[k];
    else if (same(b[k], r[k])) v = l[k];
    if (v !== undefined) out[k] = v;
  }
  return canonicalJson(out);
}
