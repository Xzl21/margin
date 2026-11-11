import type { Block, BlockKind, OutlineNode } from '../types'
import { sanitizeHtml } from '../lib/markdown'

const HEADING: Record<string, BlockKind> = {
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h4', H6: 'h4',
}

const TEXT_BLOCKS: Record<string, BlockKind> = {
  P: 'p', BLOCKQUOTE: 'quote', PRE: 'pre', FIGCAPTION: 'p', DD: 'p', DT: 'p',
}

function pushBlock(out: Block[], docId: string, kind: BlockKind, el: Element, html: string) {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text && kind !== 'table') return
  if (text.length < 1) return
  const idx = out.length
  out.push({ id: `${docId}:${idx}`, docId, idx, kind, text, html: sanitizeHtml(html) })
}

/**
 * 把 HTML 拆成可锚定的块。块是批注/解释的最小上下文单位。
 */
export function htmlToBlocks(html: string, docId: string): Block[] {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  const out: Block[] = []
  if (!root) return out

  const visit = (el: Element) => {
    const tag = el.tagName

    if (tag === 'UL' || tag === 'OL' || tag === 'DL') {
      for (const child of Array.from(el.children)) {
        if (child.tagName === 'LI' || child.tagName === 'DT' || child.tagName === 'DD') {
          pushBlock(out, docId, 'li', child, child.innerHTML)
        } else {
          visit(child)
        }
      }
      return
    }

    if (tag === 'TABLE') {
      pushBlock(out, docId, 'table', el, el.outerHTML)
      return
    }

    if (HEADING[tag]) {
      pushBlock(out, docId, HEADING[tag], el, el.innerHTML)
      return
    }

    if (TEXT_BLOCKS[tag]) {
      pushBlock(out, docId, TEXT_BLOCKS[tag], el, el.innerHTML)
      return
    }

    if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'HEADER') {
      const children = Array.from(el.children)
      const hasBlockChildren = children.some((c) =>
        ['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'PRE', 'DIV', 'SECTION'].includes(c.tagName),
      )
      if (hasBlockChildren) {
        children.forEach(visit)
      } else if ((el.textContent ?? '').trim()) {
        pushBlock(out, docId, 'p', el, el.innerHTML)
      }
      return
    }

    if (tag === 'HR') return

    if (el.textContent && el.textContent.trim()) {
      pushBlock(out, docId, 'p', el, el.outerHTML)
    }
  }

  Array.from(root.children).forEach(visit)
  return out
}

export function blocksToOutline(blocks: Block[]): OutlineNode[] {
  const out: OutlineNode[] = []
  for (const b of blocks) {
    if (b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3' || b.kind === 'h4') {
      const level = Number(b.kind.slice(1))
      out.push({
        id: `o-${b.idx}`,
        title: b.text.slice(0, 80),
        level,
        blockIdx: b.idx,
      })
    }
  }
  return out
}

/** PDF 没有标题样式，用版式与文本特征做保守推断 */
export function inferPdfOutline(blocks: Block[]): OutlineNode[] {
  const out: OutlineNode[] = []
  const headingPattern = /^(第[一二三四五六七八九十百零〇\d]+[章节讲部篇]|Chapter\s+\d+|[一二三四五六七八九十]+[、.．]|\d+(\.\d+){0,2}[、.．\s])/
  for (const b of blocks) {
    const t = b.text.trim()
    if (t.length === 0 || t.length > 46) continue
    if (/[。！？；，、]$/.test(t)) continue
    if (/^\d+$/.test(t)) continue
    if (headingPattern.test(t) || (b.kind === 'line' && t.length <= 24 && !/[，。；]/.test(t))) {
      const level = /^第[一二三四五六七八九十百]+[章篇]/.test(t) || /^Chapter/.test(t) ? 1 : 2
      out.push({ id: `o-${b.idx}`, title: t, level, blockIdx: b.idx })
    }
  }
  return out
}
