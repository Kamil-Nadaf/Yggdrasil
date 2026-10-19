/** Helpers for pasting / dropping images into the Markdown and LaTeX editors. */

const IMAGE_EXTS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** Image files carried by a paste or drop (screenshots, copied images, dragged files). */
export function imageFilesFrom(data: DataTransfer | null | undefined, allowed?: string[]): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const file of Array.from(data.files ?? [])) {
    const ext = imageExt(file);
    if (ext && (!allowed || allowed.includes(ext))) files.push(file);
  }
  return files;
}

export function imageExt(file: File): string | null {
  const fromType = IMAGE_EXTS[file.type];
  if (fromType) return fromType;
  const m = file.name.toLowerCase().match(/\.(png|jpe?g|gif|webp|svg)$/);
  if (!m) return null;
  return m[1] === "jpeg" ? "jpg" : m[1];
}

/** Filesystem-safe unique name. Pasted screenshots are all called "image.png", so stamp them. */
export function imageFileName(file: File, index = 0): string {
  const ext = imageExt(file) ?? "png";
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const generic = !base || /^(image|screenshot|pasted|untitled)$/i.test(base);
  const suffix = index > 0 ? `-${index + 1}` : "";
  return generic ? `image-${stamp}${suffix}.${ext}` : `${base}-${stamp}${suffix}.${ext}`;
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Resolve a relative markdown image path against a note's folder, e.g. ("Notes/a", "../assets/x.png") → "Notes/assets/x.png". */
export function resolveRelativePath(baseDir: string, rel: string): string {
  const out = baseDir.split("/").filter(Boolean);
  for (const part of rel.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}
