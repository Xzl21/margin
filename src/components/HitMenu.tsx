import { useEffect, useRef, useState } from 'react'
import type { Anchor, Note, Stuck } from '../types'

export type HitAdd = 'explain' | 'mark' | 'verify' | 'note' | 'stuck'

interface Props {
  anchor: Anchor
  notes: Note[]
  stucks: Stuck[]
  x: number
  y: number
  onClose: () => void
  onDeleteNote: (note: Note) => void
  onDeleteStuck: (stuck: Stuck) => void
  onDeleteMark: (anchor: Anchor) => void
  onAdd: (kind: HitAdd) => void
}

/** 点中正文里已经划出来的句子时弹出：可以删掉某条记录，也可以在同一个位置再补一个功能。 */
export function HitMenu({
  anchor, notes, stucks, x, y, onClose, onDeleteNote, onDeleteStuck, onDeleteMark, onAdd,
}: Props) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const W = 250
  const H = 240
  const left = Math.min(Math.max(8, x - W / 2), window.innerWidth - W - 8)
  const top = y + 14 + H > window.innerHeight ? Math.max(8, y - H - 14) : y + 14

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

  const hasMark = anchor.kind === 'mark'
  const hasVerify = anchor.kind === 'verify'
  const addables: [HitAdd, string][] = [
    ['explain', '解释'],
    ...(!hasMark ? ([['mark', '划线']] as [HitAdd, string][]) : []),
    ...(!hasVerify ? ([['verify', '查证']] as [HitAdd, string][]) : []),
    ['note', '批注'],
    ['stuck', '卡点'],
  ]

  return (
    <div ref={ref} className="hit-menu no-capture" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="hit-quote">
        “{anchor.quote.exact.slice(0, 46)}{anchor.quote.exact.length > 46 ? '…' : ''}”
      </div>

      {(notes.length > 0 || stucks.length > 0 || hasMark || hasVerify) && (
        <div className="hit-section">
          <div className="hit-label">这一句上有</div>
          {notes.map((note) => (
            <div key={note.id} className="hit-row">
              <span className="hit-kind">批注</span>
              <button
                type="button"
                className={`mini danger ${confirming === note.id ? 'armed' : ''}`}
                onClick={() => {
                  if (confirming === note.id) {
                    onDeleteNote(note)
                    setConfirming(null)
                    onClose()
                  } else setConfirming(note.id)
                }}
              >
                {confirming === note.id ? '确认删除' : '删除'}
              </button>
            </div>
          ))}
          {stucks.map((stuck) => (
            <div key={stuck.id} className="hit-row">
              <span className="hit-kind">卡点</span>
              <button
                type="button"
                className={`mini danger ${confirming === stuck.id ? 'armed' : ''}`}
                onClick={() => {
                  if (confirming === stuck.id) {
                    onDeleteStuck(stuck)
                    setConfirming(null)
                    onClose()
                  } else setConfirming(stuck.id)
                }}
              >
                {confirming === stuck.id ? '确认删除' : '删除'}
              </button>
            </div>
          ))}
          {hasMark && (
            <div className="hit-row">
              <span className="hit-kind">划线</span>
              <button type="button" className="mini danger" onClick={() => { onDeleteMark(anchor); onClose() }}>
                删除
              </button>
            </div>
          )}
          {hasVerify && (
            <div className="hit-row">
              <span className="hit-kind">查证 · {anchor.verdict === 'unknown' ? '未证实' : '证实'}</span>
              <button type="button" className="mini danger" onClick={() => { onDeleteMark(anchor); onClose() }}>
                删除
              </button>
            </div>
          )}
        </div>
      )}

      <div className="hit-section">
        <div className="hit-label">在这里添加</div>
        <div className="hit-add">
          {addables.map(([kind, label]) => (
            <button key={kind} type="button" className="mini" onClick={() => { onAdd(kind); onClose() }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
