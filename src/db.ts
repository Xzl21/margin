import Dexie, { type Table } from 'dexie'
import type {
  AiMsg, Anchor, Ask, Block, CacheRow, Doc, Folder, Note, Settings, Stuck,
} from './types'
import { defaultSettings, upgradeLegacyModels } from './ai/presets'

export class MarginDB extends Dexie {
  docs!: Table<Doc, string>
  blocks!: Table<Block, string>
  anchors!: Table<Anchor, string>
  notes!: Table<Note, string>
  stucks!: Table<Stuck, string>
  msgs!: Table<AiMsg, string>
  cache!: Table<CacheRow, string>
  settings!: Table<{ key: string; value: unknown }, string>
  folders!: Table<Folder, string>
  asks!: Table<Ask, string>

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
  }
}

export const db = new MarginDB()

export async function loadSettings(): Promise<Settings | undefined> {
  const row = await db.settings.get('settings')
  if (!row) return undefined
  // 旧版本存下来的设置可能缺字段（例如后加的 search），合并一次默认值
  const base = defaultSettings()
  const stored = row.value as Partial<Settings>
  const merged: Settings = {
    ...base,
    ...stored,
    providers: stored.providers?.length ? stored.providers : base.providers,
    routing: { ...base.routing, ...(stored.routing ?? {}) },
    search: {
      ...base.search,
      ...(stored.search ?? {}),
      providers: stored.search?.providers?.length ? stored.search.providers : base.search.providers,
    },
  }
  return upgradeLegacyModels(merged)
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.settings.put({ key: 'settings', value: s })
}
