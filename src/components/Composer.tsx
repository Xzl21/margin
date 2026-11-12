import { useEffect, useRef, useState } from 'react'
import type { NoteKind } from '../types'
import type { ComposerMode } from '../ui'
import { useDrag } from '../lib/useDrag'
import { NOTE_KINDS } from './Notes'

interface Props {
  mode: ComposerMode
  screen: { x: number; y: number }
  onClose: () => void
  onSubmit: (text: string, kind: NoteKind) => void
}

const HINTS: Record<ComposerMode, { title: string; placeholder: string }> = {
  note: {
    title: '在这句话旁边，写下你的想法',
    placeholder: '此刻你想到了什么？不用完整、不用正确。比如：「这里凭什么是显然的？」',
  },
  stuck: {
    title: '记下卡点',
    placeholder: '卡在哪？是缺一个定义、一个前提，还是一个例子？（可留空）',
  },
}

export function Composer({ mode, screen, onClose, onSubmit }: Props) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<NoteKind>('think')
  const ref = useRef<HTMLTextAreaElement>(null)
  const hint = HINTS[mode]

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
    if (mode !== 'stuck' && !text.trim()) return
    onSubmit(text.trim(), kind)
  }

  return (
    <div
      ref={drag.ref}
      className={`composer draggable no-capture mode-${mode}`}
      style={{ left: drag.pos.x, top: drag.pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="drag-handle" title="按住可拖动" {...drag.handlers}>
        <span className="drag-grip">⠿</span>
        <span className="drag-title">{hint.title}</span>
        <button type="button" className="icon-btn" onClick={onClose} title="关闭">
          ✕
        </button>
      </header>

      {mode === 'note' && (
        <div className="kind-row">
          {(Object.keys(NOTE_KINDS) as NoteKind[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`chip ${kind === key ? 'active' : ''} ${NOTE_KINDS[key].tone}`}
              onClick={() => setKind(key)}
            >
              {NOTE_KINDS[key].label}
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        value={text}
        rows={4}
        placeholder={hint.placeholder}
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
            {mode === 'note' ? '写到页边' : '记下卡点'}
          </button>
        </div>
      </footer>
    </div>
  )
}
