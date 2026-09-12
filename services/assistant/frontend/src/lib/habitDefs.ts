export interface HabitDef {
  key: string;
  label: string;
}

const STORAGE_KEY = "yggdrasil:habit-defs";

export const DEFAULT_HABIT_DEFS: HabitDef[] = [
  { key: "rise", label: "Wake early" },
  { key: "arxiv", label: "Read arXiv" },
  { key: "reading", label: "Notes" },
  { key: "research", label: "Research work" },
  { key: "extra_read", label: "Extra reading" },
  { key: "exercise", label: "Exercise" },
  { key: "mental", label: "Mental health" },
];

export function loadHabitDefs(): HabitDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_HABIT_DEFS];
    const parsed = JSON.parse(raw) as HabitDef[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_HABIT_DEFS];
    return parsed.filter((h) => h && typeof h.key === "string" && typeof h.label === "string");
  } catch {
    return [...DEFAULT_HABIT_DEFS];
  }
}

export function saveHabitDefs(defs: HabitDef[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defs));
}

/** slug for a new habit label */
export function habitKeyFromLabel(label: string, existing: HabitDef[]): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32) || "habit";
  let key = base;
  let i = 2;
  const keys = new Set(existing.map((h) => h.key));
  while (keys.has(key)) {
    key = `${base}_${i++}`;
  }
  return key;
}
