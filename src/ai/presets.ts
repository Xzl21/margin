import type { HighlightKey, NoteCategory, ProviderConfig, SearchProvider, Settings } from '../types'

export const SEARCH_PRESETS: SearchProvider[] = [
  // 只保留 DeepSeek 官方搜索：复用「模型」页里的 DeepSeek Key，不用再买第二个服务
  { id: 'deepseek', name: 'DeepSeek 搜索', kind: 'deepseek', apiKey: '', proxy: true },
]

/**
 * 只保留 DeepSeek 一家预置；其余厂商走「添加自定义」（任何 OpenAI 兼容接口都行）。
 * baseURL 用官方当前推荐的 https://api.deepseek.com，客户端会自己拼 /chat/completions。
 */
export const PROVIDER_PRESETS: ProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'],
    proxy: true,
  },
]

/**
 * 内置批注类别：解释 / 概念 / 想法 / 自定义。
 * 「解释」「概念」由对应功能一键存成批注时自动归类；用户可改名、改色、增删。
 */
export const DEFAULT_NOTE_CATEGORIES: NoteCategory[] = [
  { id: 'explain', label: '解释', color: '#3f7cac' },
  { id: 'concept', label: '概念', color: '#4f8a5b' },
  { id: 'think', label: '想法', color: '#c98f2e' },
  { id: 'custom', label: '自定义', color: '#8a6bbf' },
]

/** 旧版类别 id → 新版：原「疑问/反驳/复述/待查」统一并到「想法」。 */
export const LEGACY_NOTE_KINDS: Record<string, string> = {
  question: 'think',
  objection: 'think',
  summary: 'think',
  todo: 'think',
  note: 'custom',
}

/** 把存在浏览器里的旧类别列表整理成新结构（保证「解释 / 概念」存在，退役旧 id）。 */
export function normalizeNoteCategories(cats: NoteCategory[] | undefined): NoteCategory[] {
  const defaults = DEFAULT_NOTE_CATEGORIES.map((c) => ({ ...c }))
  if (!cats?.length) return defaults
  const retired = new Set(Object.keys(LEGACY_NOTE_KINDS))
  const kept = cats
    .filter((c) => !retired.has(c.id))
    .map((c) => ({ ...c }))
  const merged = [...kept]
  for (const def of defaults) {
    if (!merged.some((c) => c.id === def.id)) merged.push(def)
  }
  // 「解释」「概念」排在最前，方便一键保存时对应
  const head = merged.filter((c) => c.id === 'explain' || c.id === 'concept')
  const rest = merged.filter((c) => c.id !== 'explain' && c.id !== 'concept')
  return [...head, ...rest]
}

/** 空字符串表示跟随主题的默认色 */
export const DEFAULT_HIGHLIGHT_COLORS: Record<HighlightKey, string> = {
  note: '',
  mark: '',
  ask: '',
  'verify-ok': '',
  'verify-unknown': '',
}

export const HIGHLIGHT_LABELS: Record<HighlightKey, string> = {
  note: '批注',
  mark: '划线',
  ask: '提问',
  'verify-ok': '查证·证实',
  'verify-unknown': '查证·未证实',
}

export function defaultSettings(): Settings {
  const providers = PROVIDER_PRESETS.map((p) => ({ ...p, models: [...p.models] }))
  const route = { providerId: 'deepseek', model: 'deepseek-flash' }
  return {
    providers,
    routing: {
      explain: { ...route },
      ask: { ...route },
      verify: { ...route },
      critique: { ...route },
      map: { ...route },
    },
    // 解释/概念要快，关掉思考；点评/查证/路线要判断力，保留深度思考
    thinking: {
      explain: 'off',
      concept: 'off',
      ask: 'off',
      verify: 'high',
      critique: 'high',
      map: 'high',
    },
    stance: 'socratic',
    noSpoiler: false,
    fontSize: 18,
    zoom: 1,
    sideWidth: 340,
    panelOpen: true,
    railOpen: true,
    theme: 'paper',
    proxyBase: '/api/proxy',
    noteCategories: DEFAULT_NOTE_CATEGORIES.map((c) => ({ ...c })),
    highlightColors: { ...DEFAULT_HIGHLIGHT_COLORS },
    search: {
      providers: SEARCH_PRESETS.map((p) => ({ ...p })),
      activeId: 'deepseek',
      maxResults: 5,
    },
  }
}

/**
 * 移除已经不再预置的厂商（qwen / kimi / glm / openai / openrouter / ollama），
 * 但保留：DeepSeek 本身、用户自己加的 custom-*、以及还被某个任务引用的厂商。
 */
export function pruneProviders(
  providers: ProviderConfig[],
  routing: Settings['routing'],
): ProviderConfig[] {
  const used = new Set(Object.values(routing).map((r) => r.providerId))
  const kept = providers.filter(
    (p) => p.id === 'deepseek' || p.id.startsWith('custom-') || used.has(p.id),
  )
  if (!kept.some((p) => p.id === 'deepseek')) {
    kept.unshift({ ...PROVIDER_PRESETS[0], models: [...PROVIDER_PRESETS[0].models] })
  }
  return kept
}

export function providerById(settings: Settings, id: string): ProviderConfig | undefined {
  return settings.providers.find((p) => p.id === id)
}

export function routeReady(settings: Settings, task: keyof Settings['routing']): boolean {
  const route = settings.routing[task]
  const provider = providerById(settings, route.providerId)
  if (!provider) return false
  if (provider.id === 'ollama') return true
  return provider.apiKey.trim().length > 4
}

export function searchProviderById(settings: Settings, id: string): SearchProvider | undefined {
  return settings.search.providers.find((p) => p.id === id)
}

/** 检索是否可用：DeepSeek 搜索复用「模型」页里的 DeepSeek Key。 */
export function searchReady(settings: Settings): boolean {
  return deepseekKey(settings).length > 4
}

/** DeepSeek 搜索/抓取用的 Key：优先「模型」页里的 DeepSeek 厂商，其次搜索卡片里自己填的。 */
export function deepseekKey(settings: Settings): string {
  const llm = settings.providers.find((p) => p.id === 'deepseek')
  const own = settings.search.providers.find((p) => p.id === 'deepseek')
  return (llm?.apiKey ?? '').trim() || (own?.apiKey ?? '').trim()
}

/** 只保留 DeepSeek 搜索这一项，顺手清掉旧版本存下来的 Tavily / Brave / Serper / SearXNG。 */
export function normalizeSearch(search: Settings['search']): Settings['search'] {
  const own = (search.providers ?? []).find((p) => p.id === 'deepseek')
  const provider: SearchProvider = { ...SEARCH_PRESETS[0], ...own, kind: 'deepseek', name: SEARCH_PRESETS[0].name }
  return {
    providers: [provider],
    activeId: 'deepseek',
    maxResults: Math.max(1, Math.min(10, search.maxResults || 5)),
  }
}

/**
 * DeepSeek 官方 2026-07-24 停用了 deepseek-chat / deepseek-reasoner，
 * 旧版本存在浏览器里的配置需要平滑迁到新模型名，否则一打开就调用失败。
 */
export const LEGACY_DEEPSEEK_MODELS: Record<string, string> = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
}

export function upgradeLegacyModels(settings: Settings): Settings {
  const routing = { ...settings.routing }
  for (const task of Object.keys(routing) as (keyof Settings['routing'])[]) {
    const route = routing[task]
    const next = LEGACY_DEEPSEEK_MODELS[route.model]
    if (next) routing[task] = { ...route, model: next }
  }
  const providers = settings.providers.map((p) => {
    if (p.id !== 'deepseek') return p
    const renamed = p.models.map((m) => LEGACY_DEEPSEEK_MODELS[m] ?? m)
    const models = [...new Set([...renamed, 'deepseek-flash', 'deepseek-v4-pro'])]
    return { ...p, models }
  })
  return { ...settings, routing, providers }
}
