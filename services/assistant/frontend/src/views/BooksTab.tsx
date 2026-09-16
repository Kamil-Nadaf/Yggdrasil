import { useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, type LayoutStorage } from "react-resizable-panels";
import { api, type BookFrontmatter, type BookSectionFrontmatter, type BookSummary, type LatexFile } from "../api/client";
import { buildLatexSnippet } from "../components/LatexExportUtils";

const PANEL_SIZES_KEY = "yggdrasil:books-panel-sizes";

const panelStorage: LayoutStorage = {
  getItem: () => localStorage.getItem(PANEL_SIZES_KEY),
  setItem: (_key, value) => localStorage.setItem(PANEL_SIZES_KEY, value),
};

const BODY_HEADINGS = ["Preview", "Explain Cold", "Sanity Check", "Confusions"] as const;

function slugifyBook(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function sectionNoteId(chapter: number | string, section: string): string {
  const ch = String(chapter).trim();
  let s = section.trim();
  if (ch && s.startsWith(`${ch}.`)) s = s.slice(ch.length + 1);
  s = s.replace(/[^A-Za-z0-9._-]/g, "-");
  return `ch${ch}-s${s}`;
}

function parseBodySections(body: string): Record<(typeof BODY_HEADINGS)[number], string> {
  const out = { Preview: "", "Explain Cold": "", "Sanity Check": "", Confusions: "" };
  const re = /^## (Preview|Explain Cold|Sanity Check|Confusions)\s*$/gm;
  const matches = [...body.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i][1] as (typeof BODY_HEADINGS)[number];
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    out[heading] = body.slice(start, end).replace(/<!--[\s\S]*?-->/g, "").trim();
  }
  return out;
}

function buildSectionBody(fields: {
  preview: string;
  explainCold: string;
  sanityCheck: string;
  confusions: string;
}): string {
  return `## Preview
${fields.preview}

## Explain Cold
${fields.explainCold}

## Sanity Check
${fields.sanityCheck}

## Confusions
${fields.confusions}
`;
}

function csv(list: unknown): string {
  return Array.isArray(list) ? list.map(String).join(", ") : "";
}

function fromCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function tierLabel(tier: number): string {
  if (tier >= 2) return "can-teach";
  if (tier === 1) return "understood";
  return "skimmed";
}

export default function BooksTab() {
  const { defaultLayout, onLayoutChange } = useDefaultLayout({
    id: "books",
    storage: panelStorage,
    panelIds: ["book-list", "section-editor"],
  });

  const [books, setBooks] = useState<BookSummary[]>([]);
  const [slug, setSlug] = useState("");
  const [bookFm, setBookFm] = useState<BookFrontmatter | null>(null);
  const [sections, setSections] = useState<{ id: string; frontmatter: BookSectionFrontmatter }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<BookSectionFrontmatter>>({});
  const [preview, setPreview] = useState("");
  const [explainCold, setExplainCold] = useState("");
  const [sanityCheck, setSanityCheck] = useState("");
  const [confusions, setConfusions] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [showNewBook, setShowNewBook] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAuthors, setNewAuthors] = useState("");
  const [newYear, setNewYear] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newTracks, setNewTracks] = useState(false);

  const [showNewSection, setShowNewSection] = useState(false);
  const [nsChapter, setNsChapter] = useState("1");
  const [nsSection, setNsSection] = useState("1");
  const [nsTitle, setNsTitle] = useState("");

  const [exportOpen, setExportOpen] = useState(false);
  const [texFiles, setTexFiles] = useState<LatexFile[]>([]);
  const [exportFile, setExportFile] = useState("");
  const [exportNew, setExportNew] = useState("");
  const [exporting, setExporting] = useState(false);

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(null), 2500);
  }

  const loadBooks = useCallback(async (prefer?: string) => {
    const r = await api.books.list();
    setBooks(r.books);
    const next = prefer || slug || r.books[0]?.slug || "";
    if (next && r.books.some((b) => b.slug === next)) setSlug(next);
    else if (r.books[0]) setSlug(r.books[0].slug);
  }, [slug]);

  useEffect(() => {
    loadBooks().catch((e) => flash(e instanceof Error ? e.message : "Failed to load books"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSections = useCallback(async (bookSlug: string) => {
    if (!bookSlug) {
      setSections([]);
      setBookFm(null);
      setSelectedId(null);
      return;
    }
    const r = await api.books.sections(bookSlug);
    setBookFm(r.book);
    setSections(r.sections);
  }, []);

  useEffect(() => {
    loadSections(slug).catch((e) => flash(e instanceof Error ? e.message : "Failed to load sections"));
    setSelectedId(null);
  }, [slug, loadSections]);

  async function loadSection(id: string) {
    if (!slug) return;
    const r = await api.books.getSection(slug, id);
    const parsed = parseBodySections(r.body || "");
    const fm = r.frontmatter;
    setForm(fm);
    setPreview(parsed.Preview);
    setExplainCold(parsed["Explain Cold"] || String(fm.explain_cold || ""));
    setSanityCheck(parsed["Sanity Check"] || String(fm.sanity_check || ""));
    setConfusions(parsed.Confusions || String(fm.confusions || ""));
    setSelectedId(id);
    setDirty(false);
  }

  async function saveSection() {
    if (!slug || !selectedId) return;
    setSaving(true);
    try {
      const fm: BookSectionFrontmatter = {
        ...form,
        type: "book-section",
        book: slug,
        explain_cold: explainCold,
        sanity_check: sanityCheck,
        confusions,
      };
      await api.books.putSection(
        slug,
        selectedId,
        fm,
        buildSectionBody({ preview, explainCold, sanityCheck, confusions })
      );
      setDirty(false);
      await loadSections(slug);
      flash("Saved");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateBook() {
    const s = (newSlug || slugifyBook(newTitle)).trim();
    if (!s || !newTitle.trim()) {
      flash("Title and slug are required");
      return;
    }
    try {
      await api.books.create({
        slug: s,
        title: newTitle.trim(),
        authors: fromCsv(newAuthors),
        year: newYear ? Number(newYear) : null,
        has_tracks: newTracks,
      });
      setShowNewBook(false);
      setNewTitle("");
      setNewAuthors("");
      setNewYear("");
      setNewSlug("");
      setNewTracks(false);
      await loadBooks(s);
      flash(`Created ${s}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not create book");
    }
  }

  async function handleDeleteBook() {
    if (!slug || !bookFm) return;
    const title = String(bookFm.title || slug);
    if (!window.confirm(`Delete “${title}” and all of its sections? This cannot be undone.`)) return;
    try {
      await api.books.delete(slug);
      setBookFm(null);
      setSections([]);
      setSelectedId(null);
      await loadBooks();
      flash(`Deleted ${title}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not delete book");
    }
  }

  async function handleCreateSection() {
    if (!slug) return;
    const id = sectionNoteId(nsChapter, nsSection);
    try {
      await api.books.putSection(slug, id, {
        chapter: Number(nsChapter) || 0,
        section: nsSection.trim() || String(nsChapter),
        title: nsTitle.trim() || id,
        track: bookFm?.has_tracks ? 1 : null,
      });
      setShowNewSection(false);
      setNsTitle("");
      await loadSections(slug);
      await loadSection(id);
      flash(`Created ${id}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not create section");
    }
  }

  async function openExport() {
    if (!slug || !selectedId) return;
    try {
      const r = await api.latex.listFiles();
      setTexFiles(r.files || []);
      setExportFile(r.files[0]?.name || "");
      setExportNew(`${slug}-notes.tex`);
      setExportOpen(true);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not list LaTeX files");
    }
  }

  async function runExport(mode: "append" | "create") {
    if (!slug || !selectedId) return;
    const target = mode === "append" ? exportFile : exportNew;
    if (!target.trim()) {
      flash("Choose a file name");
      return;
    }
    setExporting(true);
    try {
      const r = await api.books.exportLatex(slug, selectedId, target.trim(), mode);
      flash(`Exported to ${r.path}`);
      setExportOpen(false);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const hasTracks = Boolean(bookFm?.has_tracks);
  const explainFilled = explainCold.trim().length > 0;

  return (
    <div className="books-tab">
      <Group
        id="books"
        orientation="horizontal"
        className="books-panel-group"
        defaultLayout={defaultLayout}
        onLayoutChange={onLayoutChange}
      >
        <Panel id="book-list" defaultSize={35} minSize={22} className="books-panel">
          <div className="books-panel-header">
            <select value={slug} onChange={(e) => setSlug(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
              {books.length === 0 && <option value="">No books yet</option>}
              {books.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.title} ({b.section_count})
                </option>
              ))}
            </select>
            <button className="btn" type="button" onClick={() => setShowNewBook((v) => !v)}>
              New book
            </button>
            <button className="btn" type="button" disabled={!bookFm} onClick={handleDeleteBook} title="Delete this book">
              Delete
            </button>
          </div>

          {showNewBook && (
            <div className="card" style={{ margin: "8px 12px" }}>
              <label>
                <div className="slot-label">Title</div>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => {
                    setNewTitle(e.target.value);
                    setNewSlug(slugifyBook(e.target.value));
                  }}
                />
              </label>
              <label>
                <div className="slot-label">Authors (comma-separated)</div>
                <input type="text" value={newAuthors} onChange={(e) => setNewAuthors(e.target.value)} />
              </label>
              <label>
                <div className="slot-label">Year</div>
                <input type="number" value={newYear} onChange={(e) => setNewYear(e.target.value)} />
              </label>
              <label>
                <div className="slot-label">Slug</div>
                <input type="text" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input type="checkbox" checked={newTracks} onChange={(e) => setNewTracks(e.target.checked)} />
                <span className="mono" style={{ fontSize: 12 }}>has tracks (Track 1 / Track 2)</span>
              </label>
              <button className="btn btn-primary" type="button" style={{ marginTop: 8 }} onClick={handleCreateBook}>
                Create book
              </button>
            </div>
          )}

          <div className="books-section-list">
            {sections.length === 0 ? (
              <div className="muted" style={{ padding: 12 }}>No sections yet.</div>
            ) : (
              sections.map((s) => {
                const fm = s.frontmatter;
                const filled = Boolean(String(fm.explain_cold || "").trim());
                const tier = Number(fm.tier || 0);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`books-section-row${selectedId === s.id ? " active" : ""}`}
                    onClick={() => loadSection(s.id)}
                  >
                    <div className="books-section-row-main">
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                        Ch.{fm.chapter} §{fm.section}
                      </span>
                      <span style={{ fontWeight: 600 }}>{fm.title || s.id}</span>
                    </div>
                    <span className={`books-tier-badge tier-${tier}`}>{tierLabel(tier)}</span>
                    <span
                      className={`books-explain-dot${filled ? " filled" : ""}`}
                      title={filled ? "Explain Cold filled" : "Explain Cold empty"}
                    />
                  </button>
                );
              })
            )}
          </div>
          <div className="books-panel-footer">
            <button className="btn" type="button" disabled={!slug} onClick={() => setShowNewSection((v) => !v)}>
              New section
            </button>
            {msg && <span className="ok mono" style={{ fontSize: 12 }}>{msg}</span>}
          </div>
          {showNewSection && (
            <div className="card" style={{ margin: "0 12px 12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label>
                  <div className="slot-label">Chapter</div>
                  <input type="number" value={nsChapter} onChange={(e) => setNsChapter(e.target.value)} />
                </label>
                <label>
                  <div className="slot-label">Section</div>
                  <input type="text" value={nsSection} onChange={(e) => setNsSection(e.target.value)} />
                </label>
              </div>
              <label>
                <div className="slot-label">Title</div>
                <input type="text" value={nsTitle} onChange={(e) => setNsTitle(e.target.value)} />
              </label>
              <div className="muted mono" style={{ fontSize: 11, margin: "6px 0" }}>
                id: {sectionNoteId(nsChapter, nsSection)}
              </div>
              <button className="btn btn-primary" type="button" onClick={handleCreateSection}>
                Create section
              </button>
            </div>
          )}
        </Panel>

        <Separator className="arxiv-resize-handle" />

        <Panel id="section-editor" defaultSize={65} minSize={30} className="books-panel">
          {!selectedId ? (
            <div className="muted" style={{ padding: 16 }}>Select a section, or create one.</div>
          ) : (
            <div className="books-editor">
              <div className="books-editor-meta">
                <label>
                  <div className="slot-label">Chapter</div>
                  <input
                    type="number"
                    value={form.chapter ?? 0}
                    onChange={(e) => { setForm((f) => ({ ...f, chapter: Number(e.target.value) })); setDirty(true); }}
                    onBlur={saveSection}
                  />
                </label>
                <label>
                  <div className="slot-label">Section</div>
                  <input
                    type="text"
                    value={String(form.section ?? "")}
                    onChange={(e) => { setForm((f) => ({ ...f, section: e.target.value })); setDirty(true); }}
                    onBlur={saveSection}
                  />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  <div className="slot-label">Title</div>
                  <input
                    type="text"
                    value={String(form.title ?? "")}
                    onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); setDirty(true); }}
                    onBlur={saveSection}
                  />
                </label>
                {hasTracks && (
                  <label>
                    <div className="slot-label">Track</div>
                    <select
                      value={form.track ?? 1}
                      onChange={(e) => { setForm((f) => ({ ...f, track: Number(e.target.value) })); setDirty(true); }}
                      onBlur={saveSection}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </label>
                )}
                <label>
                  <div className="slot-label">Tier</div>
                  <select
                    value={form.tier ?? 0}
                    onChange={(e) => { setForm((f) => ({ ...f, tier: Number(e.target.value) })); setDirty(true); }}
                    onBlur={saveSection}
                  >
                    <option value={0}>0 — skimmed</option>
                    <option value={1}>1 — understood</option>
                    <option value={2}>2 — can-teach</option>
                  </select>
                </label>
                <label>
                  <div className="slot-label">Confidence (0–100)</div>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.confidence ?? 0}
                    onChange={(e) => { setForm((f) => ({ ...f, confidence: Number(e.target.value) })); setDirty(true); }}
                    onBlur={saveSection}
                  />
                </label>
                <label>
                  <div className="slot-label">Concepts</div>
                  <input
                    type="text"
                    value={csv(form.concepts)}
                    onChange={(e) => { setForm((f) => ({ ...f, concepts: fromCsv(e.target.value) })); setDirty(true); }}
                    onBlur={saveSection}
                    placeholder="[[geodesic]], ..."
                  />
                </label>
                <label>
                  <div className="slot-label">Tags</div>
                  <input
                    type="text"
                    value={csv(form.tags)}
                    onChange={(e) => { setForm((f) => ({ ...f, tags: fromCsv(e.target.value) })); setDirty(true); }}
                    onBlur={saveSection}
                  />
                </label>
              </div>

              <div className="slot-block" style={{ marginBottom: 10 }}>
                <div className="slot-label">Preview</div>
                <textarea
                  className={`slot-textarea${preview.trim() ? " filled" : ""}`}
                  value={preview}
                  onChange={(e) => { setPreview(e.target.value); setDirty(true); }}
                  onBlur={saveSection}
                  placeholder="2–3 sentences: what question does this section answer?"
                />
              </div>
              <div className="slot-block" style={{ marginBottom: 10 }}>
                <div className="slot-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Explain Cold
                  <span
                    className={`books-explain-dot${explainFilled ? " filled" : ""}`}
                    title={explainFilled ? "Explain Cold filled" : "Explain Cold empty"}
                  />
                </div>
                <textarea
                  className={`slot-textarea${explainFilled ? " filled" : ""}`}
                  value={explainCold}
                  onChange={(e) => { setExplainCold(e.target.value); setDirty(true); }}
                  onBlur={saveSection}
                  placeholder="Book closed. Explain this in your own words to a smart undergrad."
                />
              </div>
              <div className="slot-block" style={{ marginBottom: 10 }}>
                <div className="slot-label">Sanity Check</div>
                <textarea
                  className={`slot-textarea${sanityCheck.trim() ? " filled" : ""}`}
                  value={sanityCheck}
                  onChange={(e) => { setSanityCheck(e.target.value); setDirty(true); }}
                  onBlur={saveSection}
                  placeholder="Plug in a real number. Does the order of magnitude make sense?"
                />
              </div>
              <div className="slot-block" style={{ marginBottom: 10 }}>
                <div className="slot-label">Confusions</div>
                <textarea
                  className={`slot-textarea${confusions.trim() ? " filled" : ""}`}
                  value={confusions}
                  onChange={(e) => { setConfusions(e.target.value); setDirty(true); }}
                  onBlur={saveSection}
                  placeholder="List what you don't understand yet. Chase one; leave the rest here."
                />
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn btn-primary" type="button" onClick={saveSection} disabled={saving || !dirty}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button className="btn" type="button" onClick={openExport}>
                  Export to LaTeX
                </button>
                {msg && <span className="ok mono" style={{ fontSize: 12 }}>{msg}</span>}
              </div>
            </div>
          )}
        </Panel>
      </Group>

      {exportOpen && (
        <div className="books-modal-backdrop" onClick={() => setExportOpen(false)}>
          <div className="card books-modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Export to LaTeX</h2>
            <pre className="mono" style={{ fontSize: 11, maxHeight: 120, overflow: "auto", background: "var(--bg)", padding: 8 }}>
              {buildLatexSnippet({
                title: String(form.title || selectedId || "Untitled"),
                sections: [
                  { heading: "Preview", body: preview },
                  { heading: "Explain Cold", body: explainCold },
                  { heading: "Sanity Check", body: sanityCheck },
                  { heading: "Confusions", body: confusions },
                ],
              })}
            </pre>
            <div className="slot-label">Add to existing file</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <select value={exportFile} onChange={(e) => setExportFile(e.target.value)} style={{ flex: 1 }}>
                {texFiles.length === 0 && <option value="">No .tex files yet</option>}
                {texFiles.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
              <button className="btn btn-primary" type="button" disabled={exporting || !exportFile} onClick={() => runExport("append")}>
                Add
              </button>
            </div>
            <div className="slot-label">Create new file</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" value={exportNew} onChange={(e) => setExportNew(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-primary" type="button" disabled={exporting || !exportNew.trim()} onClick={() => runExport("create")}>
                Create &amp; export
              </button>
            </div>
            <button className="btn" type="button" style={{ marginTop: 16 }} onClick={() => setExportOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
