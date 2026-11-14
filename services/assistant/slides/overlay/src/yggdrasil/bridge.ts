// Loads/saves the open deck through the Yggdrasil API (decks live in 50-Projects/<slug>/slides/<name>.json).
import type { Slide, SlideTheme } from '@/types/slides'

export interface DeckFile {
  title: string
  theme?: SlideTheme
  slides: Slide[]
  viewportSize?: number
  viewportRatio?: number
}

const params = new URLSearchParams(window.location.search)
export const project = params.get('project') || ''
export const deckName = params.get('deck') || ''
export const viewOnly = params.get('mode') === 'view'
export const autoPresent = params.get('present') === '1'
export const hasDeck = !!(project && deckName)

const url = () => `/api/projects/${encodeURIComponent(project)}/slides/${encodeURIComponent(deckName)}`

export async function loadDeck(): Promise<DeckFile | null> {
  if (!hasDeck) return null
  const res = await fetch(url())
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Load failed (${res.status})`)
  return await res.json()
}

export async function saveDeck(deck: DeckFile): Promise<void> {
  if (!hasDeck || viewOnly) return
  const res = await fetch(url(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deck),
  })
  if (!res.ok) throw new Error(`Save failed (${res.status})`)
}

export function tell(type: string, extra: Record<string, unknown> = {}) {
  try { window.parent?.postMessage({ source: 'yggdrasil-slides', type, ...extra }, '*') } catch { /* standalone */ }
}

// The toolbar's "fit to screen" button also toggles full-window mode: the host page enlarges this iframe over the app
// (the canvas fit itself still runs). Esc or the same button leaves it.
let fullWindow = false
function setFull(on: boolean) {
  fullWindow = on
  tell('fullscreen', { on })
  setTimeout(() => window.dispatchEvent(new Event('resize')), 150)
}
if (typeof document !== 'undefined' && window.parent !== window) {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null
    if (t?.closest?.('.viewport-size-adaptation')) setFull(!fullWindow)
  }, true)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fullWindow && !document.fullscreenElement) setFull(false)
  })
}
