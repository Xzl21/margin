import { useEffect } from 'react'
import { useApp } from './store'
import { useUi } from './ui'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { SettingsPanel } from './components/SettingsPanel'

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
