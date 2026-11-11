import { create } from 'zustand'
import { db, loadSettings, saveSettings } from './db'
import { defaultSettings } from './ai/presets'
import { parseFile } from './ingest/parse'
import type {
  Anchor, Block, Captured, DepMap, Doc, Note, NoteKind, Settings, Stuck,
} from './types'
import { uuid } from './lib/util'

interface AppStore {
  ready: boolean
  busy: string | null
  error: string | null
  docs: Doc[]
  doc: Doc | null
  blocks: Block[]
  anchors: Anchor[]
  notes: Note[]
  stucks: Stuck[]
  settings: Settings

  init: () => Promise<void>
  refreshDocs: () => Promise<void>
  importFiles: (files: File[]) => Promise<void>
  openDoc: (id: string) => Promise<void>
  closeDoc: () => void
  deleteDoc: (id: string) => Promise<void>

  patchSettings: (patch: Partial<Settings>) => Promise<void>
  saveProvider: (provider: import('./types').ProviderConfig) => Promise<void>
  removeProvider: (id: string) => Promise<void>

  ensureAnchor: (captured: Captured) => Promise<Anchor>
  addNote: (anchorId: string, body: string, kind: NoteKind) => Promise<Note>
  removeNote: (id: string) => Promise<void>
  saveCritique: (noteId: string, text: string, mode: Settings['stance'], model: string) => Promise<void>

  addStuck: (anchorId: string, question: string) => Promise<void>
  setStuckResolved: (id: string, resolved: boolean) => Promise<void>

  setMap: (map: DepMap) => Promise<void>
  advanceFrontier: (idx: number) => void
  setError: (msg: string | null) => void
}

let frontierTimer: number | undefined

export const useApp = create<AppStore>()((set, get) => ({
  ready: false,
  busy: null,
  error: null,
  docs: [],
  doc: null,
  blocks: [],
  anchors: [],
  notes: [],
  stucks: [],
  settings: defaultSettings(),

  async init() {
    const settings = (await loadSettings()) ?? defaultSettings()
    await saveSettings(settings)
    const docs = await db.docs.orderBy('lastReadAt').reverse().toArray()
    set({ ready: true, settings, docs })
  },

  async refreshDocs() {
    const docs = await db.docs.orderBy('lastReadAt').reverse().toArray()
    set({ docs })
  },

  async importFiles(files) {
    const list = files.filter(Boolean)
    if (!list.length) return
    for (const file of list) {
      set({ busy: `正在解析 ${file.name}…`, error: null })
      try {
        const parsed = await parseFile(file)
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
          blob: parsed.blob,
        }
        await db.transaction('rw', db.docs, db.blocks, async () => {
          await db.docs.put(doc)
          await db.blocks.bulkPut(parsed.blocks)
        })
        await get().refreshDocs()
        await get().openDoc(doc.id)
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
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
      const stucks = await db.stucks.where('docId').equals(id).toArray()
      stucks.sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.createdAt - b.createdAt)
      // 只有被批注/卡点引用过的锚点才该留下：以前的版本会在「解释」时就落一个锚点，
      // 结果没存成批注也会在正文里留一道划线。这里顺手清掉这些孤儿锚点。
      const used = new Set([...notes.map((n) => n.anchorId), ...stucks.map((s) => s.anchorId)])
      const orphans = anchors.filter((a) => !used.has(a.id))
      if (orphans.length) await db.anchors.bulkDelete(orphans.map((a) => a.id))
      const keptAnchors = anchors.filter((a) => used.has(a.id))
      const updated: Doc = { ...doc, lastReadAt: Date.now(), frontierIdx: Math.max(doc.frontierIdx, 0) }
      await db.docs.put(updated)
      set({ doc: updated, blocks, anchors: keptAnchors, notes, stucks, busy: null })
      void get().refreshDocs()
    } catch (err) {
      set({ busy: null, error: err instanceof Error ? err.message : String(err) })
    }
  },

  closeDoc() {
    set({ doc: null, blocks: [], anchors: [], notes: [], stucks: [] })
  },

  async deleteDoc(id) {
    await db.transaction(
      'rw',
      [db.docs, db.blocks, db.anchors, db.notes, db.stucks, db.msgs, db.cache],
      async () => {
        await db.docs.delete(id)
        await db.blocks.where('docId').equals(id).delete()
        await db.anchors.where('docId').equals(id).delete()
        await db.notes.where('docId').equals(id).delete()
        await db.stucks.where('docId').equals(id).delete()
        await db.msgs.where('docId').equals(id).delete()
      },
    )
    if (get().doc?.id === id) get().closeDoc()
    await get().refreshDocs()
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

  async removeNote(id) {
    const note = get().notes.find((n) => n.id === id)
    await db.notes.delete(id)
    const notes = get().notes.filter((n) => n.id !== id)
    if (note) {
      const used =
        notes.some((n) => n.anchorId === note.anchorId) ||
        get().stucks.some((s) => s.anchorId === note.anchorId)
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

  async addStuck(anchorId, question) {
    const doc = get().doc
    if (!doc) return
    const existing = get().stucks.find((s) => s.anchorId === anchorId && !s.resolved)
    if (existing) return
    const stuck: Stuck = {
      id: uuid(),
      docId: doc.id,
      anchorId,
      question: question.trim(),
      resolved: false,
      createdAt: Date.now(),
    }
    await db.stucks.put(stuck)
    set({ stucks: [...get().stucks, stuck] })
  },

  async setStuckResolved(id, resolved) {
    const s = get().stucks.find((x) => x.id === id)
    if (!s) return
    const updated = { ...s, resolved }
    await db.stucks.put(updated)
    set({ stucks: get().stucks.map((x) => (x.id === id ? updated : x)) })
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
