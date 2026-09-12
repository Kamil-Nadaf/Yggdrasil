import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import {
  type AiProviderId,
  type AiProviderConfig,
  PROVIDER_META,
  loadProviderStore,
  saveProviderStore,
  getActiveProviderId,
  setActiveProviderId,
} from "../lib/aiProvider";

interface SettingsState {
  theme: "dark" | "light" | "paper";
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
    theme: (localStorage.getItem("theme") as any) || "dark",
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
    ai: true,
    account: false,
    editor: false,
    data: false,
    git: false,
    webdav: false,
    about: false,
  });

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

  useEffect(() => {
    if (!open) return;
    fetch("/api/info").then((r) => r.json()).then(setInfo).catch(() => {});
    refreshGitStatus();
    refreshWebdavStatus();
    setProviderStore(loadProviderStore());
    setActiveProvider(getActiveProviderId());
  }, [open]);

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

  const handleThemeChange = (theme: SettingsState["theme"]) => {
    setSettings((s) => ({ ...s, theme }));
    localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  };

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
            <div className="settings-radio">
              {["dark", "light", "paper"].map((t) => (
                <div key={t} className="settings-radio-item">
                  <input
                    type="radio"
                    id={`theme-${t}`}
                    name="theme"
                    value={t}
                    checked={settings.theme === t}
                    onChange={() => handleThemeChange(t as any)}
                  />
                  <label htmlFor={`theme-${t}`} style={{ margin: 0, cursor: "pointer" }}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </label>
                </div>
              ))}
            </div>
          </div>
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
