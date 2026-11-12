import { useState } from 'react'
import type { Anchor, Ask } from '../types'
import { renderMarkdown } from '../lib/markdown'
import { formatDate } from '../lib/util'

interface AskCardProps {
  ask: Ask
  anchor?: Anchor
  compact?: boolean
  /** 正在流式回答时的实时文本（回答还没落库） */
  live?: string | null
  running: boolean
  onContinue: (ask: Ask, question: string) => void
  onStop: () => void
  onDelete: (ask: Ask) => void
  onJump?: (anchor: Anchor) => void
}

const PREVIEW = 140

/** 提问卡片：正文页边和左侧栏共用，支持展开、回到原文、多轮追问 */
export function AskCard({
  ask, anchor, compact, live, running, onContinue, onStop, onDelete, onJump,
}: AskCardProps) {
  const [expanded, setExpanded] = useState(!compact)
  const [draft, setDraft] = useState('')
  const lastAnswer = [...ask.turns].reverse().find((t) => t.role === 'assistant')?.text ?? ''
  const answerText = live ?? lastAnswer
  const long = answerText.length > PREVIEW
  const shown = expanded || !long ? answerText : `${answerText.slice(0, PREVIEW)}…`

  const submit = () => {
    const q = draft.trim()
    if (!q || running) return
    onContinue(ask, q)
    setDraft('')
  }

  return (
    <div className="ask-card" style={{ borderLeftColor: 'var(--hl-ask, var(--accent))' }}>
      <div className="ask-head">
        <span className="ask-kind">提问</span>
        <span className="note-time">{formatDate(ask.createdAt)}</span>
        <button type="button" className="mini danger ask-del" onClick={() => onDelete(ask)}>
          删除
        </button>
      </div>

      {anchor && (
        <button
          type="button"
          className="note-quote"
          title="回到原文位置"
          onClick={() => onJump?.(anchor)}
        >
          “{anchor.quote.exact.slice(0, 90)}{anchor.quote.exact.length > 90 ? '…' : ''}”
        </button>
      )}

      <div className="ask-q">{ask.question}</div>

      {(shown || running) && (
        <div className="ask-a md" dangerouslySetInnerHTML={{ __html: renderMarkdown(shown || '正在想…') }} />
      )}

      <div className="ask-actions">
        {(long || ask.turns.length > 2) && (
          <button type="button" className="mini" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '展开全部'}
          </button>
        )}
        {running && (
          <button type="button" className="mini" onClick={onStop}>
            停止
          </button>
        )}
      </div>

      {expanded && (
        <div className="ask-continue">
          <textarea
            rows={2}
            value={draft}
            placeholder="接着追问…（⌘/Ctrl+Enter 发送）"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="ask-continue-actions">
            <button type="button" className="mini primary" disabled={!draft.trim() || running} onClick={submit}>
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
