/**
 * Look up the meaning of selected text while online. The app's own server does the lookup (/api/define:
 * a free dictionary for words, Wikipedia for phrases and technical terms), so the browser needs no
 * cross-site access. Only the selected word/phrase is sent, and only when the lookup is switched on.
 */
export interface Meaning { pos: string; defs: string[] }
export interface Definition {
  term: string;
  phonetic?: string;
  meanings: Meaning[];
  /** Wikipedia-style summary when there is no dictionary entry */
  summary?: string;
  source: string;
  url?: string;
}
export type LookupResult = { ok: true; def: Definition } | { ok: false; reason: "none" | "offline" };

const cache = new Map<string, LookupResult>();

/** Selected text worth looking up: one to four words, letters only (hyphens/apostrophes allowed). */
export function lookupTerm(text: string): string | null {
  const t = text.replace(/[\u00ad\u200b]/g, "").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return null;
  const words = t.split(" ");
  if (words.length > 4) return null;
  if (!words.every((w) => /^[A-Za-z][A-Za-z'’-]*$/.test(w))) return null;
  return t;
}

export async function define(rawTerm: string, signal: AbortSignal): Promise<LookupResult> {
  const term = lookupTerm(rawTerm);
  if (!term) return { ok: false, reason: "none" };
  const key = term.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, reason: "offline" };
  try {
    const r = await fetch(`/api/define?term=${encodeURIComponent(term)}`, { signal });
    if (!r.ok) return { ok: false, reason: "offline" };
    const res = (await r.json()) as LookupResult;
    if (res.ok || res.reason === "none") cache.set(key, res);
    return res;
  } catch (e) {
    if (signal.aborted) throw e;
    return { ok: false, reason: "offline" };
  }
}
