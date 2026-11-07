import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import AbstractText from "./AbstractText";

const FOLDER = "Reading Notes";

export function readerNotePath(title: string): string {
  const leaf = title.replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/^[-.\s]+|[-.\s]+$/g, "").slice(0, 80) || "untitled";
  return `${FOLDER}/${leaf}`;
}

interface Props {
  title: string;
  page: number;
  /** Markdown blocks waiting to be appended (quotes sent from the annotation list). */
  queue: string[];
  onQueueDone: () => void;
  onSource: (src: string) => void;
  onClose: () => void;
}

/** "My notes" for the item being read: one markdown note in the vault, saved as you type. */
export default function ReaderNotes({ title, page, queue, onQueueDone, onSource, onClose }: Props) {
  const path = readerNotePath(title);
  const [src, setSrc] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState(false);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const srcRef = useRef("");
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const ta = useRef<HTMLTextAreaElement>(null);

  function set(next: string, markDirty = true) {
    srcRef.current = next;
    setSrc(next);
    onSource(next);
    if (markDirty) { dirty.current = true; schedule(); }
  }

  function schedule() {
    window.clearTimeout(timer.current);
    setState("saving");
    timer.current = window.setTimeout(() => void flush(), 700);
  }

  async function flush() {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await api.notes.createFolder(FOLDER).catch(() => {});
      await api.notes.save(path, srcRef.current);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    let live = true;
    setLoaded(false);
    api.notes.getFile(`${path}.md`)
      .then((r) => r.source)
      .catch(() => `---\ntitle: ${title.replace(/\n/g, " ")}\ntags: [reading]\n---\n\n`)
      .then((s) => { if (live) { srcRef.current = s; setSrc(s); onSource(s); setLoaded(true); } });
    return () => { live = false; window.clearTimeout(timer.current); void flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (!loaded || queue.length === 0) return;
    const add = queue.join("\n\n");
    const base = srcRef.current.replace(/\s+$/, "");
    set(`${base}\n\n${add}\n\n`);
    onQueueDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, queue]);

  function insert(text: string) {
    const el = ta.current;
    if (!el) { set(srcRef.current + text); return; }
    const a = el.selectionStart, b = el.selectionEnd;
    set(srcRef.current.slice(0, a) + text + srcRef.current.slice(b));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + text.length; });
  }

  function wrap(l: string, r = l) {
    const el = ta.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const mid = srcRef.current.slice(a, b) || "text";
    set(srcRef.current.slice(0, a) + l + mid + r + srcRef.current.slice(b));
  }

  return (
    <aside className="rn-pane" aria-label="My notes">
      <div className="rn-head">
        <div>
          <div className="rn-kicker">MY NOTES · {state === "saved" ? "SAVED" : state === "saving" ? "SAVING…" : "SAVE FAILED"}</div>
          <div className="rn-title" title={path + ".md"}>{title}</div>
        </div>
        <button type="button" className="rn-x" onClick={onClose} aria-label="Close my notes">×</button>
      </div>
      <div className="rn-tb" role="toolbar" aria-label="Note formatting">
        <button type="button" onClick={() => setPreview((v) => !v)} className={preview ? "on" : ""}>{preview ? "Edit" : "Preview"}</button>
        <button type="button" onClick={() => wrap("**")} aria-label="Bold"><b>B</b></button>
        <button type="button" onClick={() => wrap("*")} aria-label="Italic"><i>I</i></button>
        <button type="button" onClick={() => insert("\n## ")} aria-label="Heading">H</button>
        <button type="button" onClick={() => insert("\n- ")} aria-label="Bullet list">• List</button>
        <button type="button" onClick={() => insert("\n- [ ] ")} aria-label="Task">☐ Task</button>
        <button type="button" onClick={() => insert(`\n> (p. ${page}) `)} title={`Quote block for page ${page}`}>❝ p.{page}</button>
        <button type="button" onClick={() => insert("\n\n---\n\n")} title="Page break in PDF export">⎯ break</button>
      </div>
      {preview ? (
        <div className="rn-preview"><AbstractText text={src.replace(/^---[\s\S]*?\n---\n?/, "")} imageBase={FOLDER} /></div>
      ) : (
        <textarea
          ref={ta}
          className="rn-text"
          value={src}
          disabled={!loaded}
          spellCheck
          placeholder="Write your notes… use ❝ to quote, --- for a PDF page break"
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void flush(); }
          }}
        />
      )}
      <div className="rn-foot">Saved to <span className="mono">{path}.md</span> — also in the Notes section.</div>
    </aside>
  );
}
