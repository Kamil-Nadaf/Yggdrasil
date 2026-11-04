/** Browser-side helpers for imported books. */

export interface PdfProbe {
  pages: number;
  title: string;
  author: string;
  cover: Blob | null;
}

/** Page count, embedded title/author and a first-page JPEG for the library cover. Never throws. */
export async function probePdf(file: File): Promise<PdfProbe | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    let title = "";
    let author = "";
    try {
      const meta = await doc.getMetadata();
      const info = meta.info as { Title?: string; Author?: string };
      title = (info.Title || "").trim();
      author = (info.Author || "").trim();
    } catch {
      /* metadata is optional */
    }
    let cover: Blob | null = null;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 360 / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport }).promise;
        cover = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82));
      }
    } catch {
      /* a missing cover falls back to the typographic one */
    }
    const pages = doc.numPages;
    void doc.destroy();
    return { pages, title, author, cover };
  } catch {
    return null;
  }
}

export function titleFromFilename(name: string): string {
  return name
    .replace(/\.(pdf|epub)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** DOI / arXiv id printed on the first two pages of a PDF (e.g. the arXiv margin stamp), for automatic metadata lookup. */
export async function findIdentifier(file: File): Promise<{ doi?: string; arxiv?: string } | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let text = "";
    for (let i = 1; i <= Math.min(2, doc.numPages); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += " " + content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    }
    void doc.destroy();
    const arx = text.match(/arXiv:\s*(\d{4}\.\d{4,5})(?:v\d+)?/i) || text.match(/arXiv:\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7})/i);
    const doi = text.match(/\b(10\.\d{4,9}\/[^\s"<>,;]+[^\s"<>,;.)\]])/);
    if (!arx && !doi) return null;
    return { arxiv: arx?.[1], doi: doi?.[1] };
  } catch {
    return null;
  }
}
