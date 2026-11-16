<template>
  <template v-if="slides.length">
    <Screen v-if="screening" />
    <Editor v-else-if="_isPC && !viewOnly" />
    <Mobile v-else />
  </template>
  <FullscreenSpin tip="Loading deck ..." v-else loading :mask="false" />
</template>

<script lang="ts" setup>
import { onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { nanoid } from 'nanoid'
import { debounce } from 'lodash'
import { useScreenStore, useMainStore, useSnapshotStore, useSlidesStore } from '@/store'
import { LOCALSTORAGE_KEY_DISCARDED_DB } from '@/configs/storage'
import { deleteDiscardedDB } from '@/utils/database'
import { isPC } from '@/utils/common'
import api from '@/services'
import { loadDeck, saveDeck, tell, hasDeck, viewOnly, autoPresent } from '@/yggdrasil/bridge'
import useImport from '@/hooks/useImport'
import { hfmath } from '@/components/LaTeXEditor/hfmath'

import Editor from './views/Editor/index.vue'
import Screen from './views/Screen/index.vue'
import Mobile from './views/Mobile/index.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'

const _isPC = isPC()
const { importPPTXFile, importSpecificFile, importJSON } = useImport()


const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const snapshotStore = useSnapshotStore()
const screenStore = useScreenStore()
const { databaseId } = storeToRefs(mainStore)
const { slides, title, theme, viewportSize, viewportRatio } = storeToRefs(slidesStore)
const { screening } = storeToRefs(screenStore)

const isAudienceMode = new URLSearchParams(window.location.search).get('mode') === 'audience'

let loaded = false
const save = debounce(async () => {
  if (!loaded || !hasDeck || viewOnly) return
  try {
    await saveDeck({
      title: title.value,
      theme: theme.value,
      slides: slides.value,
      viewportSize: viewportSize.value,
      viewportRatio: viewportRatio.value,
    })
    tell('saved')
  }
  catch (e) { tell('error', { message: String(e) }) }
}, 1500)

onMounted(async () => {
  if (isAudienceMode) {
    slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
    screenStore.setScreening(true)
    return
  }
  let deck = null
  try { deck = await loadDeck() }
  catch (e) { tell('error', { message: String(e) }) }

  if (deck && Array.isArray(deck.slides) && deck.slides.length) {
    if (deck.viewportSize) slidesStore.setViewportSize(deck.viewportSize)
    if (deck.viewportRatio) slidesStore.setViewportRatio(deck.viewportRatio)
    slidesStore.setTitle(deck.title || 'Untitled')
    slidesStore.setSlides(deck.slides, deck.theme)
  }
  else {
    const mock = await api.getMockData('slides')
    slidesStore.setSlides(hasDeck ? [{ id: nanoid(10), elements: [] }] : mock)
  }
  loaded = true

  // The host page hands over a file picked outside the editor (Import button / Decks list).
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data
    if (!d || d.source !== 'yggdrasil-host' || d.type !== 'import' || !d.file) return
    const file = d.file as File
    const cover = !!d.cover
    const name = (file.name || '').toLowerCase()
    if (name.endsWith('.pptx')) importPPTXFile([file], { cover })
    else if (name.endsWith('.pptist')) importSpecificFile([file], cover)
    else if (name.endsWith('.json')) importJSON([file], cover)
  })

  // Handwriting written on the slide by the host: recognised there, placed here where it was written.
  // d.rect is the written area in this frame's client pixels; it is mapped through the slide's on-screen box.
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data
    if (!d || d.source !== 'yggdrasil-host' || d.type !== 'place') return
    try {
      // `.viewport` is a zero-size box scaled from its top-left corner, so its position is the slide's origin and its transform is the scale.
      const vp = document.querySelector('.viewport') as HTMLElement | null
      const r = vp?.getBoundingClientRect()
      const k = parseFloat((vp?.style.transform.match(/scale\(([\d.]+)\)/) || [])[1] || '0')
      // The host measures in its own pixels; scale to this frame's pixels in case the page is zoomed.
      const fx = d.stage && d.stage.w ? window.innerWidth / d.stage.w : 1
      const fy = d.stage && d.stage.h ? window.innerHeight / d.stage.h : 1
      const rect = d.rect && r && k ? {
        left: (d.rect.x * fx - r.left) / k,
        top: (d.rect.y * fy - r.top) / k,
        width: (d.rect.w * fx) / k,
        height: (d.rect.h * fy) / k,
      } : null
      const id = nanoid(10)
      if (d.kind === 'formula' && typeof d.latex === 'string' && d.latex.trim()) {
        const eq = new hfmath(d.latex)
        const box = eq.box({})
        const w = box.w + 32, h = box.h + 32
        let f = 1
        if (rect) f = Math.min(3, Math.max(0.3, rect.width / w))
        const left = rect ? rect.left : (viewportSize.value - w) / 2
        const top = rect ? rect.top : (viewportSize.value * viewportRatio.value - h) / 2
        slidesStore.addElement({
          type: 'latex', id, width: w * f, height: h * f, rotate: 0, left, top,
          path: eq.pathd({}), latex: d.latex, color: theme.value.fontColor, strokeWidth: 2,
          viewBox: [w, h], fixedRatio: true,
        } as any)
      }
      else if (d.kind === 'text' && typeof d.text === 'string' && d.text.trim()) {
        const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const lines: string[] = d.text.split('\n')
        const html = lines.map((l) => `<p>${esc(l)}</p>`).join('')
        slidesStore.addElement({
          type: 'text', id, rotate: 0,
          left: rect ? rect.left : 120, top: rect ? rect.top : 120,
          width: rect ? Math.max(rect.width + 40, 240) : 560,
          height: rect ? Math.max(rect.height, 40 * lines.length) : 40 * lines.length + 20,
          content: html, defaultFontName: theme.value.fontName, defaultColor: theme.value.fontColor,
        } as any)
      }
      else return
      mainStore.setActiveElementIdList([id])
      tell('placed', { kind: d.kind })
    }
    catch (err) { tell('error', { message: String(err) }) }
  })

  await deleteDiscardedDB()
  snapshotStore.initSnapshotDatabase()

  watch([slides, title, theme, viewportSize, viewportRatio], () => save(), { deep: true })
  if (autoPresent || viewOnly) screenStore.setScreening(true)
  tell('ready')
})

// Cmd/Ctrl+S: save the deck right now (it also autosaves 1.5 s after every change).
function saveNow() {
  if (!loaded) return
  save()
  save.flush()
}
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveNow()
  }
}, true)
window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data
  if (d && d.source === 'yggdrasil-host' && d.type === 'save') saveNow()
})

window.addEventListener('beforeunload', () => {
  save.flush()
  const discardedDB = localStorage.getItem(LOCALSTORAGE_KEY_DISCARDED_DB)
  const discardedDBList: string[] = discardedDB ? JSON.parse(discardedDB) : []
  discardedDBList.push(databaseId.value)
  localStorage.setItem(LOCALSTORAGE_KEY_DISCARDED_DB, JSON.stringify(discardedDBList))
})
</script>

<style lang="scss">
#app {
  height: 100%;
}
</style>
