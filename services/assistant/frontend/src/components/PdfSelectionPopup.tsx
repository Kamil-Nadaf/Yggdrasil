import { useState } from "react";
import {
  BUILTIN_COLORS, COLOR_NAMES, resetHighlightPrefs, setHighlightPrefs, slotColor, type HighlightPrefs,
} from "../lib/highlightPrefs";

export type Markup = "highlight" | "underline";
interface Slot { key: string; label: string; letter: string }

/** Floating palette shown next to selected text: colours, underline/highlight, note, and CERIC slots (papers only). */
export default function PdfSelectionPopup({
  x, y, below, prefs, markup, onMarkup, onPick, onNote, onToNotes, slots, addingSlot, onCeric, text,
}: {
  x: number; y: number; below: boolean; prefs: HighlightPrefs; markup: Markup; onMarkup: (m: Markup) => void;
  onPick: (color: string) => void; onNote: () => void; onToNotes?: () => void;
  slots: Slot[] | null; addingSlot: string | null; onCeric: (slotKey: string) => void; text: string;
}) {
  const [cfg, setCfg] = useState(false);
  const left = Math.max(Math.min(215, window.innerWidth / 2), Math.min(window.innerWidth - 215, x));
  const custom = prefs.colors.filter((c) => !BUILTIN_COLORS.includes(c));

  function addCustom(hex: string) {
    if (!prefs.colors.includes(hex)) setHighlightPrefs({ colors: [...prefs.colors, hex].slice(0, 16) });
    onPick(hex);
  }

  return (
    <div
      className="pdfv-selpop"
      style={{ left, top: y, transform: below ? "translate(-50%, 0)" : "translate(-50%, -100%)" }}
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("input")) e.preventDefault(); }}
      onPointerDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Highlight options"
    >
      <div className="pdfv-selpop-row">
        <button type="button" className={`pdfv-mk${markup === "highlight" ? " on" : ""}`} title="Highlight" onClick={() => onMarkup("highlight")}>
          <span className="mk-hl">A</span>
        </button>
        <button type="button" className={`pdfv-mk${markup === "underline" ? " on" : ""}`} title="Underline" onClick={() => onMarkup("underline")}>
          <span className="mk-ul">A</span>
        </button>
        <span className="pdfv-selpop-sep" />
        {prefs.colors.map((c) => (
          <button
            key={c} type="button"
            className={`pdfv-swatch${c === prefs.defaultColor ? " default" : ""}`}
            style={{ background: c }}
            title={`${markup === "underline" ? "Underline" : "Highlight"} ${COLOR_NAMES[c]?.toLowerCase() || c}${c === prefs.defaultColor ? " (default)" : ""}`}
            onClick={() => onPick(c)}
          />
        ))}
        <label className="pdfv-swatch add" title="Custom colour">
          +
          <input type="color" value={prefs.defaultColor} onChange={(e) => addCustom(e.target.value)} />
        </label>
        <span className="pdfv-selpop-sep" />
        <button type="button" className="pdfv-pill" onClick={onNote} title="Highlight and write a note">+ Note</button>
        {onToNotes && (
          <button type="button" className="pdfv-pill notes" onClick={onToNotes} title="Save this text to the book's notes (for LaTeX import)">→ Notes</button>
        )}
        <button type="button" className={`pdfv-pill${cfg ? " on" : ""}`} onClick={() => setCfg((v) => !v)} title="Colours and opacity" aria-label="Highlight settings">⚙</button>
      </div>

      {slots && slots.length > 0 && (
        <div className="pdfv-selpop-row ceric">
          <span className="pdfv-selpop-lbl" title={text}>CERIC</span>
          {slots.map((s, i) => (
            <button
              key={s.key} type="button" className="pdfv-slot" disabled={addingSlot === s.key}
              style={{ background: slotColor(prefs, s.key, i) }}
              onClick={() => onCeric(s.key)} title={`Add to ${s.label} (highlights in this colour)`}
            >
              <b>{addingSlot === s.key ? "…" : s.letter}</b><span>{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {cfg && (
        <div className="pdfv-selpop-cfg">
          <div className="cfg-row">
            <span>Opacity</span>
            <input type="range" min={10} max={85} value={Math.round(prefs.opacity * 100)} onChange={(e) => setHighlightPrefs({ opacity: Number(e.target.value) / 100 })} />
            <em>{Math.round(prefs.opacity * 100)}%</em>
          </div>
          <div className="cfg-row">
            <span>Default</span>
            {prefs.colors.map((c) => (
              <button key={c} type="button" className={`pdfv-swatch small${c === prefs.defaultColor ? " on" : ""}`} style={{ background: c }} onClick={() => setHighlightPrefs({ defaultColor: c })} title="Use as default" />
            ))}
          </div>
          {slots && slots.length > 0 && (
            <div className="cfg-row wrap">
              <span>CERIC</span>
              {slots.map((s, i) => (
                <label key={s.key} className="cfg-slot" title={`${s.label} colour`}>
                  <input type="color" value={slotColor(prefs, s.key, i)} onChange={(e) => setHighlightPrefs({ slotColors: { ...prefs.slotColors, [s.key]: e.target.value } })} />
                  {s.letter}
                </label>
              ))}
            </div>
          )}
          {custom.length > 0 && (
            <div className="cfg-row wrap">
              <span>Custom</span>
              {custom.map((c) => (
                <button key={c} type="button" className="pdfv-swatch small" style={{ background: c }} title="Remove this colour"
                  onClick={() => setHighlightPrefs({ colors: prefs.colors.filter((x) => x !== c), defaultColor: prefs.defaultColor === c ? BUILTIN_COLORS[0] : prefs.defaultColor })} />
              ))}
              <em>click to remove</em>
            </div>
          )}
          <div className="cfg-row"><button type="button" className="pdfv-pill" onClick={resetHighlightPrefs}>Reset colours</button></div>
        </div>
      )}
    </div>
  );
}
