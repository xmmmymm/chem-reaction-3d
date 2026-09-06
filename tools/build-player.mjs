// 从 网页/ 的某个章节页中抽取播放器代码，包装成可重复挂载的工厂，输出 src/player.js
// 同时抽取页面骨架(src/skeleton.html)与样式(src/styles.css)
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, '网页', '必修1-三、氧化还原反应.html')

const text = (await readFile(SRC, 'utf8')).replace(/\r\n/g, '\n')
const MARK = 'let DATA = ALL[0], curIdx = 0;'
const mi = text.indexOf(MARK)
if (mi < 0) throw new Error('player marker not found')
const tail = text.slice(mi)

// 1) 截掉 HTML 尾巴
// 注意：animateSliderTo 内部也有一个 })(); —— 取最后一个（最外层 IIFE 的收尾）
const endIIFE = tail.lastIndexOf('\n    })();')
if (endIIFE < 0) throw new Error('IIFE end not found')
let body = tail.slice(0, endIIFE)

// 2) 去掉外层 IIFE 起始与首行
const openIIFE = body.indexOf('(function () {')
if (openIIFE < 0) throw new Error('IIFE open not found')
body = body.slice(openIIFE + '(function () {'.length)

// 3) animate() 加销毁守卫，避免卸载后继续跑 RAF
const A = 'function animate() {'
if (!body.includes(A)) throw new Error('animate() not found')
body = body.replace(A, 'function animate() {\n            if (destroyed) return;')

// 4) window.onload -> 显式 start()
const WL = 'window.onload = function () {'
if (!body.includes(WL)) throw new Error('window.onload not found')
body = body.replace(WL, 'function start() {')
// start() 原是赋值语句，结尾的 "};" 需去掉分号
const lastSemi = body.lastIndexOf('};')
if (lastSemi < 0) throw new Error('onload terminator not found')
body = body.slice(0, lastSemi) + '}' + body.slice(lastSemi + 2)

const out = `// 化学反应微观 3D 播放器（由 tools/build-player.mjs 从 网页/ 自动生成，勿手改）
// 用法：
//   const p = ChemPlayer.create(reactionsArray);
//   p.start();        // 构建卡片 / 3D / 步骤条
//   p.destroy();      // 卸载并释放 WebGL 与事件
(function () {
    function create(ALL) {
        let DATA = ALL[0], curIdx = 0;
        let destroyed = false;
        ${body.trim()}
        function destroy() {
            destroyed = true;
            try { disposeScene(); } catch (e) { /* ignore */ }
        }
        return { start, destroy, switchReaction, get index() { return curIdx } };
    }
    window.ChemPlayer = { create };
})();
`

await mkdir(join(ROOT, 'src'), { recursive: true })
await writeFile(join(ROOT, 'src', 'player.js'), out, 'utf8')
console.log(`src/player.js  ${(out.length / 1024).toFixed(1)} KB`)

// 5) 抽取样式（<style> 内容）
const styleMatch = text.match(/<style>([\s\S]*?)<\/style>/)
if (!styleMatch) throw new Error('style block not found')
await writeFile(join(ROOT, 'src', 'styles.css'), styleMatch[1].trim() + '\n', 'utf8')
console.log(`src/styles.css ${(styleMatch[1].length / 1024).toFixed(1)} KB`)

// 6) 抽取骨架（<body ...> 到 </main>）
const bStart = text.indexOf('<body')
const bOpen = text.indexOf('>', bStart) + 1
const mEnd = text.indexOf('</main>') + '</main>'.length
let skeleton = text.slice(bOpen, mEnd).trim()
// 去掉外层 flex 布局（由 shell 负责），只保留播放器需要的两块
skeleton = skeleton.replace(/^[\s\S]*?<main[^>]*>/, '').replace(/<\/main>\s*$/, '')
await writeFile(join(ROOT, 'src', 'skeleton.html'), skeleton + '\n', 'utf8')
console.log(`src/skeleton.html ${(skeleton.length / 1024).toFixed(1)} KB`)
