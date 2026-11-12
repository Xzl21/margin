import { useEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, Note, Settings } from '../types'
import { NoteCard } from './Notes'

interface Props {
  anchors: Anchor[]
  notes: Note[]
  settings: Settings
  busyNoteId?: string | null
  onCritique: (note: Note) => void
  onDelete: (note: Note) => void
  onUpdate: (note: Note, body: string, kind: string) => void
  onRemoveCritique: (note: Note) => void
  onJump: (anchor: Anchor) => void
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
}

/**
 * 右侧批注栏。它和正文是同一个滚动容器里的两列，但位置不靠“猜”：
 * 每条批注先问 getRect 拿到它在正文里那行高亮的视口矩形，再换算成相对
 * 批注栏的 top。这样卡片贴着的是真正的划线位置，而不是段落的粗略顶部。
 */
export function MarginRail({
  anchors, notes, settings, busyNoteId, onCritique, onDelete, onUpdate, onRemoveCritique, onJump,
  getRect, revision, emptyHint,
}: Props) {
  const railRef = useRef<HTMLElement>(null)
  const groupRefs = useRef(new Map<string, HTMLDivElement>())
  const [tops, setTops] = useState<Record<string, number>>({})
  const getRectRef = useRef(getRect)
  getRectRef.current = getRect

  const groups = useMemo<Group[]>(() => {
    const byAnchor = new Map<string, Note[]>()
    for (const note of notes) {
      const list = byAnchor.get(note.anchorId) ?? []
      list.push(note)
      byAnchor.set(note.anchorId, list)
    }
    const items: Group[] = [...byAnchor.entries()].map(([anchorId, list]) => ({
      anchorId,
      anchor: anchors.find((a) => a.id === anchorId) ?? null,
      notes: list,
    }))
    items.sort((a, b) => (a.anchor?.blockIdx ?? Number.MAX_SAFE_INTEGER) - (b.anchor?.blockIdx ?? Number.MAX_SAFE_INTEGER))
    return items
  }, [notes, anchors])

  const signature = groups.map((g) => `${g.anchorId}:${g.notes.length}`).join('|')

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return

    let raf = 0
    const measure = () => {
      const railRect = rail.getBoundingClientRect()
      const next: Record<string, number> = {}
      let lastBottom = 0
      for (const group of groups) {
        const box = groupRefs.current.get(group.anchorId)
        const rect = group.anchor ? getRectRef.current(group.anchor) : null
        // 批注栏和正文同处一个滚动容器，直接用视口坐标相减，缩放多少都对得上。
        const anchorTop = rect ? rect.top - railRect.top : lastBottom + 18
        const top = lastBottom === 0 ? Math.max(anchorTop, 0) : Math.max(anchorTop, lastBottom + 12)
        next[group.anchorId] = Math.round(top)
        lastBottom = top + (box?.offsetHeight ?? 92)
      }
      setTops((prev) => {
        const keys = Object.keys(next)
        const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])
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
          style={{ top: tops[group.anchorId] ?? 0 }}
        >
          {!group.anchor && <div className="rail-orphan-label">原句没对上，先存这里：</div>}
          <div className="rail-cards">
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
