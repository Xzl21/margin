import type { HighlightKey, NoteCategory, ProviderConfig, SearchProvider, Settings } from '../types'

export const SEARCH_PRESETS: SearchProvider[] = [
  { id: 'tavily', name: 'Tavily', kind: 'tavily', apiKey: '', proxy: true },
  { id: 'brave', name: 'Brave Search', kind: 'brave', apiKey: '', proxy: true },
  { id: 'serper', name: 'Serper（Google）', kind: 'serper', apiKey: '', proxy: true },
  { id: 'searxng', name: 'SearXNG（自建，免费）', kind: 'searxng', apiKey: '', endpoint: '', proxy: true },
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

export const DEFAULT_NOTE_CATEGORIES: NoteCategory[] = [
  { id: 'think', label: '想法', color: '#c98f2e' },
  { id: 'question', label: '疑问', color: '#3f7cac' },
  { id: 'objection', label: '反驳', color: '#b4524a' },
  { id: 'summary', label: '复述', color: '#4f8a5b' },
  { id: 'todo', label: '待查', color: '#8a6bbf' },
]

/** 空字符串表示跟随主题的默认色 */
export const DEFAULT_HIGHLIGHT_COLORS: Record<HighlightKey, string> = {
  note: '',
  stuck: '',
  mark: '',
  'verify-ok': '',
  'verify-unknown': '',
}

export const HIGHLIGHT_LABELS: Record<HighlightKey, string> = {
  note: '批注',
  stuck: '卡点',
  mark: '划线',
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
      verify: { ...route },
      critique: { ...route },
      map: { ...route },
    },
    stance: 'socratic',
    noSpoiler: true,
    fontSize: 18,
    zoom: 1,
    theme: 'paper',
    proxyBase: '/api/proxy',
    noteCategories: DEFAULT_NOTE_CATEGORIES.map((c) => ({ ...c })),
    highlightColors: { ...DEFAULT_HIGHLIGHT_COLORS },
    search: {
      providers: SEARCH_PRESETS.map((p) => ({ ...p })),
      activeId: 'tavily',
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

/** 检索服务是否可用：searxng 只要有实例地址，其余要 Key。 */
export function searchReady(settings: Settings): boolean {
  const provider = searchProviderById(settings, settings.search.activeId)
  if (!provider) return false
  if (provider.kind === 'searxng') return Boolean(provider.endpoint?.trim())
  return provider.apiKey.trim().length > 8
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
