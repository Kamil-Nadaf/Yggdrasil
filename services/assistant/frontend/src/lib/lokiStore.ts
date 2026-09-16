export type LokiSkill = "ask" | "search" | "keywords" | "neighbors";

export interface LokiSource {
  citekey: string;
  excerpt: string;
}

export interface LokiImage {
  alt: string;
  src: string;
}

export interface LokiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  skill?: LokiSkill;
  sources?: LokiSource[];
  images?: LokiImage[];
}

export interface LokiChat {
  id: string;
  title: string;
  projectId: string | null;
  created: string;
  updated: string;
  messages: LokiMessage[];
}

export interface LokiProject {
  id: string;
  name: string;
}

export interface LokiState {
  projects: LokiProject[];
  chats: LokiChat[];
  activeChatId: string | null;
}

const KEY = "yggdrasil:loki";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyLokiState(): LokiState {
  return {
    projects: [{ id: "reading", name: "Reading" }],
    chats: [],
    activeChatId: null,
  };
}

export function loadLokiState(): LokiState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyLokiState();
    const parsed = JSON.parse(raw) as Partial<LokiState>;
    return {
      projects: parsed.projects?.length ? parsed.projects : emptyLokiState().projects,
      chats: parsed.chats || [],
      activeChatId: parsed.activeChatId ?? null,
    };
  } catch {
    return emptyLokiState();
  }
}

export function saveLokiState(state: LokiState) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function newChat(projectId: string | null = null): LokiChat {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: "New chat",
    projectId,
    created: now,
    updated: now,
    messages: [],
  };
}

export function newProject(name: string): LokiProject {
  return { id: uid(), name: name.trim() || "Untitled" };
}

export function titleFromPrompt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

export function messageId(): string {
  return uid();
}
