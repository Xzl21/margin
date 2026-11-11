import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import MarkdownIt from 'markdown-it'
import type { Block, DocKind, OutlineNode } from '../types'
import { blocksToOutline, htmlToBlocks, inferPdfOutline } from './html'
import { countWords, sha256Hex } from '../lib/util'
import { escapeHtml } from '../lib/markdown'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface ParsedDoc {
  kind: DocKind
  title: string
  blocks: Block[]
  outline: OutlineNode[]
  pageCount?: number
  blob?: Blob
  hash: string
  size: number
  charCount: number
}

const md = new MarkdownIt({ html: false, breaks: false, linkify: true })

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function kindOf(file: File): DocKind | null {
  const ext = extOf(file.name)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'txt' || ext === 'text') return 'txt'
  if (file.type === 'application/pdf') return 'pdf'
  return null
}

export async function parseFile(file: File): Promise<ParsedDoc> {
  const kind = kindOf(file)
  if (!kind) throw new Error('暂不支持这种格式：目前支持 PDF / DOCX / Markdown / TXT')
  const buffer = await file.arrayBuffer()
  const hash = await sha256Hex(buffer)
  const docId = hash.slice(0, 16)
  const baseTitle = file.name.replace(/\.[^.]+$/, '')

  if (kind === 'pdf') {
    const parsed = await parsePdf(new Uint8Array(buffer), docId)
    return {
      kind,
      title: baseTitle,
      blocks: parsed.blocks,
      outline: parsed.outline,
      pageCount: parsed.pageCount,
      blob: new Blob([buffer], { type: 'application/pdf' }),
      hash,
      size: file.size,
      charCount: parsed.charCount,
    }
  }

  let html = ''
  if (kind === 'docx') {
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
    html = result.value
  } else if (kind === 'md') {
    html = md.render(new TextDecoder().decode(buffer))
  } else {
    const text = new TextDecoder().decode(buffer)
    html = text
      .split(/\r?\n\s*\r?\n/)
      .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br/>')}</p>`)
      .join('')
  }

  const blocks = htmlToBlocks(html, docId)
  if (!blocks.length) throw new Error('没有解析出正文，可能是扫描件或空文件')
  const firstHeading = blocks.find((b) => b.kind === 'h1')
  return {
    kind,
    title: firstHeading ? firstHeading.text.slice(0, 80) : baseTitle,
    blocks,
    outline: blocksToOutline(blocks),
    hash,
    size: file.size,
    charCount: countWords(blocks.map((b) => b.text).join(' ')),
  }
}

/* ----------------------------- PDF ----------------------------- */

interface RawItem {
  str: string
  transform: number[]
  width: number
  height: number
}

interface Line {
  text: string
  x: number
  y: number
  h: number
  endX: number
}

function groupLines(items: RawItem[]): Line[] {
  const cleaned = items.filter((it) => typeof it.str === 'string' && it.str.trim().length > 0)
  const sorted = cleaned.sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  )
  const lines: Line[] = []
  for (const it of sorted) {
    const x = it.transform[4]
    const y = it.transform[5]
    const h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 10
    let line = lines[lines.length - 1]
    if (!line || Math.abs(line.y - y) > Math.max(2, line.h * 0.55)) {
      line = { text: '', x, y, h, endX: x }
      lines.push(line)
    }
    if (!line.text) {
      line.text = it.str
      line.x = Math.min(line.x, x)
    } else {
      const gap = x - line.endX
      const needSpace =
        gap > h * 0.22 && /[A-Za-z0-9]$/.test(line.text) && /^[A-Za-z0-9]/.test(it.str)
      line.text += (needSpace ? ' ' : '') + it.str
      line.x = Math.min(line.x, x)
    }
    line.endX = x + (it.width || 0)
  }
  return lines
}

function joinLine(prev: string, next: string): string {
  if (/[A-Za-z]-$/.test(prev)) return prev.slice(0, -1) + next
  if (/[A-Za-z0-9,;:]$/.test(prev) && /^[A-Za-z0-9]/.test(next)) return `${prev} ${next}`
  return prev + next
}

function mergeParagraphs(lines: Line[]): string[] {
  const paras: string[] = []
  let cur: Line | null = null
  let text = ''

  const flush = () => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (t) paras.push(t)
    text = ''
  }

  for (const line of lines) {
    if (!cur) {
      cur = line
      text = line.text
      continue
    }
    const gap = cur.y - line.y
    const indent = line.x - cur.x
    const newPara =
      gap > cur.h * 1.85 ||
      (indent > cur.h * 1.4 && gap > cur.h * 1.05) ||
      text.length > 900
    if (newPara) {
      flush()
      cur = line
      text = line.text
    } else {
      text = joinLine(text, line.text)
      cur = line
    }
  }
  flush()
  return paras
}

function guessKind(text: string, pageCount: number): Block['kind'] {
  const t = text.trim()
  if (t.length <= 46 && !/[。！？；，、]$/.test(t)) {
    if (/^第[一二三四五六七八九十百零〇\d]+[章节篇讲]/.test(t)) return 'h1'
    if (/^(\d+(\.\d+){0,2})[、.．\s]/.test(t) || /^[一二三四五六七八九十]+[、.．]/.test(t)) return 'h2'
    if (pageCount < 40 && t.length < 20) return 'h2'
  }
  return 'line'
}

async function parsePdf(data: Uint8Array, docId: string): Promise<{
  blocks: Block[]
  outline: OutlineNode[]
  pageCount: number
  charCount: number
}> {
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
  const blocks: Block[] = []
  const pageFirstBlock = new Map<number, number>()

  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const lines = groupLines(content.items as unknown as RawItem[])
    const paras = mergeParagraphs(lines)
    pageFirstBlock.set(p, blocks.length)
    for (const para of paras) {
      const idx = blocks.length
      blocks.push({
        id: `${docId}:${idx}`,
        docId,
        idx,
        kind: guessKind(para, pdf.numPages),
        text: para,
        page: p,
      })
    }
  }

  const outline = await outlineFromPdf(pdf, pageFirstBlock)
  const charCount = countWords(blocks.map((b) => b.text).join(' '))
  const pageCount = pdf.numPages
  await pdf.destroy()
  return {
    blocks,
    outline: outline.length ? outline : inferPdfOutline(blocks),
    pageCount,
    charCount,
  }
}

async function outlineFromPdf(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageFirstBlock: Map<number, number>,
): Promise<OutlineNode[]> {
  let raw: Awaited<ReturnType<pdfjsLib.PDFDocumentProxy['getOutline']>> | null = null
  try {
    raw = await pdf.getOutline()
  } catch {
    return []
  }
  if (!raw?.length) return []
  const out: OutlineNode[] = []

  const walk = async (items: typeof raw, level: number): Promise<void> => {
    if (!items) return
    for (const it of items) {
      if (out.length >= 200) return
      let page = 1
      try {
        let dest = it.dest
        if (typeof dest === 'string') dest = await pdf.getDestination(dest)
        if (Array.isArray(dest) && dest[0] && typeof dest[0] === 'object') {
          page = (await pdf.getPageIndex(dest[0] as never)) + 1
        }
      } catch {
        /* 目录项指向无效时退化为页首 */
      }
      out.push({
        id: `o-${out.length}`,
        title: it.title.trim() || `第 ${page} 页`,
        level: Math.min(level, 4),
        blockIdx: pageFirstBlock.get(page) ?? 0,
      })
      if (it.items?.length) await walk(it.items, level + 1)
    }
  }

  await walk(raw, 1)
  return out
}
