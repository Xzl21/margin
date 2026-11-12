import { useEffect } from 'react'
import { useApp } from './store'
import { useUi } from './ui'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { SettingsPanel } from './components/SettingsPanel'
import type { HighlightKey } from './types'

const HIGHLIGHT_KEYS: HighlightKey[] = ['note', 'mark', 'verify-ok', 'verify-unknown']

/** #rrggbb / #rgb → rgba(...)，给正文高亮用（纯色会盖住字） */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim()
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
  if (!m) return color
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 把用户自定义的颜色落成 CSS：
 * - 五类固定划线 → 覆盖 --hl-* 变量（主题默认色在 styles.css 里）
 * - 批注类别 → 动态注入 ::highlight(m-note-<id>)，正文按类别上色
 */
function applyColors(highlightColors: Record<HighlightKey, string>, categories: { id: string; color: string }[]) {
  const root = document.documentElement
  for (const key of HIGHLIGHT_KEYS) {
    const value = highlightColors[key]
    if (value) root.style.setProperty(`--hl-${key}`, value)
    else root.style.removeProperty(`--hl-${key}`)
  }

  const id = 'margin-category-colors'
  let style = document.getElementById(id) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = id
    document.head.appendChild(style)
  }
  style.textContent = categories
    .map(
      (c) =>
        `::highlight(m-note-${c.id}) { background-color: ${withAlpha(c.color, 0.34)}; }`,
    )
    .join('\n')
}

export default function App() {
  const ready = useApp((s) => s.ready)
  const doc = useApp((s) => s.doc)
  const busy = useApp((s) => s.busy)
  const error = useApp((s) => s.error)
  const setError = useApp((s) => s.setError)
  const init = useApp((s) => s.init)
  const settings = useApp((s) => s.settings)
  const settingsOpen = useUi((s) => s.settingsOpen)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    applyColors(settings.highlightColors, settings.noteCategories)
  }, [settings.highlightColors, settings.noteCategories])

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-mark">伴</div>
        <p>正在打开你的书桌…</p>
      </div>
    )
  }

  return (
    <>
      {doc ? <Reader /> : <Library />}
      {settingsOpen && <SettingsPanel />}
      {busy && (
        <div className="busy-pill" role="status">
          <span className="spinner" />
          {busy}
        </div>
      )}
      {error && (
        <div className="toast toast-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            知道了
          </button>
        </div>
      )}
    </>
  )
}
