import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

interface DragOptions {
  /** 拖出可视区之前至少留下多少像素。 */
  margin?: number
}

/**
 * 让浮层可以被拖走。
 * 用法：把 ref 挂到浮层根节点，把 handlers 挂到那条「拖动条」（通常是 header），
 * 位置用 pos 覆盖原来的定位。
 */
export function useDrag<T extends HTMLElement>(
  initial: { x: number; y: number },
  { margin = 8 }: DragOptions = {},
): {
  pos: { x: number; y: number }
  ref: RefObject<T | null>
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
  }
} {
  const [pos, setPos] = useState(initial)
  const ref = useRef<T | null>(null)
  const grab = useRef<{ dx: number; dy: number } | null>(null)

  return {
    pos,
    ref,
    handlers: {
      onPointerDown: (e) => {
        // 拖动条里的按钮/输入框还是照常点击。
        if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return
        const rect = ref.current?.getBoundingClientRect()
        if (!rect) return
        grab.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
      },
      onPointerMove: (e) => {
        if (!grab.current) return
        const rect = ref.current?.getBoundingClientRect()
        const w = rect?.width ?? 320
        const h = rect?.height ?? 200
        const maxX = Math.max(margin, window.innerWidth - w - margin)
        const maxY = Math.max(margin, window.innerHeight - h - margin)
        setPos({
          x: Math.min(Math.max(e.clientX - grab.current.dx, margin), maxX),
          y: Math.min(Math.max(e.clientY - grab.current.dy, margin), maxY),
        })
      },
      onPointerUp: (e) => {
        grab.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      },
      onPointerCancel: () => {
        grab.current = null
      },
    },
  }
}
