import Dexie, { type Table } from 'dexie'
import type { AiMsg, Anchor, Block, CacheRow, Doc, Folder, Note, Route, Settings } from './types'
import {
  defaultSettings, LEGACY_NOTE_KINDS, normalizeNoteCategories, pruneProviders, upgradeLegacyModels,
} from './ai/presets'

export class MarginDB extends Dexie {
  docs!: Table<Doc, string>
  blocks!: Table<Block, string>
  anchors!: Table<Anchor, string>
  notes!: Table<Note, string>
  msgs!: Table<AiMsg, string>
  cache!: Table<CacheRow, string>
  settings!: Table<{ key: string; value: unknown }, string>
  folders!: Table<Folder, string>

  constructor() {
    super('margin-reader')
    this.version(1).stores({
      docs: 'id, addedAt, lastReadAt',
      blocks: 'id, docId, idx, [docId+idx]',
      anchors: 'id, docId, blockId, blockIdx',
      notes: 'id, docId, anchorId, createdAt',
      stucks: 'id, docId, resolved, createdAt',
      msgs: 'id, docId, anchorId, createdAt',
      cache: 'key, createdAt',
      settings: 'key',
    })
    // v2：书架分类文件夹
    this.version(2).stores({
      docs: 'id, addedAt, lastReadAt, folderId',
      blocks: 'id, docId, idx, [docId+idx]',
      anchors: 'id, docId, blockId, blockIdx',
      notes: 'id, docId, anchorId, createdAt',
      stucks: 'id, docId, resolved, createdAt',
      msgs: 'id, docId, anchorId, createdAt',
      cache: 'key, createdAt',
      settings: 'key',
      folders: 'id, createdAt',
    })
    // v3：提问记录
    this.version(3).stores({
      docs: 'id, addedAt, lastReadAt, folderId',
      blocks: 'id, docId, idx, [docId+idx]',
      anchors: 'id, docId, blockId, blockIdx',
      notes: 'id, docId, anchorId, createdAt',
      stucks: 'id, docId, resolved, createdAt',
      msgs: 'id, docId, anchorId, createdAt',
      cache: 'key, createdAt',
      settings: 'key',
      folders: 'id, createdAt',
      asks: 'id, docId, anchorId, createdAt',
    })
    // v4：去掉「提问」功能，把它留下的表一起清掉
    this.version(4).stores({ asks: null })
    // v5：去掉「卡点」，并把旧批注类别并到新的四类（解释 / 概念 / 想法 / 自定义）
    this.version(5)
      .stores({ stucks: null })
      .upgrade(async (tx) => {
        await tx
          .table('notes')
          .toCollection()
          .modify((note: Note) => {
            const next = LEGACY_NOTE_KINDS[note.kind]
            if (next) note.kind = next
          })
      })
  }
}

export const db = new MarginDB()

export async function loadSettings(): Promise<Settings | undefined> {
  const row = await db.settings.get('settings')
  if (!row) return undefined
  // 旧版本存下来的设置可能缺字段（例如后加的 search），合并一次默认值
  const base = defaultSettings()
  const stored = row.value as Partial<Settings>
  const storedRouting = (stored.routing ?? {}) as Record<string, Route>
  const merged: Settings = {
    ...base,
    ...stored,
    providers: stored.providers?.length ? stored.providers : base.providers,
    // 旧设置里这一项叫 ask（提问）；提问功能已删，把它迁移成查证用的路由。
    routing: {
      explain: storedRouting.explain ?? base.routing.explain,
      verify: storedRouting.verify ?? storedRouting.ask ?? base.routing.verify,
      critique: storedRouting.critique ?? base.routing.critique,
      map: storedRouting.map ?? base.routing.map,
    },
    search: {
      ...base.search,
      ...(stored.search ?? {}),
      providers: stored.search?.providers?.length ? stored.search.providers : base.search.providers,
    },
    noteCategories: normalizeNoteCategories(stored.noteCategories),
    highlightColors: { ...base.highlightColors, ...(stored.highlightColors ?? {}) },
  }
  // 老版本预置了一堆厂商，现在只留 DeepSeek + 自定义；用户自己配过、或任务还在用的继续保留。
  merged.providers = pruneProviders(merged.providers, merged.routing)
  return upgradeLegacyModels(merged)
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.settings.put({ key: 'settings', value: s })
}
