export type DocKind = 'pdf' | 'docx' | 'md' | 'txt'
export type BlockKind = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'quote' | 'pre' | 'table' | 'line'

export interface Block {
  id: string
  docId: string
  idx: number
  kind: BlockKind
  text: string
  html?: string
  page?: number
}

export interface OutlineNode {
  id: string
  title: string
  level: number
  blockIdx: number
}

export interface DepNode {
  id: string
  title: string
  kind: 'claim' | 'premise' | 'definition' | 'method' | 'conclusion'
  note?: string
  blockIdx?: number
}

/** from 是前提，to 是依赖它的后件：读懂 to 之前先懂 from */
export interface DepEdge {
  from: string
  to: string
  why?: string
}

export interface DepMap {
  nodes: DepNode[]
  edges: DepEdge[]
  createdAt: number
  model?: string
}

export interface Doc {
  id: string
  title: string
  kind: DocKind
  hash: string
  size: number
  addedAt: number
  lastReadAt: number
  blockCount: number
  charCount: number
  pageCount?: number
  outline: OutlineNode[]
  map?: DepMap
  /** 已读到的最远块序号，用于「不剧透」 */
  frontierIdx: number
  /** 所属文件夹；空或不存在表示未分类 */
  folderId?: string | null
  blob?: Blob
}

/** 书架上的自定义分类文件夹 */
export interface Folder {
  id: string
  name: string
  createdAt: number
}

/** 相对页面左上角的归一化矩形（0..1） */
export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Anchor {
  id: string
  docId: string
  blockId: string
  blockIdx: number
  quote: { exact: string; prefix: string; suffix: string }
  page?: number
  rects?: NormRect[]
  /** 'mark' = 只是划了线，不写批注；'verify' = 查证结论的标记；其余（undefined）是批注/卡点的定位锚点。 */
  kind?: 'mark' | 'verify'
  /** 仅 kind==='verify' 时有效：证实 / 未证实。 */
  verdict?: 'ok' | 'unknown'
  createdAt: number
}

export type NoteKind = 'think' | 'question' | 'objection' | 'summary' | 'todo'

export interface Note {
  id: string
  docId: string
  anchorId: string
  body: string
  kind: NoteKind
  createdAt: number
  updatedAt: number
  critique?: {
    text: string
    mode: 'socratic' | 'corrective'
    model: string
    at: number
  }
}

export interface Stuck {
  id: string
  docId: string
  anchorId: string
  question: string
  resolved: boolean
  createdAt: number
}

export type TaskKind = 'explain' | 'ask' | 'critique' | 'map' | 'recap'

export interface AiMsg {
  id: string
  docId: string
  anchorId?: string
  task: TaskKind
  role: 'user' | 'assistant'
  content: string
  model?: string
  createdAt: number
}

export interface CacheRow {
  key: string
  content: string
  createdAt: number
}

export interface ProviderConfig {
  id: string
  name: string
  baseURL: string
  apiKey: string
  models: string[]
  /** 经本地 /api/proxy 转发，绕过浏览器 CORS */
  proxy: boolean
}

export type SearchKind = 'tavily' | 'brave' | 'serper' | 'searxng'

/** 联网检索服务（给「查证」用）。密钥同样只存在本地。 */
export interface SearchProvider {
  id: string
  name: string
  kind: SearchKind
  apiKey: string
  /** 仅 searxng 需要：实例地址，例如 https://searx.be */
  endpoint?: string
  proxy: boolean
}

export interface SearchSettings {
  providers: SearchProvider[]
  activeId: string
  maxResults: number
}

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

export interface Route {
  providerId: string
  model: string
}

export interface Settings {
  providers: ProviderConfig[]
  routing: Record<'explain' | 'ask' | 'critique' | 'map', Route>
  search: SearchSettings
  stance: 'socratic' | 'corrective'
  noSpoiler: boolean
  fontSize: number
  /** 正文缩放，1 = 原始大小，仅影响阅读区域。 */
  zoom: number
  theme: 'paper' | 'plain' | 'dark'
  proxyBase: string
}

export interface Captured {
  blockId: string
  blockIdx: number
  quote: string
  prefix: string
  suffix: string
  page?: number
  rects?: NormRect[]
}
