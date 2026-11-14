// Runtime English UI for PPTist (upstream is Chinese-only). Only UI chrome is touched:
// slide content, text being edited and anything the user typed are left exactly as they are.
import { A } from './zh-en-a'
import { B } from './zh-en-b'

const DICT: Record<string, string> = { ...B, ...A }
const HAN = /[一-鿿]/
// Substring replacement only uses keys of 2+ characters, longest first, so short words never corrupt other text.
const KEYS = Object.keys(DICT).filter(k => k.length >= 2).sort((a, b) => b.length - a.length)

const SKIP = [
  '.ProseMirror', '[contenteditable="true"]', '.editable-element', '.base-element', '.thumbnail', '.screen-slide',
  '.slide-content', '.element-content', '.viewport', '.table-element', '.chart-element', 'textarea', 'script', 'style',
].join(',')

export function translate(text: string): string {
  if (!HAN.test(text)) return text
  const lead = text.match(/^\s*/)![0]
  const tail = text.match(/\s*$/)![0]
  const core = text.trim()
  const hit = DICT[core]
  if (hit !== undefined) return lead + hit + tail
  let out = core
    .replace(/第\s*(\d+)\s*页/g, 'Slide $1')
    .replace(/幻灯片\s*(\d+)\s*\/\s*(\d+)/g, 'Slide $1 / $2')
    .replace(/幻灯片\s*(\d+)/g, 'Slide $1')
  for (const k of KEYS) if (out.includes(k)) out = out.split(k).join(DICT[k])
  return lead + out + tail
}

function skip(node: Node): boolean {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement
  return !!el && !!el.closest(SKIP)
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'data-placeholder']

function fixNode(node: Node) {
  if (node.nodeType === 3) {
    const t = node as Text
    if (t.nodeValue && HAN.test(t.nodeValue) && !skip(t)) {
      const v = translate(t.nodeValue)
      if (v !== t.nodeValue) t.nodeValue = v
    }
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element
  // Placeholder text lives on editor elements that are otherwise skipped, so always translate it.
  for (const a of ['data-placeholder', 'placeholder']) {
    const v = el.getAttribute(a)
    if (v && HAN.test(v)) { const n = translate(v); if (n !== v) el.setAttribute(a, n) }
  }
  if (skip(el)) return
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v && HAN.test(v)) { const n = translate(v); if (n !== v) el.setAttribute(a, n) }
  }
  if (el instanceof HTMLInputElement && el.value && HAN.test(el.value) && el.type === 'button') el.value = translate(el.value)
  el.childNodes.forEach(fixNode)
}

export function startEnglish() {
  document.documentElement.lang = 'en'
  document.title = 'Slides'
  fixNode(document.body)
  let queued = false
  const pending = new Set<Node>()
  const flush = () => {
    queued = false
    pending.forEach(n => { if (n.isConnected) fixNode(n) })
    pending.clear()
  }
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(n => pending.add(n))
      else pending.add(m.target)
    }
    if (!queued) { queued = true; requestAnimationFrame(flush) }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}
