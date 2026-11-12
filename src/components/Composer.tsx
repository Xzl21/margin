import { useEffect, useRef, useState } from 'react'
import type { NoteCategory } from '../types'
import { useDrag } from '../lib/useDrag'

interface Props {
  screen: { x: number; y: number }
  categories: NoteCategory[]
  onClose: () => void
  onSubmit: (text: string, kind: string) => void
}

export function Composer({ screen, categories, onClose, onSubmit }: Props) {
  // 默认落在「想法」，没有就取第一个类别
  const initialKind = categories.find((c) => c.id === 'think')?.id ?? categories[0]?.id ?? 'think'
  const [text, setText] = useState('')
  const [kind, setKind] = useState<string>(initialKind)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const x = Math.min(Math.max(screen.x, 180), window.innerWidth - 200)
  const y = Math.min(Math.max(screen.y + 18, 80), window.innerHeight - 260)
  const drag = useDrag<HTMLDivElement>({ x: x - 180, y })

  const submit = () => {
    if (!text.trim()) return
    onSubmit(text.trim(), kind)
  }

  return (
    <div
      ref={drag.ref}
      className="composer draggable no-capture"
      style={{ left: drag.pos.x, top: drag.pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="drag-handle" title="按住可拖动" {...drag.handlers}>
        <span className="drag-grip">⠿</span>
        <span className="drag-title">在这句话旁边，写下你的想法</span>
        <button type="button" className="icon-btn" onClick={onClose} title="关闭">
          ✕
        </button>
      </header>

      <div className="kind-row">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip ${kind === c.id ? 'active' : ''}`}
            style={{ '--note-color': c.color } as React.CSSProperties}
            onClick={() => setKind(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <textarea
        ref={ref}
        value={text}
        rows={4}
        placeholder="此刻你想到了什么？不用完整、不用正确。比如：「这里凭什么是显然的？」"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />

      <footer>
        <span className="hint">⌘/Ctrl + Enter 保存</span>
        <div>
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" onClick={submit}>
            写到页边
          </button>
        </div>
      </footer>
    </div>
  )
}
