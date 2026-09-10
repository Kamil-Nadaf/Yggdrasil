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
  },

  scores: {
    today: () => req<ScoreDay>("GET", "/api/scores/today"),
    week: () =>
      req<{ days: ScoreDay[]; week_total: number; week_target: number }>("GET", "/api/scores/week"),
  },
};
