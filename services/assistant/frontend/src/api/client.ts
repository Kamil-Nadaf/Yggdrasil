const BASE = "";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    const e = new Error(err.detail || "Request failed") as Error & { status: number; data: unknown };
    e.status = resp.status;
    e.data = err;
    throw e;
  }
  return resp.json();
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface PaperFrontmatter {
  citekey?: string;
  arxiv?: string;
  title?: string;
  authors?: string[];
  year?: number | string;
  journal?: string;
  doi?: string;
  read?: string;
  tier?: number;
  confidence?: number;
  rating?: number;
  claim?: string;
  evidence?: string;
  reasoning?: string;
  implications?: string;
  context?: string;
  aq_written?: boolean;
  adversarial_question?: string;
  verdict?: string;
  objects?: string[];
  instruments?: string[];
  methods?: string[];
  concepts?: string[];
  tags?: string[];
  [key: string]: unknown;
}

export interface Paper {
  citekey: string;
  frontmatter: PaperFrontmatter;
  body?: string;
  gate?: { passed: boolean; missing: string[]; aq_missing?: boolean };
}

export interface GraphData {
  nodes: { id: string; label: string; folder: string; path: string }[];
  edges: { source: string; target: string }[];
}

export interface ScoreDay {
  date: string;
  points: number;
  detail: { action: string; citekey?: string; pts: number }[];
}

export interface LatexFile {
  name: string;
  modified: string;
  size: number;
}

export interface LatexCompileResult {
  pdf_b64: string;
  log: string;
  errors: string[];
}

export interface LatexListResponse {
  files: LatexFile[];
  folders?: string[];
}

export interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  arxiv_url: string;
  pdf_url: string;
  categories: string[];
  submitted: string;
}

export interface ArxivSearchResult {
  papers: ArxivPaper[];
  total: number;
  start: number;
}

export type ArxivSearchField = "all" | "author" | "title" | "id";

export interface ZoteroAddResult {
  status: "ok" | "error";
  message?: string;
  item?: unknown;
}

// ── API calls ──────────────────────────────────────────────────────────────

export const api = {
  brief: {
    today: () => req<{ date: string; raw: string }>("GET", "/api/brief/today"),
  },

  papers: {
    list: () => req<Paper[]>("GET", "/api/papers"),
    get: (citekey: string) => req<Paper>("GET", `/api/papers/${citekey}`),
    update: (citekey: string, frontmatter: Partial<PaperFrontmatter>, body?: string) =>
      req("PUT", `/api/papers/${citekey}`, { frontmatter, body }),
    triage: (citekey: string, verdict: string, claim?: string) =>
      req("POST", `/api/papers/${citekey}/triage`, { verdict, claim }),
    appendSlot: (
      citekey: string,
      slot: string,
      text: string,
      meta?: { title?: string; authors?: string[]; arxiv?: string; year?: string }
    ) =>
      req<{ ok: boolean; citekey: string; slot: string; value: string }>(
        "POST",
        `/api/papers/${citekey}/append-slot`,
        { slot, text, ...meta }
      ),
    raw: (citekey: string) => req<{ raw: string }>("GET", `/api/papers/${citekey}/raw`),
  },

  locate: (query: string, limit = 5) =>
    req<{ results: { citekey: string; chunk: string }[] }>("POST", "/api/locate", { query, limit }),

  ask: (question: string, limit = 6) =>
    req<{ answer: string; sources: { citekey: string; excerpt: string }[] }>("POST", "/api/ask", {
      question,
      limit,
    }),

  examine: (citekey: string) =>
    req<{ ok: boolean; response: string }>("POST", "/api/examine", { citekey }),

  graph: () => req<GraphData>("GET", "/api/graph"),

  zotero: {
    search: (q: string) => req<PaperFrontmatter>("GET", `/api/zotero/search?q=${encodeURIComponent(q)}`),
    ensure: (arxivId: string) => req<PaperFrontmatter>("POST", `/api/zotero/ensure/${arxivId}`),
    addPaper: (arxiv_id: string, title: string, authors: string[], pdf_url: string) =>
      req<ZoteroAddResult>("POST", "/api/zotero/add-paper", { arxiv_id, title, authors, pdf_url }),
  },

  arxiv: {
    daily: (max = 200) => req<ArxivPaper[]>("GET", `/api/arxiv/daily?max=${max}`),
    search: (q: string, field: ArxivSearchField = "all", start = 0, maxResults = 50) =>
      req<ArxivSearchResult>(
        "GET",
        `/api/arxiv/search?q=${encodeURIComponent(q)}&field=${field}&start=${start}&max_results=${maxResults}`
      ),
  },

  scores: {
    today: () => req<ScoreDay>("GET", "/api/scores/today"),
    week: () =>
      req<{ days: ScoreDay[]; week_total: number; week_target: number }>("GET", "/api/scores/week"),
  },

  latex: {
    compile: (source: string, filename: string) =>
      req<LatexCompileResult>("POST", "/api/latex/compile", { source, filename }),
    save: (filename: string, source: string) =>
      req<{ path: string }>("POST", "/api/latex/save", { filename, source }),
    createFolder: (path: string) =>
      req<{ path: string }>("POST", "/api/latex/folders", { path }),
    listFiles: () => req<LatexListResponse>("GET", "/api/latex/files"),
    getFile: (name: string) => req<{ source: string }>("GET", `/api/latex/files/${encodeURIComponent(name)}`),
    deleteFile: (name: string) => req<{ ok: boolean }>("DELETE", `/api/latex/files/${encodeURIComponent(name)}`),
  },

  vault: {
    gitStatus: () =>
      req<{ is_repo: boolean; remote?: string | null; branch?: string | null; last_commit?: string | null; dirty_files?: number }>(
        "GET",
        "/api/vault/git/status"
      ),
    gitInit: (remote_url: string) => req<{ ok: boolean; message: string }>("POST", "/api/vault/git/init", { remote_url }),
    gitSync: () => req<{ ok: boolean; message: string; pushed?: boolean }>("POST", "/api/vault/git/sync"),

    webdavStatus: () =>
      req<{ configured: boolean; url?: string; username?: string; remote_dir?: string; last_sync?: string | null }>(
        "GET",
        "/api/vault/webdav/status"
      ),
    webdavConfig: (url: string, username: string, password: string, remote_dir: string) =>
      req<{ ok: boolean; message: string }>("POST", "/api/vault/webdav/config", { url, username, password, remote_dir }),
    webdavSync: () => req<{ ok: boolean; message: string; pushed?: number }>("POST", "/api/vault/webdav/sync"),
  },
};
