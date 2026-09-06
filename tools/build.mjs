// 构建：
//   dist/高中化学方程式可视化.html   —— 单文件全离线（双击即用，断网可用）
//   dist-src/                        —— 可维护源码（player.js + data/*.js，file:// 直开）
// 用法: node tools/build.mjs
import { readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const V = join(ROOT, '_vendor')
const DIST = join(ROOT, 'dist')
const DIST_SRC = join(ROOT, 'dist-src')

const r = (p) => readFile(p, 'utf8')
const rb = (p) => readFile(p)

console.log('读取素材…')
const shell = await r(join(ROOT, 'src', 'shell.html'))
const styles = await r(join(ROOT, 'src', 'styles.css'))
const skeleton = await r(join(ROOT, 'src', 'skeleton.html'))
const playerJs = await r(join(ROOT, 'src', 'player.js'))
const katexCss = await r(join(V, 'katex.min.css'))

const threeJs = await r(join(V, 'three.min.js'))
const orbitJs = await r(join(V, 'OrbitControls.js'))
const katexJs = await r(join(V, 'katex.min.js'))
const autoRenderJs = await r(join(V, 'katex-auto-render.min.js'))
const tailwindJs = await r(join(V, 'tailwind.min.js'))
const fontsCss = katexCss // 字体已内联为 data URI

// ---- 组装数据：BOOKS 顺序 = manifest ----
const manifest = JSON.parse(await r(join(ROOT, 'src', 'data', 'manifest.json')))
const books = []
// 数据文件是 window.CHEM_DATA[..] = {...}; 且内容含 '='（方程里有等号），不能切片解析 —— 用沙箱执行
const sandbox = { window: {} }
vm.createContext(sandbox)
for (const m of manifest) {
  const txt = await r(join(ROOT, 'src', 'data', m.file.replace(/^data\//, '')))
  vm.runInContext(txt, sandbox)
  books.push(sandbox.window.CHEM_DATA[m.book])
}
if (books.some((b) => !b)) throw new Error('部分分册数据加载失败')
const dataObj = `{ __books: ${JSON.stringify(books)} }`
const dataScript = `<script>window.CHEM_DATA = ${dataObj};</script>`
console.log(`  ${books.length} 册 / ${books.reduce((s, b) => s + b.chapters.reduce((t, c) => t + c.reactions.length, 0), 0)} 个方程`)

// ---- 附加 shell 需要的 tab 样式 ----
const EXTRA_CSS = `
        .tab-active { background: var(--accent); color: #fff; border-color: var(--accent); }
        .tab-idle { background: #fff; color: #475569; border-color: #e2e8f0; }
        .tab-idle:hover { border-color: var(--accent); color: var(--accent); }
        .chap-active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); font-weight: 600; }
        .chap-idle { background: #fff; color: #64748b; border-color: #e2e8f0; }
        .chap-idle:hover { border-color: var(--accent); color: var(--accent); }
        #search-overlay { position: fixed; }
`

// 注意：必须用函数形式替换 —— 依赖库里含 $& / $' 等序列，字符串形式会被当成替换模式解析
const rep = (s, token, val) => s.replace(token, () => val)

// ---- 1) 单文件全离线版 ----
let html = shell
html = rep(html, '<!--STYLE_KATEX-->', `<style>\n${fontsCss}\n</style>`)
html = rep(html, '<!--STYLE_APP-->', `<style>\n${styles}${EXTRA_CSS}\n</style>`)
html = rep(html, '<!--SKELETON-->', skeleton)
html = rep(html, '<!--DATA-->', dataScript)
html = rep(html, '<!--VENDOR_KATEX_JS-->', `<script>${katexJs}</script>`)
html = rep(html, '<!--VENDOR_THREE-->', `<script>${threeJs}</script>`)
html = rep(html, '<!--VENDOR_ORBIT-->', `<script>${orbitJs}</script>`)
html = rep(html, '<!--VENDOR_AUTORENDER-->', `<script>${autoRenderJs}</script>`)
html = rep(html, '<!--VENDOR_TAILWIND-->', `<script>${tailwindJs}</script>`)
html = rep(html, '<!--PLAYER_JS-->', `<script>${playerJs}</script>`)

// 安全检查：不应再有未替换的占位符
const leftover = html.match(/<!--(STYLE_|VENDOR_|SKELETON|DATA|PLAYER_)/g)
if (leftover) throw new Error('未替换的占位符: ' + leftover.join(', '))
// 安全检查：不应再有外链
const extRef = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/g)
if (extRef) throw new Error('单文件版仍存在外链 ' + extRef.length + ' 处: ' + extRef.slice(0, 3).join(' , '))

await mkdir(DIST, { recursive: true })
const outFile = join(DIST, '高中化学方程式可视化.html')
await writeFile(outFile, html, 'utf8')
console.log(`\n[单文件] ${outFile}`)
console.log(`         ${(html.length / 1048576).toFixed(2)} MB`)

// ---- 2) 可维护源码版（player.js + data/*.js + vendor/*.js，file:// 直接打开，同样离线）----
await rm(DIST_SRC, { recursive: true, force: true })
await mkdir(join(DIST_SRC, 'data'), { recursive: true })
await mkdir(join(DIST_SRC, 'vendor'), { recursive: true })

// vendor 依赖落盘为独立文件（便于升级/替换），源码版同样不依赖网络
for (const f of ['three.min.js', 'OrbitControls.js', 'katex.min.js', 'katex-auto-render.min.js', 'tailwind.min.js', 'katex.min.css']) {
  await copyFile(join(V, f), join(DIST_SRC, 'vendor', f))
}

let srcHtml = shell
srcHtml = rep(srcHtml, '<!--STYLE_KATEX-->', `<link rel="stylesheet" href="vendor/katex.min.css">`)
srcHtml = rep(srcHtml, '<!--STYLE_APP-->', `<style>\n${styles}${EXTRA_CSS}\n</style>`)
srcHtml = rep(srcHtml, '<!--SKELETON-->', skeleton)
srcHtml = rep(srcHtml, '<!--DATA-->',
  manifest.map((m) => `<script src="data/${m.file.replace(/^data\//, '')}"></script>`).join('\n') +
  `\n<script>window.CHEM_DATA.__books = ${JSON.stringify(manifest.map((m) => m.book))}.map(function(b){return window.CHEM_DATA[b];});</script>`)
srcHtml = rep(srcHtml, '<!--VENDOR_KATEX_JS-->', `<script src="vendor/katex.min.js"></script>`)
srcHtml = rep(srcHtml, '<!--VENDOR_THREE-->', `<script src="vendor/three.min.js"></script>`)
srcHtml = rep(srcHtml, '<!--VENDOR_ORBIT-->', `<script src="vendor/OrbitControls.js"></script>`)
srcHtml = rep(srcHtml, '<!--VENDOR_AUTORENDER-->', `<script src="vendor/katex-auto-render.min.js"></script>`)
srcHtml = rep(srcHtml, '<!--VENDOR_TAILWIND-->', `<script src="vendor/tailwind.min.js"></script>`)
srcHtml = rep(srcHtml, '<!--PLAYER_JS-->', `<script src="player.js"></script>`)

await writeFile(join(DIST_SRC, 'index.html'), srcHtml, 'utf8')
await copyFile(join(ROOT, 'src', 'player.js'), join(DIST_SRC, 'player.js'))
for (const m of manifest) {
  await copyFile(join(ROOT, 'src', 'data', m.file.replace(/^data\//, '')), join(DIST_SRC, 'data', m.file.replace(/^data\//, '')))
}
await copyFile(join(ROOT, 'src', 'styles.css'), join(DIST_SRC, 'styles.css'))
console.log(`\n[源码版] ${DIST_SRC}`)
console.log(`         index.html + player.js + data/(${manifest.length} 个分册)`)
