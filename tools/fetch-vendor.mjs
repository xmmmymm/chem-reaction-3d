// 下载离线依赖到 _vendor/，并把 KaTeX 的字体 url() 内联为 base64 data URI
// 用法: node tools/fetch-vendor.mjs
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const V = join(ROOT, '_vendor')
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist'

const FILES = [
  ['three.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'],
  ['OrbitControls.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'],
  ['tailwind.min.js', 'https://cdn.tailwindcss.com'],
  ['katex.min.js', `${KATEX}/katex.min.js`],
  ['katex-auto-render.min.js', `${KATEX}/contrib/auto-render.min.js`],
]

// 只保留 woff2（现代浏览器全支持），woff/ttf 是老浏览器回退，去掉可省一半以上体积
const FONTS = [
  'KaTeX_AMS-Regular', 'KaTeX_Caligraphic-Bold', 'KaTeX_Caligraphic-Regular',
  'KaTeX_Fraktur-Bold', 'KaTeX_Fraktur-Regular', 'KaTeX_Main-Bold',
  'KaTeX_Main-BoldItalic', 'KaTeX_Main-Italic', 'KaTeX_Main-Regular',
  'KaTeX_Math-BoldItalic', 'KaTeX_Math-Italic', 'KaTeX_SansSerif-Bold',
  'KaTeX_SansSerif-Italic', 'KaTeX_SansSerif-Regular', 'KaTeX_Script-Bold',
  'KaTeX_Script-Regular', 'KaTeX_Size1-Regular', 'KaTeX_Size2-Regular',
  'KaTeX_Size3-Regular', 'KaTeX_Size4-Regular', 'KaTeX_Typewriter-Regular',
].map((f) => `${f}.woff2`)

async function get(url, tries = 3) {
  let last
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      last = e
      if (i < tries) await new Promise((s) => setTimeout(s, 800 * i))
    }
  }
  throw last
}

await mkdir(join(V, 'fonts'), { recursive: true })

const jobs = [
  ...FILES.map(([n, u]) => [join(V, n), u, true]),
  ...FONTS.map((f) => [join(V, 'fonts', f), `${KATEX}/fonts/${f}`, false]),
]

let ok = 0, bytes = 0
for (const [dest, url, required] of jobs) {
  try {
    const buf = await get(url)
    await writeFile(dest, buf)
    bytes += buf.length
    ok++
  } catch (e) {
    console.warn(`  MISSING ${url.split('/').pop()} — ${e.message}`)
    if (required) process.exitCode = 1
  }
}

// KaTeX CSS: url(fonts/X.woff2) -> base64; 并删除 woff/ttf 回退声明
let css = (await get(`${KATEX}/katex.min.css`)).toString('utf8')
const before = css.length

css = css.replace(
  /url\(\s*fonts\/([A-Za-z0-9_-]+\.woff2)\s*\)\s*format\(\s*["']?woff2["']?\s*\)/g,
  (m, file) => {
    try {
      const b = readFileSync(join(V, 'fonts', file))
      return `url(data:font/woff2;base64,${b.toString('base64')})format("woff2")`
    } catch { return m }
  }
)
// 去掉已无字体文件的 woff / truetype 回退
css = css.replace(/\s*,\s*url\(\s*fonts\/[^)]+\.(?:woff|ttf)\s*\)\s*format\(\s*["']?(?:woff|truetype)["']?\s*\)/g, '')
const leftovers = (css.match(/url\(\s*fonts\//g) || []).length

await writeFile(join(V, 'katex.min.css'), css)
console.log(`downloaded ${ok}/${jobs.length} files, ${(bytes / 1048576).toFixed(2)} MB`)
console.log(`katex.min.css  ${(before / 1024).toFixed(0)} KB -> ${(css.length / 1024).toFixed(0)} KB (fonts inlined, leftovers=${leftovers})`)

for (const [n] of FILES) {
  try {
    const s = await readFile(join(V, n))
    console.log(`  ${n.padEnd(28)} ${(s.length / 1024).toFixed(0)} KB`)
  } catch { console.log(`  ${n.padEnd(28)} MISSING`) }
}
