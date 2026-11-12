import type { Anchor, Block, Captured } from '../types'
import { longestCommonSubstring, normalizeSpace } from './util'

export type HighlightTone = 'note' | 'stuck' | 'ai' | 'mark'

const MAX_QUOTE = 800

export function blockElementOf(node: Node | null, root: HTMLElement): HTMLElement | null {
  let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null)
  while (el && el !== root) {
    if (el instanceof HTMLElement && el.dataset.blockId) return el
    el = el.parentElement
  }
  return null
}

export function offsetIn(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

/** 从 HTML 正文里捕获选区（块级锚点） */
export function captureHtmlSelection(root: HTMLElement): Captured | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const blockEl = blockElementOf(range.startContainer, root)
  if (!blockEl) return null
  const raw = sel.toString()
  if (!raw.trim()) return null
  const blockText = blockEl.textContent ?? ''
  const start = Math.min(offsetIn(blockEl, range.startContainer, range.startOffset), blockText.length)
  const endRaw = blockEl.contains(range.endContainer)
    ? offsetIn(blockEl, range.endContainer, range.endOffset)
    : Math.min(blockText.length, start + raw.length)
  const end = Math.max(start + 1, Math.min(endRaw, blockText.length))
  const exact = normalizeSpace(blockText.slice(start, end)).slice(0, MAX_QUOTE) || normalizeSpace(raw)

  return {
    blockId: blockEl.dataset.blockId ?? '',
    blockIdx: Number(blockEl.dataset.idx ?? '0'),
    quote: exact,
    prefix: normalizeSpace(blockText.slice(Math.max(0, start - 40), start)),
    suffix: normalizeSpace(blockText.slice(end, end + 40)),
  }
}

function closestPage(node: Node | null): HTMLElement | null {
  let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null)
  while (el) {
    if (el instanceof HTMLElement && el.dataset.pdfPage) return el
    el = el.parentElement
  }
  return null
}

/** 从 PDF 文本层捕获选区：记录页号 + 归一化矩形，便于重绘高亮 */
export function capturePdfSelection(root: HTMLElement, blocks: Block[]): Captured | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const pageEl = closestPage(range.commonAncestorContainer)
  if (!pageEl) return null
  const quote = normalizeSpace(sel.toString()).slice(0, MAX_QUOTE)
  if (!quote) return null

  const box = pageEl.getBoundingClientRect()
  if (box.width < 10 || box.height < 10) return null
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 2 && r.height > 2)
    .slice(0, 120)
    .map((r) => ({
      x: (r.left - box.left) / box.width,
      y: (r.top - box.top) / box.height,
      w: r.width / box.width,
      h: r.height / box.height,
    }))
  if (!rects.length) return null

  const page = Number(pageEl.dataset.pdfPage)
  const pageBlocks = blocks.filter((b) => b.page === page)
  let best: Block | null = null
  let bestScore = 0
  for (const b of pageBlocks) {
    if (b.text.includes(quote)) {
      best = b
      break
    }
    const score = longestCommonSubstring(quote, b.text)
    if (score > bestScore) {
      bestScore = score
      best = b
    }
  }
  if (!best && pageBlocks.length) best = pageBlocks[0]
  if (!best) return null

  const at = best.text.indexOf(quote)
  const idx = at >= 0 ? at : 0
  const exact = at >= 0 ? quote : normalizeSpace(best.text.slice(0, Math.min(MAX_QUOTE, best.text.length)))
  return {
    blockId: best.id,
    blockIdx: best.idx,
    quote: exact,
    prefix: normalizeSpace(best.text.slice(Math.max(0, idx - 40), idx)),
    suffix: normalizeSpace(best.text.slice(idx + exact.length, idx + exact.length + 40)),
    page,
    rects,
  }
}

/** 在块内按 offset 建 Range */
export function locateOffset(root: HTMLElement, offset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0
  let node = walker.nextNode()
  while (node) {
    const len = node.textContent?.length ?? 0
    if (acc + len >= offset) return { node, offset: Math.max(0, offset - acc) }
    acc += len
    node = walker.nextNode()
  }
  return null
}

/** 在块元素内为锚点找 Range。优先用 prefix 消歧，找不到再用模糊匹配。 */
export function rangeForAnchor(blockEl: HTMLElement, anchor: Anchor): Range | null {
  const text = blockEl.textContent ?? ''
  const quote = anchor.quote.exact
  if (!quote) return null

  const candidates: number[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(quote, from)
    if (at < 0) break
    candidates.push(at)
    from = at + 1
    if (candidates.length > 20) break
  }

  let bestAt = -1
  if (candidates.length === 1) {
    bestAt = candidates[0]
  } else if (candidates.length > 1) {
    const prefix = anchor.quote.prefix
    let bestScore = -1
    for (const at of candidates) {
      const before = text.slice(Math.max(0, at - prefix.length), at)
      let score = 0
      for (let i = 0; i < Math.min(before.length, prefix.length); i += 1) {
        if (before[before.length - 1 - i] === prefix[prefix.length - 1 - i]) score += 1
        else break
      }
      if (score > bestScore) {
        bestScore = score
        bestAt = at
      }
    }
  }

  if (bestAt < 0) {
    // 原文被改写：用最长公共子串兜底，避免批注彻底消失
    const loose = anchor.quote.prefix ? text.indexOf(anchor.quote.prefix.slice(-12)) : -1
    if (loose < 0) return null
    bestAt = loose
  }

  const start = locateOffset(blockEl, bestAt)
  const end = locateOffset(blockEl, bestAt + quote.length)
  if (!start || !end) return null
  const range = document.createRange()
  try {
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
  } catch {
    return null
  }
  return range
}

export function paintHtmlHighlights(
  root: HTMLElement,
  items: { anchor: Anchor; tone: HighlightTone }[],
): void {
  const css = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS
  if (!css?.highlights) return
  const buckets: Record<HighlightTone, Range[]> = { note: [], stuck: [], ai: [], mark: [] }
  for (const { anchor, tone } of items) {
    const blockEl = root.querySelector<HTMLElement>(`[data-block-id="${CSS_escape(anchor.blockId)}"]`)
    if (!blockEl) continue
    const range = rangeForAnchor(blockEl, anchor)
    if (range) buckets[tone].push(range)
  }
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!H) return
  for (const tone of ['note', 'stuck', 'ai', 'mark'] as HighlightTone[]) {
    const hl = new H(...buckets[tone])
    css.highlights.set(`m-${tone}`, hl)
  }
}

function CSS_escape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}
