import { useEffect, useMemo, useRef } from 'react'
import type { Anchor, Block, Doc, Note, Settings, Stuck } from '../types'
import { paintHtmlHighlights } from '../lib/anchor'
import { escapeHtml, sanitizeHtml } from '../lib/markdown'
import { MarginNotes } from './Notes'

interface Props {
  doc: Doc
  blocks: Block[]
  anchors: Anchor[]
  notes: Note[]
  stucks: Stuck[]
  settings: Settings
  busyNoteId: string | null
  onCritique: (note: Note) => void
  onDeleteNote: (note: Note) => void
  onJump: (anchor: Anchor) => void
}

export function HtmlArticle({
  doc, blocks, anchors, notes, stucks, settings, busyNoteId, onCritique, onDeleteNote, onJump,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  const html = useMemo(
    () => blocks.map((b) => (b.html ? sanitizeHtml(b.html) : escapeHtml(b.text).replace(/\n/g, '<br/>'))),
    [blocks],
  )

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const items = anchors.map((anchor) => {
      const stuck = stucks.some((s) => s.anchorId === anchor.id && !s.resolved)
      const noted = notes.some((n) => n.anchorId === anchor.id)
      const tone = stuck ? ('stuck' as const) : noted ? ('note' as const) : anchor.kind === 'mark' ? ('mark' as const) : ('note' as const)
      return { anchor, tone }
    })
    const timer = window.setTimeout(() => paintHtmlHighlights(root, items), 30)
    return () => window.clearTimeout(timer)
  }, [anchors, stucks, notes, blocks])

  return (
    <div className="article-body" ref={ref} style={{ fontSize: settings.fontSize }}>
      {blocks.map((b, i) => (
        <div
          key={b.id}
          className={`blk blk-${b.kind}`}
          data-block-id={b.id}
          data-idx={b.idx}
          data-page={b.page}
          dangerouslySetInnerHTML={{ __html: html[i] }}
        />
      ))}
      <MarginNotes
        containerRef={ref}
        anchors={anchors}
        notes={notes}
        stance={settings.stance}
        busyNoteId={busyNoteId}
        onCritique={onCritique}
        onDelete={onDeleteNote}
        onJump={onJump}
      />
      <div className="article-end">
        <span>— 读到此处，回头看看卡点日志 —</span>
        <small>{doc.title}</small>
      </div>
    </div>
  )
}
