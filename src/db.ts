import Dexie, { type Table } from 'dexie'
import type { AiMsg, Anchor, Ask, Block, CacheRow, Doc, Folder, Note, Route, Settings, UsageRow } from './types'
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
  asks!: Table<Ask, string>
  usage!: Table<UsageRow, string>

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
    // v6：提问功能回来了，这次一条提问带完整的多轮对话
    this.version(6).stores({ asks: 'id, docId, anchorId, createdAt' })
    // v7：本机记录每次模型调用的 token 用量
    this.version(7).stores({ usage: 'id, at, task, model' })
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
    // 旧设置里这一项可能缺（提问功能曾被删过），缺了就用默认路由补上。
    routing: {
      explain: storedRouting.explain ?? base.routing.explain,
      ask: storedRouting.ask ?? base.routing.ask,
      verify: storedRouting.verify ?? base.routing.verify,
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
