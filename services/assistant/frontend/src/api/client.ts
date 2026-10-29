const BASE = "";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    const detail = Array.isArray(err.detail)
      ? err.detail.map((d: { msg?: string } | string) => (typeof d === "string" ? d : d.msg || JSON.stringify(d))).join("; ")
      : err.detail;
    const e = new Error(detail || "Request failed") as Error & { status: number; data: unknown };
    e.status = resp.status;
    e.data = err;
    throw e;
  }
  return resp.json();
}

async function upload<T>(method: string, path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(BASE + path, { method, body: form });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    const detail = Array.isArray(err.detail)
      ? err.detail.map((d: { msg?: string } | string) => (typeof d === "string" ? d : d.msg || JSON.stringify(d))).join("; ")
      : err.detail;
    throw new Error(detail || "Upload failed");
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

export interface GraphEdge {
  source: string;
  target: string;
  type?: string;
  reason_text?: string;
  confidence_score?: number;
}

export interface GraphData {
  nodes: { id: string; label: string; folder: string; path: string }[];
  edges: GraphEdge[];
}

export interface GraphNeighbor {
  note: string;
  type: string;
  reason_text: string;
  confidence_score: number;
  created_at?: string;
}

export interface BookSummary {
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  has_tracks: boolean;
  started?: string;
  section_count: number;
}

export interface BookFrontmatter {
  type?: string;
  slug?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  has_tracks?: boolean;
  total_sections?: number | null;
  started?: string;
  [key: string]: unknown;
}

export interface BookSectionFrontmatter {
  type?: string;
  book?: string;
  chapter?: number | string;
  section?: string;
  title?: string;
  track?: number | null;
  read?: string;
  tier?: number;
  confidence?: number;
  concepts?: string[];
  tags?: string[];
  explain_cold?: string;
  sanity_check?: string;
  confusions?: string;
  [key: string]: unknown;
}

export interface BookSection {
  id: string;
  frontmatter: BookSectionFrontmatter;
  body?: string;
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
  assets?: LatexFile[];
}

export interface NotesListResponse {
  root: string;
  files: LatexFile[];
  folders: string[];
}

/** Encode each path segment so nested paths like MyPaper/main survive the URL. */
function encodeLatexPath(name: string): string {
  return name.split("/").map(encodeURIComponent).join("/");
}

/** URL that serves a LaTeX project asset (image / PDF / text) for inline preview. */
export function latexAssetUrl(path: string): string {
  return `/api/latex/assets/${encodeLatexPath(path)}`;
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
  source?: string;
  doi?: string;
}

export interface ArxivSearchResult {
  papers: ArxivPaper[];
  total: number;
  start: number;
}

export type ArxivSearchField = "all" | "author" | "title" | "id";
export type AcademicSearchSource = "all" | "openalex" | "arxiv" | "europepmc";

export interface ZoteroAddResult {
  status: "ok" | "error";
  message?: string;
  item?: unknown;
}

export interface TaskProject {
  slug: string;
  name: string;
  pinned: boolean;
  created_at: string;
  main_task_count: number;
}

/** A user-defined shape token — grayscale-safe status differentiation, color is secondary. */
export type StatusIcon = "circle-outline" | "half-fill" | "full-fill" | "square" | "triangle";

export interface TaskStatusDef {
  id: string;
  name: string;
  color: string;
  order: number;
  icon: StatusIcon;
}

export interface Goal {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export interface MainTask {
  id: string;
  project_slug: string;
  name: string;
  deadline: string | null;
  is_active: boolean;
  status_id: string;
  created_at: string;
  subtask_done: number;
  subtask_total: number;
}

export interface Subtask {
  id: string;
  main_task_id: string;
  project_slug: string;
  name: string;
  deadline: string | null;
  status_id: string;
  done: boolean;
  completed_at: string | null;
  created_at: string;
}

export interface ActiveMainTask {
  project_slug: string;
  project_name: string;
  main_task_id: string;
  main_task_name: string;
  deadline: string | null;
  subtask_done: number;
  subtask_total: number;
}

/** A main task or subtask with a deadline — one entry on the Calendar view. */
export interface CalendarItem {
  kind: "main" | "subtask";
  id: string;
  name: string;
  deadline: string; // YYYY-MM-DD
  status_id: string;
  done: boolean;
  project_slug: string;
  project_name: string;
  main_task_id: string;
  main_task_name: string;
}

export interface NotificationSettings {
  enabled: boolean;
  /** true only in the desktop app — native reminders can't run in a browser or Docker. */
  desktop: boolean;
}

export type AiProviderConfig = {
  provider: string;
  api_key?: string;
  base_url?: string;
  model?: string;
};

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
    delete: (citekey: string) =>
      req<{ ok: boolean; citekey: string }>("DELETE", `/api/papers/${encodeURIComponent(citekey)}`),
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

  search: (q: string, limit = 30) =>
    req<{ results: { citekey: string; title: string; folder: string; path: string; snippet: string }[]; query: string }>(
      "GET",
      `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`
    ),

  digest: (period: "week" | "month" = "week") =>
    req<{ markdown: string; count: number; start: string; end: string }>("GET", `/api/digest?period=${period}`),

  zoteroAudit: () =>
    req<{
      missing: { citekey: string; title: string; arxiv: string }[];
      found: { citekey: string; title: string; arxiv: string }[];
      total: number;
    }>("GET", "/api/zotero/audit"),

  graphCitations: () => req<{ edges: { source: string; target: string; type: string }[] }>("GET", "/api/graph/citations"),
  graphSuggested: () =>
    req<{ edges: { source: string; target: string; type: string }[]; warning?: string }>("GET", "/api/graph/suggested"),
  graphNeighbors: (note: string, limit = 20) =>
    req<{ note: string; neighbors: GraphNeighbor[] }>("POST", "/api/graph/neighbors", { note, limit }),
  graphRebuild: () =>
    req<{ ok: boolean; notes?: number; edges_written?: number; message?: string }>("POST", "/api/graph/rebuild"),

  clientPrefs: {
    get: () => req<{ prefs: Record<string, string> }>("GET", "/api/settings/client-prefs"),
    save: (prefs: Record<string, string>) =>
      req<{ ok: boolean }>("POST", "/api/settings/client-prefs", { prefs }),
  },

  uploads: {
    fonts: {
      list: () => req<{ fonts: { filename: string; url: string }[] }>("GET", "/api/uploads/fonts"),
      add: (file: File) => upload<{ ok: boolean; filename: string; url: string }>("POST", "/api/uploads/fonts", file),
      remove: (filename: string) => req<{ ok: boolean }>("DELETE", `/api/uploads/fonts/${encodeURIComponent(filename)}`),
    },
    lokiLogo: {
      get: () => req<{ url: string | null }>("GET", "/api/uploads/loki-logo"),
      set: (file: File) => upload<{ ok: boolean; url: string }>("POST", "/api/uploads/loki-logo", file),
      remove: () => req<{ ok: boolean }>("DELETE", "/api/uploads/loki-logo"),
    },
  },

  analysisTags: {
    get: () =>
      req<{
        analysis_tags: string[];
        keys: string[];
        defaults: string[];
        key_counts: Record<string, number>;
      }>("GET", "/api/settings/analysis-tags"),
    set: (analysis_tags: string[], migrate = false, dry_run = true) =>
      req<{
        ok: boolean;
        analysis_tags: string[];
        keys: string[];
        migration?: {
          ok: boolean;
          dry_run: boolean;
          mapping?: Record<string, string>;
          counts?: Record<string, number>;
          changed?: string[];
          skipped?: string[];
          warning?: string;
        };
      }>("POST", "/api/settings/analysis-tags", { analysis_tags, migrate, dry_run }),
    migrate: (mapping: Record<string, string>, dry_run = false) =>
      req<{
        ok: boolean;
        changed: string[];
        skipped: string[];
        dry_run: boolean;
        mapping: Record<string, string>;
        counts: Record<string, number>;
      }>("POST", "/api/settings/analysis-tags/migrate", { mapping, dry_run }),
  },

  ask: (question: string, limit = 6, provider?: AiProviderConfig) =>
    req<{ answer: string; sources: { citekey: string; excerpt: string }[] }>("POST", "/api/ask", {
      question,
      limit,
      provider: provider || undefined,
    }),

  data: {
    probe: (path: string) =>
      req<{
        ok: boolean;
        desktop?: boolean;
        exists?: boolean;
        hasManifest?: boolean;
        hasVaultLayout?: boolean;
        existingData?: boolean;
        previousAppVersion?: string;
        latexFileCount?: number;
        message?: string;
        manifest?: {
          app_version?: string;
          vault_path?: string;
          latex_path?: string;
          notes_path?: string;
        } | null;
      }>("POST", "/api/data/probe", { path }),
  },

  loki: {
    keywords: (query: string, limit = 40) =>
      req<{ keywords: { term: string; count: number; citekeys: string[] }[]; query: string }>(
        "POST",
        "/api/loki/keywords",
        { query, limit }
      ),
  },

  feynman: {
    status: () =>
      req<{
        ok: boolean;
        installed: boolean;
        reachable: boolean;
        internalUrl: string;
        publicUrl: string;
        wsUrl: string;
        port: string;
        docsUrl: string;
        message: string;
        mode?: string;
      }>("GET", "/api/feynman/status"),
  },

  examine: (citekey: string, provider?: AiProviderConfig) =>
    req<{ ok: boolean; response: string }>("POST", "/api/examine", { citekey, provider: provider || undefined }),

  habits: {
    get: (day: string) => req<{ date: string; habits: Record<string, boolean | number> }>("GET", `/api/habits/${day}`),
    set: (day: string, habits: Record<string, boolean | number>) =>
      req<{ ok: boolean; date: string; habits: Record<string, boolean | number> }>("POST", `/api/habits/${day}`, { habits }),
    range: (start: string, end: string) =>
      req<{ days: { date: string; habits: Record<string, boolean | number> }[] }>(
        "GET",
        `/api/habits/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
      ),
  },

  taskProjects: {
    list: () => req<{ projects: TaskProject[] }>("GET", "/api/task-projects"),
    create: (name: string) => req<{ ok: boolean; project: TaskProject }>("POST", "/api/task-projects", { name }),
    delete: (slug: string) => req<{ ok: boolean; slug: string }>("DELETE", `/api/task-projects/${encodeURIComponent(slug)}`),
  },

  mainTasks: {
    list: (projectSlug: string) =>
      req<{ main_tasks: MainTask[] }>("GET", `/api/task-projects/${encodeURIComponent(projectSlug)}/main-tasks`),
    create: (projectSlug: string, body: { name: string; deadline?: string | null; status_id?: string }) =>
      req<{ ok: boolean; main_task: MainTask }>("POST", `/api/task-projects/${encodeURIComponent(projectSlug)}/main-tasks`, body),
    update: (projectSlug: string, id: string, body: { name?: string; deadline?: string | null; is_active?: boolean; status_id?: string }) =>
      req<{ ok: boolean; main_task: MainTask }>(
        "PUT",
        `/api/task-projects/${encodeURIComponent(projectSlug)}/main-tasks/${encodeURIComponent(id)}`,
        body
      ),
    delete: (projectSlug: string, id: string) =>
      req<{ ok: boolean; id: string }>(
        "DELETE",
        `/api/task-projects/${encodeURIComponent(projectSlug)}/main-tasks/${encodeURIComponent(id)}`
      ),
  },

  subtasks: {
    list: (projectSlug: string, mainTaskId: string) =>
      req<{ subtasks: Subtask[] }>(
        "GET",
        `/api/task-projects/${encodeURIComponent(projectSlug)}/main-tasks/${encodeURIComponent(mainTaskId)}/subtasks`
      ),
    create: (projectSlug: string, mainTaskId: string, body: { name: string; deadline?: string | null; status_id?: string }) =>
      req<{ ok: boolean; subtask: Subtask }>(
        "POST",
        `/api/task-projects/${encodeURIComponent(projectSlug)}/main-tasks/${encodeURIComponent(mainTaskId)}/subtasks`,
        body
      ),
    update: (projectSlug: string, mainTaskId: string, id: string, body: { name?: string; deadline?: string | null; status_id?: string }) =>
      req<{ ok: boolean; subtask: Subtask }>(
        "PUT",
        `/api/task-projects/${encodeURIComponent(projectSlug)}/main-tasks/${encodeURIComponent(mainTaskId)}/subtasks/${encodeURIComponent(id)}`,
        body
      ),
    delete: (projectSlug: string, mainTaskId: string, id: string) =>
      req<{ ok: boolean; id: string }>(
        "DELETE",
        `/api/task-projects/${encodeURIComponent(projectSlug)}/main-tasks/${encodeURIComponent(mainTaskId)}/subtasks/${encodeURIComponent(id)}`
      ),
  },

  tasks: {
    activeSummary: () => req<{ active: ActiveMainTask[] }>("GET", "/api/tasks/active-summary"),
    calendar: () => req<{ items: CalendarItem[] }>("GET", "/api/tasks/calendar"),
    completedByDay: (start: string, end: string) =>
      req<{ days: { date: string; count: number }[] }>(
        "GET",
        `/api/tasks/completed-by-day?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
      ),
  },

  notifications: {
    settings: () => req<NotificationSettings>("GET", "/api/notifications/settings"),
    save: (enabled: boolean) => req<NotificationSettings>("POST", "/api/notifications/settings", { enabled }),
    test: () => req<{ desktop: boolean; sent: boolean }>("POST", "/api/notifications/test"),
  },

  taskStatuses: {
    get: () => req<{ task_statuses: TaskStatusDef[]; usage: Record<string, number> }>("GET", "/api/settings/task-statuses"),
    set: (task_statuses: TaskStatusDef[], reassign?: Record<string, string>) =>
      req<{ ok: boolean; task_statuses: TaskStatusDef[] }>("POST", "/api/settings/task-statuses", {
        task_statuses,
        reassign: reassign || {},
      }),
  },

  goals: {
    list: () => req<{ goals: Goal[] }>("GET", "/api/settings/goals"),
    add: (goal: { name: string; start_date: string; end_date: string }) =>
      req<{ ok: boolean; goals: Goal[] }>("POST", "/api/settings/goals", goal),
    update: (id: string, goal: Partial<{ name: string; start_date: string; end_date: string }>) =>
      req<{ ok: boolean; goals: Goal[] }>("PUT", `/api/settings/goals/${encodeURIComponent(id)}`, goal),
    remove: (id: string) => req<{ ok: boolean; goals: Goal[] }>("DELETE", `/api/settings/goals/${encodeURIComponent(id)}`),
  },

  graph: () => req<GraphData>("GET", "/api/graph"),

  zotero: {
    search: (q: string) => req<PaperFrontmatter>("GET", `/api/zotero/search?q=${encodeURIComponent(q)}`),
    ensure: (arxivId: string) => req<PaperFrontmatter>("POST", `/api/zotero/ensure/${arxivId}`),
    addPaper: (arxiv_id: string, title: string, authors: string[], pdf_url: string) =>
      req<ZoteroAddResult>("POST", "/api/zotero/add-paper", { arxiv_id, title, authors, pdf_url }),
  },

  arxiv: {
    topics: () => req<{ topics: { id: string; label: string; group?: string }[] }>("GET", "/api/arxiv/topics"),
    daily: (max = 200, cat = "astro-ph.HE", refresh = false, date?: string) =>
      req<{ papers: ArxivPaper[]; cat: string; date: string | null; cached: boolean; warning?: string | null; latest_submitted?: string }>(
        "GET",
        `/api/arxiv/daily?max=${max}&cat=${encodeURIComponent(cat)}&refresh=${refresh ? "true" : "false"}${date ? `&date=${encodeURIComponent(date)}` : ""}`
      ),
    search: (q: string, field: ArxivSearchField = "all", start = 0, maxResults = 50, source: AcademicSearchSource = "all") =>
      req<ArxivSearchResult>(
        "GET",
        `/api/arxiv/search?q=${encodeURIComponent(q)}&field=${field}&start=${start}&max_results=${maxResults}&source=${source}`
      ),
  },

  books: {
    list: () => req<{ books: BookSummary[] }>("GET", "/api/books"),
    create: (body: { slug: string; title: string; authors: string[]; year: number | null; has_tracks: boolean }) =>
      req<{ ok: boolean; slug: string }>("POST", "/api/books", body),
    delete: (slug: string) =>
      req<{ ok: boolean; slug: string }>("DELETE", `/api/books/${encodeURIComponent(slug)}`),
    sections: (slug: string) =>
      req<{ book: BookFrontmatter; sections: { id: string; frontmatter: BookSectionFrontmatter }[] }>(
        "GET",
        `/api/books/${encodeURIComponent(slug)}/sections`
      ),
    getSection: (slug: string, id: string) =>
      req<BookSection>("GET", `/api/books/${encodeURIComponent(slug)}/sections/${encodeURIComponent(id)}`),
    putSection: (slug: string, id: string, frontmatter: Partial<BookSectionFrontmatter>, body?: string) =>
      req<{ ok: boolean; id: string }>(
        "PUT",
        `/api/books/${encodeURIComponent(slug)}/sections/${encodeURIComponent(id)}`,
        { frontmatter, body }
      ),
    deleteSection: (slug: string, id: string) =>
      req<{ ok: boolean }>("DELETE", `/api/books/${encodeURIComponent(slug)}/sections/${encodeURIComponent(id)}`),
    raw: (slug: string, id: string) =>
      req<{ raw: string }>("GET", `/api/books/${encodeURIComponent(slug)}/sections/${encodeURIComponent(id)}/raw`),
    exportLatex: (slug: string, id: string, target_file: string, mode: "append" | "create") =>
      req<{ ok: boolean; path: string }>(
        "POST",
        `/api/books/${encodeURIComponent(slug)}/sections/${encodeURIComponent(id)}/export-latex`,
        { target_file, mode }
      ),
  },

  latex: {
    compile: (source: string, filename: string) =>
      req<LatexCompileResult>("POST", "/api/latex/compile", { source, filename }),
    save: (filename: string, source: string) =>
      req<{ path: string }>("POST", "/api/latex/save", { filename, source }),
    createFolder: (path: string) =>
      req<{ path: string }>("POST", "/api/latex/folders", { path }),
    deleteFolder: (path: string) =>
      req<{ ok: boolean; path: string }>("DELETE", `/api/latex/folders/${encodeLatexPath(path)}`),
    listFiles: () => req<LatexListResponse>("GET", "/api/latex/files"),
    getFile: (name: string) =>
      req<{ source: string }>("GET", `/api/latex/files/${encodeLatexPath(name)}`),
    deleteFile: (name: string) =>
      req<{ ok: boolean }>("DELETE", `/api/latex/files/${encodeLatexPath(name)}`),
    uploadAsset: (path: string, content_b64: string) =>
      req<{ path: string; size: number }>("POST", "/api/latex/assets", { path, content_b64 }),
    importZip: (name: string, content_b64: string) =>
      req<{
        project: string;
        main: string | null;
        files: number;
        skipped_count: number;
        skipped: string[];
        renamed: string[];
      }>("POST", "/api/latex/import-zip", { name, content_b64 }),
    deleteAsset: (path: string) =>
      req<{ ok: boolean }>("DELETE", `/api/latex/assets/${encodeLatexPath(path)}`),
    zip: (path: string) =>
      req<{ filename: string; zip_b64: string }>("GET", `/api/latex/zip/${encodeLatexPath(path)}`),
    rename: (src: string, dest: string) =>
      req<{ ok: boolean; src: string; dest: string }>("POST", "/api/latex/rename", { src, dest }),
  },

  notes: {
    listFiles: () => req<NotesListResponse>("GET", "/api/notes/files"),
    getFile: (name: string) =>
      req<{ name: string; source: string }>("GET", `/api/notes/files/${encodeLatexPath(name)}`),
    save: (filename: string, source: string) =>
      req<{ ok: boolean; name: string }>("POST", "/api/notes/files", { filename, source }),
    createFolder: (path: string) =>
      req<{ ok: boolean; path: string }>("POST", "/api/notes/folders", { path }),
    deleteFolder: (path: string) =>
      req<{ ok: boolean }>("DELETE", `/api/notes/folders/${encodeLatexPath(path)}`),
    deleteFile: (name: string) =>
      req<{ ok: boolean }>("DELETE", `/api/notes/files/${encodeLatexPath(name)}`),
    rename: (src: string, dest: string) =>
      req<{ ok: boolean }>("POST", "/api/notes/rename", { src, dest }),
    uploadAsset: (path: string, content_b64: string) =>
      req<{ ok: boolean; path: string }>("POST", "/api/notes/assets", { path, content_b64 }),
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

    autosyncStatus: () =>
      req<{ enabled: boolean; interval_minutes: number; target: string; last_run?: string | null }>(
        "GET",
        "/api/vault/autosync/status"
      ),
    autosyncConfig: (enabled: boolean, interval_minutes: number, target: string) =>
      req<{ ok: boolean; message: string }>("POST", "/api/vault/autosync/config", { enabled, interval_minutes, target }),
  },

  webhook: {
    status: () =>
      req<{ configured: boolean; url?: string; enabled?: boolean; day_of_week?: number; hour?: number; last_sent?: string | null }>(
        "GET",
        "/api/webhook/status"
      ),
    config: (url: string, enabled: boolean, day_of_week: number, hour: number) =>
      req<{ ok: boolean; message: string }>("POST", "/api/webhook/config", { url, enabled, day_of_week, hour }),
    test: () => req<{ ok: boolean; message: string }>("POST", "/api/webhook/test"),
  },
};
