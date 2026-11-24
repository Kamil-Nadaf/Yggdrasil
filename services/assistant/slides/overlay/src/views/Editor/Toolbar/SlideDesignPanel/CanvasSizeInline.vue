<template>
  <div class="canvas-size-inline">
    <div class="lbl">Canvas size (px)</div>
    <div class="fields">
      <input type="number" v-model.number="w" :min="MIN" :max="MAX" aria-label="Canvas width" @keydown.enter.prevent="apply" @blur="apply" />
      <span class="x">×</span>
      <input type="number" v-model.number="h" :min="MIN" :max="MAX" aria-label="Canvas height" @keydown.enter.prevent="apply" @blur="apply" />
    </div>
    <div class="hint">{{ MIN }} – {{ MAX }}. Elements keep their size and position.</div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSlidesStore } from '@/store'
import message from '@/utils/message'

const MIN = 200
const MAX = 6000
const store = useSlidesStore()
const { viewportRatio, viewportSize } = storeToRefs(store)
const round = (n: number) => Math.round(n * 100) / 100
const w = ref(round(viewportSize.value))
const h = ref(round(viewportSize.value * viewportRatio.value))
watch([viewportSize, viewportRatio], () => {
  w.value = round(viewportSize.value)
  h.value = round(viewportSize.value * viewportRatio.value)
})

const apply = () => {
  const nw = Number(w.value), nh = Number(h.value)
  if (!isFinite(nw) || !isFinite(nh) || nw < MIN || nw > MAX || nh < MIN || nh > MAX) {
    message.warning(`Canvas width and height must be between ${MIN} and ${MAX}`)
    w.value = round(viewportSize.value)
    h.value = round(viewportSize.value * viewportRatio.value)
    return
  }
  if (nw === round(viewportSize.value) && nh === round(viewportSize.value * viewportRatio.value)) return
  store.setViewportSize(nw)
  store.setViewportRatio(nh / nw)
}
</script>

<style lang="scss" scoped>
.canvas-size-inline { width: 100%; }
.lbl { font-size: 12px; margin-bottom: 6px; opacity: .75; }
.fields { display: flex; align-items: center; gap: 8px; }
.fields input { flex: 1; min-width: 0; padding: 4px 6px; font: inherit; border: 1px solid #d9d9d9; border-radius: 4px; background: #fff; color: inherit; }
.x { opacity: .6; }
.hint { font-size: 11px; opacity: .6; margin-top: 4px; }
</style>
