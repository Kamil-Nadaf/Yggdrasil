import { useEffect, useState } from "react";
import { api } from "../api/client";

const KEY = "yggdrasil:zotero-collection";

/** Collection key the user last picked ("" = library root). */
export function getZoteroCollection(): string {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}

let cache: { key: string; name: string }[] | null = null;

/** Dropdown next to “Add to Zotero”: which collection the paper goes into (remembered). */
export default function ZoteroCollectionSelect() {
  const [cols, setCols] = useState<{ key: string; name: string }[]>(cache || []);
  const [value, setValue] = useState(getZoteroCollection());
  const [err, setErr] = useState("");

  function load() {
    api.zotero.collections().then((r) => {
      if (r.error) setErr(r.error); else { setErr(""); cache = r.collections; setCols(r.collections); }
    }).catch(() => setErr("Couldn’t load collections"));
  }
  useEffect(() => { if (!cache) load(); }, []);

  return (
    <select
      className="zotero-collection"
      value={value}
      title={err || "Zotero collection for the next “Add to Zotero”"}
      onFocus={() => { if (err || cols.length === 0) load(); }}
      onChange={(e) => {
        setValue(e.target.value);
        try { localStorage.setItem(KEY, e.target.value); } catch { /* ignore */ }
      }}
    >
      <option value="">Library (no collection)</option>
      {cols.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
      {value && !cols.some((c) => c.key === value) && <option value={value}>(selected collection)</option>}
    </select>
  );
}
