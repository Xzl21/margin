import { useEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, Block, Doc, Note, Settings } from '../types'
import { paintHtmlHighlights, rangeForAnchor } from '../lib/anchor'
import { escapeHtml, sanitizeHtml } from '../lib/markdown'
import { BlockMargin } from './Notes'

interface Props {
  doc: Doc
  blocks: Block[]
  anchors: Anchor[]
  notes: Note[]
  settings: Settings
  busyNoteId: string | null
  onCritique: (note: Note) => void
  onDeleteNote: (note: Note) => void
  onUpdateNote: (note: Note, body: string, kind: string) => void
  onRemoveCritique: (note: Note) => void
  onJump: (anchor: Anchor) => void
}

type Group = { key: string; blockId: string | null; notes: Note[] }

export function HtmlArticle({
  doc, blocks, anchors, notes, settings, busyNoteId, onCritique, onDeleteNote, onUpdateNote,
  onRemoveCritique, onJump,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const groupRefs = useRef(new Map<string, HTMLDivElement>())
  const [tops, setTops] = useState<Record<string, number>>({})
  const [badges, setBadges] = useState<{ id: string; ok: boolean; x: number; y: number }[]>([])

  const html = useMemo(
    () => blocks.map((b) => (b.html ? sanitizeHtml(b.html) : escapeHtml(b.text).replace(/\n/g, '<br/>'))),
    [blocks],
  )

  // 按块归拢批注：右侧栏的卡片和正文段落一一对应，位置由这一步的映射决定。
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

  const groups = useMemo<Group[]>(() => {
    const list: Group[] = []
    for (const block of blocks) {
      const items = notesByBlock.get(block.id)
      if (items?.length) list.push({ key: block.id, blockId: block.id, notes: items })
    }
    if (orphanNotes.length) list.push({ key: '__orphans__', blockId: null, notes: orphanNotes })
    return list
  }, [blocks, notesByBlock, orphanNotes])

  const groupKey = groups.map((g) => `${g.key}:${g.notes.length}`).join('|')

  // 右侧栏与正文在同一个滚动容器里，卡片用段落的位置定位 → 上下滚动天然同步。
  useEffect(() => {
    const root = ref.current
    const rail = railRef.current
    if (!root || !rail) return

    let raf = 0
    const measure = () => {
      const zoom = settings.zoom || 1
      const railRect = rail.getBoundingClientRect()
      const next: Record<string, number> = {}
      let lastBottom = 0
      for (const group of groups) {
        const box = groupRefs.current.get(group.key)
        const blockEl = group.blockId
          ? root.querySelector<HTMLElement>(`[data-block-id="${group.blockId.replace(/["\\]/g, '\\$&')}"]`)
          : null
        const anchorTop = blockEl
          ? (blockEl.getBoundingClientRect().top - railRect.top) / zoom
          : lastBottom + 18
        const top = Math.max(anchorTop, lastBottom === 0 ? 0 : lastBottom + 14)
        next[group.key] = Math.round(top)
        lastBottom = top + (box?.offsetHeight ?? 90)
      }
      setTops((prev) => {
        const same = Object.keys(next).length === Object.keys(prev).length &&
          Object.keys(next).every((k) => prev[k] === next[k])
        return same ? prev : next
      })
    }

    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    schedule()
    const timer = window.setTimeout(schedule, 120)
    const ro = new ResizeObserver(schedule)
    ro.observe(root)
    if (rail.parentElement) ro.observe(rail.parentElement)
    window.addEventListener('resize', schedule)
    document.fonts?.ready.then(schedule).catch(() => {})
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [groups, groupKey, settings.zoom, blocks, notes.length])

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

  const marginProps = {
    anchors,
    categories: settings.noteCategories,
    stance: settings.stance,
    busyNoteId,
    onCritique,
    onDelete: onDeleteNote,
    onUpdate: onUpdateNote,
    onRemoveCritique,
    onJump,
  }

  return (
    <div className="article-body" ref={ref} style={{ fontSize: settings.fontSize }}>
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

      {/* 右侧栏：和正文共用滚动，卡片按段落位置对齐 */}
      <aside className="article-rail" ref={railRef} aria-label="页边批注">
        {groups.map((group) => (
          <div
            key={group.key}
            ref={(el) => {
              if (el) groupRefs.current.set(group.key, el)
              else groupRefs.current.delete(group.key)
            }}
            className={`rail-group ${group.blockId ? '' : 'orphan'}`}
            style={{ top: tops[group.key] ?? 0 }}
          >
            {!group.blockId && (
              <div className="rail-orphan-label">这些批注的原句在重新导入后没对上，先存这里：</div>
            )}
            <BlockMargin notes={group.notes} {...marginProps} />
          </div>
        ))}
        {!groups.length && (
          <div className="rail-hint">
            选中正文里的句子，写下的批注会出现在这一栏，和那句话对齐。
          </div>
        )}
      </aside>

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
