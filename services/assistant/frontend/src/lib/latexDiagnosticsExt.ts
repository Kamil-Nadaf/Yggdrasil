import { EditorView, Decoration, type DecorationSet, gutter, GutterMarker } from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";

export type MarkKind = "error" | "warning";
export interface LineMark { line: number; kind: MarkKind; message: string }

export const setLineMarks = StateEffect.define<LineMark[]>();

const errLine = Decoration.line({ class: "cm-diag-error" });
const warnLine = Decoration.line({ class: "cm-diag-warning" });

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setLineMarks)) {
        const doc = tr.state.doc;
        const byLine = new Map<number, LineMark>();
        for (const m of e.value) {
          if (m.line < 1 || m.line > doc.lines) continue;
          const prev = byLine.get(m.line);
          if (!prev || (prev.kind === "warning" && m.kind === "error")) byLine.set(m.line, m);
        }
        const ranges = [...byLine.values()]
          .sort((a, b) => a.line - b.line)
          .map((m) => (m.kind === "error" ? errLine : warnLine).range(doc.line(m.line).from));
        value = Decoration.set(ranges);
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

class Mark extends GutterMarker {
  constructor(readonly kind: MarkKind) { super(); }
  eq(o: Mark) { return o.kind === this.kind; }
  toDOM() {
    const s = document.createElement("span");
    s.className = `cm-diag-mark ${this.kind}`;
    s.textContent = this.kind === "error" ? "●" : "▲";
    return s;
  }
}
const errMark = new Mark("error");
const warnMark = new Mark("warning");

export const latexDiagnosticsExt: Extension = [
  marksField,
  gutter({
    class: "cm-diag-gutter",
    lineMarker(view, line) {
      let found: Mark | null = null;
      view.state.field(marksField).between(line.from, line.from, (_f, _t, d) => {
        found = (d.spec as { class?: string }).class === "cm-diag-error" ? errMark : warnMark;
      });
      return found;
    },
    lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setLineMarks))) || u.docChanged,
  }),
];
