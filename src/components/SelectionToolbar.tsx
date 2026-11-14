import { useLayoutEffect, useState } from 'react'
import type { Captured } from '../types'

interface Props {
  captured: Captured
  onExplain: () => void
  onConcept: () => void
  onNote: (screen: { x: number; y: number }) => void
  onAsk: (screen: { x: number; y: number }) => void
  onMark: () => void
  onVerify: () => void
  onClose: () => void
}

export function SelectionToolbar({
  captured, onExplain, onConcept, onNote, onAsk, onMark, onVerify, onClose,
}: Props) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)

  useLayoutEffect(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    // 长选区（跨多段）的联合矩形可能高过屏幕，顶部跑到视口外，浮窗就“消失”了。
    // 改成贴住选区最后一行：它一定在屏幕上，也正好是鼠标松开的位置。
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
    const anchor = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect()
    if (!anchor || (anchor.width === 0 && anchor.height === 0)) return
    const half = 190
    const x = Math.min(Math.max(anchor.left + anchor.width / 2, half), window.innerWidth - half)
    const below = anchor.top < 64
    const y = below ? Math.min(anchor.bottom + 10, window.innerHeight - 16) : anchor.top - 10
    setPos({ x, y, below })
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
      <button type="button" onClick={onConcept} title="只讲清这个词 / 这句话是什么">
        概念
      </button>
      <button type="button" onClick={() => onNote({ x: pos.x, y: pos.y })}>
        批注
      </button>
      <button type="button" onClick={() => onAsk({ x: pos.x, y: pos.y })}>
        提问
      </button>
      <button type="button" onClick={onMark} title="只划一道线，不写内容">
        划线
      </button>
      <button type="button" onClick={onVerify} title="联网核对这些话是否属实，并给出处">
        查证
      </button>
      <button type="button" className="sel-close" onClick={onClose} title="取消选择">
        ✕
      </button>
    </div>
  )
}
