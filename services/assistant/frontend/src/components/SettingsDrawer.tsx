import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";

const colorPickerIcon = "/color-picker-icon.png";
import {
  type AiProviderId,
  type AiProviderConfig,
  PROVIDER_META,
  loadProviderStore,
  saveProviderStore,
  getActiveProviderId,
  setActiveProviderId,
} from "../lib/aiProvider";
import {
  THEMES,
  TACTILE_ACCENTS,
  DEFAULT_THEME,
  applyTheme,
  loadCustomTheme,
  saveCustomTheme,
  customFromPreset,
  loadTactileAccent,
  saveTactileAccent,
  hexOk,
  type CustomTheme,
} from "../lib/theme";
import {
  APP_FONTS,
  FONT_CATEGORIES,
  loadAppFonts,
  saveAppFonts,
  type AppFonts,
} from "../lib/fonts";
import TaskStatusEditor from "./TaskStatusEditor";

interface McpConnection {
  id: string;
  name: string;
  endpoint: string;
  configured: boolean;
}

const MCP_KEY = "yggdrasil:mcp-connections";
const DEFAULT_MCP_SLOTS: McpConnection[] = [
  { id: "zotero", name: "Zotero", endpoint: "", configured: false },
  { id: "powerpoint", name: "PowerPoint", endpoint: "", configured: false },
  { id: "blender", name: "Blender", endpoint: "", configured: false },
  { id: "github", name: "GitHub", endpoint: "", configured: false },
];

function loadMcpConnections(): McpConnection[] {
  try {
    const raw = localStorage.getItem(MCP_KEY);
    if (!raw) return DEFAULT_MCP_SLOTS;
    const saved: McpConnection[] = JSON.parse(raw);
    // merge so a future new default slot still shows up for existing users
    const byId = new Map(saved.map((s) => [s.id, s]));
    return DEFAULT_MCP_SLOTS.map((d) => byId.get(d.id) || d).concat(
      saved.filter((s) => !DEFAULT_MCP_SLOTS.some((d) => d.id === s.id))
    );
  } catch {
    return DEFAULT_MCP_SLOTS;
  }
}

interface SettingsState {
  theme: string;
  fontSize: number;
  tabWidth: number;
  lineWrap: boolean;
  autoCompile: boolean;
  userAccount: string;
  latexDir: string;
}

interface SystemInfo {
  texVersion?: string;
  vaultPath?: string;
  diskFree?: number;
  availablePaths?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="settings-section">
      <button type="button" className="settings-section-toggle" onClick={onToggle} aria-expanded={open}>
        <span>{title}</span>
        <span className="mono muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="settings-section-body" id={id}>{children}</div>}
    </div>
  );
}

export default function SettingsDrawer({ open, onClose }: Props) {
  const [settings, setSettings] = useState<SettingsState>(() => ({
    theme: (() => {
      const raw = localStorage.getItem("theme") || DEFAULT_THEME;
      return raw === "custom" || raw === "dark" || raw === "paper" || raw === "tactile" ? raw : "custom";
    })(),
    fontSize: parseInt(localStorage.getItem("fontSize") || "13"),
    tabWidth: parseInt(localStorage.getItem("tabWidth") || "2"),
    lineWrap: localStorage.getItem("lineWrap") !== "false",
    autoCompile: localStorage.getItem("autoCompile") === "true",
    userAccount: localStorage.getItem("userAccount") || "",
    latexDir: localStorage.getItem("latexDir") || "/vault",
  }));

  const [info, setInfo] = useState<SystemInfo>({});
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    appearance: true,
    statuses: false,
    ai: true,
    account: false,
    editor: false,
    data: false,
    git: false,
    webdav: false,
    autosync: false,
    webhook: false,
    connections: false,
    about: false,
  });

  const [customTheme, setCustomTheme] = useState<CustomTheme>(() => loadCustomTheme());
  const [tactileAccent, setTactileAccent] = useState<string>(() => loadTactileAccent());
  const [appFonts, setAppFonts] = useState<AppFonts>(() => loadAppFonts());
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>(() => loadMcpConnections());

  const [providerStore, setProviderStore] = useState(() => loadProviderStore());
  const [activeProvider, setActiveProvider] = useState<AiProviderId>(() => getActiveProviderId());
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  const [remoteUrl, setRemoteUrl] = useState("");
  const [gitStatus, setGitStatus] = useState<{ is_repo: boolean; remote?: string | null; branch?: string | null; last_commit?: string | null; dirty_files?: number } | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitMsg, setGitMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavPass, setWebdavPass] = useState("");
  const [webdavDir, setWebdavDir] = useState("yggdrasil-vault");
  const [webdavStatus, setWebdavStatus] = useState<{ configured: boolean; last_sync?: string | null } | null>(null);
  const [webdavBusy, setWebdavBusy] = useState(false);
  const [webdavMsg, setWebdavMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [autosyncEnabled, setAutosyncEnabled] = useState(false);
  const [autosyncInterval, setAutosyncInterval] = useState(30);
  const [autosyncTarget, setAutosyncTarget] = useState<"git" | "webdav" | "both">("git");
  const [autosyncLastRun, setAutosyncLastRun] = useState<string | null>(null);
  const [autosyncBusy, setAutosyncBusy] = useState(false);
  const [autosyncMsg, setAutosyncMsg] = useState<string | null>(null);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookDay, setWebhookDay] = useState(6);
  const [webhookHour, setWebhookHour] = useState(18);
  const [webhookLastSent, setWebhookLastSent] = useState<string | null>(null);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/info").then((r) => r.json()).then(setInfo).catch(() => {});
    refreshGitStatus();
    refreshWebdavStatus();
    refreshAutosyncStatus();
    refreshWebhookStatus();
    setProviderStore(loadProviderStore());
    setActiveProvider(getActiveProviderId());
  }, [open]);

  function refreshAutosyncStatus() {
    api.vault.autosyncStatus().then((s) => {
      setAutosyncEnabled(s.enabled);
      setAutosyncInterval(s.interval_minutes);
      setAutosyncTarget((s.target as "git" | "webdav" | "both") || "git");
      setAutosyncLastRun(s.last_run || null);
    }).catch(() => {});
  }

  async function saveAutosync(next: { enabled?: boolean; interval_minutes?: number; target?: "git" | "webdav" | "both" }) {
    const enabled = next.enabled ?? autosyncEnabled;
    const interval = next.interval_minutes ?? autosyncInterval;
    const target = next.target ?? autosyncTarget;
    setAutosyncEnabled(enabled);
    setAutosyncInterval(interval);
    setAutosyncTarget(target);
    setAutosyncBusy(true);
    try {
      const r = await api.vault.autosyncConfig(enabled, interval, target);
      setAutosyncMsg(r.message);
      setTimeout(() => setAutosyncMsg(null), 2500);
    } catch (e) {
      setAutosyncMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setAutosyncBusy(false);
    }
  }

  function refreshWebhookStatus() {
    api.webhook.status().then((s) => {
      if (s.configured) {
        setWebhookUrl(s.url || "");
        setWebhookEnabled(Boolean(s.enabled));
        setWebhookDay(s.day_of_week ?? 6);
        setWebhookHour(s.hour ?? 18);
        setWebhookLastSent(s.last_sent || null);
      }
    }).catch(() => {});
  }

  async function handleWebhookSave() {
    if (!webhookUrl.trim()) return;
    setWebhookBusy(true);
    setWebhookMsg(null);
    try {
      const r = await api.webhook.config(webhookUrl.trim(), webhookEnabled, webhookDay, webhookHour);
      setWebhookMsg({ text: r.message, ok: r.ok });
      refreshWebhookStatus();
    } catch (e) {
      setWebhookMsg({ text: e instanceof Error ? e.message : "Failed to save", ok: false });
    } finally {
      setWebhookBusy(false);
    }
  }

  async function handleWebhookTest() {
    setWebhookBusy(true);
    setWebhookMsg(null);
    try {
      const r = await api.webhook.test();
      setWebhookMsg({ text: r.message, ok: r.ok });
      refreshWebhookStatus();
    } catch (e) {
      setWebhookMsg({ text: e instanceof Error ? e.message : "Send failed", ok: false });
    } finally {
      setWebhookBusy(false);
    }
  }

  function toggle(id: string) {
    setOpenSections((s) => ({ ...s, [id]: !s[id] }));
  }

  function refreshWebdavStatus() {
    api.vault.webdavStatus().then((s) => {
      setWebdavStatus(s);
      if (s.url) setWebdavUrl(s.url);
      if (s.username) setWebdavUser(s.username);
      if (s.remote_dir) setWebdavDir(s.remote_dir);
    }).catch(() => {});
  }

  async function handleWebdavSave() {
    if (!webdavUrl.trim()) return;
    setWebdavBusy(true);
    setWebdavMsg(null);
    try {
      const r = await api.vault.webdavConfig(webdavUrl.trim(), webdavUser.trim(), webdavPass, webdavDir.trim());
      setWebdavMsg({ text: r.message, ok: r.ok });
      setWebdavPass("");
      refreshWebdavStatus();
    } catch (e) {
      setWebdavMsg({ text: e instanceof Error ? e.message : "Failed to save remote", ok: false });
    } finally {
      setWebdavBusy(false);
    }
  }

  async function handleWebdavSync() {
    setWebdavBusy(true);
    setWebdavMsg(null);
    try {
      const r = await api.vault.webdavSync();
      setWebdavMsg({ text: r.message, ok: r.ok });
      refreshWebdavStatus();
    } catch (e) {
      setWebdavMsg({ text: e instanceof Error ? e.message : "Sync failed", ok: false });
    } finally {
      setWebdavBusy(false);
    }
  }

  function refreshGitStatus() {
    api.vault.gitStatus().then((s) => {
      setGitStatus(s);
      if (s.remote) setRemoteUrl(s.remote);
    }).catch(() => {});
  }

  async function handleGitInit() {
    if (!remoteUrl.trim()) return;
    setGitBusy(true);
    setGitMsg(null);
    try {
      const r = await api.vault.gitInit(remoteUrl.trim());
      setGitMsg({ text: r.message, ok: r.ok });
      refreshGitStatus();
    } catch (e) {
      setGitMsg({ text: e instanceof Error ? e.message : "Failed to set remote", ok: false });
    } finally {
      setGitBusy(false);
    }
  }

  async function handleGitSync() {
    setGitBusy(true);
    setGitMsg(null);
    try {
      const r = await api.vault.gitSync();
      setGitMsg({ text: r.message, ok: r.ok });
      refreshGitStatus();
    } catch (e) {
      setGitMsg({ text: e instanceof Error ? e.message : "Sync failed", ok: false });
    } finally {
      setGitBusy(false);
    }
  }

  const handleThemeChange = (theme: string) => {
    setSettings((s) => ({ ...s, theme }));
    localStorage.setItem("theme", theme);
    applyTheme();
  };

  function updateCustom<K extends keyof CustomTheme>(key: K, value: CustomTheme[K]) {
    const next = { ...customTheme, [key]: value };
    setCustomTheme(next);
    saveCustomTheme(next);
    if (settings.theme !== "custom") {
      setSettings((s) => ({ ...s, theme: "custom" }));
      localStorage.setItem("theme", "custom");
    }
    applyTheme();
  }

  function pickFont(slot: keyof AppFonts, id: string) {
    const next = { ...appFonts, [slot]: id };
    setAppFonts(next);
    saveAppFonts(next);
    applyTheme();
  }

  function pickTactileAccent(hex: string) {
    setTactileAccent(hex);
    saveTactileAccent(hex);
  }

  function seedCustomFrom(id: "dark" | "paper" | "tactile") {
    const next = customFromPreset(id);
    setCustomTheme(next);
    saveCustomTheme(next);
    setSettings((s) => ({ ...s, theme: "custom" }));
    localStorage.setItem("theme", "custom");
    applyTheme();
  }

  function updateMcpConnection(id: string, endpoint: string) {
    setMcpConnections((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, endpoint, configured: Boolean(endpoint.trim()) } : c));
      localStorage.setItem(MCP_KEY, JSON.stringify(next));
      return next;
    });
  }

  function disconnectMcp(id: string) {
    updateMcpConnection(id, "");
  }

  const handleSettingChange = (key: keyof SettingsState, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    localStorage.setItem(key, String(value));
  };

  function updateProviderField(field: keyof AiProviderConfig, value: string) {
    setProviderStore((prev) => {
      const next = {
        ...prev,
        [activeProvider]: { ...prev[activeProvider], [field]: value, provider: activeProvider },
      };
      return next;
    });
  }

  function saveAiProviders() {
    saveProviderStore(providerStore);
    setActiveProviderId(activeProvider);
    setAiMsg("Saved in this browser only — never sent to the server except when you call Ask / Examine.");
    setTimeout(() => setAiMsg(null), 4000);
  }

  const handleSaveLatexDir = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latexDir: settings.latexDir, userAccount: settings.userAccount }),
      });
    } catch (e) {
      console.error("Failed to save settings", e);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const cfg = providerStore[activeProvider];
  const meta = PROVIDER_META[activeProvider];

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>

        <CollapsibleSection id="appearance" title="Appearance" open={!!openSections.appearance} onToggle={() => toggle("appearance")}>
          <div className="settings-item">
            <label>Theme</label>
            <div className="theme-picker">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-card${settings.theme === t.id ? " selected" : ""}`}
                  onClick={() => handleThemeChange(t.id)}
                  title={t.label}
                >
                  <span className="theme-card-swatch" style={{ background: (t.id === "custom" ? customTheme : t.swatch).bg }}>
                    <span className="theme-card-dot" style={{ background: (t.id === "custom" ? customTheme : t.swatch).surface }} />
                    <span
                      className="theme-card-dot"
                      style={{ background: t.id === "custom" ? customTheme.accent : t.id === "tactile" ? tactileAccent : t.swatch.accent }}
                    />
                    <span className="theme-card-bar" style={{ background: (t.id === "custom" ? customTheme : t.swatch).text }} />
                  </span>
                  <span className="theme-card-label">{t.label}</span>
                </button>
              ))}
            </div>
            <div className="settings-info" style={{ marginTop: 8 }}>
              Shared across the app. Use <strong>Edit page</strong> in the top bar to colour a single view.
            </div>
          </div>

          <div className="settings-item" style={{ marginTop: 14 }}>
            <label>Fonts</label>
            <div className="settings-info" style={{ marginBottom: 8 }}>
              Main text is body copy. Titles cover headings and the Yggdrasil wordmark.
            </div>
            <div className="font-picker-row">
              <label className="font-picker-field">
                <span>Main text</span>
                <select
                  value={appFonts.body}
                  onChange={(e) => pickFont("body", e.target.value)}
                  style={{ fontFamily: APP_FONTS.find((f) => f.id === appFonts.body)?.stack }}
                >
                  {FONT_CATEGORIES.map((cat) => (
                    <optgroup key={cat.id} label={cat.label}>
                      {APP_FONTS.filter((f) => f.category === cat.id).map((f) => (
                        <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                          {f.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="font-picker-field">
                <span>Titles</span>
                <select
                  value={appFonts.title}
                  onChange={(e) => pickFont("title", e.target.value)}
                  style={{ fontFamily: APP_FONTS.find((f) => f.id === appFonts.title)?.stack }}
                >
                  {FONT_CATEGORIES.map((cat) => (
                    <optgroup key={cat.id} label={cat.label}>
                      {APP_FONTS.filter((f) => f.category === cat.id).map((f) => (
                        <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                          {f.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>
            <div className="font-picker-preview">
              <p className="font-picker-preview-title">Reading notes for today</p>
              <p className="font-picker-preview-body">
                The claim needs a specific observation, not a restatement of the abstract.
              </p>
            </div>
          </div>

          {settings.theme === "tactile" && (
            <div className="settings-item" style={{ marginTop: 14 }}>
              <label>Tactile accent</label>
              <div className="settings-info" style={{ marginBottom: 8 }}>
                Surfaces and shadows stay the same — pick the hue used for buttons, chips, and highlights.
              </div>
              <div className="tactile-accent-bar">
                {TACTILE_ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`tactile-accent-swatch${tactileAccent.toLowerCase() === a.hex.toLowerCase() ? " selected" : ""}`}
                    style={{ background: a.hex }}
                    title={a.label}
                    onClick={() => pickTactileAccent(a.hex)}
                  />
                ))}
                <label
                  className="tactile-accent-swatch tactile-accent-custom"
                  title="Custom colour"
                  style={{ backgroundImage: `url(${colorPickerIcon})` }}
                >
                  <input
                    type="color"
                    value={hexOk(tactileAccent) ? tactileAccent : "#C97B4A"}
                    onChange={(e) => pickTactileAccent(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {settings.theme === "custom" && (
            <div className="settings-item" style={{ marginTop: 14 }}>
              <label>Customize</label>
              <div className="settings-info" style={{ marginBottom: 8 }}>
                App-wide colours (background, nav, text). Dark and Paper stay unchanged.
                Per-page colours (heatmap, Graph, LaTeX) are under <strong>Edit page</strong> in the top bar.
              </div>
              <div className="theme-color-grid">
                {(
                  [
                    ["bg", "Background"],
                    ["surface", "Surface"],
                    ["border", "Border"],
                    ["text", "Text"],
                    ["muted", "Muted"],
                    ["accent", "Accent"],
                    ["ok", "OK"],
                    ["gate", "Warning"],
                    ["crit", "Error"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="theme-color-field">
                    <span>{label}</span>
                    <input
                      type="color"
                      value={customTheme[key]}
                      onChange={(e) => updateCustom(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" className="btn" onClick={() => seedCustomFrom("dark")}>Start from Dark</button>
                <button type="button" className="btn" onClick={() => seedCustomFrom("paper")}>Start from Paper</button>
                <button type="button" className="btn" onClick={() => seedCustomFrom("tactile")}>Start from Tactile</button>
              </div>
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection id="statuses" title="Task statuses" open={!!openSections.statuses} onToggle={() => toggle("statuses")}>
          <TaskStatusEditor />
        </CollapsibleSection>

        <CollapsibleSection id="ai" title="AI Providers" open={!!openSections.ai} onToggle={() => toggle("ai")}>
          <div className="settings-item">
            <div className="settings-info" style={{ marginBottom: 10 }}>
              Keys stay in <strong>this browser’s localStorage</strong> only. They are sent with Ask / Examine
              requests and are never written to the vault or Docker image.
            </div>
            <label htmlFor="activeProvider">Active provider</label>
            <select
              id="activeProvider"
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value as AiProviderId)}
              style={{ width: "100%" }}
            >
              {(Object.keys(PROVIDER_META) as AiProviderId[]).map((id) => (
                <option key={id} value={id}>{PROVIDER_META[id].label}</option>
              ))}
            </select>
            {meta.needsKey && (
              <>
                <label htmlFor="aiKey" style={{ marginTop: 8 }}>API Key</label>
                <input
                  id="aiKey"
                  type="password"
                  value={cfg.api_key}
                  onChange={(e) => updateProviderField("api_key", e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </>
            )}
            <label htmlFor="aiBase" style={{ marginTop: 8 }}>Base URL</label>
            <input
              id="aiBase"
              type="text"
              value={cfg.base_url}
              onChange={(e) => updateProviderField("base_url", e.target.value)}
              placeholder={meta.defaultBase || "(Claude uses Anthropic API)"}
            />
            <label htmlFor="aiModel" style={{ marginTop: 8 }}>Model</label>
            <input
              id="aiModel"
              type="text"
              value={cfg.model}
              onChange={(e) => updateProviderField("model", e.target.value)}
              placeholder={meta.defaultModel}
            />
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={saveAiProviders}>Save AI settings</button>
            </div>
            {aiMsg && <div className="ok mono" style={{ fontSize: 12, marginTop: 8 }}>{aiMsg}</div>}
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="account" title="Account" open={!!openSections.account} onToggle={() => toggle("account")}>
          <div className="settings-item">
            <label htmlFor="userAccount">User Account</label>
            <input
              id="userAccount"
              type="text"
              value={settings.userAccount}
              onChange={(e) => handleSettingChange("userAccount", e.target.value)}
              placeholder="Your name or account"
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="editor" title="Editor" open={!!openSections.editor} onToggle={() => toggle("editor")}>
          <div className="settings-item">
            <label htmlFor="fontSize">Font Size (px)</label>
            <input
              id="fontSize"
              type="number"
              min={10}
              max={20}
              value={settings.fontSize}
              onChange={(e) => handleSettingChange("fontSize", parseInt(e.target.value))}
            />
          </div>
          <div className="settings-item">
            <label htmlFor="tabWidth">Tab Width</label>
            <input
              id="tabWidth"
              type="number"
              min={1}
              max={8}
              value={settings.tabWidth}
              onChange={(e) => handleSettingChange("tabWidth", parseInt(e.target.value))}
            />
          </div>
          <div className="settings-item">
            <label>
              <input
                type="checkbox"
                checked={settings.lineWrap}
                onChange={(e) => handleSettingChange("lineWrap", e.target.checked)}
              />
              {" "}Line Wrap
            </label>
          </div>
          <div className="settings-item">
            <label>
              <input
                type="checkbox"
                checked={settings.autoCompile}
                onChange={(e) => handleSettingChange("autoCompile", e.target.checked)}
              />
              {" "}Auto Compile (when file changes)
            </label>
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="data" title="Data" open={!!openSections.data} onToggle={() => toggle("data")}>
          <div className="settings-item">
            <label htmlFor="latexDir">Data Path</label>
            <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
              <input
                id="latexDir"
                type="text"
                value={settings.latexDir}
                onChange={(e) => handleSettingChange("latexDir", e.target.value)}
                placeholder="/vault"
                style={{ flex: 1 }}
              />
              {info.availablePaths && info.availablePaths.length > 0 && (
                <select
                  value={settings.latexDir}
                  onChange={(e) => handleSettingChange("latexDir", e.target.value)}
                  style={{ width: "100%" }}
                >
                  {info.availablePaths.map((path) => (
                    <option key={path} value={path}>{path}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="settings-info" style={{ marginTop: 8 }}>
              Prefer in-container paths like <code>/vault</code>. Host paths are not reachable from Docker.
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={handleSaveLatexDir} disabled={saving}>
                {saving ? "…" : "Save"}
              </button>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="git" title="Data Sync (Git)" open={!!openSections.git} onToggle={() => toggle("git")}>
          <div className="settings-item">
            <label htmlFor="gitRemote">Remote URL</label>
            <input
              id="gitRemote"
              type="text"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://&lt;token&gt;@github.com/you/vault-backup.git"
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={handleGitInit} disabled={gitBusy || !remoteUrl.trim()}>
                {gitStatus?.is_repo ? "Update Remote" : "Init + Set Remote"}
              </button>
              <button className="btn btn-primary" onClick={handleGitSync} disabled={gitBusy || !gitStatus?.remote}>
                {gitBusy ? "…" : "Sync Now"}
              </button>
            </div>
            {gitMsg && (
              <div className={gitMsg.ok ? "ok mono" : "crit mono"} style={{ fontSize: 12, marginTop: 8 }}>
                {gitMsg.text}
              </div>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="webdav" title="Data Sync (Cloud / WebDAV)" open={!!openSections.webdav} onToggle={() => toggle("webdav")}>
          <div className="settings-item">
            <label htmlFor="webdavUrl">WebDAV URL</label>
            <input id="webdavUrl" type="text" value={webdavUrl} onChange={(e) => setWebdavUrl(e.target.value)} />
            <label htmlFor="webdavUser" style={{ marginTop: 8 }}>Username</label>
            <input id="webdavUser" type="text" value={webdavUser} onChange={(e) => setWebdavUser(e.target.value)} />
            <label htmlFor="webdavPass" style={{ marginTop: 8 }}>Password / App Token</label>
            <input id="webdavPass" type="password" value={webdavPass} onChange={(e) => setWebdavPass(e.target.value)} />
            <label htmlFor="webdavDir" style={{ marginTop: 8 }}>Remote Folder</label>
            <input id="webdavDir" type="text" value={webdavDir} onChange={(e) => setWebdavDir(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={handleWebdavSave} disabled={webdavBusy || !webdavUrl.trim()}>
                {webdavStatus?.configured ? "Update Remote" : "Save Remote"}
              </button>
              <button className="btn btn-primary" onClick={handleWebdavSync} disabled={webdavBusy || !webdavStatus?.configured}>
                {webdavBusy ? "…" : "Sync Now"}
              </button>
            </div>
            {webdavMsg && (
              <div className={webdavMsg.ok ? "ok mono" : "crit mono"} style={{ fontSize: 12, marginTop: 8 }}>
                {webdavMsg.text}
              </div>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="autosync" title="Auto-Sync" open={!!openSections.autosync} onToggle={() => toggle("autosync")}>
          <div className="settings-item">
            <div className="settings-info" style={{ marginBottom: 10 }}>
              Runs the Git and/or WebDAV sync above automatically on a timer, instead of you having to click
              "Sync Now" yourself. Off by default. Checked every 5 minutes; actual sync only runs once the
              configured interval has elapsed.
            </div>
            <label>
              <input
                type="checkbox"
                checked={autosyncEnabled}
                onChange={(e) => saveAutosync({ enabled: e.target.checked })}
              />
              {" "}Enable auto-sync
            </label>
            <label htmlFor="autosyncTarget" style={{ marginTop: 8 }}>Sync target</label>
            <select
              id="autosyncTarget"
              value={autosyncTarget}
              onChange={(e) => saveAutosync({ target: e.target.value as "git" | "webdav" | "both" })}
            >
              <option value="git">Git remote</option>
              <option value="webdav">WebDAV / Cloud</option>
              <option value="both">Both</option>
            </select>
            <label htmlFor="autosyncInterval" style={{ marginTop: 8 }}>Every N minutes</label>
            <input
              id="autosyncInterval"
              type="number"
              min={5}
              max={1440}
              value={autosyncInterval}
              onChange={(e) => saveAutosync({ interval_minutes: parseInt(e.target.value) || 30 })}
            />
            {autosyncBusy && <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>Saving…</div>}
            {autosyncMsg && <div className="ok mono" style={{ fontSize: 12, marginTop: 6 }}>{autosyncMsg}</div>}
            {autosyncLastRun && (
              <div className="settings-info" style={{ marginTop: 8 }}>
                Last auto-sync: {new Date(autosyncLastRun).toLocaleString()}
              </div>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="webhook" title="Weekly Score Digest (Webhook)" open={!!openSections.webhook} onToggle={() => toggle("webhook")}>
          <div className="settings-item">
            <div className="settings-info" style={{ marginBottom: 10 }}>
              Posts your weekly score + completed-paper digest to a Slack or Discord incoming webhook URL, so
              you get a nudge even if you forget to open the Dashboard.
            </div>
            <label htmlFor="webhookUrl">Webhook URL</label>
            <input
              id="webhookUrl"
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/... or a Discord webhook URL"
            />
            <label style={{ marginTop: 8 }}>
              <input type="checkbox" checked={webhookEnabled} onChange={(e) => setWebhookEnabled(e.target.checked)} />
              {" "}Send automatically every week
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="webhookDay">Day</label>
                <select id="webhookDay" value={webhookDay} onChange={(e) => setWebhookDay(parseInt(e.target.value))} style={{ width: "100%" }}>
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="webhookHour">Hour (24h, container time)</label>
                <input
                  id="webhookHour"
                  type="number"
                  min={0}
                  max={23}
                  value={webhookHour}
                  onChange={(e) => setWebhookHour(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={handleWebhookSave} disabled={webhookBusy || !webhookUrl.trim()}>
                Save
              </button>
              <button className="btn btn-primary" onClick={handleWebhookTest} disabled={webhookBusy || !webhookUrl.trim()}>
                {webhookBusy ? "…" : "Send Now"}
              </button>
            </div>
            {webhookMsg && (
              <div className={webhookMsg.ok ? "ok mono" : "crit mono"} style={{ fontSize: 12, marginTop: 8 }}>
                {webhookMsg.text}
              </div>
            )}
            {webhookLastSent && (
              <div className="settings-info" style={{ marginTop: 8 }}>Last sent: {webhookLastSent}</div>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="connections" title="Connections" open={!!openSections.connections} onToggle={() => toggle("connections")}>
          <div className="settings-item">
            <div className="settings-info" style={{ marginBottom: 10 }}>
              Endpoint slots for MCP servers you run yourself. Saving an endpoint here only stores it in
              this browser — it does not start, health-check, or authenticate a connection. Wiring an
              actual MCP client into the backend is a separate, larger change; treat "Configured" below as
              "has an endpoint saved," not "verified reachable."
            </div>
            {mcpConnections.map((c) => (
              <div key={c.id} className="mcp-row">
                <div className="mcp-row-name">{c.name}</div>
                <input
                  type="text"
                  value={c.endpoint}
                  onChange={(e) => updateMcpConnection(c.id, e.target.value)}
                  placeholder="e.g. http://localhost:PORT or a command"
                  className="mcp-row-endpoint"
                />
                <span className={`mcp-status${c.configured ? " configured" : ""}`}>
                  {c.configured ? "● Configured" : "○ Not configured"}
                </span>
                <button className="btn" onClick={() => disconnectMcp(c.id)} disabled={!c.configured}>
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="about" title="About" open={!!openSections.about} onToggle={() => toggle("about")}>
          <div className="settings-info">
            {info.vaultPath && <div>📁 Vault: {info.vaultPath}</div>}
            {info.texVersion && <div>🔧 TeX: {info.texVersion}</div>}
            {info.diskFree && <div>💾 Disk Free: {(info.diskFree / 1024 / 1024 / 1024).toFixed(1)} GB</div>}
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
