import { useEffect, useRef, type MouseEventHandler } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import renderMathInElement from "katex/contrib/auto-render";
import { resolveRelativePath } from "../lib/pastedImages";

marked.setOptions({ breaks: true, gfm: true });

const ALERT_TITLES: Record<string, string> = {
  note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution", info: "Info",
};

/** GitHub/Azure-style `> [!NOTE]` alerts become callouts; `[TOC]` becomes a heading list. */
function decorateNoteBlocks(el: HTMLElement) {
  el.querySelectorAll("blockquote").forEach((bq) => {
    const first = bq.querySelector("p");
    const m = first?.textContent?.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO)\]\s*/i);
    if (!first || !m) return;
    const kind = m[1].toLowerCase();
    // Drop the marker text (and the line break that follows it) from the first paragraph.
    const node = first.firstChild;
    if (node && node.nodeType === Node.TEXT_NODE) {
      node.textContent = (node.textContent || "").replace(/^\s*\[![A-Za-z]+\]\s*/, "");
      if (!node.textContent && first.firstChild?.nextSibling?.nodeName === "BR") first.firstChild.nextSibling.remove();
      if (!node.textContent) node.remove();
    }
    bq.classList.add("md-alert", `md-alert-${kind}`);
    const title = document.createElement("div");
    title.className = "md-alert-title";
    title.textContent = ALERT_TITLES[kind];
    bq.insertBefore(title, bq.firstChild);
    if (!first.textContent?.trim()) first.remove();
  });

  el.querySelectorAll("p").forEach((p) => {
    if (!/^\s*(\[TOC\]|\[\[_TOC_\]\])\s*$/i.test(p.textContent || "")) return;
    const heads = Array.from(el.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const ul = document.createElement("ul");
    ul.className = "md-toc";
    heads.forEach((h) => {
      const li = document.createElement("li");
      li.style.marginLeft = `${(Number(h.tagName[1]) - 1) * 14}px`;
      li.textContent = h.textContent || "";
      ul.appendChild(li);
    });
    p.replaceWith(ul);
  });
}

/**
 * Renders arXiv abstracts / CERIC note text as markdown + LaTeX math instead of
 * a raw string full of literal $...$ and \emph{...}. Abstracts are third-party
 * content, so markdown output is sanitized before it ever touches the DOM.
 */
export default function AbstractText({
  text,
  className,
  onMouseUp,
  imageBase,
}: {
  text: string;
  className?: string;
  onMouseUp?: MouseEventHandler<HTMLDivElement>;
  /** Notes-vault folder (e.g. "Quick Notes/sub") that relative image links resolve against. */
  imageBase?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = DOMPurify.sanitize(marked.parse(text || "", { async: false }) as string);
    el.innerHTML = html;
    decorateNoteBlocks(el);
    if (imageBase !== undefined) {
      el.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src") || "";
        if (!src || /^(https?:|data:|blob:|\/)/i.test(src)) return;
        let rel = src;
        try { rel = decodeURIComponent(src); } catch { /* keep raw */ }
        const resolved = resolveRelativePath(imageBase, rel);
        img.setAttribute("src", "/api/notes/assets/" + resolved.split("/").map(encodeURIComponent).join("/"));
      });
    }
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
      });
    } catch {
      // Malformed TeX in a paper abstract shouldn't break the page — leave the
      // markdown-rendered text as-is if KaTeX can't parse it.
    }
  }, [text, imageBase]);

  return (
    <div
      ref={ref}
      className={`abstract-text${className ? ` ${className}` : ""}`}
      onMouseUp={onMouseUp}
    />
  );
}
