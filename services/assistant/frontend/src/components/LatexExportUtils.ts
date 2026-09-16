export type LatexSection = { heading: string; body: string };

export function escapeLatex(s: string): string {
  return s.replace(/([%$&#_{}])/g, "\\$1");
}

export function buildLatexSnippet(input: { title: string; sections: LatexSection[] }): string {
  const parts = [`\\subsection{${escapeLatex(input.title || "Untitled")}}`];
  for (const section of input.sections) {
    const val = (section.body || "").trim();
    if (!val) continue;
    parts.push(`\\paragraph{${escapeLatex(section.heading)}} ${escapeLatex(val)}`);
  }
  return parts.join("\n\n");
}
