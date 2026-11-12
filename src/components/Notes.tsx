import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Anchor, Note, NoteKind } from '../types'
import { renderMarkdown } from '../lib/markdown'
import { formatDate } from '../lib/util'

export const NOTE_KINDS: Record<NoteKind, { label: string; tone: string }> = {
  think: { label: '想法', tone: 'tone-think' },
  question: { label: '疑问', tone: 'tone-question' },
  objection: { label: '反驳', tone: 'tone-objection' },
  summary: { label: '复述', tone: 'tone-summary' },
  todo: { label: '待查', tone: 'tone-todo' },
}

interface NoteCardProps {
  note: Note
  anchor?: Anchor
  compact?: boolean
  stance: 'socratic' | 'corrective'
  busy?: boolean
  onCritique: (note: Note) => void
  onDelete: (note: Note) => void
  onRemoveCritique?: (note: Note) => void
  onJump?: (anchor: Anchor) => void
}

export function NoteCard({
  note, anchor, compact, stance, busy, onCritique, onDelete, onRemoveCritique, onJump,
}: NoteCardProps) {
  const [expanded, setExpanded] = useState(!compact)
  const [showCritique, setShowCritique] = useState(compact)
  const meta = NOTE_KINDS[note.kind]

  return (
    <div className={`note-card ${compact ? 'compact' : ''} ${meta.tone}`}>
      <div className="note-head">
        <span className="note-kind">{meta.label}</span>
        <span className="note-time">{formatDate(note.createdAt)}</span>
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
      <div className={`note-body ${expanded ? '' : 'clamped'}`}>{note.body}</div>
      {note.critique && showCritique && (
        <div className="note-critique">
          <div className="note-critique-head">
            <span>{note.critique.mode === 'socratic' ? '追问' : '校对'}</span>
            <span className="model-tag">{note.critique.model}</span>
            {onRemoveCritique && (
              <button
                type="button"
                className="mini danger critique-del"
                title="删掉这段点评，批注本身保留"
                onClick={() => onRemoveCritique(note)}
              >
                删除
              </button>
            )}
          </div>
          <div
            className="md"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(note.critique.text) }}
          />
        </div>
      )}
      <div className="note-actions">
        {anchor && (
          <button type="button" className="mini" title="定位到原文这句话" onClick={() => onJump?.(anchor)}>
            回到原文
          </button>
        )}
        <button type="button" className="mini" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : '展开'}
        </button>
        <button type="button" className="mini accent" disabled={busy} onClick={() => onCritique(note)}>
          {busy ? '思考中…' : stance === 'socratic' ? '让 AI 追问' : '让 AI 校对'}
        </button>
        {note.critique && (
          <button type="button" className="mini" onClick={() => setShowCritique((v) => !v)}>
            {showCritique ? '隐藏点评' : '看点评'}
          </button>
        )}
        <button type="button" className="mini danger" onClick={() => onDelete(note)}>
          删除
        </button>
      </div>
    </div>
  )
}

interface MarginNotesProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  anchors: Anchor[]
  notes: Note[]
  stance: 'socratic' | 'corrective'
  busyNoteId?: string | null
  onCritique: (note: Note) => void
  onDelete: (note: Note) => void
  onRemoveCritique?: (note: Note) => void
  onJump: (anchor: Anchor) => void
}

/** 页边批注：按块在正文里的垂直位置摆放，模拟写在书页边缘的感觉 */
export function MarginNotes({
  containerRef, anchors, notes, stance, busyNoteId, onCritique, onDelete, onRemoveCritique, onJump,
}: MarginNotesProps) {
  const [tops, setTops] = useState<Record<string, number>>({})
  const [stacked, setStacked] = useState<{ note: Note; anchor: Anchor; top: number }[]>([])
  const rafRef = useRef(0)

  // 位置一律用 offsetTop 算（相对 .article-body 的 padding box），既不受滚动影响，
  // 也不受 CSS zoom 影响；刚打开文档时要等一帧以上才量得准，所以 rAF + 定时器各补一次。
  useLayoutEffect(() => {
    const root = containerRef.current
    if (!root) return
    const measure = () => {
      const next: Record<string, number> = {}
      for (const n of notes) {
        if (next[n.anchorId] !== undefined) continue
        const anchor = anchors.find((a) => a.id === n.anchorId)
        if (!anchor) continue
        const el = root.querySelector<HTMLElement>(`[data-block-id="${cssEscape(anchor.blockId)}"]`)
        if (!el) continue
        next[anchor.id] = Math.max(0, el.offsetTop)
      }
      setTops(next)
    }
    measure()
    rafRef.current = window.requestAnimationFrame(() => {
      measure()
      rafRef.current = window.requestAnimationFrame(measure)
    })
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    root.querySelectorAll<HTMLElement>('.blk').forEach((el) => ro.observe(el))
    const scroller = root.closest('.reader-scroll')
    scroller?.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    document.fonts?.ready.then(measure).catch(() => undefined)
    const timer = window.setTimeout(measure, 260)
    return () => {
      window.cancelAnimationFrame(rafRef.current)
      window.clearTimeout(timer)
      ro.disconnect()
      scroller?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [containerRef, anchors, notes])

  useEffect(() => {
    const rows: { note: Note; anchor: Anchor; top: number }[] = []
    for (const note of notes) {
      const anchor = anchors.find((a) => a.id === note.anchorId)
      if (!anchor) continue
      const base = tops[anchor.id]
      if (base === undefined) continue
      rows.push({ note, anchor, top: base })
    }
    rows.sort((a, b) => a.top - b.top)
    let lastBottom = -Infinity
    const placed = rows.map((row) => {
      const top = Math.max(row.top, lastBottom + 10)
      lastBottom = top + 96
      return { ...row, top }
    })
    setStacked(placed)
  }, [tops, anchors, notes])

  if (!stacked.length) return null

  return (
    <aside className="margin-notes" aria-label="页边批注">
      {stacked.map(({ note, anchor, top }) => (
        <div key={note.id} className="margin-slot" style={{ top }}>
          <NoteCard
            note={note}
            anchor={anchor}
            compact
            stance={stance}
            busy={busyNoteId === note.id}
            onCritique={onCritique}
            onDelete={onDelete}
            onRemoveCritique={onRemoveCritique}
            onJump={onJump}
          />
        </div>
      ))}
    </aside>
  )
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}
