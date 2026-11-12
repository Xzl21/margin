import { useEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, Block, Doc, Note, Settings } from '../types'
import { paintHtmlHighlights, rangeForAnchor } from '../lib/anchor'
import { escapeHtml, sanitizeHtml } from '../lib/markdown'
import { MarginRail } from './MarginRail'

interface Props {
  doc: Doc
  blocks: Block[]
  anchors: Anchor[]
  notes: Note[]
  settings: Settings
  showRail: boolean
  busyNoteId: string | null
  onCritique: (note: Note) => void
  onDeleteNote: (note: Note) => void
  onUpdateNote: (note: Note, body: string, kind: string) => void
  onRemoveCritique: (note: Note) => void
  onJump: (anchor: Anchor) => void
}

export function HtmlArticle({
  doc, blocks, anchors, notes, settings, showRail, busyNoteId, onCritique, onDeleteNote, onUpdateNote,
  onRemoveCritique, onJump,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [badges, setBadges] = useState<{ id: string; ok: boolean; x: number; y: number }[]>([])

  const html = useMemo(
    () => blocks.map((b) => (b.html ? sanitizeHtml(b.html) : escapeHtml(b.text).replace(/\n/g, '<br/>'))),
    [blocks],
  )

  /** 批注卡片要贴的位置：这条批注在正文里那行高亮的矩形 */
  const locate = (anchor: Anchor): DOMRect | null => {
    const root = ref.current
    if (!root) return null
    const blockEl = root.querySelector<HTMLElement>(`[data-block-id="${anchor.blockId.replace(/["\\]/g, '\\$&')}"]`)
    if (!blockEl) return null
    const range = rangeForAnchor(blockEl, anchor)
    if (range) {
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0)
      if (rects.length) return rects[0]
    }
    return blockEl.getBoundingClientRect()
  }

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const items = anchors.map((anchor) => {
      const note = notes.find((n) => n.anchorId === anchor.id)
      const noteTone = note && settings.noteCategories.some((c) => c.id === note.kind)
        ? (`note-${note.kind}` as const)
        : ('note' as const)
      const tone = note
        ? noteTone
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
  }, [anchors, notes, blocks, settings.zoom])

  const revision = `${blocks.length}:${settings.fontSize}:${anchors.length}:${notes.length}`

  return (
    <div className={`article-body ${showRail ? '' : 'no-rail'}`} ref={ref} style={{ fontSize: settings.fontSize }}>
      <div className="article-main">
        {blocks.map((b, i) => (
          <div className="blk-row" key={b.id}>
            <div
              className={`blk blk-${b.kind}`}
              data-block-id={b.id}
              data-idx={b.idx}
              data-page={b.page}
              dangerouslySetInnerHTML={{ __html: html[i] }}
            />
          </div>
        ))}
      </div>

      {showRail && (
        <MarginRail
          anchors={anchors}
          notes={notes}
          settings={settings}
          busyNoteId={busyNoteId}
          onCritique={onCritique}
          onDelete={onDeleteNote}
          onUpdate={onUpdateNote}
          onRemoveCritique={onRemoveCritique}
          onJump={onJump}
          getRect={locate}
          revision={revision}
          emptyHint="选中正文里的句子，写下的批注会出现在这一栏，和那句话对齐。"
        />
      )}

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
        <span>— 读到此处，回头看看页边写过什么 —</span>
        <small>{doc.title}</small>
      </div>
    </div>
  )
}
