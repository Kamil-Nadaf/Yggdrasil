import type { TaskStage } from "../../api/client";
import { TASK_STAGES } from "../../api/client";
import { addDaysISO, parseISO, toISO } from "../../lib/taskDates";
import { parseMinutes } from "../../lib/taskOptions";

/** What the quick-add line understood: "Refit spectrum #sahu !analyse ~2h fri". */
export interface QuickAdd {
  title: string;
  /** Raw text after "#", matched to a project by the caller (see matchProject). */
  project: string | null;
  stage: TaskStage | null;
  estimate_min: number | null;
  deadline: string | null;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LONG = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Lower-case letters and digits only, so "Sahu's Model", "sahus-model" and "sahusmodel" all agree. */
export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Date for one token (today, tomorrow, fri, friday, +3d, 2026-11-20, 11-20), or null. */
export function parseDateWord(word: string, today: string): string | null {
  const w = word.toLowerCase();
  if (w === "today" || w === "tod") return today;
  if (w === "tomorrow" || w === "tmr" || w === "tom") return addDaysISO(today, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  let m = /^(\d{1,2})-(\d{1,2})$/.exec(w);
  if (m) {
    const y = parseISO(today).getFullYear();
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = /^\+(\d{1,3})(d|w)$/.exec(w);
  if (m) return addDaysISO(today, parseInt(m[1], 10) * (m[2] === "w" ? 7 : 1));
  let dow = DAYS.indexOf(w);
  if (dow < 0) dow = DAY_LONG.indexOf(w);
  if (dow >= 0) {
    // The next such weekday after today ("fri" on a Friday means next Friday).
    const cur = parseISO(today).getDay();
    return addDaysISO(today, ((dow - cur + 6) % 7) + 1);
  }
  return null;
}

export function parseQuickAdd(input: string, today: string = toISO(new Date())): QuickAdd {
  const out: QuickAdd = { title: "", project: null, stage: null, estimate_min: null, deadline: null };
  const toks = input.trim().split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  for (const tok of toks) {
    if (tok.startsWith("#") && tok.length > 1 && out.project === null) {
      out.project = tok.slice(1);
      continue;
    }
    if (tok.startsWith("!") && tok.length > 1 && out.stage === null) {
      const q = tok.slice(1).toLowerCase();
      const hit = TASK_STAGES.find((s) => s === q) ?? TASK_STAGES.find((s) => s.startsWith(q));
      if (hit) {
        out.stage = hit;
        continue;
      }
    }
    if (tok.startsWith("~") && tok.length > 1 && out.estimate_min === null) {
      const v = parseMinutes(tok.slice(1));
      if (v !== null && !Number.isNaN(v)) {
        out.estimate_min = v || null;
        continue;
      }
    }
    if (out.deadline === null) {
      const d = parseDateWord(tok, today);
      // A lone word ("friday") is a title, not a date; with other words it is the due date.
      if (d && (toks.length > 1 || tok.startsWith("+"))) {
        out.deadline = d;
        continue;
      }
    }
    rest.push(tok);
  }
  out.title = rest.join(" ");
  return out;
}

/** Best project for a "#text": exact slug/name first, then prefix, then substring (normalised). */
export function matchProject<T extends { slug: string; name: string }>(projects: T[], text: string | null): T | null {
  if (!text) return null;
  const q = normName(text);
  if (!q) return null;
  const keys = (p: T) => [normName(p.slug), normName(p.name)];
  return (
    projects.find((p) => keys(p).includes(q)) ??
    projects.find((p) => keys(p).some((k) => k.startsWith(q))) ??
    projects.find((p) => keys(p).some((k) => k.includes(q))) ??
    null
  );
}
