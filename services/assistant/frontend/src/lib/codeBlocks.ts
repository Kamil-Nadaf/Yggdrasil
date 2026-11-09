/** Obsidian / GitLab-style fenced code blocks for note previews: a language
 * label, a copy button and syntax highlighting (highlight.js, common languages only). */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import latex from "highlight.js/lib/languages/latex";
import cpp from "highlight.js/lib/languages/cpp";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import markdown from "highlight.js/lib/languages/markdown";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";

const LANGS: Record<string, unknown> = {
  bash, python, javascript, typescript, json, yaml, latex, cpp, sql, xml, css, markdown, diff, dockerfile, ini, rust, go, java,
};
Object.entries(LANGS).forEach(([name, def]) => hljs.registerLanguage(name, def as never));

const ALIASES: Record<string, string> = {
  sh: "bash", shell: "bash", zsh: "bash", console: "bash", terminal: "bash",
  py: "python", python3: "python", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  tex: "latex", yml: "yaml", c: "cpp", "c++": "cpp", h: "cpp", html: "xml", svg: "xml", md: "markdown",
  toml: "ini", docker: "dockerfile", rs: "rust", golang: "go", patch: "diff",
};

const LABELS: Record<string, string> = {
  bash: "Shell", python: "Python", javascript: "JavaScript", typescript: "TypeScript", json: "JSON", yaml: "YAML",
  latex: "LaTeX", cpp: "C++", sql: "SQL", xml: "HTML", css: "CSS", markdown: "Markdown", diff: "Diff",
  dockerfile: "Dockerfile", ini: "TOML", rust: "Rust", go: "Go", java: "Java",
};

/** hljs leaves shell flags/subcommands/numbers uncoloured; tint them like Obsidian does:
 * `--flag` / `-f` yellow, the `=` after a flag red, a command's subcommand yellow, bare numbers purple. */
function tintShell(code: HTMLElement) {
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!(n.parentElement as HTMLElement).closest(".hljs-comment,.hljs-string")) nodes.push(n as Text);
  }
  const RE = /(^|\s)(--?[A-Za-z][\w-]*)(=?)|(^|[\s:=])(\d+)(?=[\s:\/]|$)/g;
  for (const node of nodes) {
    const t = node.data;
    RE.lastIndex = 0;
    let last = 0;
    const frag = document.createDocumentFragment();
    for (let m = RE.exec(t); m; m = RE.exec(t)) {
      frag.append(t.slice(last, m.index));
      if (m[2]) {
        frag.append(m[1]);
        const f = document.createElement("span"); f.className = "hl-flag"; f.textContent = m[2]; frag.append(f);
        if (m[3]) { const e = document.createElement("span"); e.className = "hl-eq"; e.textContent = "="; frag.append(e); }
      } else {
        frag.append(m[4]);
        const d = document.createElement("span"); d.className = "hljs-number"; d.textContent = m[5]; frag.append(d);
      }
      last = m.index + m[0].length;
    }
    if (last === 0) continue;
    frag.append(t.slice(last));
    node.replaceWith(frag);
  }
  // Subcommand: second word of a line that starts a command (docker stop, git commit, pip3 install…).
  code.innerHTML = code.innerHTML.replace(/^((?:[\w.-]+)[ \t]+)([a-z][\w-]*)(?=[ \t]|$)/gm, (all, a, b) =>
    /^(sudo|cd|export|echo|cat|ls|mkdir|rm|mv|cp)$/.test(a.trim()) ? all : `${a}<span class="hl-sub">${b}</span>`);
}

export function decorateCodeBlocks(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("pre").forEach((pre) => {
    const code = pre.querySelector<HTMLElement>(":scope > code");
    if (!code || pre.parentElement?.classList.contains("md-code")) return;
    const raw = (/language-([\w+#-]+)/.exec(code.className)?.[1] || "").toLowerCase();
    if (raw === "mermaid") return; // drawn as a diagram, not shown as code
    const lang = ALIASES[raw] || raw;
    const text = code.textContent || "";
    if (lang && lang in LANGS) {
      try {
        code.innerHTML = hljs.highlight(text.replace(/\n$/, ""), { language: lang, ignoreIllegals: true }).value;
        code.classList.add("hljs");
        if (lang === "bash") tintShell(code);
      } catch { /* leave plain */ }
    }
    const wrap = document.createElement("div");
    wrap.className = "md-code";
    const label = document.createElement("span");
    label.className = "md-code-lang";
    label.textContent = LABELS[lang] || (raw ? raw : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "md-code-copy";
    btn.textContent = "Copy";
    btn.title = "Copy code";
    btn.addEventListener("click", () => {
      void navigator.clipboard?.writeText(text.replace(/\n$/, "")).then(() => {
        btn.textContent = "Copied";
        window.setTimeout(() => { btn.textContent = "Copy"; }, 1400);
      });
    });
    const bar = document.createElement("div");
    bar.className = "md-code-bar";
    bar.append(label, btn);
    pre.replaceWith(wrap);
    wrap.append(bar, pre);
  });
}

/** Light text colour => dark theme (drives the highlight palette + Mermaid theme). */
export function isDarkTone(el: HTMLElement): boolean {
  const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return false;
  const [r, g, b] = m.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}
