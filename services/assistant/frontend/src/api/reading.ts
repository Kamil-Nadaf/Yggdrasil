/** Typed client for the Books reading library (/api/reading/*). */

export type BookStatus = "want" | "reading" | "finished";
export type BookFormat = "pdf" | "epub" | "none";

export interface ReadingBook {
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  format: BookFormat;
  has_file: boolean;
  has_cover: boolean;
  status: BookStatus;
  progress: number;
  last_page: number;
  total_pages: number | null;
  last_position: string;
  highlights: number;
  /** Quotes saved to this item's notes (books). */
  note_count?: number;
  last_opened: string | null;
  added: string | null;
  finished: string | null;
  section_count: number;
  /** "paper" for references saved from arXiv/DOI/BibTeX, "book" for books. */
  kind: "paper" | "book";
  item_type: ItemType;
  venue: string;
  doi: string;
  arxiv: string;
  url: string;
  publisher: string;
  volume: string;
  issue: string;
  pages: string;
  abstract: string;
  notes: string;
  citekey: string;
  tags: string[];
  favorite: boolean;
  related: string[];
  zotero_key: string;
}

export interface ReadingNote {
  id: string;
  text: string;
  page: number | null;
  comment: string;
  /** EPUB CFI (books in epub format) so the note can jump back. */
  loc: string;
  created: string;
}

export interface SavedSearch { id: string; name: string; q: string }
export interface AnnotationSyncStatus {
  running: boolean;
  phase: string;
  done: number;
  total: number;
  items: number;
  pulled: number;
  pushed: number;
  updated_local: number;
  updated_remote: number;
  deleted_local: number;
  deleted_remote: number;
  needs_open: number;
  unsupported: number;
  unlinked: number;
  no_pdf: number;
  failed: number;
  error: string;
}

export interface ZoteroImportStatus {
  running: boolean;
  phase: "idle" | "starting" | "collections" | "notes" | "items" | "pdfs" | "done" | "error";
  done: number;
  total: number;
  added: number;
  duplicates: number;
  pdfs: number;
  collections: number;
  error: string;
}

export type ItemType = "article" | "preprint" | "book" | "chapter" | "conference" | "thesis" | "report" | "webpage";
export const ITEM_TYPES: { id: ItemType; label: string }[] = [
  { id: "article", label: "Journal article" },
  { id: "preprint", label: "Preprint" },
  { id: "conference", label: "Conference paper" },
  { id: "book", label: "Book" },
  { id: "chapter", label: "Book chapter" },
  { id: "thesis", label: "Thesis" },
  { id: "report", label: "Report" },
  { id: "webpage", label: "Web page" },
];

export type CiteStyle = "bibtex" | "apa" | "ieee" | "harvard" | "chicago" | "mla" | "ris" | "csljson";
export const CITE_STYLES: { id: CiteStyle; label: string }[] = [
  { id: "bibtex", label: "BibTeX" },
  { id: "apa", label: "APA 7" },
  { id: "ieee", label: "IEEE" },
  { id: "harvard", label: "Harvard" },
  { id: "chicago", label: "Chicago" },
  { id: "mla", label: "MLA" },
  { id: "ris", label: "RIS" },
  { id: "csljson", label: "CSL-JSON" },
];

/** Fields for a new reference (also what DOI/arXiv lookup returns). */
export interface NewItem {
  title: string;
  kind?: "paper" | "book";
  authors?: string[];
  year?: number | null;
  item_type?: ItemType;
  venue?: string;
  doi?: string;
  arxiv?: string;
  url?: string;
  pdf_url?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  abstract?: string;
  tags?: string[];
  collection?: string;
  fetch_pdf?: boolean;
}

export interface BookCollection {
  id: string;
  name: string;
  slugs: string[];
  /** id of the parent collection (sub-collections). */
  parent?: string;
  zotero_key?: string;
}

export interface WeekDay {
  date: string;
  letter: string;
  seconds: number;
  met: boolean;
  state: "done" | "today" | "missed" | "future";
}

export type TimeCategory = "books" | "papers" | "writing";
export interface TimeTotals { books: number; papers: number; writing: number }

export interface ReadingGoal {
  time_today: TimeTotals;
  time_week: TimeTotals;
  date: string;
  goal_minutes: number;
  today_seconds: number;
  goal_met: boolean;
  streak: number;
  record: number;
  week: WeekDay[];
  week_seconds: number;
  pages_today: number;
  pages_week: number;
  highlights_total: number;
  finished_this_year: number;
  reading_count: number;
  current: {
    slug: string;
    title: string;
    format: BookFormat;
    progress: number;
    last_page: number;
    total_pages: number | null;
  } | null;
}

/** EPUB highlight; PDF highlights use the shared PdfAnnotation store. */
export interface EpubHighlight {
  id: string;
  cfi: string;
  text: string;
  color: string;
  note: string;
  chapter: string;
  created: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle<T>(resp);
}

async function handle<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    const detail = Array.isArray(err.detail)
      ? err.detail.map((d: { msg?: string } | string) => (typeof d === "string" ? d : d.msg || JSON.stringify(d))).join("; ")
      : err.detail;
    throw new Error(detail || "Request failed");
  }
  return resp.json();
}

/** Local calendar date (YYYY-MM-DD) — the server may run in another timezone. */
export function localDate(d: Date = new Date()): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export const reading = {
  library: () => call<{ books: ReadingBook[] }>("GET", "/api/reading/library"),

  importBook: async (file: File, meta: { title: string; authors: string; year: string }, cover?: Blob | null) => {
    const form = new FormData();
    form.append("file", file);
    form.append("title", meta.title);
    form.append("authors", meta.authors);
    form.append("year", meta.year);
    if (cover) form.append("cover", cover, "cover.jpg");
    const resp = await fetch("/api/reading/import", { method: "POST", body: form });
    return handle<{ ok: boolean; book: ReadingBook }>(resp);
  },

  attachFile: async (slug: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(`/api/reading/${slug}/file`, { method: "POST", body: form });
    return handle<{ ok: boolean; book: ReadingBook }>(resp);
  },

  patch: (
    slug: string,
    body: Partial<{
      title: string;
      authors: string[];
      year: number;
      status: BookStatus;
      total_pages: number;
      last_page: number;
      last_position: string;
      progress: number;
      item_type: ItemType;
      venue: string;
      doi: string;
      arxiv: string;
      url: string;
      publisher: string;
      volume: string;
      issue: string;
      pages: string;
      abstract: string;
      notes: string;
      citekey: string;
      tags: string[];
      favorite: boolean;
      kind: "paper" | "book";
      related: string[];
    }>
  ) => call<{ ok: boolean; book: ReadingBook }>("PATCH", `/api/reading/${slug}`, body),

  remove: (slug: string) => call<{ ok: boolean }>("DELETE", `/api/reading/${slug}`),

  addItem: (item: NewItem) =>
    call<{ ok: boolean; duplicate: boolean; pdf_saved: boolean; book: ReadingBook }>("POST", "/api/reading/items", item),
  fetchPdf: (slug: string, url = "") =>
    call<{ ok: boolean; book: ReadingBook }>("POST", `/api/reading/items/${slug}/fetch-pdf${url ? `?url=${encodeURIComponent(url)}` : ""}`),
  lookup: (q: string) => call<{ item: NewItem }>("GET", `/api/reading/lookup?q=${encodeURIComponent(q)}`),
  importRefs: (text: string, collection?: string) =>
    call<{ ok: boolean; added: number; duplicates: number }>("POST", "/api/reading/import-refs", { text, collection }),
  cite: (slug: string, style: CiteStyle) =>
    call<{ style: string; text: string; citekey: string }>("GET", `/api/reading/${slug}/cite?style=${style}`),
  exportUrl: (format: CiteStyle, opts: { collection?: string; slugs?: string[] } = {}) =>
    `/api/reading/export?format=${format}${opts.collection ? `&collection=${encodeURIComponent(opts.collection)}` : ""}${opts.slugs ? `&slugs=${opts.slugs.join(",")}` : ""}`,

  searches: () => call<{ searches: SavedSearch[] }>("GET", "/api/reading/searches"),
  saveSearches: (searches: SavedSearch[]) => call<{ ok: boolean; searches: SavedSearch[] }>("PUT", "/api/reading/searches", { searches }),
  merge: (keep: string, remove: string[]) => call<{ ok: boolean; removed: number; book: ReadingBook }>("POST", "/api/reading/merge", { keep, remove }),
  latexBib: (project: string, slugs: string[]) =>
    call<{ ok: boolean; keys: Record<string, string>; added: number; path: string }>("POST", "/api/reading/latex-bib", { project, slugs }),
  importZotero: (withPdfs: boolean) => call<ZoteroImportStatus & { ok: boolean; started: boolean }>("POST", "/api/reading/import-zotero", { with_pdfs: withPdfs }),
  zoteroStatus: () => call<ZoteroImportStatus>("GET", "/api/reading/import-zotero/status"),
  syncAnnotations: () => call<AnnotationSyncStatus & { ok: boolean; started: boolean }>("POST", "/api/reading/sync-annotations"),
  annotationSyncStatus: () => call<AnnotationSyncStatus>("GET", "/api/reading/sync-annotations/status"),

  notes: (slug: string) => call<{ notes: ReadingNote[] }>("GET", `/api/reading/${slug}/notes`),
  addNote: (slug: string, n: { text: string; page?: number | null; comment?: string; loc?: string }) =>
    call<{ ok: boolean; note: ReadingNote; count: number }>("POST", `/api/reading/${slug}/notes`, n),
  saveNotes: (slug: string, notes: ReadingNote[]) => call<{ ok: boolean }>("PUT", `/api/reading/${slug}/notes`, { notes }),
  notesLatex: (slug: string, o: { project?: string; pages?: boolean; heading?: boolean; comments?: boolean }) =>
    call<{ ok: boolean; latex: string; citekey: string; count: number }>("POST", `/api/reading/${slug}/notes/latex`, o),
  notesMarkdown: (slug: string) => call<{ markdown: string; count: number }>("GET", `/api/reading/${slug}/notes/markdown`),

  fileUrl: (slug: string) => `/api/reading/${slug}/file`,
  coverUrl: (slug: string) => `/api/reading/${slug}/cover`,

  highlights: (slug: string) => call<{ highlights: EpubHighlight[] }>("GET", `/api/reading/${slug}/highlights`),
  saveHighlights: (slug: string, highlights: EpubHighlight[]) =>
    call<{ ok: boolean }>("PUT", `/api/reading/${slug}/highlights`, { highlights }),

  collections: () => call<{ collections: BookCollection[] }>("GET", "/api/reading/collections"),
  saveCollections: (collections: BookCollection[]) =>
    call<{ ok: boolean; collections: BookCollection[] }>("PUT", "/api/reading/collections", { collections }),

  goal: () => call<ReadingGoal>("GET", `/api/reading/goal?today=${localDate()}`),
  setGoal: (minutes: number) => call<{ ok: boolean; goal_minutes: number }>("PUT", "/api/reading/goal", { minutes }),
  history: (days = 90) =>
    call<{ goal_minutes: number; days: (TimeTotals & { date: string; goal_met: boolean })[] }>("GET", `/api/reading/history?today=${localDate()}&days=${days}`),

  addTime: (category: TimeCategory, seconds: number) =>
    call<{ ok: boolean; seconds: number }>("POST", "/api/reading/time", { category, seconds, date: localDate() }),

  session: (slug: string, seconds: number, page?: number) =>
    call<{ ok: boolean; seconds: number; goal_met: boolean; habit_synced: boolean }>("POST", "/api/reading/session", {
      slug,
      seconds,
      page,
      date: localDate(),
    }),
};

/** "18:05" for 1085 s; "1:02:03" past an hour. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const z = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${z(m)}:${z(sec)}` : `${m}:${z(sec)}`;
}

/** "42m", "1h 05m" — for time totals (the arc keeps the m:ss clock). */
export function formatDuration(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
