type DesktopSaveApi = { save_file?: (filename: string, b64: string) => Promise<string> };

function desktopApi(): DesktopSaveApi | undefined {
  return (window as unknown as { pywebview?: { api?: DesktopSaveApi } }).pywebview?.api;
}

function anchorDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Save a blob/object URL. In the desktop app (pywebview) the browser-style
 * <a download> does nothing, so we use the native Save dialog instead.
 */
export function downloadBlobUrl(url: string, filename: string) {
  const save = desktopApi()?.save_file;
  if (!save) {
    anchorDownload(url, filename);
    return;
  }
  void (async () => {
    let b64 = "";
    try {
      const blob = await (await fetch(url)).blob();
      b64 = await blobToBase64(blob);
      // 1) native "Save as…" dialog; returns "" if the user cancelled.
      await save(filename, b64);
      return;
    } catch (e) {
      console.error("Native save dialog failed", e);
    }
    try {
      // 2) let the local server drop the file into ~/Downloads.
      const res = await fetch("/api/desktop/save-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, b64 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { path } = (await res.json()) as { path: string };
      window.alert(`Saved to ${path}`);
      return;
    } catch (e) {
      console.error("Server-side save failed", e);
    }
    // 3) last resort: browser-style download.
    anchorDownload(url, filename);
  })();
}

export function downloadBase64(b64: string, filename: string, mime: string) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  downloadBlobUrl(url, filename);
  // Revoke later: the desktop path reads the blob asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
