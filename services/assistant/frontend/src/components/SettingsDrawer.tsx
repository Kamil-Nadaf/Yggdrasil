import { useEffect, useState } from "react";
import { api } from "../api/client";

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

export default function SettingsDrawer({ open, onClose }: Props) {
  const [settings, setSettings] = useState<SettingsState>(() => ({
    theme: (localStorage.getItem("theme") as any) || "dark",
    fontSize: parseInt(localStorage.getItem("fontSize") || "13"),
    tabWidth: parseInt(localStorage.getItem("tabWidth") || "2"),
    lineWrap: localStorage.getItem("lineWrap") !== "false",
    autoCompile: localStorage.getItem("autoCompile") === "true",
    userAccount: localStorage.getItem("userAccount") || "",
    latexDir: localStorage.getItem("latexDir") || "/Users/kamil/Projects/Yggdrasil/data",
  }));

  const [info, setInfo] = useState<SystemInfo>({});
  const [saving, setSaving] = useState(false);

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
    fetch("/api/info")
      .then(r => r.json())
      .then(setInfo)
      .catch(() => {});
    refreshGitStatus();
    refreshWebdavStatus();
  }, []);

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
    setSettings(s => ({ ...s, theme }));
    localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  };

  const handleSettingChange = (key: keyof SettingsState, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    localStorage.setItem(key, String(value));
  };

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

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>

        {/* Appearance */}
        <div className="settings-section">
          <h3>Appearance</h3>
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
        </div>

        {/* Account */}
        <div className="settings-section">
          <h3>Account</h3>
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
        </div>

        {/* Editor */}
        <div className="settings-section">
          <h3>Editor</h3>
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
        </div>

        {/* Data */}
        <div className="settings-section">
          <h3>Data</h3>
          <div className="settings-item">
            <label htmlFor="latexDir">Data Path</label>
            <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
              <input
                id="latexDir"
                type="text"
                value={settings.latexDir}
                onChange={(e) => handleSettingChange("latexDir", e.target.value)}
                placeholder="/vault/70-LaTeX"
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
              The browser cannot directly browse your local machine filesystem. Choose one of the folders already mounted into the container, or type a mounted path such as /vault/70-LaTeX.
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={handleSaveLatexDir} disabled={saving}>
                {saving ? "…" : "Save"}
              </button>
            </div>
          </div>
        </div>

        {/* Data Sync (Git) */}
        <div className="settings-section">
          <h3>Data Sync (Git)</h3>
          <div className="settings-item">
            <label htmlFor="gitRemote">Remote URL</label>
            <input
              id="gitRemote"
              type="text"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://<token>@github.com/you/vault-backup.git"
            />
            <div className="settings-info" style={{ marginTop: 8 }}>
              Syncs the vault (papers, briefs, LaTeX docs) to your own git remote with full
              commit history — separate from Syncthing. For HTTPS, embed a personal access
              token in the URL as shown (no credentials are stored server-side). SSH remotes
              need a key mounted into the <code>assistant</code> container.
            </div>
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
            {gitStatus?.is_repo && (
              <div className="settings-info" style={{ marginTop: 10 }}>
                {gitStatus.branch && <div>Branch: {gitStatus.branch}</div>}
                <div>Uncommitted changes: {gitStatus.dirty_files ?? 0}</div>
                {gitStatus.last_commit && <div>Last commit: {gitStatus.last_commit}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Data Sync (Cloud / WebDAV) */}
        <div className="settings-section">
          <h3>Data Sync (Cloud / WebDAV)</h3>
          <div className="settings-item">
            <div className="settings-info" style={{ marginBottom: 10 }}>
              There's no way to link a Google or iCloud <em>account</em> directly (that needs
              an OAuth app registration we don't have). What works without any of that is
              <strong> WebDAV</strong> — supported by Nextcloud, ownCloud, Koofr, and most
              self-hosted "personal cloud" boxes. Point it at your WebDAV endpoint and an app
              password and every sync mirrors the vault there.
            </div>
            <label htmlFor="webdavUrl">WebDAV URL</label>
            <input
              id="webdavUrl"
              type="text"
              value={webdavUrl}
              onChange={(e) => setWebdavUrl(e.target.value)}
              placeholder="https://cloud.example.com/remote.php/dav/files/you"
            />
            <label htmlFor="webdavUser" style={{ marginTop: 8 }}>Username</label>
            <input
              id="webdavUser"
              type="text"
              value={webdavUser}
              onChange={(e) => setWebdavUser(e.target.value)}
              placeholder="username"
            />
            <label htmlFor="webdavPass" style={{ marginTop: 8 }}>Password / App Token</label>
            <input
              id="webdavPass"
              type="password"
              value={webdavPass}
              onChange={(e) => setWebdavPass(e.target.value)}
              placeholder={webdavStatus?.configured ? "•••••••• (leave blank to keep current)" : "app password"}
            />
            <label htmlFor="webdavDir" style={{ marginTop: 8 }}>Remote Folder</label>
            <input
              id="webdavDir"
              type="text"
              value={webdavDir}
              onChange={(e) => setWebdavDir(e.target.value)}
              placeholder="yggdrasil-vault"
            />
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
            {webdavStatus?.last_sync && (
              <div className="settings-info" style={{ marginTop: 10 }}>
                Last synced: {new Date(webdavStatus.last_sync).toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* About */}
        <div className="settings-section">
          <h3>About</h3>
          <div className="settings-info">
            {info.vaultPath && <div>📁 Vault: {info.vaultPath}</div>}
            {info.texVersion && <div>🔧 TeX: {info.texVersion}</div>}
            {info.diskFree && <div>💾 Disk Free: {(info.diskFree / 1024 / 1024 / 1024).toFixed(1)} GB</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
