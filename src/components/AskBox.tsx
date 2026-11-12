import { useEffect, useRef, useState } from 'react'
import { useDrag } from '../lib/useDrag'

interface AskBoxProps {
  screen: { x: number; y: number }
  quote: string
  busy?: boolean
  onSubmit: (question: string) => void
  onClose: () => void
}

/** 选中文字后弹出的提问输入框：先写问题，再让 AI 带着上下文回答。 */
export function AskBox({ screen, quote, busy, onSubmit, onClose }: AskBoxProps) {
  const [text, setText] = useState('')
  const drag = useDrag<HTMLDivElement>({ x: screen.x, y: screen.y })
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    areaRef.current?.focus()
  }, [])

  const submit = () => {
    const q = text.trim()
    if (!q || busy) return
    onSubmit(q)
  }

  return (
    <div
      ref={drag.ref}
      className="ask-box no-capture draggable"
      style={{ left: drag.pos.x, top: drag.pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="ask-box-head drag-handle" {...drag.handlers}>
        <span className="drag-grip">⠿</span>
        <span className="drag-title">提问</span>
        <button type="button" className="mini ghost" onClick={onClose}>
          关闭
        </button>
      </div>

      <div className="ask-box-quote">“{quote.slice(0, 120)}{quote.length > 120 ? '…' : ''}”</div>

      <textarea
        ref={areaRef}
        rows={3}
        value={text}
        placeholder="你想问什么？（⌘/Ctrl+Enter 发送）"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />

      <div className="ask-box-actions">
        <span className="ask-box-hint">会用全文上下文，能联网就查一下</span>
        <button type="button" className="btn primary" disabled={!text.trim() || busy} onClick={submit}>
          提问
        </button>
      </div>
    </div>
  )
}
