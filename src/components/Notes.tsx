import { useState } from 'react'
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

interface BlockMarginProps {
  notes: Note[]
  anchors: Anchor[]
  categories: NoteCategory[]
  stance: 'socratic' | 'corrective'
  busyNoteId?: string | null
  onCritique: (note: Note) => void
  onDelete: (note: Note) => void
  onUpdate?: (note: Note, body: string, kind: string) => void
  onRemoveCritique?: (note: Note) => void
  onJump: (anchor: Anchor) => void
}

/**
 * 右侧栏里的一组批注卡片：一个正文段落对应一组，位置由上层的 rail 布局决定。
 */
export function BlockMargin({
  notes, anchors, categories, stance, busyNoteId, onCritique, onDelete, onUpdate, onRemoveCritique, onJump,
}: BlockMarginProps) {
  if (!notes.length) return null
  return (
    <div className="rail-cards">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          anchor={anchors.find((a) => a.id === note.anchorId)}
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
      ))}
    </div>
  )
}
