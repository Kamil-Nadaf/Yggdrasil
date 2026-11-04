import type { ReactNode } from "react";

/** Semicircle progress arc: `fraction` 0..1 of the goal, drawn left to right over the top.
 * Scales to whatever box it is put in (the SVG keeps its aspect ratio). */
export default function ReadingArc({ fraction, width = 440, stroke = 12, fluid = false, children }: { fraction: number; width?: number; stroke?: number; fluid?: boolean; children?: ReactNode }) {
  const f = Math.max(0, Math.min(0.999, fraction));
  const r = width / 2 - stroke;
  const cx = width / 2;
  const cy = r + stroke;
  const h = cy + stroke;
  const ex = cx - r * Math.cos(Math.PI * f);
  const ey = cy - r * Math.sin(Math.PI * f);
  const track = `M ${stroke} ${cy} A ${r} ${r} 0 0 1 ${width - stroke} ${cy}`;
  const prog = `M ${stroke} ${cy} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  return (
    <div className={`rd-arc${fluid ? " rd-arc--fluid" : ""}`} style={fluid ? undefined : { width, height: h }}>
      <svg width={fluid ? "100%" : width} height={fluid ? "100%" : h} viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="xMidYMax meet" fill="none" aria-hidden="true">
        <path d={track} className="rd-arc-track" strokeWidth={stroke} strokeLinecap="round" />
        {f > 0 && <path d={prog} className="rd-arc-fill" strokeWidth={stroke} strokeLinecap="round" />}
      </svg>
      <div className="rd-arc-center">{children}</div>
    </div>
  );
}
