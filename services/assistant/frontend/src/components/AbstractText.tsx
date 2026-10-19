import { useEffect, useRef, type MouseEventHandler } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import renderMathInElement from "katex/contrib/auto-render";
import { resolveRelativePath } from "../lib/pastedImages";

marked.setOptions({ breaks: true, gfm: true });

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
