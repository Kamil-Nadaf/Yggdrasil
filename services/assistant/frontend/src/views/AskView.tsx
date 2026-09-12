import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { api } from "../api/client";
import { getActiveProviderPayload } from "../lib/aiProvider";

interface Source {
  citekey: string;
  excerpt: string;
}

type AskTab = "notes" | "feynman";

interface FeynmanStatus {
  ok: boolean;
  installed: boolean;
  reachable: boolean;
  publicUrl: string;
  wsUrl: string;
  docsUrl: string;
  message: string;
  port: string;
  mode?: string;
}

function NotesPanel() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk() {
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      const r = await api.ask(question, 6, getActiveProviderPayload());
      setAnswer(r.answer);
      setSources(r.sources);
    } catch (e: unknown) {
      setError((e as Error).message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ask-panel">
      <p className="muted" style={{ marginBottom: 20 }}>
        Searches your vault and answers from your own notes only. Uses the AI provider configured in Settings
        (keys stay in this browser).
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && handleAsk()}
          placeholder="What mechanisms explain GRB prompt emission variability?"
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={handleAsk} disabled={loading || !question.trim()}>
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {error && <div className="crit" style={{ marginBottom: 12 }}>{error}</div>}

      {answer && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Answer</h2>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{answer}</div>
        </div>
      )}

      {sources.length > 0 && (
        <div>
          <h2 style={{ marginBottom: 8 }}>Sources</h2>
          {sources.map((s, i) => (
            <div key={i} className="card" style={{ marginBottom: 8 }}>
              <div className="mono" style={{ color: "var(--accent)", fontSize: 12, marginBottom: 4 }}>
                [{s.citekey}]
              </div>
              <div className="muted" style={{ fontSize: 13 }}>…{s.excerpt}…</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function defaultWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:6174/ws`;
}

function FeynmanTerminal({ wsUrl, onExit }: { wsUrl: string; onExit?: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: {
        background: "#0D1117",
        foreground: "#CDD9E5",
        cursor: "#4FC3F7",
        selectionBackground: "rgba(79,195,247,0.35)",
        black: "#0D1117",
        red: "#F87171",
        green: "#34D399",
        yellow: "#F59E0B",
        blue: "#4FC3F7",
        magenta: "#C084FC",
        cyan: "#22D3EE",
        white: "#CDD9E5",
        brightBlack: "#6B7280",
        brightRed: "#FCA5A5",
        brightGreen: "#6EE7B7",
        brightYellow: "#FBBF24",
        brightBlue: "#7DD3FC",
        brightMagenta: "#D8B4FE",
        brightCyan: "#67E8F9",
        brightWhite: "#F8FAFC",
      },
      convertEol: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.writeln("\x1b[1mFeynman CLI\x1b[0m — physics / astrophysics welcome (no domain picker).");
    term.writeln("Connecting…\r\n");

    let disposed = false;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const sendResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      if (disposed) return;
      setConnected(true);
      setErr(null);
      sendResize();
      term.focus();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        term.write(ev.data);
        return;
      }
      term.write(new Uint8Array(ev.data as ArrayBuffer));
    };

    ws.onerror = () => {
      setErr("WebSocket error — is the feynman container running?");
    };

    ws.onclose = () => {
      setConnected(false);
      if (!disposed) {
        term.writeln("\r\n\x1b[33m[session closed]\x1b[0m");
        onExit?.();
      }
    };

    const dataSub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const onWinResize = () => sendResize();
    window.addEventListener("resize", onWinResize);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => sendResize()) : null;
    ro?.observe(host);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onWinResize);
      ro?.disconnect();
      dataSub.dispose();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [wsUrl, onExit]);

  return (
    <div className="ask-feynman-term-wrap">
      <div className="ask-feynman-term-bar mono">
        <span style={{ color: connected ? "var(--ok)" : "var(--muted)" }}>
          {connected ? "● connected" : "○ connecting"}
        </span>
        {err && <span className="crit">{err}</span>}
        <span className="muted">physics · astrophysics · GRBs — type naturally in the CLI</span>
      </div>
      <div ref={hostRef} className="ask-feynman-term" />
    </div>
  );
}

function FeynmanPanel() {
  const [status, setStatus] = useState<FeynmanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.feynman.status();
      setStatus(s);
    } catch (e: unknown) {
      setStatus({
        ok: false,
        installed: false,
        reachable: false,
        publicUrl: `http://${window.location.hostname}:6174/`,
        wsUrl: defaultWsUrl(),
        docsUrl: "https://www.feynman.is",
        message: (e as Error).message || "Status check failed",
        port: "6174",
        mode: "terminal",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 20000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const reachable = Boolean(status?.reachable);
  const wsUrl = status?.wsUrl || defaultWsUrl();

  return (
    <div className="ask-panel ask-feynman-panel">
      <div className="ask-feynman-toolbar">
        <div className="ask-feynman-meta">
          <p className="muted" style={{ margin: 0 }}>
            Terminal Feynman CLI — papers, web search, drafts, citations.{" "}
            <a href="https://www.feynman.is" target="_blank" rel="noreferrer">
              feynman.is
            </a>
            . Workbench GUI removed; use this shell (physics / astrophysics included — no chip list).
          </p>
          <div className="ask-feynman-status mono">
            {loading && !status ? (
              <span className="muted">Checking terminal…</span>
            ) : reachable ? (
              <span style={{ color: "var(--ok)" }}>● Terminal ready on :{status?.port || "6174"}</span>
            ) : (
              <span style={{ color: "var(--crit)" }}>
                ● Offline{status?.message ? ` — ${status.message}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="ask-feynman-actions">
          <button type="button" className="btn" onClick={() => { setSession((n) => n + 1); refresh(); }}>
            New session
          </button>
          <button type="button" className="btn" onClick={refresh}>
            Refresh
          </button>
          <a className="btn" href="https://www.feynman.is" target="_blank" rel="noreferrer">
            Docs
          </a>
        </div>
      </div>

      {reachable ? (
        <FeynmanTerminal key={session} wsUrl={wsUrl} onExit={refresh} />
      ) : (
        <div className="card ask-feynman-install">
          <h2 style={{ marginTop: 0 }}>Start Feynman terminal</h2>
          <p className="muted">
            Rebuild and start the Feynman CLI container (terminal mode, not the science-workbench GUI):
          </p>
          <pre className="ask-feynman-code">{`docker compose build feynman
docker compose up -d feynman`}</pre>
          <button type="button" className="btn btn-primary" onClick={refresh} disabled={loading}>
            {loading ? "Checking…" : "Check again"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AskView() {
  const [tab, setTab] = useState<AskTab>(() => {
    const saved = localStorage.getItem("yggdrasil:ask-tab");
    return saved === "feynman" ? "feynman" : "notes";
  });

  function selectTab(next: AskTab) {
    setTab(next);
    localStorage.setItem("yggdrasil:ask-tab", next);
  }

  return (
    <div className={`ask-view${tab === "feynman" ? " ask-view--feynman" : ""}`}>
      <div className="ask-header">
        <h1 style={{ margin: 0 }}>Ask</h1>
        <div className="browser-field-tabs ask-tabs" role="tablist" aria-label="Ask subsections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "notes"}
            className={`btn${tab === "notes" ? " btn-primary" : ""}`}
            onClick={() => selectTab("notes")}
          >
            Ask Your Notes
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "feynman"}
            className={`btn${tab === "feynman" ? " btn-primary" : ""}`}
            onClick={() => selectTab("feynman")}
          >
            Feynman
          </button>
        </div>
      </div>

      {tab === "notes" ? <NotesPanel /> : <FeynmanPanel />}
    </div>
  );
}
