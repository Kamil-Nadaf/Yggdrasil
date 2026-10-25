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
    try {
      const blob = await (await fetch(url)).blob();
      await save(filename, await blobToBase64(blob));
    } catch (e) {
      console.error("Native save failed, falling back to browser download", e);
      anchorDownload(url, filename);
    }
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
