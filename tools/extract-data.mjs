// 从 网页/*.html 提取「册 -> 章 -> 方程」结构，输出 src/data/*.js（每个分册一个，用 <script src> 即可在 file:// 下加载）
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_WEB = join(ROOT, '网页')
const OUT = join(ROOT, 'src', 'data')

const INDEX_PAGES = new Set(['index.html', '必修1.html', '必修2.html', '选择性必修1.html', '选择性必修2.html', '选择性必修3.html'])

function parseChapterPage(text, fileName) {
  const start = text.indexOf('const ALL = [')
  if (start < 0) return null
  const open = text.indexOf('[', start)
  // 括号配对扫描，找到数组结束
  let depth = 0, inStr = false, esc = false, end = -1
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '[') depth++
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error(`unbalanced array in ${fileName}`)
  const raw = text.slice(open, end + 1)
  const all = JSON.parse(raw)
  if (!Array.isArray(all)) throw new Error(`ALL is not array in ${fileName}`)
  return all
}

// 从分册页解析章节顺序与链接
function parseBookPage(text) {
  const links = [...text.matchAll(/<a href="([^"]+\.html)"[^>]*>([^<]+)<\/a>/g)]
  return links.map((m) => ({ file: decodeURIComponent(m[1]), title: m[2].trim() }))
}

const { readdir } = await import('node:fs/promises')
const files = await readdir(SRC_WEB)
const chaptersByBook = new Map()

for (const name of files) {
  if (!name.endsWith('.html') || INDEX_PAGES.has(name)) continue
  const text = await readFile(join(SRC_WEB, name), 'utf8')
  const all = parseChapterPage(text, name)
  // 章节标题：文件名去掉「册-」前缀
  const dashIdx = name.indexOf('-')
  const book = name.slice(0, dashIdx)
  const chapTitle = basename(name, '.html').slice(dashIdx + 1)
  if (!chaptersByBook.has(book)) chaptersByBook.set(book, [])
  chaptersByBook.set(book, chaptersByBook.get(book).concat({ title: chapTitle, file: name, reactions: all }))
}

// 用分册页的链接顺序排序章节（保持原导航顺序）
await mkdir(OUT, { recursive: true })
const manifest = []
let totalReactions = 0

for (const [book, chapters] of chaptersByBook) {
  const bookPage = join(SRC_WEB, `${book}.html`)
  let order = null
  try {
    const bt = await readFile(bookPage, 'utf8')
    order = parseBookPage(bt).map((l) => l.file)
  } catch { /* 无分册页则按文件名排序 */ }
  if (order) {
    chapters.sort((a, b) => {
      const ia = order.indexOf(a.file), ib = order.indexOf(b.file)
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
    })
  } else {
    chapters.sort((a, b) => a.file.localeCompare(b.file, 'zh'))
  }

  const payload = {
    book,
    chapters: chapters.map((c) => ({ title: c.title, reactions: c.reactions })),
  }
  totalReactions += chapters.reduce((s, c) => s + c.reactions.length, 0)

  const js = `window.CHEM_DATA = window.CHEM_DATA || {};\nwindow.CHEM_DATA[${JSON.stringify(book)}] = ${JSON.stringify(payload)};\n`
  await writeFile(join(OUT, `${book}.js`), js, 'utf8')
  manifest.push({ book, file: `data/${book}.js`, chapters: chapters.length, reactions: chapters.reduce((s, c) => s + c.reactions.length, 0) })
  console.log(`${book.padEnd(10)} ${String(chapters.length).padStart(2)} 章  ${String(manifest.at(-1).reactions).padStart(3)} 方程  -> src/data/${book}.js (${(js.length / 1024).toFixed(0)} KB)`)
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
console.log(`\nTOTAL: ${manifest.length} 册, ${totalReactions} 个方程`)
