/** Update check for the phone app. The app files inside an APK never change, so "latest" must come from GitHub releases. */
const REPO = 'Kamil-Nadaf/Yggdrasil';

export interface Release { version: string; url: string; apk: string; notes: string }

const parts = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
export function isNewer(latest: string, current: string): boolean {
  const [a, b] = [parts(latest), parts(current)];
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

export async function latestRelease(fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<Release | null> {
  const r = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  const apk = (j.assets || []).find((a: { name: string }) => /android\.apk$/i.test(a.name));
  return { version: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url, apk: apk?.browser_download_url || '', notes: String(j.body || '').slice(0, 400) };
}

/** Open a link in the phone's browser when the Capacitor Browser plugin is bundled, else the WebView/window. */
export function openExternal(url: string) {
  const cap = (window as unknown as { Capacitor?: { nativePromise?: (p: string, m: string, o: object) => Promise<unknown> } }).Capacitor;
  if (cap?.nativePromise) cap.nativePromise('Browser', 'open', { url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank');
}

export type UpdateCheck =
  | { kind: 'app'; release: Release }          // a newer release exists on GitHub: install the new APK
  | { kind: 'reload' }                         // this page is served by a server that has a newer build
  | { kind: 'latest'; version: string };

export async function checkForUpdate(): Promise<UpdateCheck> {
  let rel: Release | null = null;
  try { rel = await latestRelease(); } catch { /* offline or rate-limited: fall through to the server check */ }
  if (rel && isNewer(rel.version, __APP_VERSION__)) return { kind: 'app', release: rel };
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) { const { build } = (await r.json()) as { build: string }; if (build && build !== __BUILD__) return { kind: 'reload' }; }
  } catch { /* no server copy to compare with */ }
  if (!rel) throw new Error('Could not check for updates. Are you online?');
  return { kind: 'latest', version: __APP_VERSION__ };
}

export async function applyReload(): Promise<void> {
  const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
  await Promise.all(regs.map((g) => g.unregister()));
  for (const k of await caches.keys()) if (k !== 'ygg-pdf') await caches.delete(k);
  location.reload();
}
