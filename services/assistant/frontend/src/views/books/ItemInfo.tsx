import { useEffect, useState } from "react";
import { CITE_STYLES, ITEM_TYPES, reading, type BookCollection, type CiteStyle, type ItemType, type ReadingBook } from "../../api/reading";

interface Props {
  book: ReadingBook;
  collections: BookCollection[];
  onClose: () => void;
  onOpen: (b: ReadingBook) => void;
  onAttach: (b: ReadingBook) => void;
  onChanged: () => void;
  onCollectionsChange: (next: BookCollection[]) => void;
  /** Every item in the library (for the Related picker). */
  all: ReadingBook[];
  /** Other items that look like duplicates of this one. */
  dupes: ReadingBook[];
  onSelect: (slug: string) => void;
}

/** Zotero-style item pane: editable metadata, tags, notes, collections and ready-made citations. */
export default function ItemInfo({ book, collections, onClose, onOpen, onAttach, onChanged, onCollectionsChange, all, dupes, onSelect }: Props) {
  const [d, setD] = useState(() => draft(book));
  const [dirty, setDirty] = useState(false);
  const [tag, setTag] = useState("");
  const [style, setStyle] = useState<CiteStyle>("apa");
  const [cite, setCite] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setD(draft(book)); setDirty(false); setMsg(""); }, [book.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    setCite("");
    reading.cite(book.slug, style).then((r) => { if (live) setCite(r.text); }).catch(() => { if (live) setCite("Could not build the citation."); });
    return () => { live = false; };
  }, [book.slug, style, book.title, book.authors, book.year, book.venue, book.doi, book.arxiv, book.volume, book.issue, book.pages, book.item_type, book.citekey, book.publisher, book.url, book.tags]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as Element)?.closest?.("input,textarea,select")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const upd = (k: keyof ReturnType<typeof draft>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { setD((s) => ({ ...s, [k]: e.target.value })); setDirty(true); };

  async function run(fn: () => Promise<unknown>, ok = "") {
    setBusy(true);
    setMsg("");
    try { await fn(); onChanged(); if (ok) setMsg(ok); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); }
  }

  const save = () => run(async () => {
    const yr = parseInt(d.year, 10);
    await reading.patch(book.slug, {
      title: d.title.trim() || book.title, authors: d.authors.split(/;|\n|\s+and\s+/).map((a) => a.trim()).filter(Boolean), ...(Number.isFinite(yr) ? { year: yr } : {}),
      item_type: d.item_type, venue: d.venue, doi: d.doi, arxiv: d.arxiv, url: d.url, publisher: d.publisher, volume: d.volume, issue: d.issue, pages: d.pages, abstract: d.abstract, citekey: d.citekey,
    });
    setDirty(false);
  }, "Saved");

  const saveTags = (tags: string[]) => run(() => reading.patch(book.slug, { tags }));
  const addTag = () => { const t = tag.trim(); setTag(""); if (t && !book.tags.includes(t)) void saveTags([...book.tags, t]); };
  const inCols = collections.filter((c) => c.slugs.includes(book.slug));

  function toggleCol(c: BookCollection) {
    const has = c.slugs.includes(book.slug);
    onCollectionsChange(collections.map((x) => (x.id === c.id ? { ...x, slugs: has ? x.slugs.filter((s) => s !== book.slug) : [...x.slugs, book.slug] } : x)));
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setMsg(`${label} copied`); } catch { setMsg("Copy failed — select the text and copy manually"); }
  }

  const key = book.citekey || "";
  return (
    <aside className="ii-pane card" aria-label="Item info">
      <div className="ii-head">
        <span className="ab-tag">{book.kind === "paper" ? "PAPER" : "BOOK"}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={`ii-star${book.favorite ? " on" : ""}`} aria-pressed={book.favorite} title={book.favorite ? "Remove from Favorites" : "Add to Favorites"} onClick={() => void run(() => reading.patch(book.slug, { favorite: !book.favorite }))}>★</button>
        <button type="button" className="btn" onClick={onClose} aria-label="Close info">✕</button>
      </div>

      <div className="ii-actions">
        {book.has_file ? <button type="button" className="btn btn-primary" onClick={() => onOpen(book)}>Read</button> : (
          <>
            <button type="button" className="btn btn-primary" disabled={busy || !(book.arxiv || book.url)} title={book.arxiv ? "Download the PDF from arXiv" : "Needs an arXiv id"} onClick={() => void run(() => reading.fetchPdf(book.slug), "PDF saved")}>Get PDF</button>
            <button type="button" className="btn" onClick={() => onAttach(book)}>Attach file…</button>
          </>
        )}
        {(book.url || book.doi || book.arxiv) && <a className="btn" target="_blank" rel="noopener noreferrer" href={book.doi ? `https://doi.org/${book.doi}` : book.url || `https://arxiv.org/abs/${book.arxiv}`}>↗ Source</a>}
      </div>

      <div className="ii-fields">
        <label className="ii-wide"><span>Type</span>
          <select value={d.item_type} onChange={upd("item_type")}>{ITEM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        </label>
        <label className="ii-wide"><span>Title</span><textarea rows={2} value={d.title} onChange={upd("title")} /></label>
        <label className="ii-wide"><span>Authors <em className="muted">(“;” between)</em></span><textarea rows={2} value={d.authors} onChange={upd("authors")} /></label>
        <label><span>Year</span><input value={d.year} onChange={upd("year")} inputMode="numeric" /></label>
        <label><span>Cite key</span><input value={d.citekey} onChange={upd("citekey")} placeholder="auto" /></label>
        <label className="ii-wide"><span>{d.item_type === "conference" || d.item_type === "chapter" ? "Proceedings / book" : d.item_type === "book" ? "Series" : "Journal / venue"}</span><input value={d.venue} onChange={upd("venue")} /></label>
        <label><span>DOI</span><input value={d.doi} onChange={upd("doi")} /></label>
        <label><span>arXiv</span><input value={d.arxiv} onChange={upd("arxiv")} /></label>
        <label className="ii-wide"><span>URL</span><input value={d.url} onChange={upd("url")} /></label>
        <label className="ii-wide"><span>Publisher</span><input value={d.publisher} onChange={upd("publisher")} /></label>
        <label><span>Volume</span><input value={d.volume} onChange={upd("volume")} /></label>
        <label><span>Issue</span><input value={d.issue} onChange={upd("issue")} /></label>
        <label className="ii-wide"><span>Pages</span><input value={d.pages} onChange={upd("pages")} /></label>
        <label className="ii-wide"><span>Abstract</span><textarea rows={book.abstract ? 6 : 2} value={d.abstract} onChange={upd("abstract")} /></label>
      </div>
      <div className="ii-savebar">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()}>Save changes</button>
        {dirty && <button type="button" className="btn" onClick={() => { setD(draft(book)); setDirty(false); }}>Revert</button>}
        <span className="muted ii-msg" role="status">{msg}</span>
      </div>

      <div className="ii-sec">Tags</div>
      <div className="ii-tags">
        {book.tags.map((t) => <span key={t} className="ii-tag">{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => void saveTags(book.tags.filter((x) => x !== t))}>×</button></span>)}
        <form onSubmit={(e) => { e.preventDefault(); addTag(); }}><input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add tag…" aria-label="Add tag" maxLength={60} /></form>
      </div>

      <div className="ii-sec">Collections</div>
      {collections.length === 0 ? <div className="muted">No collections yet.</div> : (
        <div className="ii-cols">{collections.map((c) => (
          <label key={c.id}><input type="checkbox" checked={c.slugs.includes(book.slug)} onChange={() => toggleCol(c)} />{c.name}</label>
        ))}{inCols.length === 0 && <span className="muted">Not in any collection.</span>}</div>
      )}

      <div className="ii-sec">Related</div>
      <div className="ii-cols">
        {book.related.map((s) => {
          const r = all.find((x) => x.slug === s);
          return r ? (
            <span key={s} className="ii-rel">
              <button type="button" className="ab-link" onClick={() => onSelect(s)} title={r.title}>{r.title}</button>
              <button type="button" aria-label={`Unlink ${r.title}`} onClick={() => void run(() => reading.patch(book.slug, { related: book.related.filter((x) => x !== s) }))}>×</button>
            </span>
          ) : null;
        })}
        <select value="" aria-label="Link a related item" onChange={(e) => { const v = e.target.value; if (v) void run(() => reading.patch(book.slug, { related: [...book.related, v] })); }}>
          <option value="">+ Link a related item…</option>
          {all.filter((x) => x.slug !== book.slug && !book.related.includes(x.slug)).sort((a, b) => a.title.localeCompare(b.title)).map((x) => <option key={x.slug} value={x.slug}>{x.title.slice(0, 70)}</option>)}
        </select>
      </div>

      {dupes.length > 0 && (
        <>
          <div className="ii-sec">Possible duplicates</div>
          <div className="ii-cols">
            {dupes.map((x) => (
              <span key={x.slug} className="ii-rel">
                <button type="button" className="ab-link" onClick={() => onSelect(x.slug)} title={x.title}>{x.title}</button>
                <button type="button" className="btn" disabled={busy} onClick={() => { if (window.confirm(`Merge “${x.title}” into this item? Tags, notes, collections and any file are combined; the other copy is removed.`)) void run(() => reading.merge(book.slug, [x.slug]), "Merged"); }}>Merge into this</button>
              </span>
            ))}
          </div>
        </>
      )}

      <div className="ii-sec">Notes</div>
      <textarea className="ii-notes" rows={5} defaultValue={book.notes} key={`n-${book.slug}`} placeholder="Your notes on this item (Markdown)…" onBlur={(e) => { if (e.target.value !== book.notes) void run(() => reading.patch(book.slug, { notes: e.target.value })); }} />

      <div className="ii-sec">Cite</div>
      <div className="ii-citebar">
        <select value={style} onChange={(e) => setStyle(e.target.value as CiteStyle)} aria-label="Citation style">{CITE_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <button type="button" className="btn" disabled={!cite} onClick={() => void copy(cite, "Citation")}>Copy citation</button>
        <button type="button" className="btn" onClick={async () => { const r = await reading.cite(book.slug, "bibtex").catch(() => null); if (r) void copy(`\\cite{${r.citekey}}`, "\\cite{…}"); }}>Copy \cite</button>
      </div>
      <pre className="ii-cite">{cite || "…"}</pre>
      {key === "" && <div className="muted ii-hint">The cite key is generated from author, year and title; set one above to fix it.</div>}

      <div className="ii-foot muted">
        Added {book.added || "—"}{book.highlights ? ` · ${book.highlights} highlights` : ""}
        <button type="button" className="ab-link ii-del" onClick={() => { if (window.confirm(`Delete “${book.title}”, its file, highlights and notes from your vault? This cannot be undone.`)) void run(async () => { await reading.remove(book.slug); onClose(); }); }}>Delete</button>
      </div>
    </aside>
  );
}

function draft(b: ReadingBook) {
  return {
    title: b.title, authors: b.authors.join("; "), year: b.year ? String(b.year) : "", item_type: b.item_type as ItemType, venue: b.venue, doi: b.doi, arxiv: b.arxiv, url: b.url,
    publisher: b.publisher, volume: b.volume, issue: b.issue, pages: b.pages, abstract: b.abstract, citekey: b.citekey,
  };
}
