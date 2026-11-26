import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import AbstractText from "./AbstractText";
import { addUnderSection, sectionAt, type Sec } from "../lib/noteSections";
import { fileToBase64, imageFileName, imageFilesFrom } from "../lib/pastedImages";

const FOLDER = "Reading Notes";

export function readerNotePath(title: string): string {
  const leaf = title.replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/^[-.\s]+|[-.\s]+$/g, "").slice(0, 80) || "untitled";
  return `${FOLDER}/${leaf}`;
}

interface Props {
  title: string;
  page: number;
  /** The paper's chapters/sections in reading order (empty until detected). Notes are filed under them. */
  sections: Sec[];
  /** Markdown blocks waiting to be appended (quotes sent from the annotation list). */
  queue: string[];
  onQueueDone: () => void;
  onSource: (src: string) => void;
  onClose: () => void;
}

/** "My notes" for the item being read: one markdown note in the vault, saved as you type. */
export default function ReaderNotes({ title, page, sections, queue, onQueueDone, onSource, onClose }: Props) {
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
    let cur = srcRef.current;
    for (const block of queue) {
      // quotes carry "— p. N": file them under the section that page belongs to
      const pg = Number(block.match(/—\s*p\.\s*(\d+)/)?.[1]);
      const idx = pg && sections.length ? sectionAt(sections, pg) : -1;
      cur = idx >= 0 ? addUnderSection(cur, sections, idx, block).src : `${cur.replace(/\s+$/, "")}\n\n${block}`;
    }
    set(`${cur.replace(/\s+$/, "")}\n\n`);
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

  /** Save pasted / dropped images to "Reading Notes/assets/" and insert ![](assets/name) at the cursor. */
  async function insertImages(files: File[]) {
    if (files.length === 0) return;
    const el = ta.current;
    const a = el ? el.selectionStart : srcRef.current.length;
    const b = el ? el.selectionEnd : a;
    try {
      let snippet = "";
      for (let i = 0; i < files.length; i++) {
        const name = imageFileName(files[i], i);
        await api.notes.uploadAsset(`${FOLDER}/assets/${name}`, await fileToBase64(files[i]));
        snippet += `${i > 0 ? "\n" : ""}![${name.replace(/\.[^.]+$/, "")}](assets/${name})`;
      }
      // the note may have changed while the upload ran: clamp to the current text
      const cur = srcRef.current;
      const s0 = Math.min(a, cur.length), e0 = Math.min(b, cur.length);
      // keep each image on its own line
      if (s0 > 0 && cur[s0 - 1] !== "\n") snippet = "\n" + snippet;
      if (e0 < cur.length && cur[e0] !== "\n") snippet += "\n";
      set(cur.slice(0, s0) + snippet + cur.slice(e0));
      requestAnimationFrame(() => { const t = ta.current; if (t) { t.focus(); t.selectionStart = t.selectionEnd = s0 + snippet.length; } });
    } catch {
      setState("error");
    }
  }

  /** Pasting a URL over selected text turns the selection into a link. */
  function pasteLink(e: React.ClipboardEvent<HTMLTextAreaElement>): boolean {
    const el = e.currentTarget;
    const a = el.selectionStart, b = el.selectionEnd;
    const url = e.clipboardData.getData("text/plain").trim();
    if (a === b || !/^https?:\/\/\S+$/i.test(url)) return false;
    e.preventDefault();
    const sel = srcRef.current.slice(a, b);
    const md = `[${sel}](${url})`;
    set(srcRef.current.slice(0, a) + md + srcRef.current.slice(b));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + md.length; });
    return true;
  }

  const secIdx = sectionAt(sections, page);
  const sec = secIdx >= 0 ? sections[secIdx] : null;

  /** Put `text` under the heading of the section being read (created in reading order if missing). */
  function insertInSection(text: string) {
    if (!sec) { insert(`\n${text}`); return; }
    const r = addUnderSection(srcRef.current, sections, secIdx, text);
    set(r.src);
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = r.caret; } });
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
      {sec && <div className="rn-sec" title="Notes you add with ❝ or § go under this heading">§ {sec.title} · p.{page}</div>}
      <div className="rn-tb" role="toolbar" aria-label="Note formatting">
        <button type="button" onClick={() => setPreview((v) => !v)} className={preview ? "on" : ""}>{preview ? "Edit" : "Preview"}</button>
        <button type="button" onClick={() => wrap("**")} aria-label="Bold"><b>B</b></button>
        <button type="button" onClick={() => wrap("*")} aria-label="Italic"><i>I</i></button>
        <button type="button" onClick={() => insert("\n## ")} aria-label="Heading">H</button>
        <button type="button" onClick={() => insert("\n- ")} aria-label="Bullet list">• List</button>
        <button type="button" onClick={() => insert("\n- [ ] ")} aria-label="Task">☐ Task</button>
        <button type="button" onClick={() => insertInSection(`> (p. ${page}) `)} title={sec ? `Quote for page ${page}, filed under "${sec.title}"` : `Quote block for page ${page}`}>❝ p.{page}</button>
        <button type="button" disabled={!sec} onClick={() => sec && insertInSection("")} title={sec ? `Jump to / create the heading for "${sec.title}" and write under it` : "Sections not detected yet"}>§ Section</button>
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
          placeholder="Write your notes… paste or drop screenshots, paste a link over selected text, ❝ to quote, --- for a PDF page break"
          onChange={(e) => set(e.target.value)}
          onPaste={(e) => {
            const images = imageFilesFrom(e.clipboardData);
            if (images.length > 0) { e.preventDefault(); void insertImages(images); return; }
            pasteLink(e);
          }}
          onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); }}
          onDrop={(e) => {
            const images = imageFilesFrom(e.dataTransfer);
            if (images.length === 0) return;
            e.preventDefault();
            void insertImages(images);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void flush(); }
          }}
        />
      )}
      <div className="rn-foot">Saved to <span className="mono">{path}.md</span> — also in the Notes section.</div>
    </aside>
  );
}
