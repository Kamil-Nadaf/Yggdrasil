// Build-time English pass over PPTist's *data* (things the runtime DOM translator cannot reach because they end up
// inside slides / charts / canvas-drawn spreadsheets). Usage: node translate-source.mjs <pptist-checkout>
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
if (!root) { console.error('usage: translate-source.mjs <pptist dir>'); process.exit(1) }

// 1) Source literals (chart defaults, import/export labels).
const patches = [
  ['src/configs/chart.ts', [[/类别(\d)/g, 'Category $1'], [/系列(\d)/g, 'Series $1'], [/坐标(\d)/g, 'Axis $1'], [/'值'/g, "'Value'"]]],
  ['src/hooks/useImport.ts', [[/坐标\$\{/g, 'Axis ${'], [/系列\$\{/g, 'Series ${']]],
  ['src/hooks/useExport.ts', [[/系列\$\{/g, 'Series ${'], [/坐标\$\{/g, 'Axis ${']]],
]
for (const [file, rules] of patches) {
  const p = path.join(root, file)
  if (!fs.existsSync(p)) { console.warn('skip (missing):', file); continue }
  let s = fs.readFileSync(p, 'utf8')
  for (const [re, to] of rules) s = s.replace(re, to)
  fs.writeFileSync(p, s)
}

// 2) Template / sample slide JSON text. Phrase table, longest first; repeated filler units get a trailing space.
const PHRASES = [
  ['模板小节过渡标题', 'Template section title'], ['模板小节过渡正文', 'Section body text '],
  ['模板封面标题', 'Template cover title'], ['模板封面正文', 'Cover body text '],
  ['模板内容页标题', 'Template content title'], ['模板过渡标题', 'Template transition title'],
  ['封面页副标题', 'Cover subtitle '], ['封面页主标题', 'Cover title'], ['封面页标题', 'Cover title'],
  ['过渡页副标题', 'Transition subtitle '], ['过渡页正文', 'Transition body text '], ['过渡页标题', 'Transition title'],
  ['内容项标题', 'Item title'], ['内容项正文', 'Body text '], ['内容页标题', 'Content title'], ['在此输入标题', 'Enter title here'],
  ['商务汇报|工作总结|工作计划', 'Business report | Summary | Plan'],
  ['演讲人：', 'Speaker: '], ['汇报人：', 'Presenter: '], ['日期：', 'Date: '], ['时间：', 'Time: '],
  ['谢谢聆听', 'Thank you'], ['谢谢观看', 'Thank you'], ['感谢倾听', 'Thank you'], ['感谢您的观看', 'Thank you'],
  ['感谢聆听', 'Thank you'], ['感谢观看', 'Thank you'], ['欢迎观看', 'Welcome'], ['未命名演示文稿', 'Untitled presentation'],
  ['目录项十', 'Contents item 10'], ['目录项九', 'Contents item 9'], ['目录项八', 'Contents item 8'], ['目录项七', 'Contents item 7'],
  ['目录项六', 'Contents item 6'], ['目录项五', 'Contents item 5'], ['目录项四', 'Contents item 4'], ['目录项三', 'Contents item 3'],
  ['目录项二', 'Contents item 2'], ['目录项一', 'Contents item 1'], ['目录项 六', 'Contents item 6'],
  ['目录项', 'Contents item '], ['项目', 'Item '], ['目录', 'Contents'],
  // truncated filler fragments and phrases split across spans (lowest priority)
  ['页副标题', 'subtitle '], ['模板封面', 'Cover '], ['内容项', 'Item '], ['模板', 'Template '],
  ['感谢', 'Thank '], ['你的', 'you for '], ['观看', 'watching'],
  ['✨项目特点', 'Features'], ['代码可控：', 'Code you control: '], ['功能丰富：', 'Feature-rich: '], ['易使用：', 'Easy to use: '], ['易开发：', 'Easy to develop: '],
]
const SINGLE = [['目', 'Con'], ['录', 'tents']] // the vertical "目 / 录" title halves

function fixText(s) {
  s = s.replace(/&nbsp;/g, ' ')
  for (const [zh, en] of PHRASES) if (s.includes(zh)) s = s.split(zh).join(en)
  return s
}
function fixJsonStrings(raw) {
  // Work inside JSON string values only so keys and structure stay untouched.
  return raw.replace(/"((?:[^"\\]|\\.)*)"/g, (m, body) => (/[一-鿿]/.test(body) ? `"${fixText(body)}"` : m))
}
const mocks = path.join(root, 'public', 'mocks')
if (fs.existsSync(mocks)) {
  for (const f of fs.readdirSync(mocks)) {
    if (!/^template_\d+\.json$/.test(f)) continue
    const p = path.join(mocks, f)
    let raw = fixJsonStrings(fs.readFileSync(p, 'utf8'))
    // Large title halves: font shrinks so "Contents" still fits the original box.
    raw = raw.replace(/(font-size:\s*)(\d+)(px[^"]*?>)(Contents)</g, (m, a, n, b, c) => `${a}${Math.round(Number(n) * 0.6)}${b}${c}<`)
    for (const [zh, en] of SINGLE) raw = raw.split(`>${zh}<`).join(`>${en}<`)
    fs.writeFileSync(p, raw)
  }
}
// Anything left over is reported so the next pass knows what to add.
let left = 0
if (fs.existsSync(mocks)) {
  for (const f of fs.readdirSync(mocks)) {
    if (!/^template_\d+\.json$/.test(f)) continue
    const m = fs.readFileSync(path.join(mocks, f), 'utf8').match(/[一-鿿]+/g)
    if (m) { left += m.length; console.warn(`translate-source: ${f} still has`, [...new Set(m)].slice(0, 8).join(' ')) }
  }
}
console.log(`translate-source: done (${left} Chinese fragments left in templates)`)
