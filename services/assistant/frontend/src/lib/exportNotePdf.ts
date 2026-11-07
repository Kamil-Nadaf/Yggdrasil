import { api } from "../api/client";
import { listNoteImages, markdownToLatexDocument } from "./markdownToLatex";
import { resolveRelativePath } from "./pastedImages";

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** gif / webp / svg can't go into pdfLaTeX — rasterize them to PNG in the browser first. */
async function rasterizeToPng(blob: Blob): Promise<ArrayBuffer | null> {
  try {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png ? await png.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/**
 * Compile a note to PDF. A line with only `---` starts a new page. Images the note references
 * (relative to `imageBase`) are fetched from the vault and shipped with the compile request.
 */
export async function exportNoteToPdf(source: string, title: string, imageBase: string): Promise<string> {
  const images: Record<string, string> = {};
  const assets: Record<string, string> = {};

  let n = 0;
  for (const src of listNoteImages(source)) {
    if (/^(https?:|data:)/i.test(src)) continue;
    try {
      let rel = src;
      try { rel = decodeURIComponent(src); } catch { /* keep raw */ }
      const resolved = src.startsWith("/") ? src.replace(/^\/api\/notes\/assets\//, "") : resolveRelativePath(imageBase, rel);
      const resp = await fetch("/api/notes/assets/" + resolved.split("/").map(encodeURIComponent).join("/"));
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const ext = (resolved.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
      let data: ArrayBuffer | null = null;
      let outExt = ext === "jpeg" ? "jpg" : ext;
      if (["png", "jpg", "pdf"].includes(outExt)) {
        data = await blob.arrayBuffer();
      } else {
        data = await rasterizeToPng(blob);
        outExt = "png";
      }
      if (!data) continue;
      const name = `img${++n}.${outExt}`;
      assets[name] = bufferToBase64(data);
      images[src] = name;
    } catch {
      /* unreadable image → placeholder text in the PDF */
    }
  }

  const tex = markdownToLatexDocument(source, title, { images });
  const result = await api.latex.compile(tex, `${title || "note"}-export`, assets);
  return result.pdf_b64;
}
