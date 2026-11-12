import { useEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, Ask, Note, Settings } from '../types'
import { NoteCard } from './Notes'
import { AskCard } from './AskCard'

interface Props {
  anchors: Anchor[]
  notes: Note[]
  asks: Ask[]
  settings: Settings
  busyNoteId?: string | null
  onCritique: (note: Note) => void
  onDelete: (note: Note) => void
  onUpdate: (note: Note, body: string, kind: string) => void
  onRemoveCritique: (note: Note) => void
  onJump: (anchor: Anchor) => void
  onDeleteAsk: (ask: Ask) => void
  onAskContinue: (ask: Ask, question: string) => void
  onAskStop: () => void
  askLive: { askId: string; text: string; running: boolean } | null
  /** 返回这条批注对应原文位置在视口里的矩形（找不到时返回 null） */
  getRect: (anchor: Anchor) => DOMRect | null
  /** 布局可能变化的信号：滚动区尺寸、缩放、重排后变化时换一个值即可触发重测 */
  revision?: string
  emptyHint?: string
}

interface Group {
  anchorId: string
  anchor: Anchor | null
  notes: Note[]
  asks: Ask[]
}

/** 卡片里第一行文字的矩形：用来把“卡片首行”和“正文那一行”对齐 */
function firstLineBox(el: HTMLElement): DOMRect | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node.textContent && node.textContent.trim()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      const rect = Array.from(range.getClientRects()).find((r) => r.height > 0)
      if (rect) return rect
    }
    node = walker.nextNode()
  }
  return null
}

/**
 * 右侧批注栏。它和正文是同一个滚动容器里的两列，但位置不靠“猜”：
 * 每条批注先问 getRect 拿到它在正文里那行高亮的视口矩形，再换算成相对
 * 批注栏的 top。这样卡片贴着的是真正的划线位置，而不是段落的粗略顶部。
 */
export function MarginRail({
  anchors, notes, asks, settings, busyNoteId, onCritique, onDelete, onUpdate, onRemoveCritique, onJump,
  onDeleteAsk, onAskContinue, onAskStop, askLive,
  getRect, revision, emptyHint,
}: Props) {
  const railRef = useRef<HTMLElement>(null)
  const groupRefs = useRef(new Map<string, HTMLDivElement>())
  const [tops, setTops] = useState<Record<string, number>>({})
  const getRectRef = useRef(getRect)
  getRectRef.current = getRect

  const groups = useMemo<Group[]>(() => {
    const notesByAnchor = new Map<string, Note[]>()
    for (const note of notes) {
      const list = notesByAnchor.get(note.anchorId) ?? []
      list.push(note)
      notesByAnchor.set(note.anchorId, list)
    }
    const asksByAnchor = new Map<string, Ask[]>()
    for (const ask of asks) {
      const list = asksByAnchor.get(ask.anchorId) ?? []
      list.push(ask)
      asksByAnchor.set(ask.anchorId, list)
    }
    const ids = new Set([...notesByAnchor.keys(), ...asksByAnchor.keys()])
    const items: Group[] = [...ids].map((anchorId) => ({
      anchorId,
      anchor: anchors.find((a) => a.id === anchorId) ?? null,
      notes: notesByAnchor.get(anchorId) ?? [],
      asks: asksByAnchor.get(anchorId) ?? [],
    }))
    items.sort((a, b) => (a.anchor?.blockIdx ?? Number.MAX_SAFE_INTEGER) - (b.anchor?.blockIdx ?? Number.MAX_SAFE_INTEGER))
    return items
  }, [notes, asks, anchors])

  const signature = groups.map((g) => `${g.anchorId}:${g.notes.length}:${g.asks.length}`).join('|')

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return

    let raf = 0
    const measure = () => {
      const railRect = rail.getBoundingClientRect()
      // 右栏在正文的 zoom 容器里，getBoundingClientRect 是缩放后的设备像素，
      // 而写进样式里的 top/transform 是未缩放的 CSS 像素；两者相差一个 zoom。
      const zoom = railRect.width / Math.max(1, rail.offsetWidth)
      const next: Record<string, number> = {}
      let lastBottom = 0
      for (const group of groups) {
        const box = groupRefs.current.get(group.anchorId)
        const rect = group.anchor ? getRectRef.current(group.anchor) : null
        const card =
          box?.querySelector<HTMLElement>('.note-card') ??
          box?.querySelector<HTMLElement>('.ask-card') ??
          null
        const cardRect = card?.getBoundingClientRect()
        const line = card ? firstLineBox(card) : null
        // 把卡片第一行字的竖直中心，对到正文那一行字的竖直中心：
        // 行盒比字高（行高 1.95），直接对顶边会看起来偏高半个行距。
        const anchorCenter = rect ? rect.top + rect.height / 2 : 0
        const lineOffset = cardRect && line ? line.top - cardRect.top : 0
        const lineHeight = line?.height ?? 0
        let anchorTop = rect ? anchorCenter - lineOffset - lineHeight / 2 - railRect.top : lastBottom + 18
        if (lastBottom > 0) anchorTop = Math.max(anchorTop, lastBottom + 12)
        anchorTop = Math.max(anchorTop, 0)
        // 存未缩放的 CSS 像素；stacking 用设备像素算，避免两套单位混在一起。
        next[group.anchorId] = anchorTop / zoom
        lastBottom = anchorTop + (cardRect?.height ?? 92)
      }
      setTops((prev) => {
        const keys = Object.keys(next)
        const same = keys.length === Object.keys(prev).length && keys.every((k) => Math.abs((prev[k] ?? 0) - next[k]) < 0.5)
        return same ? prev : next
      })
    }

    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    schedule()
    const timer = window.setTimeout(schedule, 140)
    const timer2 = window.setTimeout(schedule, 600)
    const ro = new ResizeObserver(schedule)
    if (rail.parentElement) ro.observe(rail.parentElement)
    window.addEventListener('resize', schedule)
    document.fonts?.ready.then(schedule).catch(() => {})
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      window.clearTimeout(timer2)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [groups, signature, revision, settings.zoom])

  return (
    <aside className="article-rail" ref={railRef} aria-label="页边批注">
      {groups.map((group) => (
        <div
          key={group.anchorId}
          ref={(el) => {
            if (el) groupRefs.current.set(group.anchorId, el)
            else groupRefs.current.delete(group.anchorId)
          }}
          className={`rail-group ${group.anchor ? '' : 'orphan'}`}
          style={{ transform: `translateY(${tops[group.anchorId] ?? 0}px)` }}
        >
          {!group.anchor && <div className="rail-orphan-label">原句没对上，先存这里：</div>}
          <div className="rail-cards">
            {group.asks.map((ask) => (
              <AskCard
                key={ask.id}
                ask={ask}
                anchor={group.anchor ?? undefined}
                compact
                live={askLive?.askId === ask.id ? askLive.text : null}
                running={askLive?.askId === ask.id && askLive.running}
                onContinue={onAskContinue}
                onStop={onAskStop}
                onDelete={onDeleteAsk}
                onJump={onJump}
              />
            ))}
            {group.notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                anchor={group.anchor ?? undefined}
                categories={settings.noteCategories}
                compact
                stance={settings.stance}
                busy={busyNoteId === note.id}
                onCritique={onCritique}
                onDelete={onDelete}
                onUpdate={onUpdate}
                onRemoveCritique={onRemoveCritique}
                onJump={onJump}
              />
            ))}
          </div>
        </div>
      ))}
      {!groups.length && emptyHint && <div className="rail-hint">{emptyHint}</div>}
    </aside>
  )
}
