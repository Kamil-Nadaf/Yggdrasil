// Small source patches applied to the upstream PPTist checkout (see build.sh).
import fs from 'node:fs'
import path from 'node:path'
const root = process.argv[2]
const f = path.join(root, 'src/views/Editor/Toolbar/SlideDesignPanel/index.vue')
let s = fs.readFileSync(f, 'utf8')
const re = /<div class="canvas-size">[^\n]*<\/div>/
if (!re.test(s)) throw new Error('canvas-size line not found in SlideDesignPanel/index.vue')
s = s.replace(re, '<CanvasSizeInline />')
s = s.replace("import ViewportSizeSetting from './ViewportSizeSetting.vue'", "import ViewportSizeSetting from './ViewportSizeSetting.vue'\nimport CanvasSizeInline from './CanvasSizeInline.vue'")
if (!s.includes('CanvasSizeInline from')) throw new Error('import anchor not found')
fs.writeFileSync(f, s)
console.log('patched SlideDesignPanel')

// Toolbar "Image" upload: store GIFs with the project (animated, and not a multi-MB data: URL inside the deck JSON).
{
  const g = path.join(root, 'src/views/Editor/CanvasTool/index.vue')
  let t = fs.readFileSync(g, 'utf8')
  const from = "getImageDataURL(imageFile).then(dataURL => createImageElement(dataURL))"
  if (!t.includes(from)) throw new Error('insertImageElement body not found in CanvasTool/index.vue')
  t = t.replace(from, "if (imageFile.type === 'image/gif') {\n    uploadMedia(imageFile).then(url => url ? createImageElement(url) : getImageDataURL(imageFile).then(createImageElement)).catch(() => getImageDataURL(imageFile).then(createImageElement))\n    return\n  }\n  " + from)
  t = t.replace("import { getImageDataURL } from '@/utils/image'", "import { getImageDataURL } from '@/utils/image'\nimport { uploadMedia } from '@/yggdrasil/bridge'")
  if (!t.includes("import { uploadMedia }")) throw new Error('image import anchor not found')
  fs.writeFileSync(g, t)
  console.log('patched CanvasTool image upload')
}
