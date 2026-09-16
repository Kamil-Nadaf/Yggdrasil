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
  THEME_ACCENTS,
  DEFAULT_THEME,
  MODE_TOGGLE_THEMES,
  applyTheme,
  loadCustomTheme,
  saveCustomTheme,
  customFromPreset,
  loadThemeAccent,
  saveThemeAccent,
  themePreviewTokens,
  loadThemeMode,
  saveThemeMode,
  hexOk,
  type CustomTheme,
  type ThemeMode,
} from "../lib/theme";
import {
  APP_FONTS,
  FONT_CATEGORIES,
  loadAppFonts,
  saveAppFonts,
  type AppFonts,
} from "../lib/fonts";
import { APP_COPYRIGHT, APP_LICENSE, APP_OWNER } from "../lib/copyright";
import { DEFAULT_ANALYSIS_TAGS, setCachedAnalysisTags, tagToKey } from "../lib/analysisTags";
import { DEFAULT_TASK_STATUSES, setCachedTaskStatuses, STATUS_ICON_GLYPH, STATUS_ICON_CYCLE } from "../lib/taskStatuses";
import type { TaskStatusDef, StatusIcon } from "../api/client";

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
  latexPath?: string;
  notesPath?: string;
  diskFree?: number;
  availablePaths?: string[];
  desktop?: boolean;
  dataPathChosen?: boolean;
  existingData?: boolean;
  manifestPresent?: boolean;
  previousAppVersion?: string | null;
  appVersion?: string;
}

interface SettingsSaveResult {
  ok?: boolean;
  message?: string;
  vaultPath?: string;
  desktop?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  firstRun?: boolean;
  onDataPathSaved?: () => void;
}

declare global {
  interface Window {
    pywebview?: {
      api?: {
        pick_folder?: () => Promise<string>;
      };
    };
  }
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

export default function SettingsDrawer({ open, onClose, firstRun, onDataPathSaved }: Props) {
  const [settings, setSettings] = useState<SettingsState>(() => ({
    theme: (() => {
      const raw = localStorage.getItem("theme") || DEFAULT_THEME;
      return THEMES.some((t) => t.id === raw) ? raw : "custom";
    })(),
    fontSize: parseInt(localStorage.getItem("fontSize") || "13"),
    tabWidth: parseInt(localStorage.getItem("tabWidth") || "2"),
    lineWrap: localStorage.getItem("lineWrap") !== "false",
    autoCompile: localStorage.getItem("autoCompile") === "true",
    userAccount: localStorage.getItem("userAccount") || "",
    latexDir: localStorage.getItem("latexDir") || "",
  }));

  const [info, setInfo] = useState<SystemInfo>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    existingData?: boolean;
    hasManifest?: boolean;
    previousAppVersion?: string;
    latexFileCount?: number;
    vaultPath?: string;
  } | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    appearance: true,
    ai: true,
    account: false,
    editor: false,
    analysisTags: false,
    taskStatuses: false,
    data: false,
    git: false,
    webdav: false,
    autosync: false,
    webhook: false,
    connections: false,
    about: false,
  });

  const [customTheme, setCustomTheme] = useState<CustomTheme>(() => loadCustomTheme());
  const [themeAccent, setThemeAccent] = useState<string>(() => {
    const raw = localStorage.getItem("theme") || DEFAULT_THEME;
    return loadThemeAccent(THEMES.some((t) => t.id === raw) ? raw : "custom");
  });
  const [modeTick, setModeTick] = useState(0);
  const [appFonts, setAppFonts] = useState<AppFonts>(() => loadAppFonts());
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>(() => loadMcpConnections());

  const [analysisTags, setAnalysisTags] = useState<string[]>([
    "Claim", "Evidence", "Reasoning", "Implications", "Context",
  ]);
  const [analysisDefaults, setAnalysisDefaults] = useState<string[]>([]);
  const [analysisMsg, setAnalysisMsg] = useState<string | null>(null);
  const [analysisSaving, setAnalysisSaving] = useState(false);
  const [pendingMigration, setPendingMigration] = useState<{
    mapping: Record<string, string>;
    counts: Record<string, number>;
    warning?: string;
  } | null>(null);

  const [taskStatuses, setTaskStatuses] = useState<TaskStatusDef[]>([...DEFAULT_TASK_STATUSES]);
  const [taskStatusUsage, setTaskStatusUsage] = useState<Record<string, number>>({});
  const [taskStatusesMsg, setTaskStatusesMsg] = useState<string | null>(null);
  const [taskStatusesSaving, setTaskStatusesSaving] = useState(false);
  const [pendingReassign, setPendingReassign] = useState<{
    statusId: string;
    statusName: string;
    count: number;
    chooseTo: string;
  } | null>(null);

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
    fetch("/api/info")
      .then((r) => r.json())
      .then((data: SystemInfo) => {
        setInfo(data);
        if (data.vaultPath && (data.desktop || !localStorage.getItem("latexDir") || localStorage.getItem("latexDir") === "/vault")) {
          setSettings((s) => ({ ...s, latexDir: data.vaultPath || s.latexDir }));
        }
      })
      .catch(() => {});
    refreshGitStatus();
    refreshWebdavStatus();
    refreshAutosyncStatus();
    refreshWebhookStatus();
    setProviderStore(loadProviderStore());
    setActiveProvider(getActiveProviderId());
    api.analysisTags.get()
      .then((r) => {
        setAnalysisTags(r.analysis_tags);
        setAnalysisDefaults(r.defaults);
        setCachedAnalysisTags(r.analysis_tags);
        setPendingMigration(null);
      })
      .catch(() => {});
    api.taskStatuses.get()
      .then((r) => {
        setTaskStatuses(r.task_statuses);
        setTaskStatusUsage(r.usage);
        setCachedTaskStatuses(r.task_statuses);
        setPendingReassign(null);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open || !firstRun) return;
    setOpenSections((s) => ({ ...s, appearance: false, ai: false, data: true }));
  }, [open, firstRun]);

  useEffect(() => {
    if (!open || !info.desktop || !settings.latexDir.trim()) {
      setProbe(null);
      return;
    }
    const handle = window.setTimeout(() => {
      api.data.probe(settings.latexDir.trim()).then((r) => {
        if (!r.ok || !r.existingData) {
          setProbe(null);
          return;
        }
        setProbe({
          existingData: r.existingData,
          hasManifest: r.hasManifest,
          previousAppVersion: r.previousAppVersion,
          latexFileCount: r.latexFileCount,
          vaultPath: r.manifest?.vault_path,
        });
      }).catch(() => setProbe(null));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [open, info.desktop, settings.latexDir]);

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
    setThemeAccent(loadThemeAccent(theme));
    applyTheme();
  };

  const activeThemeMode: ThemeMode = loadThemeMode(settings.theme);
  const pickMode = (mode: ThemeMode) => {
    saveThemeMode(settings.theme, mode);
    setThemeAccent(loadThemeAccent(settings.theme));
    setModeTick((n) => n + 1);
  };
  void modeTick;

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

  function pickThemeAccent(hex: string) {
    setThemeAccent(hex);
    if (settings.theme === "custom") {
      const next = { ...customTheme, accent: hex };
      setCustomTheme(next);
      saveCustomTheme(next);
      applyTheme();
      return;
    }
    saveThemeAccent(settings.theme, hex);
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

  async function persistServerSettings(path = settings.latexDir): Promise<SettingsSaveResult> {
    const resp = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latexDir: path, userAccount: settings.userAccount }),
    });
    const data = (await resp.json().catch(() => ({}))) as SettingsSaveResult;
    if (data.vaultPath) {
      handleSettingChange("latexDir", data.vaultPath);
      setInfo((prev) => ({
        ...prev,
        vaultPath: data.vaultPath,
        dataPathChosen: data.ok !== false,
      }));
    }
    if (data.ok !== false && (info.desktop || data.desktop)) {
      onDataPathSaved?.();
    }
    return data;
  }

  async function pickDataFolder() {
    const picker = window.pywebview?.api?.pick_folder;
    if (!picker) {
      setSaveMsg("Folder picker is only available in the desktop app.");
      setTimeout(() => setSaveMsg(null), 4000);
      return;
    }
    try {
      const path = await picker();
      if (path) handleSettingChange("latexDir", path);
    } catch (e) {
      console.error("Folder picker failed", e);
    }
  }

  const handleSaveLatexDir = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const data = await persistServerSettings();
      if (data.ok === false) {
        setSaveMsg(data.message || "Could not save data path.");
        return;
      }
      setSaveMsg(data.message || "Data path saved.");
      setTimeout(() => setSaveMsg(null), 4000);
    } catch (e) {
      console.error("Failed to save settings", e);
      setSaveMsg("Could not save data path.");
    } finally {
      setSaving(false);
    }
  };

  async function saveAllSettings() {
    setSaving(true);
    setSaveMsg(null);
    try {
      (Object.keys(settings) as (keyof SettingsState)[]).forEach((key) => {
        localStorage.setItem(key, String(settings[key]));
      });
      saveCustomTheme(customTheme);
      saveAppFonts(appFonts);
      if (settings.theme === "custom") {
        saveCustomTheme({ ...customTheme, accent: themeAccent });
      } else {
        saveThemeAccent(settings.theme, themeAccent);
      }
      saveProviderStore(providerStore);
      setActiveProviderId(activeProvider);
      localStorage.setItem(MCP_KEY, JSON.stringify(mcpConnections));
      applyTheme();
      try {
        const data = await persistServerSettings();
        if (data.ok === false) {
          setSaveMsg(data.message || "Could not save data path.");
          return;
        }
        setSaveMsg(info.desktop ? (data.message || "Saved.") : "Saved.");
      } catch {
        setSaveMsg("Saved in this browser.");
      }
      setTimeout(() => setSaveMsg(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  function cycleIcon(current: StatusIcon): StatusIcon {
    const i = STATUS_ICON_CYCLE.indexOf(current);
    return STATUS_ICON_CYCLE[(i + 1) % STATUS_ICON_CYCLE.length];
  }

  async function saveTaskStatuses(reassign?: Record<string, string>) {
    setTaskStatusesSaving(true);
    setTaskStatusesMsg(null);
    try {
      const r = await api.taskStatuses.set(taskStatuses, reassign);
      setTaskStatuses(r.task_statuses);
      setCachedTaskStatuses(r.task_statuses);
      setPendingReassign(null);
      setTaskStatusesMsg("Statuses saved.");
      const usage = await api.taskStatuses.get();
      setTaskStatusUsage(usage.usage);
    } catch (e) {
      const err = e as Error & { status?: number; data?: { detail?: { status_id: string; status_name: string; count: number } } };
      if (err.status === 409 && err.data?.detail) {
        const { status_id, status_name, count } = err.data.detail;
        setPendingReassign({
          statusId: status_id,
          statusName: status_name,
          count,
          chooseTo: taskStatuses.find((s) => s.id !== status_id)?.id || "",
        });
        setTaskStatusesMsg(`${count} task(s) use "${status_name}" — choose where to move them below, then save again.`);
      } else {
        setTaskStatusesMsg(e instanceof Error ? e.message : "Save failed");
      }
    } finally {
      setTaskStatusesSaving(false);
    }
  }

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

        <div className="settings-body">
        <CollapsibleSection id="appearance" title="Appearance" open={!!openSections.appearance} onToggle={() => toggle("appearance")}>
          <div className="settings-item">
            <label>Theme</label>
            <div className="theme-picker">
              {THEMES.map((t) => {
                const isDarkMode = MODE_TOGGLE_THEMES.has(t.id) && loadThemeMode(t.id) === "dark";
                const swatch = t.id === "custom" ? customTheme : themePreviewTokens(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`theme-card${settings.theme === t.id ? " selected" : ""}`}
                    onClick={() => handleThemeChange(t.id)}
                    title={t.label}
                  >
                    <span className="theme-card-swatch" style={{ background: swatch.bg }}>
                      <span className="theme-card-dot" style={{ background: swatch.surface }} />
                      <span
                        className="theme-card-dot"
                        style={{ background: t.id === settings.theme ? themeAccent : swatch.accent }}
                      />
                      <span className="theme-card-bar" style={{ background: swatch.text }} />
                    </span>
                    <span className="theme-card-label">
                      {t.label}
                      {isDarkMode ? " (Dark)" : MODE_TOGGLE_THEMES.has(t.id) && loadThemeMode(t.id) === "light" && t.id === "dark" ? " (Light)" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="settings-info" style={{ marginTop: 8 }}>
              Shared across the app. Use <strong>Edit page</strong> in the top bar to colour a single view.
            </div>
          </div>

          {MODE_TOGGLE_THEMES.has(settings.theme) && (
            <div className="settings-item">
              <label>Mode</label>
              <div className="theme-mode-toggle">
                <button
                  type="button"
                  className={`theme-mode-btn${activeThemeMode === "light" ? " selected" : ""}`}
                  onClick={() => pickMode("light")}
                >
                  ☀ Light
                </button>
                <button
                  type="button"
                  className={`theme-mode-btn${activeThemeMode === "dark" ? " selected" : ""}`}
                  onClick={() => pickMode("dark")}
                >
                  ☾ Dark
                </button>
              </div>
              <div className="settings-info" style={{ marginTop: 8 }}>
                {THEMES.find((t) => t.id === settings.theme)?.label} remembers its own Light/Dark choice. Custom uses
                the colour grid below instead.
              </div>
            </div>
          )}

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

          <div className="settings-item" style={{ marginTop: 14 }}>
            <label>Colour palette</label>
            <div className="settings-info" style={{ marginBottom: 8 }}>
              Surfaces stay the same — pick the hue for buttons, chips, and highlights. Each theme remembers its own
              colour.
            </div>
            <div className="tactile-accent-bar">
              {THEME_ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`tactile-accent-swatch${themeAccent.toLowerCase() === a.hex.toLowerCase() ? " selected" : ""}`}
                  style={{ background: a.hex }}
                  title={a.label}
                  onClick={() => pickThemeAccent(a.hex)}
                />
              ))}
              <label
                className="tactile-accent-swatch tactile-accent-custom"
                title="Custom colour"
                style={{ backgroundImage: `url(${colorPickerIcon})` }}
              >
                <input
                  type="color"
                  value={hexOk(themeAccent) ? themeAccent : "#C97B4A"}
                  onChange={(e) => pickThemeAccent(e.target.value)}
                />
              </label>
            </div>
          </div>

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

        <CollapsibleSection id="analysisTags" title="Analysis Tags" open={!!openSections.analysisTags} onToggle={() => toggle("analysisTags")}>
          <div className="settings-item">
            <div className="settings-info" style={{ marginBottom: 10 }}>
              Rename the five (or more) active-reading slots. Frontmatter keys become lowercase versions
              of these names. The Gate still requires every slot + aq_written — only the names change.
            </div>
            {analysisTags.map((tag, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <input
                  type="text"
                  value={tag}
                  onChange={(e) => {
                    const next = [...analysisTags];
                    next[i] = e.target.value;
                    setAnalysisTags(next);
                  }}
                  style={{ flex: 1 }}
                  aria-label={`Analysis tag ${i + 1}`}
                />
                <span className="mono muted" style={{ fontSize: 11, minWidth: 72 }}>
                  {tagToKey(tag)}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const defaults = analysisDefaults.length ? analysisDefaults : [...DEFAULT_ANALYSIS_TAGS];
                    const next = [...analysisTags];
                    next[i] = defaults[i] || defaults[0] || "Claim";
                    setAnalysisTags(next);
                  }}
                >
                  Reset
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setAnalysisTags((t) => [...t, "New Tag"])}
              >
                + Add tag
              </button>
              <button
                type="button"
                className="btn"
                disabled={analysisTags.length <= 5}
                onClick={() => setAnalysisTags((t) => (t.length > 5 ? t.slice(0, -1) : t))}
              >
                − Remove last
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setAnalysisTags(analysisDefaults.length ? [...analysisDefaults] : [...DEFAULT_ANALYSIS_TAGS])}
              >
                Reset all
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={analysisSaving}
                onClick={async () => {
                  setAnalysisSaving(true);
                  setAnalysisMsg(null);
                  try {
                    const r = await api.analysisTags.set(analysisTags, false, true);
                    setAnalysisTags(r.analysis_tags);
                    setCachedAnalysisTags(r.analysis_tags);
                    if (r.migration?.mapping && Object.keys(r.migration.mapping).length) {
                      setPendingMigration({
                        mapping: r.migration.mapping,
                        counts: r.migration.counts || {},
                        warning: r.migration.warning,
                      });
                      setAnalysisMsg(r.migration.warning || "Tags saved. Vault keys need migration.");
                    } else {
                      setPendingMigration(null);
                      setAnalysisMsg("Analysis tags saved.");
                    }
                  } catch (e) {
                    setAnalysisMsg(e instanceof Error ? e.message : "Save failed");
                  } finally {
                    setAnalysisSaving(false);
                  }
                }}
              >
                {analysisSaving ? "…" : "Save tags"}
              </button>
            </div>
            {pendingMigration && (
              <div className="settings-info" style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 8 }}>
                  Rename frontmatter keys in batch?
                  {" "}
                  {Object.entries(pendingMigration.mapping).map(([o, n]) => (
                    <span key={o} className="mono" style={{ marginRight: 8 }}>
                      {o}→{n} ({pendingMigration.counts[o] || 0})
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={analysisSaving}
                  onClick={async () => {
                    setAnalysisSaving(true);
                    try {
                      const r = await api.analysisTags.migrate(pendingMigration.mapping, false);
                      setPendingMigration(null);
                      setAnalysisMsg(`Migrated ${r.changed.length} note(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ""}.`);
                    } catch (e) {
                      setAnalysisMsg(e instanceof Error ? e.message : "Migration failed");
                    } finally {
                      setAnalysisSaving(false);
                    }
                  }}
                >
                  Migrate vault keys
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ marginLeft: 8 }}
                  onClick={() => setPendingMigration(null)}
                >
                  Keep old keys (warn only)
                </button>
              </div>
            )}
            {analysisMsg && <div className="settings-info" style={{ marginTop: 8 }}>{analysisMsg}</div>}
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="taskStatuses" title="Task Statuses" open={!!openSections.taskStatuses} onToggle={() => toggle("taskStatuses")}>
          <div className="settings-item">
            <div className="settings-info" style={{ marginBottom: 10 }}>
              Customize the statuses used by the Tasks List status pill and Kanban columns. The
              icon/shape always differentiates status — color is a secondary accent only, so
              everything still reads correctly in grayscale or print.
            </div>
            {taskStatuses.map((s, i) => (
              <div key={s.id || `new-${i}`} className="task-status-edit-row">
                <button
                  type="button"
                  className="btn"
                  title="Cycle icon/shape"
                  onClick={() => {
                    const next = [...taskStatuses];
                    next[i] = { ...s, icon: cycleIcon(s.icon) };
                    setTaskStatuses(next);
                  }}
                >
                  {STATUS_ICON_GLYPH[s.icon]}
                </button>
                <input
                  type="text"
                  value={s.name}
                  placeholder="Status name"
                  onChange={(e) => {
                    const next = [...taskStatuses];
                    next[i] = { ...s, name: e.target.value };
                    setTaskStatuses(next);
                  }}
                  style={{ flex: 1 }}
                  aria-label={`Status ${i + 1} name`}
                />
                <input
                  type="color"
                  value={s.color}
                  title="Color (secondary accent only)"
                  onChange={(e) => {
                    const next = [...taskStatuses];
                    next[i] = { ...s, color: e.target.value };
                    setTaskStatuses(next);
                  }}
                />
                <span className="muted mono" style={{ fontSize: 11, minWidth: 60 }}>
                  {taskStatusUsage[s.id] || 0} task{(taskStatusUsage[s.id] || 0) === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="btn btn-crit"
                  disabled={taskStatuses.length <= 1}
                  title={taskStatuses.length <= 1 ? "At least one status is required" : "Delete this status"}
                  onClick={() => {
                    if (taskStatuses.length <= 1) return;
                    const count = taskStatusUsage[s.id] || 0;
                    if (count === 0) {
                      setTaskStatuses(taskStatuses.filter((_, j) => j !== i));
                    } else {
                      const remaining = taskStatuses.filter((_, j) => j !== i);
                      setPendingReassign({
                        statusId: s.id,
                        statusName: s.name,
                        count,
                        chooseTo: remaining[0]?.id || "",
                      });
                    }
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setTaskStatuses((prev) => [
                    ...prev,
                    { id: "", name: "New Status", color: "#6B7280", order: prev.length, icon: STATUS_ICON_CYCLE[prev.length % STATUS_ICON_CYCLE.length] },
                  ])
                }
              >
                + Add Status
              </button>

              <button
                type="button"
                className="btn btn-primary"
                disabled={taskStatusesSaving}
                onClick={() => saveTaskStatuses()}
              >
                {taskStatusesSaving ? "…" : "Save statuses"}
              </button>
            </div>
            {pendingReassign && (
              <div className="settings-info" style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 8 }}>
                  {pendingReassign.count} task(s) use &quot;{pendingReassign.statusName}&quot; — reassign to:
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    value={pendingReassign.chooseTo}
                    onChange={(e) => setPendingReassign({ ...pendingReassign, chooseTo: e.target.value })}
                  >
                    {taskStatuses.filter((s) => s.id !== pendingReassign.statusId).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={taskStatusesSaving}
                    onClick={() => saveTaskStatuses({ [pendingReassign.statusId]: pendingReassign.chooseTo })}
                  >
                    Reassign &amp; delete
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPendingReassign(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {taskStatusesMsg && <div className="settings-info" style={{ marginTop: 8 }}>{taskStatusesMsg}</div>}
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
                placeholder={info.desktop ? "~/Documents/Yggdrasil" : "/vault"}
                style={{ flex: 1 }}
              />
              {info.desktop && (
                <button type="button" className="btn" onClick={pickDataFolder}>
                  Choose folder…
                </button>
              )}
              {!info.desktop && info.availablePaths && info.availablePaths.length > 0 && (
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
              {info.desktop
                ? (firstRun || info.dataPathChosen === false
                  ? "Choose this first so papers, notes, tasks, and LaTeX files have a home on this Mac. Then click Save."
                  : "Papers, notes, tasks, and LaTeX files are saved in this folder.")
                : <>Prefer in-container paths like <code>/vault</code>. Host paths are not reachable from Docker.</>}
            </div>
            {info.desktop && probe?.existingData && (
              <div className="settings-info" style={{ marginTop: 10 }}>
                Existing Yggdrasil data found
                {probe.previousAppVersion ? ` (v${probe.previousAppVersion})` : ""}.
                {typeof probe.latexFileCount === "number" ? ` ${probe.latexFileCount} LaTeX file(s) on disk.` : ""}
                {" "}Nothing will be overwritten.
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      const path = probe.vaultPath || settings.latexDir;
                      handleSettingChange("latexDir", path);
                      setSaving(true);
                      setSaveMsg(null);
                      try {
                        const data = await persistServerSettings(path);
                        setSaveMsg(data.ok === false ? (data.message || "Could not restore.") : (data.message || "Restored existing data."));
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                  >
                    Restore from existing data
                  </button>
                </div>
              </div>
            )}
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
          <div className="about-copyright">
            <div className="about-copyright-title">Yggdrasil</div>
            <div>{APP_COPYRIGHT}</div>
            <div>Owner: {APP_OWNER}</div>
            <div>License: {APP_LICENSE}</div>
            <p className="about-copyright-legal">
              Permission is hereby granted, free of charge, to use, copy, modify, and
              distribute this software, subject to the MIT License. The software is
              provided “as is”, without warranty of any kind.
            </p>
          </div>
          <div className="settings-info">
            {info.vaultPath && <div>📁 Vault: {info.vaultPath}</div>}
            {info.texVersion && <div>🔧 TeX: {info.texVersion}</div>}
            {info.diskFree && <div>💾 Disk Free: {(info.diskFree / 1024 / 1024 / 1024).toFixed(1)} GB</div>}
          </div>
        </CollapsibleSection>
        </div>

        <div className="settings-footer">
          <button type="button" className="btn btn-primary" onClick={saveAllSettings} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {saveMsg && <span className="ok mono" style={{ fontSize: 12 }}>{saveMsg}</span>}
        </div>
      </div>
    </div>
  );
}
