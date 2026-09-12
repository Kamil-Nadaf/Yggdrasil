export type AiProviderId = "ollama" | "lmstudio" | "claude" | "deepseek" | "kimi" | "huggingface";

export interface AiProviderConfig {
  provider: AiProviderId;
  api_key: string;
  base_url: string;
  model: string;
}

const STORAGE_KEY = "yggdrasil:ai-providers";
const ACTIVE_KEY = "yggdrasil:ai-active-provider";

export const PROVIDER_META: Record<
  AiProviderId,
  { label: string; defaultBase: string; defaultModel: string; needsKey: boolean }
> = {
  ollama: { label: "Ollama", defaultBase: "http://localhost:11434", defaultModel: "llama3.2", needsKey: false },
  lmstudio: { label: "LM Studio", defaultBase: "http://localhost:1234", defaultModel: "local-model", needsKey: false },
  claude: { label: "Claude (Anthropic)", defaultBase: "", defaultModel: "claude-sonnet-4-5", needsKey: true },
  deepseek: { label: "DeepSeek", defaultBase: "https://api.deepseek.com", defaultModel: "deepseek-chat", needsKey: true },
  kimi: { label: "Kimi (Moonshot)", defaultBase: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-8k", needsKey: true },
  huggingface: {
    label: "Hugging Face",
    defaultBase: "https://router.huggingface.co/v1",
    defaultModel: "meta-llama/Meta-Llama-3-8B-Instruct",
    needsKey: true,
  },
};

function emptyStore(): Record<AiProviderId, AiProviderConfig> {
  const out = {} as Record<AiProviderId, AiProviderConfig>;
  (Object.keys(PROVIDER_META) as AiProviderId[]).forEach((id) => {
    out[id] = {
      provider: id,
      api_key: "",
      base_url: PROVIDER_META[id].defaultBase,
      model: PROVIDER_META[id].defaultModel,
    };
  });
  return out;
}

export function loadProviderStore(): Record<AiProviderId, AiProviderConfig> {
  const base = emptyStore();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<AiProviderId, Partial<AiProviderConfig>>>;
    (Object.keys(base) as AiProviderId[]).forEach((id) => {
      if (parsed[id]) base[id] = { ...base[id], ...parsed[id], provider: id };
    });
  } catch {
    /* ignore */
  }
  return base;
}

export function saveProviderStore(store: Record<AiProviderId, AiProviderConfig>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function getActiveProviderId(): AiProviderId {
  const v = localStorage.getItem(ACTIVE_KEY) as AiProviderId | null;
  return v && v in PROVIDER_META ? v : "ollama";
}

export function setActiveProviderId(id: AiProviderId) {
  localStorage.setItem(ACTIVE_KEY, id);
}

/** Config to send with /ask and /examine — never written to the server permanently. */
export function getActiveProviderPayload(): AiProviderConfig {
  const id = getActiveProviderId();
  return loadProviderStore()[id];
}
