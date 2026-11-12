import { renderMarkdown } from '../lib/markdown'
import type { DockState } from '../ui'

interface Props {
  dock: DockState
  onStop: () => void
  onClose: () => void
  onSaveNote?: () => void
  onVerdict?: (verdict: 'ok' | 'unknown') => void
}

export function ActionDock({ dock, onStop, onClose, onSaveNote, onVerdict }: Props) {
  const canVerdict = Boolean(dock.allowVerdict && !dock.running && dock.text && !dock.error)
  return (
    <div className="action-dock no-capture">
      <header>
        <div>
          <strong>{dock.title}</strong>
          {dock.subtitle && <span className="dock-sub">“{dock.subtitle}”</span>}
        </div>
        <div className="dock-tools">
          {dock.running && (
            <button type="button" className="mini" onClick={onStop}>
              停止
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
      </header>

      {dock.error ? (
        <div className="dock-error">{dock.error}</div>
      ) : (
        <div className="dock-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(dock.text) }} />
      )}
      {dock.running && !dock.text && (
        <div className="dock-thinking">
          <span className="spinner" /> {dock.thinking ?? '正在读你划出的那句话…'}
        </div>
      )}

      <footer>
        <span className="model-tag">{dock.model ?? '未标注模型'}</span>
        <div>
          {canVerdict && !dock.verdict && onVerdict && (
            <>
              <button
                type="button"
                className="mini ok"
                title="这条说法与资料一致：在原文上标绿色✓"
                onClick={() => onVerdict('ok')}
              >
                ✓ 证实
              </button>
              <button
                type="button"
                className="mini unknown"
                title="资料不足或有出入：在原文上标灰色问号"
                onClick={() => onVerdict('unknown')}
              >
                ? 未证实
              </button>
            </>
          )}
          {dock.verdict && (
            <span className={`verdict-tag ${dock.verdict}`}>{dock.verdict === 'ok' ? '✓ 已证实' : '? 未证实'}</span>
          )}
          {onSaveNote && dock.text && !dock.running && (
            <button type="button" className="ghost" onClick={onSaveNote}>
              存成批注
            </button>
          )}
          <button type="button" className="ghost" onClick={onClose}>
            收起
          </button>
        </div>
      </footer>
    </div>
  )
}
