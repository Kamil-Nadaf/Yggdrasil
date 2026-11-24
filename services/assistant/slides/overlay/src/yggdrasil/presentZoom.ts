// Zoom + pan while presenting. Ctrl/Cmd + wheel (or trackpad pinch) zooms at the pointer, + / - / 0 on the keyboard,
// drag to pan once zoomed, buttons at the top right. Works by transforming the slide list, so the slides themselves are untouched.
const MIN = 1
const MAX = 6
let z = 1, tx = 0, ty = 0
let list: HTMLElement | null = null
let bar: HTMLElement | null = null
let label: HTMLElement | null = null

const host = () => document.querySelector('.pptist-screen') as HTMLElement | null
const getList = () => document.querySelector('.pptist-screen .screen-slide-list') as HTMLElement | null

function clamp() {
  const h = host(); if (!h) return
  const w = h.clientWidth, ht = h.clientHeight
  tx = Math.min(0, Math.max(w - w * z, tx))
  ty = Math.min(0, Math.max(ht - ht * z, ty))
}
function apply() {
  if (!list) return
  clamp()
  list.style.transformOrigin = '0 0'
  list.style.transform = z === 1 ? '' : `translate(${tx}px, ${ty}px) scale(${z})`
  if (label) label.textContent = `${Math.round(z * 100)}%`
  if (bar) bar.classList.toggle('zoomed', z > 1)
  const h = host(); if (h) h.style.cursor = z > 1 ? 'grab' : ''
}
function zoomAt(nz: number, cx: number, cy: number) {
  nz = Math.min(MAX, Math.max(MIN, nz))
  if (nz === z) return
  tx = cx - (cx - tx) * (nz / z)
  ty = cy - (cy - ty) * (nz / z)
  z = nz
  if (z === 1) { tx = 0; ty = 0 }
  apply()
}
const center = () => { const h = host(); return h ? [h.clientWidth / 2, h.clientHeight / 2] : [0, 0] }
const step = (f: number) => { const [cx, cy] = center(); zoomAt(z * f, cx, cy) }
const reset = () => { z = 1; tx = 0; ty = 0; apply() }

function ensureBar() {
  const h = host()
  if (!h) { list = null; bar = null; label = null; if (z !== 1 || tx || ty) { z = 1; tx = 0; ty = 0 } return false }
  list = getList()
  if (!bar || !bar.isConnected) {
    bar = document.createElement('div')
    bar.className = 'ygg-present-zoom'
    bar.innerHTML = '<button data-a="out" title="Zoom out (-)">−</button><span class="pct">100%</span><button data-a="in" title="Zoom in (+, or Ctrl/Cmd + scroll)">+</button><button data-a="reset" title="Reset zoom (0)">Reset</button>'
    label = bar.querySelector('.pct')
    bar.addEventListener('click', (e) => {
      e.stopPropagation()
      const a = (e.target as HTMLElement).dataset.a
      if (a === 'in') step(1.25); else if (a === 'out') step(0.8); else if (a === 'reset') reset()
    })
    for (const ev of ['mousedown', 'wheel', 'dblclick']) bar.addEventListener(ev, (e) => e.stopPropagation())
    h.appendChild(bar)
  }
  return true
}

export function startPresentZoom() {
  const style = document.createElement('style')
  style.textContent = `.ygg-present-zoom{position:fixed;top:10px;right:10px;z-index:50;display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:6px;background:rgba(20,20,20,.75);color:#fff;font:12px system-ui,sans-serif;opacity:.5;transition:opacity .2s}
.ygg-present-zoom:hover,.ygg-present-zoom.zoomed{opacity:1}
.ygg-present-zoom button{background:transparent;border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:4px;padding:1px 8px;cursor:pointer;font:inherit}
.ygg-present-zoom button:hover{background:rgba(255,255,255,.2)}
.ygg-present-zoom .pct{min-width:40px;text-align:center}`
  document.head.appendChild(style)

  new MutationObserver(() => { ensureBar() }).observe(document.body, { childList: true, subtree: true })

  window.addEventListener('wheel', (e: WheelEvent) => {
    if (!ensureBar()) return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); e.stopPropagation()
      zoomAt(z * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
    }
    else if (z > 1) {
      e.preventDefault(); e.stopPropagation()
      tx -= e.deltaX; ty -= e.deltaY; apply()
    }
  }, { capture: true, passive: false })

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!ensureBar() || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    if (e.key === '+' || e.key === '=') { e.preventDefault(); e.stopPropagation(); step(1.25) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); e.stopPropagation(); step(0.8) }
    else if (e.key === '0' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); reset() }
  }, true)

  let drag: { x: number; y: number; moved: boolean } | null = null
  window.addEventListener('mousedown', (e: MouseEvent) => {
    if (z <= 1 || e.button !== 0 || !ensureBar()) return
    drag = { x: e.clientX, y: e.clientY, moved: false }
    const h = host(); if (h) h.style.cursor = 'grabbing'
  }, true)
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!drag) return
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    drag.moved = true; drag.x = e.clientX; drag.y = e.clientY
    tx += dx; ty += dy; apply()
  }, true)
  window.addEventListener('mouseup', () => {
    const h = host(); if (h && z > 1) h.style.cursor = 'grab'
    const moved = drag?.moved
    drag = null
    // a drag must not count as a click (clicks advance the slide)
    if (moved) { const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault() }; window.addEventListener('click', stop, { capture: true, once: true }) }
  }, true)
}
