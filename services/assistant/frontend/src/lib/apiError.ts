/** Surfaces a FastAPI validation `detail` (string or pydantic error list) from a failed `req()` call. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback;
  const detail = (e as Error & { data?: { detail?: unknown } }).data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item) =>
      typeof item === "string" ? item : (item as { msg?: string }).msg || ""
    );
    const joined = parts.filter(Boolean).join("; ");
    if (joined) return joined;
  }
  return e.message || fallback;
}
