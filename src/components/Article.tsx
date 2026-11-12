import { useEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, Block, Doc, Note, Settings, Stuck } from '../types'
import { paintHtmlHighlights, rangeForAnchor } from '../lib/anchor'
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
  onRemoveCritique: (note: Note) => void
  onJump: (anchor: Anchor) => void
}

export function HtmlArticle({
  doc, blocks, anchors, notes, stucks, settings, busyNoteId, onCritique, onDeleteNote, onRemoveCritique, onJump,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [badges, setBadges] = useState<{ id: string; ok: boolean; x: number; y: number }[]>([])

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
      const tone = stuck
        ? ('stuck' as const)
        : noted
          ? ('note' as const)
          : anchor.kind === 'verify'
            ? anchor.verdict === 'unknown'
              ? ('verify-unknown' as const)
              : ('verify-ok' as const)
            : anchor.kind === 'mark'
              ? ('mark' as const)
              : ('note' as const)
      return { anchor, tone }
    })
    const timer = window.setTimeout(() => {
      paintHtmlHighlights(root, items)
      // 查证结论的角标：不能塞进原文 DOM（会打乱字符偏移），所以浮在行尾。
      const zoom = settings.zoom || 1
      const contRect = root.getBoundingClientRect()
      const next: { id: string; ok: boolean; x: number; y: number }[] = []
      for (const anchor of anchors) {
        if (anchor.kind !== 'verify') continue
        const blockEl = root.querySelector<HTMLElement>(`[data-block-id="${anchor.blockId.replace(/["\\]/g, '\\$&')}"]`)
        if (!blockEl) continue
        const range = rangeForAnchor(blockEl, anchor)
        if (!range) continue
        const rects = Array.from(range.getClientRects())
        const last = rects[rects.length - 1]
        if (!last || (last.width === 0 && last.height === 0)) continue
        next.push({
          id: anchor.id,
          ok: anchor.verdict !== 'unknown',
          x: (last.right - contRect.left) / zoom + 2,
          y: (last.top - contRect.top) / zoom - 3,
        })
      }
      setBadges(next)
    }, 30)
    return () => window.clearTimeout(timer)
  }, [anchors, stucks, notes, blocks, settings.zoom])

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
        onRemoveCritique={onRemoveCritique}
        onJump={onJump}
      />
      {badges.map((b) => (
        <span
          key={b.id}
          className={`verify-badge ${b.ok ? 'ok' : 'unknown'}`}
          style={{ left: b.x, top: b.y }}
          title={b.ok ? '已核实：与资料一致' : '未证实：资料不足或有出入'}
        >
          {b.ok ? '✓' : '?'}
        </span>
      ))}
      <div className="article-end">
        <span>— 读到此处，回头看看卡点日志 —</span>
        <small>{doc.title}</small>
      </div>
    </div>
  )
}
