import { useCallback, useEffect, useRef, useState } from "react";
import "./browser.css";

const KEY = "yggdrasil:browser";
const QUICK: { label: string; url: string }[] = [
  { label: "arXiv", url: "https://arxiv.org/" },
  { label: "NASA ADS", url: "https://ui.adsabs.harvard.edu/" },
  { label: "Wikipedia", url: "https://en.wikipedia.org/" },
  { label: "INSPIRE", url: "https://inspirehep.net/" },
  { label: "GCN", url: "https://gcn.nasa.gov/" },
];

type Saved = { stack: string[]; i: number };
function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.stack) && typeof s.i === "number") return { stack: s.stack.slice(-40), i: Math.min(s.i, s.stack.length - 1) };
  } catch { /* fresh */ }
  return { stack: [], i: -1 };
}

/** Quick-check browser for the split view. Pages are fetched by the backend and shown inert (no page scripts), so
 *  it is for reading: searches, abstracts, docs, articles. Anything it can't show opens in your own browser. */
export default function BrowserView() {
  const [{ stack, i }, setNav] = useState<Saved>(load);
  const url = i >= 0 ? stack[i] : "";
  const [input, setInput] = useState(url);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ stack, i })); } catch { /* private mode */ } }, [stack, i]);
  useEffect(() => { setInput(url); setTitle(""); setLoading(!!url); }, [url, tick]);

  const go = useCallback((target: string) => {
    const t = target.trim();
    if (!t) return;
    setNav((s) => ({ stack: [...s.stack.slice(0, s.i + 1), t].slice(-40), i: Math.min(s.i + 1, 39) }));
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as { ygg?: number; type?: string; url?: string; title?: string; newTab?: boolean };
      if (!m || m.ygg !== 1) return;
      if (m.type === "loaded") { setLoading(false); setTitle(m.title || ""); }
      else if (m.type === "nav" && m.url) { if (m.newTab) window.open(m.url, "_blank", "noopener,noreferrer"); else go(m.url); }
      else if (m.type === "pdf" && m.url) window.open(`/api/pdf-proxy?url=${encodeURIComponent(m.url)}`, "_blank", "noopener");
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [go]);

  const back = () => setNav((s) => ({ ...s, i: Math.max(0, s.i - 1) }));
  const fwd = () => setNav((s) => ({ ...s, i: Math.min(s.stack.length - 1, s.i + 1) }));
  const isUrl = /^https?:\/\//i.test(url);
  const src = url ? `/api/browse?${isUrl ? "url" : "q"}=${encodeURIComponent(url)}&_=${tick}` : "";

  return (
    <div className="bw">
      <form className="bw-bar" onSubmit={(e) => { e.preventDefault(); go(input); }}>
        <button type="button" className="bw-btn" onClick={back} disabled={i <= 0} title="Back" aria-label="Back">←</button>
        <button type="button" className="bw-btn" onClick={fwd} disabled={i >= stack.length - 1} title="Forward" aria-label="Forward">→</button>
        <button type="button" className="bw-btn" onClick={() => url && setTick((n) => n + 1)} disabled={!url} title="Reload" aria-label="Reload">↻</button>
        <input className="bw-url" value={input} onChange={(e) => setInput(e.target.value)} onFocus={(e) => e.currentTarget.select()} placeholder="Search the web or type an address" aria-label="Address or search" spellCheck={false} />
        <button type="button" className="bw-btn" onClick={() => isUrl && window.open(url, "_blank", "noopener,noreferrer")} disabled={!isUrl} title="Open in your own browser" aria-label="Open in your own browser">↗</button>
      </form>
      {loading && <div className="bw-load" aria-hidden="true" />}
      {url ? (
        <iframe ref={frame} key={`${url}|${tick}`} className="bw-frame" src={src} title={title || "Browser"} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" onLoad={() => setLoading(false)} />
      ) : (
        <div className="bw-home">
          <h2>Quick browser</h2>
          <p>Search or open a page beside whatever you are reading. Pages are shown as readable text and images; sign-in pages and script-heavy sites may not work.</p>
          <div className="bw-quick">{QUICK.map((q) => <button key={q.url} type="button" className="btn" onClick={() => go(q.url)}>{q.label}</button>)}</div>
        </div>
      )}
    </div>
  );
}
