// The host app (Yggdrasil) posts its current theme colours so the editor chrome matches it, also after a theme switch.
const MAP: Record<string, string> = {
  bg: '--yg-bg',
  surface: '--yg-surface',
  surface2: '--yg-surface2',
  border: '--yg-border',
  text: '--yg-text',
  muted: '--yg-muted',
  accent: '--yg-accent',
  accentText: '--yg-accent-text',
}

export function startThemeSync() {
  window.addEventListener('message', e => {
    const d = e.data
    if (!d || d.source !== 'yggdrasil-host' || d.type !== 'theme' || typeof d.vars !== 'object') return
    const root = document.documentElement
    for (const k of Object.keys(MAP)) {
      const v = d.vars[k]
      if (typeof v === 'string' && v.trim()) root.style.setProperty(MAP[k], v.trim())
    }
  })
  try { window.parent?.postMessage({ source: 'yggdrasil-slides', type: 'theme-ready' }, '*') } catch { /* standalone */ }
}
