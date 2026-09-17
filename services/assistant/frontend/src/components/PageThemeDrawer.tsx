import { useEffect, useState } from "react";
import {
  DEFAULT_FOLDER_COLORS,
  PAGE_LABELS,
  cssColorToHex,
  hexOk,
  loadPageTheme,
  readCssVar,
  resetPageTheme,
  savePageTheme,
  type PageId,
  type PageTheme,
} from "../lib/theme";
import { api } from "../api/client";
import {
  FONT_CATEGORIES,
  getSelectableFonts,
  refreshCustomFonts,
  resolveFont,
  DEFAULT_TITLE_FONT,
} from "../lib/fonts";
import {
  loadLokiBrand,
  saveLokiBrand,
  announceLokiBrandChange,
  MIN_TITLE_SIZE,
  MAX_TITLE_SIZE,
  type LokiBrand,
} from "../lib/lokiBrand";

interface Props {
  open: boolean;
  page: PageId;
  onClose: () => void;
}

function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value?: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  const shown = cssColorToHex(hexOk(value) ? value : fallback, "#888888");
  return (
    <label className="theme-color-field">
      <span>{label}</span>
      <input type="color" value={shown} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function PageThemeDrawer({ open, page, onClose }: Props) {
  const [theme, setTheme] = useState<PageTheme>({});
  const [brand, setBrand] = useState<LokiBrand>(() => loadLokiBrand());
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [, forceFontsTick] = useState(0);

  useEffect(() => {
    if (open) setTheme(loadPageTheme(page));
  }, [open, page]);

  useEffect(() => {
    if (open && page === "ask") {
      setBrand(loadLokiBrand());
      refreshCustomFonts().then(() => forceFontsTick((v) => v + 1));
      api.uploads.lokiLogo.get()
        .then((r) => setLogoUrl(r.url ? `${r.url}?t=${Date.now()}` : null))
        .catch(() => setLogoUrl(null));
    }
  }, [open, page]);

  function patchBrand(next: Partial<LokiBrand>) {
    const merged = { ...brand, ...next };
    setBrand(merged);
    saveLokiBrand(merged);
  }

  async function handleLogoUpload(file: File) {
    setLogoBusy(true);
    try {
      const r = await api.uploads.lokiLogo.set(file);
      // Cache-bust: the served path is fixed ("logo.<ext>"), so a same-name
      // replacement would otherwise keep showing the browser's cached old image.
      setLogoUrl(`${r.url}?t=${Date.now()}`);
      announceLokiBrandChange();
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleLogoRemove() {
    await api.uploads.lokiLogo.remove();
    setLogoUrl(null);
    announceLokiBrandChange();
  }

  if (!open) return null;

  function patch(next: PageTheme) {
    setTheme(next);
    savePageTheme(page, next);
  }

  const fallbackAccent = readCssVar("--page-accent", readCssVar("--accent", "#4FC3F7"));
  const fallbackEmpty = readCssVar("--heatmap-empty", "#2A3447");
  const fallbackFill = readCssVar("--heatmap-fill", fallbackAccent);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Edit {PAGE_LABELS[page]}</h2>
          <button className="settings-close" onClick={onClose} type="button">×</button>
        </div>

        <div className="settings-section-body" style={{ padding: "12px 16px 20px" }}>
          <p className="settings-info" style={{ marginTop: 0 }}>
            App-wide background, nav, and text stay in Settings → Appearance.
            These colours apply only to this page.
          </p>

          <div className="settings-item">
            <label>Page accent</label>
            <div className="theme-color-grid">
              <ColorField
                label="Buttons, chips, selected tabs"
                value={theme.accent}
                fallback={fallbackAccent}
                onChange={(accent) => patch({ ...theme, accent })}
              />
            </div>
          </div>

          {page === "scores" && (
            <div className="settings-item">
              <label>Heatmap</label>
              <div className="theme-color-grid">
                <ColorField
                  label="Empty cell"
                  value={theme.heatmapEmpty}
                  fallback={fallbackEmpty}
                  onChange={(heatmapEmpty) => patch({ ...theme, heatmapEmpty })}
                />
                <ColorField
                  label="Filled cell"
                  value={theme.heatmapFill}
                  fallback={fallbackFill}
                  onChange={(heatmapFill) => patch({ ...theme, heatmapFill })}
                />
              </div>
            </div>
          )}

          {page === "graph" && (
            <>
              <div className="settings-item">
                <label>Folder colours</label>
                <div className="theme-color-grid">
                  {Object.entries(DEFAULT_FOLDER_COLORS)
                    .filter(([k]) => k !== "external")
                    .map(([folder, fallback]) => (
                      <ColorField
                        key={folder}
                        label={folder}
                        value={theme.graphFolders?.[folder]}
                        fallback={fallback}
                        onChange={(color) =>
                          patch({
                            ...theme,
                            graphFolders: { ...theme.graphFolders, [folder]: color },
                          })
                        }
                      />
                    ))}
                </div>
              </div>
              <div className="settings-item">
                <label>Edge colours</label>
                <div className="theme-color-grid">
                  <ColorField
                    label="Wikilinks"
                    value={theme.graphWikilink}
                    fallback={readCssVar("--graph-wikilink", "#2A3447")}
                    onChange={(graphWikilink) => patch({ ...theme, graphWikilink })}
                  />
                  <ColorField
                    label="Citations"
                    value={theme.graphCitation}
                    fallback={readCssVar("--graph-citation", fallbackAccent)}
                    onChange={(graphCitation) => patch({ ...theme, graphCitation })}
                  />
                  <ColorField
                    label="Suggested"
                    value={theme.graphSuggested}
                    fallback={readCssVar("--graph-suggested", "#A78BFA")}
                    onChange={(graphSuggested) => patch({ ...theme, graphSuggested })}
                  />
                </div>
              </div>
            </>
          )}

          {page === "ask" && (
            <div className="settings-item">
              <label>Loki identity</label>
              <div className="settings-info" style={{ marginBottom: 8 }}>
                Rename the assistant and choose how its title is shown on this page — a font, or your own logo image.
              </div>
              <label className="theme-color-field" style={{ marginBottom: 10 }}>
                <span>Assistant name</span>
                <input
                  type="text"
                  value={brand.name}
                  onChange={(e) => patchBrand({ name: e.target.value })}
                  placeholder="Loki"
                  style={{ maxWidth: 220 }}
                />
              </label>

              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button
                  type="button"
                  className={`btn${brand.titleMode === "text" ? " btn-primary" : ""}`}
                  onClick={() => patchBrand({ titleMode: "text" })}
                >
                  Text + font
                </button>
                <button
                  type="button"
                  className={`btn${brand.titleMode === "logo" ? " btn-primary" : ""}`}
                  onClick={() => patchBrand({ titleMode: "logo" })}
                >
                  Logo image
                </button>
              </div>

              {brand.titleMode === "text" ? (
                <label className="font-picker-field">
                  <span>Title font</span>
                  <select
                    value={brand.fontId}
                    onChange={(e) => patchBrand({ fontId: e.target.value })}
                    style={{ fontFamily: resolveFont(brand.fontId, DEFAULT_TITLE_FONT).stack }}
                  >
                    {FONT_CATEGORIES.map((cat) => (
                      <optgroup key={cat.id} label={cat.label}>
                        {getSelectableFonts()
                          .filter((f) => f.category === cat.id)
                          .map((f) => (
                            <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                              {f.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  <label className="theme-color-field" style={{ marginTop: 10 }}>
                    <span>Size ({brand.fontSize}px)</span>
                    <input
                      type="range"
                      min={MIN_TITLE_SIZE}
                      max={MAX_TITLE_SIZE}
                      value={brand.fontSize}
                      onChange={(e) => patchBrand({ fontSize: Number(e.target.value) })}
                    />
                  </label>
                  <div
                    style={{
                      fontFamily: resolveFont(brand.fontId, DEFAULT_TITLE_FONT).stack,
                      fontSize: brand.fontSize,
                      marginTop: 8,
                    }}
                  >
                    {brand.name || "Loki"}
                  </div>
                  <div className="settings-info" style={{ marginTop: 6 }}>
                    Need a specific brush/display font? Upload it under Appearance → Fonts → Custom fonts first, then
                    pick it here.
                  </div>
                </label>
              ) : (
                <div>
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={brand.name}
                      style={{ height: brand.logoHeight, maxHeight: brand.logoHeight, display: "block", marginBottom: 8 }}
                    />
                  ) : (
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>No logo uploaded yet.</div>
                  )}
                  <label className="theme-color-field" style={{ marginBottom: 10 }}>
                    <span>Size ({brand.logoHeight}px)</span>
                    <input
                      type="range"
                      min={MIN_TITLE_SIZE}
                      max={MAX_TITLE_SIZE}
                      value={brand.logoHeight}
                      onChange={(e) => patchBrand({ logoHeight: Number(e.target.value) })}
                    />
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/jpeg,image/webp"
                    disabled={logoBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleLogoUpload(file);
                      e.target.value = "";
                    }}
                  />
                  {logoUrl && (
                    <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={handleLogoRemove}>
                      Remove logo
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {page === "latex" && (
            <div className="settings-item">
              <label>Syntax colours</label>
              <div className="theme-color-grid">
                <ColorField
                  label="Keyword / command"
                  value={theme.latexKeyword}
                  fallback={readCssVar("--latex-keyword", fallbackAccent)}
                  onChange={(latexKeyword) => patch({ ...theme, latexKeyword })}
                />
                <ColorField
                  label="String"
                  value={theme.latexString}
                  fallback={readCssVar("--latex-string", "#34D399")}
                  onChange={(latexString) => patch({ ...theme, latexString })}
                />
                <ColorField
                  label="Comment"
                  value={theme.latexComment}
                  fallback={readCssVar("--latex-comment", "#6B7280")}
                  onChange={(latexComment) => patch({ ...theme, latexComment })}
                />
                <ColorField
                  label="Brackets [] {}"
                  value={theme.latexBracket}
                  fallback={readCssVar("--latex-bracket", "#CDD9E5")}
                  onChange={(latexBracket) => patch({ ...theme, latexBracket })}
                />
                <ColorField
                  label="Number"
                  value={theme.latexNumber}
                  fallback={readCssVar("--latex-number", "#34D399")}
                  onChange={(latexNumber) => patch({ ...theme, latexNumber })}
                />
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                resetPageTheme(page);
                setTheme({});
              }}
            >
              Reset this page
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
