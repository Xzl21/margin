// Node-side smoke test: mount the built bundle inside happy-dom.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Window } from 'happy-dom'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

const distAssets = path.resolve('dist/assets')
const jsFile = fs.readdirSync(distAssets).find((f) => /^index-.*\.js$/.test(f))
if (!jsFile) throw new Error('no built bundle found; run vite build first')

const win = new Window({ url: 'http://127.0.0.1:8787/', width: 1440, height: 900 })
const doc = win.document
doc.body.innerHTML = '<div id="root"></div>'

const g = globalThis
g.window = win
g.self = win
for (const key of Object.getOwnPropertyNames(win)) {
  if (key in g) continue
  try {
    g[key] = win[key]
  } catch {
    /* readonly */
  }
}
const define = (name, value) => {
  try {
    Object.defineProperty(g, name, { value, configurable: true, writable: true })
  } catch {
    /* ignore */
  }
}
define('document', doc)
define('navigator', win.navigator)
define('location', win.location)
define('history', win.history)
define('localStorage', win.localStorage)
define('sessionStorage', win.sessionStorage)

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  constructor(cb) {
    this.cb = cb
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
class HighlightStub {
  constructor(...ranges) {
    this.ranges = ranges
  }
}
g.ResizeObserver = win.ResizeObserver ?? ResizeObserverStub
g.IntersectionObserver = win.IntersectionObserver ?? IntersectionObserverStub
g.Highlight = win.Highlight ?? HighlightStub
g.CSS = Object.assign(win.CSS ?? {}, { highlights: new Map() })
g.indexedDB = new IDBFactory()
g.IDBKeyRange = IDBKeyRange
if (!g.requestIdleCallback) {
  g.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 8 }), 1)
  g.cancelIdleCallback = (id) => clearTimeout(id)
}
if (!win.matchMedia) {
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
}
g.scrollTo = () => {}
win.scrollTo = () => {}
g.HTMLElement.prototype.scrollIntoView = function () {}

const errors = []
win.addEventListener('error', (e) => errors.push(String(e?.message ?? e)))
process.on('unhandledRejection', (e) => errors.push('unhandled: ' + String(e?.message ?? e)))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const report = []
const check = (name, ok, extra = '') => {
  report.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

try {
  await import(pathToFileURL(path.join(distAssets, jsFile)).href)
  await wait(1500)

  const bodyText = doc.body.textContent ?? ''
  check('bundle boots', (doc.querySelector('#root')?.childElementCount ?? 0) > 0)
  check('library heading visible', /伴读|书架|导入/.test(bodyText), bodyText.replace(/\s+/g, ' ').slice(0, 120))

  const buttons = [...doc.querySelectorAll('button')]
  const sampleBtn = buttons.find((b) => /示例|读一篇/.test(b.textContent ?? ''))
  check('sample button present', Boolean(sampleBtn), buttons.map((b) => (b.textContent ?? '').trim()).slice(0, 8).join(' | '))

  // 书架分类文件夹
  const rail = doc.querySelector('.folder-rail')
  check('folder rail present', Boolean(rail), (rail?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60))
  const newFolderBtn = [...(rail?.querySelectorAll('button') ?? [])].find((b) => /新建文件夹/.test(b.textContent ?? ''))
  check('new folder button present', Boolean(newFolderBtn))
  if (rail && newFolderBtn) {
    newFolderBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await wait(120)
    const input = rail.querySelector('.folder-form input')
    check('folder input appears', Boolean(input))
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set
      setter.call(input, '测试分类')
      input.dispatchEvent(new win.Event('input', { bubbles: true }))
      await wait(80)
      const okBtn = [...rail.querySelectorAll('.folder-form button')].find((b) => /✓/.test(b.textContent ?? ''))
      okBtn?.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await wait(400)
      const items = [...rail.querySelectorAll('.folder-item')].map((b) => (b.textContent ?? '').trim())
      check('folder created', items.some((t) => /测试分类/.test(t)), items.join(' | '))
    }
  }

  if (sampleBtn) {
    sampleBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await wait(2000)
    const blocks = doc.querySelectorAll('.blk').length
    check('reader renders blocks', blocks > 3, `blocks=${blocks}`)
    check('outline rendered', doc.querySelectorAll('.outline-item, .outline li, .panel-outline li, .toc-item').length > 0)
    const head = doc.querySelector('.reader-head')
    check('reader header present', Boolean(head), (head?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 80))
    const firstBlockText = (doc.querySelector('.blk')?.textContent ?? '').slice(0, 60)
    check('block has text', firstBlockText.length > 10, firstBlockText)
  }

  // settings modal
  const settingsBtn = [...doc.querySelectorAll('button')].find((b) => /设置/.test(b.textContent ?? ''))
  if (settingsBtn) {
    settingsBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await wait(400)
    check('settings opens', /模型|阅读|数据/.test(doc.body.textContent ?? ''))

    const searchTab = [...doc.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '联网')
    check('search tab present', Boolean(searchTab))
    if (searchTab) {
      searchTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await wait(200)
      const text = doc.body.textContent ?? ''
      check('search settings render', /Tavily/.test(text) && /查证/.test(text), text.replace(/\s+/g, ' ').slice(0, 60))
      check('search provider cards', doc.querySelectorAll('.provider-card').length >= 4)
    }
  } else {
    check('settings button present', false)
  }
} catch (err) {
  check('bundle boots', false, String(err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err))
}

console.log(report.join('\n'))
if (errors.length) console.log('\nerrors:\n' + [...new Set(errors)].slice(0, 8).join('\n'))
process.exit(report.some((r) => r.startsWith('FAIL')) ? 1 : 0)
