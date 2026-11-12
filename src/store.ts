import { create } from 'zustand'
import { db, loadSettings, saveSettings } from './db'
import { defaultSettings } from './ai/presets'
import { parseFile } from './ingest/parse'
import type {
  Anchor, Block, Captured, DepMap, Doc, Folder, Note, NoteKind, Settings,
} from './types'
import { uuid } from './lib/util'

interface AppStore {
  ready: boolean
  busy: string | null
  error: string | null
  docs: Doc[]
  folders: Folder[]
  doc: Doc | null
  blocks: Block[]
  anchors: Anchor[]
  notes: Note[]
  settings: Settings

  init: () => Promise<void>
  refreshDocs: () => Promise<void>
  importFiles: (files: File[], folderId?: string | null) => Promise<void>
  openDoc: (id: string) => Promise<void>
  closeDoc: () => void
  deleteDoc: (id: string) => Promise<void>
  createFolder: (name: string) => Promise<Folder>
  renameFolder: (id: string, name: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  moveDoc: (docId: string, folderId: string | null) => Promise<void>

  patchSettings: (patch: Partial<Settings>) => Promise<void>
  saveProvider: (provider: import('./types').ProviderConfig) => Promise<void>
  removeProvider: (id: string) => Promise<void>

  ensureAnchor: (captured: Captured) => Promise<Anchor>
  ensureMark: (captured: Captured) => Promise<Anchor>
  ensureVerify: (captured: Captured, verdict: 'ok' | 'unknown', text?: string) => Promise<Anchor>
  removeMark: (id: string) => Promise<void>
  addNote: (anchorId: string, body: string, kind: NoteKind) => Promise<Note>
  updateNote: (id: string, body: string, kind?: string) => Promise<void>
  removeNote: (id: string) => Promise<void>
  saveCritique: (noteId: string, text: string, mode: Settings['stance'], model: string) => Promise<void>
  removeCritique: (noteId: string) => Promise<void>

  setMap: (map: DepMap) => Promise<void>
  advanceFrontier: (idx: number) => void
  setError: (msg: string | null) => void
}

let frontierTimer: number | undefined

// 把底层英文异常翻成用户能行动的中文提示。
function importErrorMessage(err: unknown, name: string): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/detached|ArrayBuffer/i.test(raw)) {
    return `「${name}」在读文件时被浏览器打断，请再导入一次。`
  }
  if (/password/i.test(raw)) {
    return `「${name}」有密码保护，先另存一份无密码的 PDF 再导入。`
  }
  if (/InvalidPDF|Invalid PDF|Missing PDF|Invalid argument/i.test(raw)) {
    return `「${name}」不是有效的 PDF，文件可能已损坏。`
  }
  if (/OCR|扫描/i.test(raw)) return raw
  return `「${name}」导入失败：${raw}`
}

export const useApp = create<AppStore>()((set, get) => ({
  ready: false,
  busy: null,
  error: null,
  docs: [],
  folders: [],
  doc: null,
  blocks: [],
  anchors: [],
  notes: [],
  settings: defaultSettings(),

  async init() {
    const settings = (await loadSettings()) ?? defaultSettings()
    await saveSettings(settings)
    const [docs, folders] = await Promise.all([
      db.docs.orderBy('lastReadAt').reverse().toArray(),
      db.folders.orderBy('createdAt').toArray(),
    ])
    set({ ready: true, settings, docs, folders })
  },

  async refreshDocs() {
    const docs = await db.docs.orderBy('lastReadAt').reverse().toArray()
    set({ docs })
  },

  async importFiles(files, folderId = null) {
    const list = files.filter(Boolean)
    if (!list.length) return
    for (const file of list) {
      set({ busy: `正在解析 ${file.name}…`, error: null })
      try {
        const parsed = await parseFile(file)
        if (!parsed.blocks.length) {
          throw new Error(
            `「${file.name}」里没有可读文字，可能是扫描件。先用 OCR 转成带文字层的 PDF，或把正文复制成 Markdown/TXT 再导入。`,
          )
        }
        const existing = await db.docs.get(parsed.hash.slice(0, 16))
        if (existing) {
          await get().openDoc(existing.id)
          continue
        }
        const doc: Doc = {
          id: parsed.hash.slice(0, 16),
          title: parsed.title,
          kind: parsed.kind,
          hash: parsed.hash,
          size: parsed.size,
          addedAt: Date.now(),
          lastReadAt: Date.now(),
          blockCount: parsed.blocks.length,
          charCount: parsed.charCount,
          pageCount: parsed.pageCount,
          outline: parsed.outline,
          frontierIdx: 0,
          folderId: folderId ?? null,
          blob: parsed.blob,
        }
        await db.transaction('rw', db.docs, db.blocks, async () => {
          await db.docs.put(doc)
          await db.blocks.bulkPut(parsed.blocks)
        })
        await get().refreshDocs()
        await get().openDoc(doc.id)
      } catch (err) {
        set({ error: importErrorMessage(err, file.name) })
      }
    }
    set({ busy: null })
  },

  async openDoc(id) {
    set({ busy: '正在打开…', error: null })
    try {
      const doc = await db.docs.get(id)
      if (!doc) throw new Error('找不到这份文档')
      const blocks = await db.blocks.where('docId').equals(id).toArray()
      blocks.sort((a, b) => a.idx - b.idx)
      const anchors = await db.anchors.where('docId').equals(id).toArray()
      const anchorIds = new Set(anchors.map((a) => a.id))
      const allNotes = await db.notes.where('docId').equals(id).toArray()
      const notes = allNotes.filter((n) => anchorIds.has(n.anchorId)).sort((a, b) => a.createdAt - b.createdAt)
      // 只有被批注引用过、或用户明确划了线/标了查证结论的锚点才该留下：以前的版本会在「解释」
      // 时就落一个锚点，结果没存成批注也会在正文里留一道划线。这里顺手清掉这些孤儿锚点。
      const used = new Set([...notes.map((n) => n.anchorId)])
      const keep = (a: Anchor) => used.has(a.id) || a.kind === 'mark' || a.kind === 'verify'
      const orphans = anchors.filter((a) => !keep(a))
      if (orphans.length) await db.anchors.bulkDelete(orphans.map((a) => a.id))
      const keptAnchors = anchors.filter(keep)
      const updated: Doc = { ...doc, lastReadAt: Date.now(), frontierIdx: Math.max(doc.frontierIdx, 0) }
      await db.docs.put(updated)
      set({ doc: updated, blocks, anchors: keptAnchors, notes, busy: null })
      void get().refreshDocs()
    } catch (err) {
      set({ busy: null, error: err instanceof Error ? err.message : String(err) })
    }
  },

  closeDoc() {
    set({ doc: null, blocks: [], anchors: [], notes: [] })
  },

  async deleteDoc(id) {
    await db.transaction(
      'rw',
      [db.docs, db.blocks, db.anchors, db.notes, db.msgs, db.cache],
      async () => {
        await db.docs.delete(id)
        await db.blocks.where('docId').equals(id).delete()
        await db.anchors.where('docId').equals(id).delete()
        await db.notes.where('docId').equals(id).delete()
        await db.msgs.where('docId').equals(id).delete()
      },
    )
    if (get().doc?.id === id) get().closeDoc()
    await get().refreshDocs()
  },

  async createFolder(name) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('文件夹名不能为空')
    if (get().folders.some((f) => f.name === trimmed)) throw new Error('已经有同名文件夹了')
    const folder: Folder = { id: uuid(), name: trimmed, createdAt: Date.now() }
    await db.folders.put(folder)
    set({ folders: [...get().folders, folder] })
    return folder
  },

  async renameFolder(id, name) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('文件夹名不能为空')
    const folder = get().folders.find((f) => f.id === id)
    if (!folder) return
    const updated = { ...folder, name: trimmed }
    await db.folders.put(updated)
    set({ folders: get().folders.map((f) => (f.id === id ? updated : f)) })
  },

  async deleteFolder(id) {
    // 只删分类，不删文档：里面的文档回到「未分类」
    await db.transaction('rw', db.folders, db.docs, async () => {
      await db.docs.where('folderId').equals(id).modify({ folderId: null })
      await db.folders.delete(id)
    })
    set({
      folders: get().folders.filter((f) => f.id !== id),
      docs: get().docs.map((d) => (d.folderId === id ? { ...d, folderId: null } : d)),
      doc: get().doc?.folderId === id ? { ...get().doc!, folderId: null } : get().doc,
    })
  },

  async moveDoc(docId, folderId) {
    await db.docs.update(docId, { folderId })
    set({
      docs: get().docs.map((d) => (d.id === docId ? { ...d, folderId } : d)),
      doc: get().doc?.id === docId ? { ...get().doc!, folderId } : get().doc,
    })
  },

  async patchSettings(patch) {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    await saveSettings(settings)
  },

  async saveProvider(provider) {
    const settings = get().settings
    const exists = settings.providers.some((p) => p.id === provider.id)
    const providers = exists
      ? settings.providers.map((p) => (p.id === provider.id ? provider : p))
      : [...settings.providers, provider]
    await get().patchSettings({ providers })
  },

  async removeProvider(id) {
    const settings = get().settings
    const providers = settings.providers.filter((p) => p.id !== id)
    const fallback = providers[0]?.id ?? ''
    const routing = { ...settings.routing }
    for (const key of Object.keys(routing) as (keyof Settings['routing'])[]) {
      if (routing[key].providerId === id) routing[key] = { providerId: fallback, model: '' }
    }
    await get().patchSettings({ providers, routing })
  },

  async ensureAnchor(captured) {
    const doc = get().doc
    if (!doc) throw new Error('没有打开的文档')
    const same = get().anchors.find(
      (a) => a.blockId === captured.blockId && a.quote.exact === captured.quote,
    )
    if (same) return same
    const anchor: Anchor = {
      id: uuid(),
      docId: doc.id,
      blockId: captured.blockId,
      blockIdx: captured.blockIdx,
      quote: { exact: captured.quote, prefix: captured.prefix, suffix: captured.suffix },
      page: captured.page,
      rects: captured.rects,
      createdAt: Date.now(),
    }
    await db.anchors.put(anchor)
    set({ anchors: [...get().anchors, anchor] })
    return anchor
  },

  async ensureMark(captured) {
    const doc = get().doc
    if (!doc) throw new Error('没有打开的文档')
    const same = get().anchors.find(
      (a) => a.blockId === captured.blockId && a.quote.exact === captured.quote,
    )
    if (same) {
      if (same.kind === 'mark') return same
      // 这段已经被批注/卡点占着，就顺手把它也当划线显示，不再新建重复锚点。
      const updated: Anchor = { ...same, kind: 'mark' }
      await db.anchors.put(updated)
      set({ anchors: get().anchors.map((a) => (a.id === same.id ? updated : a)) })
      return updated
    }
    const anchor: Anchor = {
      id: uuid(),
      docId: doc.id,
      blockId: captured.blockId,
      blockIdx: captured.blockIdx,
      quote: { exact: captured.quote, prefix: captured.prefix, suffix: captured.suffix },
      page: captured.page,
      rects: captured.rects,
      kind: 'mark',
      createdAt: Date.now(),
    }
    await db.anchors.put(anchor)
    set({ anchors: [...get().anchors, anchor] })
    return anchor
  },

  async ensureVerify(captured, verdict, text) {
    const doc = get().doc
    if (!doc) throw new Error('没有打开的文档')
    const same = get().anchors.find(
      (a) => a.blockId === captured.blockId && a.quote.exact === captured.quote,
    )
    if (same) {
      const updated: Anchor = { ...same, kind: 'verify', verdict, verifyText: text ?? same.verifyText }
      await db.anchors.put(updated)
      set({ anchors: get().anchors.map((a) => (a.id === same.id ? updated : a)) })
      return updated
    }
    const anchor: Anchor = {
      id: uuid(),
      docId: doc.id,
      blockId: captured.blockId,
      blockIdx: captured.blockIdx,
      quote: { exact: captured.quote, prefix: captured.prefix, suffix: captured.suffix },
      page: captured.page,
      rects: captured.rects,
      kind: 'verify',
      verdict,
      verifyText: text,
      createdAt: Date.now(),
    }
    await db.anchors.put(anchor)
    set({ anchors: [...get().anchors, anchor] })
    return anchor
  },

  async removeMark(id) {
    const used = get().notes.some((n) => n.anchorId === id)
    if (used) {
      // 还有批注挂在上面：只去掉「划线」身份，锚点留着给批注用。
      const anchor = get().anchors.find((a) => a.id === id)
      if (!anchor) return
      const updated: Anchor = { ...anchor, kind: undefined }
      await db.anchors.put(updated)
      set({ anchors: get().anchors.map((a) => (a.id === id ? updated : a)) })
      return
    }
    await db.anchors.delete(id)
    set({ anchors: get().anchors.filter((a) => a.id !== id) })
  },

  async addNote(anchorId, body, kind) {
    const doc = get().doc
    if (!doc) throw new Error('没有打开的文档')
    const note: Note = {
      id: uuid(),
      docId: doc.id,
      anchorId,
      body: body.trim(),
      kind,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.notes.put(note)
    set({ notes: [...get().notes, note] })
    return note
  },

  async updateNote(id, body, kind) {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    const updated: Note = {
      ...note,
      body: body.trim(),
      kind: kind?.trim() ? kind : note.kind,
      updatedAt: Date.now(),
    }
    await db.notes.put(updated)
    set({ notes: get().notes.map((n) => (n.id === id ? updated : n)) })
  },

  async removeNote(id) {
    const note = get().notes.find((n) => n.id === id)
    await db.notes.delete(id)
    const notes = get().notes.filter((n) => n.id !== id)
    if (note) {
      const anchor = get().anchors.find((a) => a.id === note.anchorId)
      const used =
        notes.some((n) => n.anchorId === note.anchorId) ||
        anchor?.kind === 'mark' || anchor?.kind === 'verify'
      if (!used) {
        await db.anchors.delete(note.anchorId)
        set({ notes, anchors: get().anchors.filter((a) => a.id !== note.anchorId) })
        return
      }
    }
    set({ notes })
  },

  async saveCritique(noteId, text, mode, model) {
    const note = get().notes.find((n) => n.id === noteId)
    if (!note) return
    const updated: Note = { ...note, critique: { text, mode, model, at: Date.now() }, updatedAt: Date.now() }
    await db.notes.put(updated)
    set({ notes: get().notes.map((n) => (n.id === noteId ? updated : n)) })
  },

  async removeCritique(noteId) {
    const note = get().notes.find((n) => n.id === noteId)
    if (!note) return
    const updated: Note = { ...note, critique: undefined, updatedAt: Date.now() }
    await db.notes.put(updated)
    set({ notes: get().notes.map((n) => (n.id === noteId ? updated : n)) })
  },

  async setMap(map) {
    const doc = get().doc
    if (!doc) return
    const updated = { ...doc, map }
    await db.docs.put(updated)
    set({ doc: updated })
  },

  advanceFrontier(idx) {
    const doc = get().doc
    if (!doc) return
    if (idx <= doc.frontierIdx) return
    const updated = { ...doc, frontierIdx: idx }
    set({ doc: updated })
    if (frontierTimer) window.clearTimeout(frontierTimer)
    frontierTimer = window.setTimeout(() => {
      void db.docs.put({ ...updated, lastReadAt: Date.now() })
    }, 900)
  },

  setError(msg) {
    set({ error: msg })
  },
}))
