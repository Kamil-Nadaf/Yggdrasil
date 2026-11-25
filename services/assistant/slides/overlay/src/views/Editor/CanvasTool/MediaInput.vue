<template>
  <div class="media-input">
    <Tabs 
      :tabs="tabs" 
      v-model:value="type" 
      :tabsStyle="{ marginBottom: '15px' }" 
    />

    <template v-if="type === 'video'">
      <Input v-model:value="videoSrc" placeholder="Video or GIF address, e.g. https://example.com/clip.mp4"></Input>
      <div class="hint">Local files are stored with the project, so they stay after you reload. Video: MP4 / WebM / OGG play everywhere (MOV only in Safari). GIFs are placed as animated images.</div>
      <div class="btns">
        <FileInput accept="video/*,image/gif,.gif,.mp4,.webm,.ogv,.mov,.m4v" @change="files => uploadVideo(files)">
          <Button :disabled="busy"><i-icon-park-outline:upload /> {{ busy ? 'Uploading…' : 'Upload video or GIF' }}</Button>
        </FileInput>
        <div class="group">
          <Button @click="emit('close')" style="margin-right: 10px;">Cancel</Button>
          <Button type="primary" :disabled="busy" @click="insertVideo()">Confirm</Button>
        </div>
      </div>
    </template>

    <template v-if="type === 'audio'">
      <Input v-model:value="audioSrc" placeholder="Audio address, e.g. https://example.com/clip.mp3"></Input>
      <div class="btns">
        <FileInput accept="audio/*" @change="files => uploadAudio(files)">
          <Button :disabled="busy"><i-icon-park-outline:upload /> {{ busy ? 'Uploading…' : 'Upload audio' }}</Button>
        </FileInput>
        <div class="group">
          <Button @click="emit('close')" style="margin-right: 10px;">Cancel</Button>
          <Button type="primary" :disabled="busy" @click="insertAudio()">Confirm</Button>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import message from '@/utils/message'
import { MIME_MAP } from '@/configs/mime'
import useCreateElement from '@/hooks/useCreateElement'
import { uploadMedia } from '@/yggdrasil/bridge'
import Tabs from '@/components/Tabs.vue'
import Input from '@/components/Input.vue'
import Button from '@/components/Button.vue'
import FileInput from '@/components/FileInput.vue'

type TypeKey = 'video' | 'audio'
interface TabItem {
  key: TypeKey
  label: string
}

const emit = defineEmits<{
  (event: 'insertVideo', payload: { src: string, ext?: string }): void
  (event: 'insertAudio', payload: { src: string, ext?: string }): void
  (event: 'close'): void
}>()

const { createImageElement } = useCreateElement()

const type = ref<TypeKey>('video')
const busy = ref(false)

const videoSrc = ref('')
const audioSrc = ref('')

const tabs: TabItem[] = [
  { key: 'video', label: 'Video / GIF' },
  { key: 'audio', label: 'Audio' },
]

const EXT_MIME: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', gif: 'image/gif' }
const extOf = (name: string) => (name.split(/[?#]/)[0].split('.').pop() || '').toLowerCase()
const isGif = (src: string, file?: File) => (file ? file.type === 'image/gif' || extOf(file.name) === 'gif' : extOf(src) === 'gif' || src.startsWith('data:image/gif'))

const insertVideo = () => {
  const src = videoSrc.value.trim()
  if (!src) return message.error('Enter a video or GIF address first')
  if (isGif(src)) { createImageElement(src); emit('close'); return }
  emit('insertVideo', { src })
}

const insertAudio = () => {
  const src = audioSrc.value.trim()
  if (!src) return message.error('Enter an audio address first')
  emit('insertAudio', { src })
}

// Store the file with the project; fall back to a temporary blob URL only when no deck is open.
const store = async (file: File) => {
  try {
    return (await uploadMedia(file)) || URL.createObjectURL(file)
  }
  catch (e) {
    message.error(String((e as Error).message || e))
    return null
  }
}

const uploadVideo = async (files: FileList) => {
  const file = files[0]
  if (!file || busy.value) return
  busy.value = true
  const src = await store(file)
  busy.value = false
  if (!src) return
  if (isGif('', file)) { createImageElement(src); emit('close'); return }
  const ext = MIME_MAP[file.type] || MIME_MAP[EXT_MIME[extOf(file.name)] || ''] || extOf(file.name)
  emit('insertVideo', { src, ext })
}

const uploadAudio = async (files: FileList) => {
  const file = files[0]
  if (!file || busy.value) return
  busy.value = true
  const src = await store(file)
  busy.value = false
  if (!src) return
  emit('insertAudio', { src, ext: MIME_MAP[file.type] || extOf(file.name) })
}
</script>

<style lang="scss" scoped>
.media-input {
  width: 480px;
}
.hint {
  margin-top: 8px;
  font-size: 12px;
  opacity: .65;
  line-height: 1.4;
}
.btns {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
}
</style>
