import { db } from '../db'
import type { Anchor, Block, Doc, Folder, Note, Settings, Stuck } from '../types'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(blob)
  })
}

async function base64ToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

export async function exportBundle(): Promise<Blob> {
  const [docs, blocks, anchors, notes, stucks, msgs, folders, settingsRow] = await Promise.all([
    db.docs.toArray(),
    db.blocks.toArray(),
    db.anchors.toArray(),
    db.notes.toArray(),
    db.stucks.toArray(),
    db.msgs.toArray(),
    db.folders.toArray(),
    db.settings.get('settings'),
  ])

  const docsOut = await Promise.all(
    docs.map(async (d) => ({
      ...d,
      blob: d.blob ? await blobToBase64(d.blob) : undefined,
    })),
  )

  const payload = {
    app: 'margin-reader',
    version: 1,
    exportedAt: new Date().toISOString(),
    docs: docsOut,
    blocks,
    anchors,
    notes,
    stucks,
    msgs,
    folders,
    settings: settingsRow?.value,
  }
  return new Blob([JSON.stringify(payload)], { type: 'application/json' })
}

interface Bundle {
  app?: string
  docs?: (Omit<Doc, 'blob'> & { blob?: string })[]
  blocks?: Block[]
  anchors?: Anchor[]
  notes?: Note[]
  stucks?: Stuck[]
  msgs?: unknown[]
  folders?: Folder[]
  settings?: Settings
}

export async function importBundle(file: File): Promise<{ docs: number; notes: number }> {
  const text = await file.text()
  const parsed = JSON.parse(text) as Bundle
  if (parsed.app !== 'margin-reader' || !Array.isArray(parsed.docs)) {
    throw new Error('这不是伴读导出的备份文件')
  }
  const docs: Doc[] = []
  for (const d of parsed.docs) {
    const { blob, ...rest } = d
    docs.push({ ...(rest as Doc), blob: blob ? await base64ToBlob(blob) : undefined })
  }
  await db.transaction(
    'rw',
    [db.docs, db.blocks, db.anchors, db.notes, db.stucks, db.msgs, db.folders, db.settings],
    async () => {
      await Promise.all([
        db.docs.clear(), db.blocks.clear(), db.anchors.clear(), db.notes.clear(),
        db.stucks.clear(), db.msgs.clear(), db.folders.clear(),
      ])
      await db.docs.bulkPut(docs)
      if (parsed.blocks?.length) await db.blocks.bulkPut(parsed.blocks)
      if (parsed.anchors?.length) await db.anchors.bulkPut(parsed.anchors)
      if (parsed.notes?.length) await db.notes.bulkPut(parsed.notes)
      if (parsed.stucks?.length) await db.stucks.bulkPut(parsed.stucks)
      if (parsed.folders?.length) await db.folders.bulkPut(parsed.folders)
      if (parsed.settings) await db.settings.put({ key: 'settings', value: parsed.settings })
    },
  )
  return { docs: docs.length, notes: parsed.notes?.length ?? 0 }
}

export function docMarkdown(input: {
  doc: Doc
  blocks: Block[]
  anchors: Anchor[]
  notes: Note[]
  stucks: Stuck[]
}): string {
  const { doc, blocks, anchors, notes, stucks } = input
  const anchorById = new Map(anchors.map((a) => [a.id, a]))
  const lines: string[] = [
    `# ${doc.title}`,
    '',
    `> 导出时间：${new Date().toLocaleString('zh-CN')} · ${doc.blockCount} 段 · 已读至第 ${doc.frontierIdx + 1} 段`,
    '',
  ]

  if (doc.outline.length) {
    lines.push('## 大纲', '')
    for (const node of doc.outline) {
      lines.push(`${'  '.repeat(Math.max(0, node.level - 1))}- ${node.title}`)
    }
    lines.push('')
  }

  const sorted = notes
    .map((n) => ({ note: n, anchor: anchorById.get(n.anchorId) }))
    .sort((a, b) => (a.anchor?.blockIdx ?? 0) - (b.anchor?.blockIdx ?? 0))

  lines.push('## 批注', '')
  if (!sorted.length) lines.push('（还没有批注）', '')
  for (const { note, anchor } of sorted) {
    lines.push(`### ${anchor ? `第 ${(anchor.blockIdx ?? 0) + 1} 段` : '位置丢失'}`)
    if (anchor) lines.push(`> ${anchor.quote.exact.replace(/\n/g, ' ')}`)
    lines.push('', note.body, '')
    if (note.critique) {
      lines.push(`*AI ${note.critique.mode === 'socratic' ? '追问' : '校对'}（${note.critique.model}）：*`, '', note.critique.text, '')
    }
  }

  const openStuck = stucks.filter((s) => !s.resolved)
  if (openStuck.length) {
    lines.push('## 未解决的卡点', '')
    for (const s of openStuck) {
      const anchor = anchorById.get(s.anchorId)
      lines.push(`- ${anchor ? `「${anchor.quote.exact.slice(0, 60)}」` : ''} ${s.question || '（没写原因）'}`)
    }
    lines.push('')
  }

  const contextBlock = (idx: number) => {
    const start = Math.max(0, idx - 2)
    return blocks.slice(start, idx + 1).map((b) => b.text).join('\n')
  }

  if (sorted.length) {
    lines.push('## 批注对应原文', '')
    const seen = new Set<number>()
    for (const { anchor } of sorted) {
      if (!anchor || seen.has(anchor.blockIdx)) continue
      seen.add(anchor.blockIdx)
      lines.push(`### 第 ${anchor.blockIdx + 1} 段`, '', contextBlock(anchor.blockIdx), '')
    }
  }

  return lines.join('\n')
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
