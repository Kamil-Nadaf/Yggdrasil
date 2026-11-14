<template>
  <div class="pptist-editor">
    <EditorHeader class="layout-header" />
    <div class="layout-content">
      <Thumbnails v-show="leftOpen" class="layout-content-left" />
      <button type="button" class="yg-side-toggle yg-left" :class="{ closed: !leftOpen }" :style="{ left: leftOpen ? '160px' : '0px' }"
        :title="leftOpen ? 'Hide slide list' : 'Show slide list'" @click="toggleLeft()">{{ leftOpen ? '‹' : '›' }}</button>
      <div class="layout-content-center" :style="{ width: centerWidth }">
        <CanvasTool class="center-top" />
        <Canvas class="center-body" :style="{ height: `calc(100% - ${remarkHeight + 40}px)` }" />
        <Remark
          class="center-bottom" 
          v-model:height="remarkHeight" 
          :style="{ height: `${remarkHeight}px` }"
        />
      </div>
      <button type="button" class="yg-side-toggle yg-right" :class="{ closed: !rightOpen }" :style="{ right: rightOpen ? '260px' : '0px' }"
        :title="rightOpen ? 'Hide design panel' : 'Show design panel'" @click="toggleRight()">{{ rightOpen ? '›' : '‹' }}</button>
      <Toolbar v-show="rightOpen" class="layout-content-right" />
    </div>
  </div>

  <SelectPanel v-if="showSelectPanel" />
  <SearchPanel v-if="showSearchPanel" />
  <NotesPanel v-if="showNotesPanel" />
  <MarkupPanel v-if="showMarkupPanel" />
  <SymbolPanel v-if="showSymbolPanel" />
  <ImageLibPanel v-if="showImageLibPanel" />
  <ChartDataEditorDialog />
  <LatexEditorDialog />

  <Modal
    :visible="!!dialogForExport" 
    :width="680"
    @closed="closeExportDialog()"
  >
    <ExportDialog />
  </Modal>

  <Modal
    :visible="!!showAIPPTDialog" 
    :width="720"
    :closeOnClickMask="false"
    :closeOnEsc="false"
    closeButton
    :wrapStyle="{ opacity: showAIPPTDialog === 'running' ? 0 : 1 }"
    @closed="closeAIPPTDialog()"
  >
    <AIPPTDialog />
  </Modal>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'
import useGlobalHotkey from '@/hooks/useGlobalHotkey'
import usePasteEvent from '@/hooks/usePasteEvent'

import EditorHeader from './EditorHeader/index.vue'
import Canvas from './Canvas/index.vue'
import CanvasTool from './CanvasTool/index.vue'
import Thumbnails from './Thumbnails/index.vue'
import Toolbar from './Toolbar/index.vue'
import Remark from './Remark/index.vue'
import ChartDataEditorDialog from './ChartDataEditorDialog.vue'
import LatexEditorDialog from './LatexEditorDialog.vue'
import ExportDialog from './ExportDialog/index.vue'
import SelectPanel from './SelectPanel.vue'
import SearchPanel from './SearchPanel.vue'
import NotesPanel from './NotesPanel.vue'
import SymbolPanel from './SymbolPanel.vue'
import MarkupPanel from './MarkupPanel.vue'
import ImageLibPanel from './ImageLibPanel.vue'
import AIPPTDialog from './AIPPTDialog.vue'
import Modal from '@/components/Modal.vue'

const mainStore = useMainStore()
const {
  dialogForExport,
  showSelectPanel,
  showSearchPanel,
  showNotesPanel,
  showSymbolPanel,
  showMarkupPanel,
  showImageLibPanel,
  showAIPPTDialog,
} = storeToRefs(mainStore)

const closeExportDialog = () => mainStore.setDialogForExport('')
const closeAIPPTDialog = () => mainStore.setAIPPTDialogState(false)

const remarkHeight = ref(40)

// Collapsible side panels (state remembered per browser).
const rd = (k: string) => { try { return localStorage.getItem(k) !== '0' } catch { return true } }
const wr = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0') } catch { /* ignore */ } }
const leftOpen = ref(rd('yggdrasil:slides-left'))
const rightOpen = ref(rd('yggdrasil:slides-right'))
const relayout = () => setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
const toggleLeft = () => { leftOpen.value = !leftOpen.value; wr('yggdrasil:slides-left', leftOpen.value); relayout() }
const toggleRight = () => { rightOpen.value = !rightOpen.value; wr('yggdrasil:slides-right', rightOpen.value); relayout() }
const centerWidth = computed(() => `calc(100% - ${leftOpen.value ? 160 : 0}px - ${rightOpen.value ? 260 : 0}px)`)

useGlobalHotkey()
usePasteEvent()
</script>

<style lang="scss" scoped>
.pptist-editor {
  height: 100%;
}
.layout-header {
  height: 40px;
}
.layout-content {
  height: calc(100% - 40px);
  display: flex;
  position: relative;
}
.yg-side-toggle {
  position: absolute;
  top: 50%;
  z-index: 20;
  width: 14px;
  height: 44px;
  margin-top: -22px;
  padding: 0;
  border: 1px solid var(--yg-border, #d9d9d4);
  background: var(--yg-surface, #fff);
  color: var(--yg-text, #141414);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: .6;
}
.yg-side-toggle:hover { opacity: 1; }
.yg-left { border-left: 0; transform: translateX(-1px); }
.yg-right { border-right: 0; transform: translateX(1px); }
.layout-content-left {
  width: 160px;
  height: 100%;
  flex-shrink: 0;
}
.layout-content-center {
  width: calc(100% - 160px - 260px);

  .center-top {
    height: 40px;
  }
}
.layout-content-right {
  width: 260px;
  height: 100%;
}
</style>
