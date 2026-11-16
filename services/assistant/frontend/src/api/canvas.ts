/** Typed client for the Ink Canvas (/api/canvas/*). */
import type { PageData } from "../views/canvas/ink";

export interface RecognizeAttempt {
  engine: string;
  ok: boolean;
  ms?: number;
  error?: string;
  warnings?: string[];
}

export interface RecognizeResult {
  latex: string;
  engine: string;
  engine_id: string;
  ms: number;
  warnings: string[];
  attempts: RecognizeAttempt[];
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    const detail = Array.isArray(err.detail)
      ? err.detail.map((d: { msg?: string } | string) => (typeof d === "string" ? d : d.msg || JSON.stringify(d))).join("; ")
      : err.detail;
    const e = new Error(detail || "Request failed") as Error & { status: number };
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

export const canvasApi = {
  recognize: (image: string, engines: { id: string; label: string; base_url: string; api_key: string; model: string }[]) =>
    call<RecognizeResult>("POST", "/api/canvas/recognize", { image, engines }),
  models: (base_url: string, api_key: string) =>
    call<{ models: string[] }>("POST", "/api/canvas/models", { base_url, api_key }),
  pages: () => call<{ pages: { name: string; updated: number }[] }>("GET", "/api/canvas/pages"),
  getPage: (name: string) => call<PageData>("GET", `/api/canvas/pages/${encodeURIComponent(name)}`),
  putPage: (name: string, data: PageData) =>
    call<{ ok: boolean }>("PUT", `/api/canvas/pages/${encodeURIComponent(name)}`, data),
  deletePage: (name: string) => call<{ ok: boolean }>("DELETE", `/api/canvas/pages/${encodeURIComponent(name)}`),
};
