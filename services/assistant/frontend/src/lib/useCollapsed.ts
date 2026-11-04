import { useCallback, useState } from "react";

/** Remembered collapsed/expanded flag for a panel (per-device, falls back to in-memory if storage is blocked). */
export function useCollapsed(key: string, initial = false): [boolean, () => void, (v: boolean) => void] {
  const k = `yggdrasil:collapsed:${key}`;
  const [value, setValue] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback((v: boolean) => {
    setValue(v);
    try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* ignore */ }
  }, [k]);
  const toggle = useCallback(() => set(!value), [set, value]);
  return [value, toggle, set];
}
