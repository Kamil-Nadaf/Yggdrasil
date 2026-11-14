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

  await deleteDiscardedDB()
  snapshotStore.initSnapshotDatabase()

  watch([slides, title, theme, viewportSize, viewportRatio], () => save(), { deep: true })
  if (autoPresent || viewOnly) screenStore.setScreening(true)
  tell('ready')
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
