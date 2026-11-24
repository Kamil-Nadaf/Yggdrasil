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
