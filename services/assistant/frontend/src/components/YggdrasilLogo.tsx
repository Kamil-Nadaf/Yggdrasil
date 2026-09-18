/** The Yggdrasil logo — the actual artwork at /yggdrasil-logo.png, shown
 * as-is by default. Two layers are stacked so colour mode can switch with
 * pure CSS (see `.logo-original` / `.logo-tint` in index.css, driven by
 * `[data-logo-mode]` on <html>, set from lib/logoTheme.ts):
 *  - `.logo-original`: the real image, untouched.
 *  - `.logo-tint`: the same image used as a mask, filled with one colour.
 * Nothing here redraws or approximates the artwork. */

interface Props {
  size?: number;
  className?: string;
}

export default function YggdrasilLogo({ size = 32, className }: Props) {
  return (
    <span
      className={`ygg-logo${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
    >
      <img className="logo-original" src="/yggdrasil-logo.png" alt="Yggdrasil" width={size} height={size} />
      <span className="logo-tint" aria-hidden="true" />
    </span>
  );
}
