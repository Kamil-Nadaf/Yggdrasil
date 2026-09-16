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

  useEffect(() => {
    if (open) setTheme(loadPageTheme(page));
  }, [open, page]);

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
