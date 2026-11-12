import { useLayoutEffect, useState } from 'react'
import type { Captured } from '../types'

interface Props {
  captured: Captured
  onExplain: () => void
  onMark: () => void
  onAsk: (screen: { x: number; y: number }) => void
  onVerify: () => void
  onNote: (screen: { x: number; y: number }) => void
  onStuck: () => void
  onClose: () => void
}

export function SelectionToolbar({ captured, onExplain, onMark, onAsk, onVerify, onNote, onStuck, onClose }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)

  useLayoutEffect(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) return
    const below = rect.top < 70
    setPos({
      x: Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150),
      y: below ? rect.bottom + 10 : rect.top - 10,
      below,
    })
  }, [captured])

  if (!pos) return null

  return (
    <div
      className={`sel-toolbar no-capture ${pos.below ? 'below' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className="sel-primary" onClick={onExplain}>
        解释
      </button>
      <button type="button" onClick={onMark} title="只划一道线，不写内容">
        划线
      </button>
      <button type="button" onClick={() => onAsk({ x: pos.x, y: pos.y })}>
        提问
      </button>
      <button type="button" onClick={onVerify} title="联网核对这句话是否属实，并给出出处">
        查证
      </button>
      <button type="button" onClick={() => onNote({ x: pos.x, y: pos.y })}>
        批注
      </button>
      <button type="button" onClick={onStuck}>
        卡点
      </button>
      <button type="button" className="sel-close" onClick={onClose} title="取消选择">
        ✕
      </button>
    </div>
  )
}
