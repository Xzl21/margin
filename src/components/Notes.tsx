import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Anchor, Note, NoteCategory } from '../types'
import { renderMarkdown } from '../lib/markdown'
import { formatDate } from '../lib/util'

/** 找不到类别时给一个中性回退，避免旧数据或删掉的类别变成空白 */
export function categoryOf(categories: NoteCategory[], kind: string): NoteCategory {
  return (
    categories.find((c) => c.id === kind) ?? {
      id: kind || 'note',
      label: kind || '批注',
      color: 'var(--accent)',
    }
  )
}

interface NoteCardProps {
  note: Note
  anchor?: Anchor
  categories: NoteCategory[]
  compact?: boolean
  stance: 'socratic' | 'corrective'
  busy?: boolean
  onCritique: (note: Note) => void
  onDelete: (note: Note) => void
  onUpdate?: (note: Note, body: string, kind: string) => void
  onRemoveCritique?: (note: Note) => void
  onJump?: (anchor: Anchor) => void
}

export function NoteCard({
  note, anchor, categories, compact, stance, busy, onCritique, onDelete, onUpdate, onRemoveCritique, onJump,
}: NoteCardProps) {
  const [expanded, setExpanded] = useState(!compact)
  const [showCritique, setShowCritique] = useState(compact)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)
  const [draftKind, setDraftKind] = useState(note.kind)
  const meta = categoryOf(categories, note.kind)

  const startEdit = () => {
    setDraft(note.body)
    setDraftKind(note.kind)
    setEditing(true)
  }
  const save = () => {
    onUpdate?.(note, draft, draftKind)
    setEditing(false)
  }

  return (
    <div
      className={`note-card ${compact ? 'compact' : ''}`}
      style={{ '--note-color': meta.color } as React.CSSProperties}
    >
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
      {editing ? (
        <div className="note-edit">
          {categories.length > 0 && (
            <div className="kind-row note-kind-edit">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${draftKind === c.id ? 'active' : ''}`}
                  style={{ '--note-color': c.color } as React.CSSProperties}
                  onClick={() => setDraftKind(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={draft}
            rows={4}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditing(false)
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                save()
              }
            }}
          />
          <div className="note-edit-actions">
            <button type="button" className="mini accent" disabled={!draft.trim()} onClick={save}>
              保存
            </button>
            <button type="button" className="mini" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className={`note-body ${expanded ? '' : 'clamped'}`}>{note.body}</div>
      )}
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
        {onUpdate && !editing && (
          <button type="button" className="mini" onClick={startEdit}>
            编辑
          </button>
        )}
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
  categories: NoteCategory[]
  stance: 'socratic' | 'corrective'
  busyNoteId?: string | null
  onCritique: (note: Note) => void
  onDelete: (note: Note) => void
  onUpdate?: (note: Note, body: string, kind: string) => void
  onRemoveCritique?: (note: Note) => void
  onJump: (anchor: Anchor) => void
}

/** 页边批注：按块在正文里的垂直位置摆放，模拟写在书页边缘的感觉 */
export function MarginNotes({
  containerRef, anchors, notes, categories, stance, busyNoteId, onCritique, onDelete, onUpdate, onRemoveCritique, onJump,
}: MarginNotesProps) {
  const [tops, setTops] = useState<Record<string, number>>({})
  const [stacked, setStacked] = useState<{ note: Note; anchor: Anchor; top: number }[]>([])
  const rafRef = useRef(0)

  // 用屏幕上的真实位置来定位：offsetTop 相对的是 padding box，正文容器有 46px 上内边距，
  // 直接用会让页边批注整体比划线高出一段；getBoundingClientRect 才是和划线共同的坐标系。
  useLayoutEffect(() => {
    const root = containerRef.current
    if (!root) return
    const measure = () => {
      const next: Record<string, number> = {}
      const rootRect = root.getBoundingClientRect()
      // 缩放比例从实际宽度反推：不同浏览器对 zoom 的 computed value 表示并不一致
      const zoom = rootRect.width && root.offsetWidth ? rootRect.width / root.offsetWidth : 1
      for (const n of notes) {
        if (next[n.anchorId] !== undefined) continue
        const anchor = anchors.find((a) => a.id === n.anchorId)
        if (!anchor) continue
        const el = root.querySelector<HTMLElement>(`[data-block-id="${cssEscape(anchor.blockId)}"]`)
        if (!el) continue
        next[anchor.id] = Math.max(0, (el.getBoundingClientRect().top - rootRect.top) / zoom)
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
            categories={categories}
            compact
            stance={stance}
            busy={busyNoteId === note.id}
            onCritique={onCritique}
            onDelete={onDelete}
            onUpdate={onUpdate}
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
