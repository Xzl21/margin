import { useEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, Block, Doc, Note, Settings, Stuck } from '../types'
import { paintHtmlHighlights, rangeForAnchor } from '../lib/anchor'
import { escapeHtml, sanitizeHtml } from '../lib/markdown'
import { BlockMargin } from './Notes'

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
  onUpdateNote: (note: Note, body: string, kind: string) => void
  onRemoveCritique: (note: Note) => void
  onJump: (anchor: Anchor) => void
}

export function HtmlArticle({
  doc, blocks, anchors, notes, stucks, settings, busyNoteId, onCritique, onDeleteNote, onUpdateNote,
  onRemoveCritique, onJump,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [badges, setBadges] = useState<{ id: string; ok: boolean; x: number; y: number }[]>([])

  const html = useMemo(
    () => blocks.map((b) => (b.html ? sanitizeHtml(b.html) : escapeHtml(b.text).replace(/\n/g, '<br/>'))),
    [blocks],
  )

  // 按块归拢批注：页边卡片直接挂在对应段落自己的行里，位置由布局决定，不再靠 JS 量坐标。
  const { notesByBlock, orphanNotes } = useMemo(() => {
    const map = new Map<string, Note[]>()
    const known = new Set(blocks.map((b) => b.id))
    const orphans: Note[] = []
    for (const note of notes) {
      const anchor = anchors.find((a) => a.id === note.anchorId)
      if (!anchor || !known.has(anchor.blockId)) {
        orphans.push(note)
        continue
      }
      const list = map.get(anchor.blockId) ?? []
      list.push(note)
      map.set(anchor.blockId, list)
    }
    return { notesByBlock: map, orphanNotes: orphans }
  }, [notes, anchors, blocks])

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const items = anchors.map((anchor) => {
      const stuck = stucks.some((s) => s.anchorId === anchor.id && !s.resolved)
      const note = notes.find((n) => n.anchorId === anchor.id)
      const noteTone = note && settings.noteCategories.some((c) => c.id === note.kind)
        ? (`note-${note.kind}` as const)
        : ('note' as const)
      const tone = stuck
        ? ('stuck' as const)
        : note
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
  }, [anchors, stucks, notes, blocks, settings.zoom])

  return (
    <div className="article-body" ref={ref} style={{ fontSize: settings.fontSize }}>
      {blocks.map((b, i) => (
        <div className="blk-row" key={b.id}>
          <div
            className={`blk blk-${b.kind}`}
            data-block-id={b.id}
            data-idx={b.idx}
            data-page={b.page}
            dangerouslySetInnerHTML={{ __html: html[i] }}
          />
          <BlockMargin
            notes={notesByBlock.get(b.id) ?? []}
            anchors={anchors}
            categories={settings.noteCategories}
            stance={settings.stance}
            busyNoteId={busyNoteId}
            onCritique={onCritique}
            onDelete={onDeleteNote}
            onUpdate={onUpdateNote}
            onRemoveCritique={onRemoveCritique}
            onJump={onJump}
          />
        </div>
      ))}

      {/* 找不到原文位置的批注（文档被重新解析过）也别丢，集中放在文末 */}
      {orphanNotes.length > 0 && (
        <div className="blk-row orphan-row">
          <div className="blk orphan-label">这些批注的原句在重新导入后没对上，先存这里：</div>
          <BlockMargin
            notes={orphanNotes}
            anchors={anchors}
            categories={settings.noteCategories}
            stance={settings.stance}
            busyNoteId={busyNoteId}
            onCritique={onCritique}
            onDelete={onDeleteNote}
            onUpdate={onUpdateNote}
            onRemoveCritique={onRemoveCritique}
            onJump={onJump}
          />
        </div>
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
        <span>— 读到此处，回头看看卡点日志 —</span>
        <small>{doc.title}</small>
      </div>
    </div>
  )
}
