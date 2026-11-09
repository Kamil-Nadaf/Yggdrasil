/** Renders ```mermaid fenced blocks (flowcharts, mindmaps, sequence diagrams…)
 * inside a markdown preview. Mermaid is large, so it is loaded lazily the first
 * time a note actually contains a diagram. */
type MermaidApi = typeof import("mermaid").default;
let mermaidPromise: Promise<MermaidApi> | null = null;
let seq = 0;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) mermaidPromise = import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

/** Light text colour => the surrounding theme is dark. */
function isDark(el: HTMLElement): boolean {
  const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return false;
  const [r, g, b] = m.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

export async function renderMermaidBlocks(root: HTMLElement, isCancelled: () => boolean = () => false) {
  const codes = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
  if (codes.length === 0) return;
  const mermaid = await loadMermaid();
  if (isCancelled()) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict", // notes can hold third-party text: no scripts / raw HTML in diagrams
    theme: isDark(root) ? "dark" : "default",
    flowchart: { htmlLabels: true },
  });
  for (const code of codes) {
    const pre = code.parentElement as HTMLElement;
    const src = code.textContent || "";
    const holder = document.createElement("div");
    holder.className = "md-mermaid";
    try {
      const { svg } = await mermaid.render(`mmd-${Date.now()}-${seq++}`, src);
      if (isCancelled()) return;
      holder.innerHTML = svg;
    } catch (err) {
      // Keep the source visible with the parser message instead of a blank block.
      holder.classList.add("md-mermaid-error");
      const msg = document.createElement("div");
      msg.className = "md-mermaid-error-msg";
      msg.textContent = "Mermaid error: " + (err instanceof Error ? err.message.split("\n")[0] : String(err));
      holder.appendChild(msg);
      holder.appendChild(pre.cloneNode(true));
    }
    if (pre.isConnected) pre.replaceWith(holder);
  }
  // mermaid leaves temp error nodes in <body> on parse failure
  document.querySelectorAll("body > [id^='dmmd-'], body > svg[id^='mmd-']").forEach((n) => n.remove());
}
