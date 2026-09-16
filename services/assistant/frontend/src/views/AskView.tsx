import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import AbstractText from "../components/AbstractText";
import { getActiveProviderPayload } from "../lib/aiProvider";
import {
  loadLokiState,
  saveLokiState,
  newChat,
  newProject,
  titleFromPrompt,
  messageId,
  type LokiChat,
  type LokiMessage,
  type LokiSkill,
  type LokiState,
} from "../lib/lokiStore";

const SKILLS: { id: LokiSkill; label: string; hint: string }[] = [
  { id: "ask", label: "Ask notes", hint: "Answer from your vault only" },
  { id: "search", label: "Search", hint: "Exact matches in notes" },
  { id: "keywords", label: "Keywords", hint: "Tags, objects, instruments" },
  { id: "neighbors", label: "Neighbors", hint: "Graph links with reasons" },
];

function persist(next: LokiState) {
  saveLokiState(next);
  return next;
}

export default function AskView() {
  const [state, setState] = useState<LokiState>(() => loadLokiState());
  const [skill, setSkill] = useState<LokiSkill>("ask");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const active = state.chats.find((c) => c.id === state.activeChatId) || null;

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, loading]);

  const chatsByProject = useMemo(() => {
    const grouped = new Map<string | null, LokiChat[]>();
    for (const chat of [...state.chats].sort((a, b) => b.updated.localeCompare(a.updated))) {
      const key = chat.projectId;
      const list = grouped.get(key) || [];
      list.push(chat);
      grouped.set(key, list);
    }
    return grouped;
  }, [state.chats]);

  function update(mutator: (prev: LokiState) => LokiState) {
    setState((prev) => persist(mutator(prev)));
  }

  function startChat(projectId: string | null = null) {
    const chat = newChat(projectId);
    update((prev) => ({
      ...prev,
      chats: [chat, ...prev.chats],
      activeChatId: chat.id,
    }));
    setDraft("");
  }

  function addProject() {
    const name = projectName.trim();
    if (!name) return;
    const project = newProject(name);
    update((prev) => ({ ...prev, projects: [...prev.projects, project] }));
    setProjectName("");
    startChat(project.id);
  }

  async function send() {
    const text = draft.trim();
    if (!text || loading) return;

    let chatId = state.activeChatId;
    let working = state;
    if (!chatId) {
      const chat = newChat(null);
      working = persist({
        ...state,
        chats: [chat, ...state.chats],
        activeChatId: chat.id,
      });
      setState(working);
      chatId = chat.id;
    }

    const userMsg: LokiMessage = { id: messageId(), role: "user", text, skill };
    working = persist({
      ...working,
      chats: working.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              title: c.messages.length === 0 ? titleFromPrompt(text) : c.title,
              updated: new Date().toISOString(),
              messages: [...c.messages, userMsg],
            }
          : c
      ),
    });
    setState(working);
    setDraft("");
    setLoading(true);

    let assistant: LokiMessage;
    try {
      if (skill === "search") {
        const r = await api.search(text);
        const lines = r.results.length
          ? r.results.map((hit) => `**${hit.title}** \`${hit.folder}\`\n${hit.snippet}`).join("\n\n")
          : "No matches in your notes.";
        assistant = { id: messageId(), role: "assistant", text: lines, skill };
      } else if (skill === "keywords") {
        const r = await api.loki.keywords(text);
        const lines = r.keywords.length
          ? r.keywords
              .map((k) => `- **${k.term}** · ${k.count} note${k.count === 1 ? "" : "s"} (${k.citekeys.slice(0, 4).join(", ")})`)
              .join("\n")
          : "No keywords in matching notes yet. Tags and objects on paper notes will show up here.";
        assistant = { id: messageId(), role: "assistant", text: lines, skill };
      } else if (skill === "neighbors") {
        const r = await api.graphNeighbors(text);
        const lines = r.neighbors.length
          ? r.neighbors
              .map((n) => `- **${n.note}** \`${n.type}\` — ${n.reason_text} _(conf ${n.confidence_score.toFixed(2)})_`)
              .join("\n")
          : `No neighbors found for \`${text}\`. Try a citekey, or rebuild typed edges from the Graph view.`;
        assistant = { id: messageId(), role: "assistant", text: lines, skill };
      } else {
        const r = await api.ask(text, 6, getActiveProviderPayload());
        assistant = {
          id: messageId(),
          role: "assistant",
          text: r.answer,
          skill,
          sources: r.sources,
        };
      }
    } catch (e) {
      assistant = {
        id: messageId(),
        role: "assistant",
        text: (e as Error).message || "Request failed",
        skill,
      };
    } finally {
      setLoading(false);
    }

    setState((prev) =>
      persist({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId
            ? { ...c, updated: new Date().toISOString(), messages: [...c.messages, assistant] }
            : c
        ),
      })
    );
  }

  const empty = !active || active.messages.length === 0;

  return (
    <div className="loki-shell">
      <aside className="loki-sidebar">
        <div className="loki-sidebar-top">
          <div className="loki-brand">
            <div className="loki-brand-name">Loki</div>
            <div className="loki-brand-sub muted">Master of your notes</div>
          </div>
          <button type="button" className="btn btn-primary loki-new" onClick={() => startChat(null)}>
            + New chat
          </button>
        </div>

        <div className="loki-sidebar-scroll">
          {state.projects.map((project) => (
            <div key={project.id} className="loki-group">
              <div className="loki-group-title">
                <span>{project.name}</span>
                <button type="button" className="loki-ghost" onClick={() => startChat(project.id)}>
                  +
                </button>
              </div>
              {(chatsByProject.get(project.id) || []).map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  className={`loki-chat-item${chat.id === state.activeChatId ? " active" : ""}`}
                  onClick={() => update((prev) => ({ ...prev, activeChatId: chat.id }))}
                >
                  {chat.title}
                </button>
              ))}
            </div>
          ))}

          <div className="loki-group">
            <div className="loki-group-title">Chats</div>
            {(chatsByProject.get(null) || []).map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={`loki-chat-item${chat.id === state.activeChatId ? " active" : ""}`}
                onClick={() => update((prev) => ({ ...prev, activeChatId: chat.id }))}
              >
                {chat.title}
              </button>
            ))}
            {(chatsByProject.get(null) || []).length === 0 && (
              <div className="muted loki-empty-hint">No chats yet</div>
            )}
          </div>
        </div>

        <form
          className="loki-new-project"
          onSubmit={(e) => {
            e.preventDefault();
            addProject();
          }}
        >
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="New project"
          />
          <button type="submit" className="btn" disabled={!projectName.trim()}>
            Add
          </button>
        </form>
      </aside>

      <section className="loki-main">
        {empty ? (
          <div className="loki-hero">
            <h1>Loki</h1>
            <p className="muted">Ask your notes. Loki only answers from what you have written.</p>
            <Composer
              draft={draft}
              setDraft={setDraft}
              skill={skill}
              setSkill={setSkill}
              loading={loading}
              onSend={send}
              wide
            />
          </div>
        ) : (
          <>
            <div className="loki-thread" ref={threadRef}>
              {active!.messages.map((msg) => (
                <article key={msg.id} className={`loki-msg loki-msg--${msg.role}`}>
                  <div className="loki-msg-role mono">
                    {msg.role === "user" ? "You" : "Loki"}
                    {msg.skill && msg.role === "assistant" ? ` · ${SKILLS.find((s) => s.id === msg.skill)?.label}` : ""}
                  </div>
                  <div className="loki-msg-body">
                    <AbstractText text={msg.text} />
                    {msg.images?.map((img) => (
                      <img key={img.src} className="loki-msg-image" src={img.src} alt={img.alt} />
                    ))}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="loki-sources">
                        {msg.sources.map((s, i) => (
                          <div key={`${s.citekey}-${i}`} className="loki-source">
                            <span className="mono">{s.citekey}</span>
                            <span className="muted">{s.excerpt}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {loading && <div className="muted loki-thinking">Loki is reading your notes…</div>}
            </div>
            <Composer
              draft={draft}
              setDraft={setDraft}
              skill={skill}
              setSkill={setSkill}
              loading={loading}
              onSend={send}
            />
          </>
        )}
      </section>
    </div>
  );
}

function Composer({
  draft,
  setDraft,
  skill,
  setSkill,
  loading,
  onSend,
  wide,
}: {
  draft: string;
  setDraft: (v: string) => void;
  skill: LokiSkill;
  setSkill: (s: LokiSkill) => void;
  loading: boolean;
  onSend: () => void;
  wide?: boolean;
}) {
  return (
    <div className={`loki-composer${wide ? " loki-composer--wide" : ""}`}>
      <div className="loki-skills">
        {SKILLS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`loki-skill${skill === s.id ? " selected" : ""}`}
            title={s.hint}
            onClick={() => setSkill(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="loki-input-row">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={
            skill === "ask"
              ? "Ask Loki about your notes…"
              : skill === "search"
                ? "Search titles, tags, analysis slots…"
                : skill === "neighbors"
                  ? "Citekey or note id for graph neighbors…"
                  : "Find keywords in matching notes…"
          }
          rows={wide ? 3 : 2}
        />
        <button type="button" className="btn btn-primary" onClick={onSend} disabled={loading || !draft.trim()}>
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
