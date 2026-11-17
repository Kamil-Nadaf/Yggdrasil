import { useState } from "react";
import BookIcon from "./BookIcons";

interface Props {
  /** The reader's own key: an arXiv id, or `book-{slug}` for a Collection item. */
  fileKey: string;
  /** Public PDF URL, used when the app has no saved copy yet. */
  url?: string;
  name: string;
  /** Papers start converting at once. Books are only added: they can be long, so you start them in Tools. */
  kind: "paper" | "book";
  onResult?: (text: string, ok: boolean) => void;
  /** Icon-only, for toolbars. */
  iconOnly?: boolean;
  disabled?: boolean;
}

/** Sends a document to Tools → PDF → Markdown. */
export default function ConvertButton({ fileKey, url = "", name, kind, onResult, iconOnly, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"" | "added" | "converting">("");

  async function go(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/tools/pdf/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: fileKey, url, name, kind }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not add to Convert");
      try {
        localStorage.setItem("yggdrasil:pdf-select", body.file.id);
        localStorage.setItem("yggdrasil:tools-page", "pdf");
      } catch { /* ignore */ }
      const running = body.file.status === "running";
      setState(running ? "converting" : "added");
      onResult?.(
        body.existed
          ? running ? "Already in Tools → PDF, converting now" : "Already in Tools → PDF"
          : running ? "Added to Tools → PDF. Converting in the background ✓" : "Added to Tools → PDF. Open it there to start converting ✓",
        true,
      );
    } catch (err) {
      onResult?.(err instanceof Error ? err.message : "Could not add to Convert", false);
    } finally {
      setBusy(false);
    }
  }

  const title = kind === "paper" ? "Convert to Markdown / LaTeX (starts in the background)" : "Add to Convert (start it in Tools → PDF)";
  if (iconOnly) {
    return (
      <button type="button" className={`pdfv-ib${state ? " on" : ""}`} onClick={go} disabled={busy || disabled} title={title} aria-label="Convert">
        <BookIcon name="convert" size={17} />
      </button>
    );
  }
  return (
    <button type="button" className="btn" onClick={go} disabled={busy || disabled} title={title}>
      {busy ? "Adding…" : state === "converting" ? "⇄ Converting…" : state === "added" ? "⇄ Added" : "⇄ Convert"}
    </button>
  );
}
