/**
 * Keeps the big section "windows" (notes workspace, papers, books, graph, project notes) exactly as tall as the
 * space left in the browser window, instead of a hard-coded `100vh - N px` that leaves a gap or overflows.
 * Split-view panes size themselves with CSS (split-view.css), so they are skipped here.
 */
const SELECTOR = [
  ".notes-embedded-shell",
  ".papers-view",
  ".books-tab-wrap",
  ".graph-container",
  ".arxiv-panel-group",
  ".pj-notes",
  ".pj-reader",
  ".pj-slides",
].join(",");
const BOTTOM_GAP = 16;
const MIN_H = 360;

function fit() {
  const els = document.querySelectorAll<HTMLElement>(SELECTOR);
  els.forEach((el) => {
    if (el.closest(".split-pane") || !el.offsetParent) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const h = Math.max(MIN_H, Math.floor(window.innerHeight - top - BOTTOM_GAP));
    const v = `${h}px`;
    if (el.style.height !== v) el.style.height = v;
    if (el.style.minHeight !== "0px") el.style.minHeight = "0px";
  });
}

export function startFitViewport() {
  let queued = false;
  const run = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fit();
    });
  };
  window.addEventListener("resize", run);
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
  run();
}
