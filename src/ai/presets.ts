import type { ProviderConfig, SearchProvider, Settings } from '../types'

export const SEARCH_PRESETS: SearchProvider[] = [
  { id: 'tavily', name: 'Tavily', kind: 'tavily', apiKey: '', proxy: true },
  { id: 'brave', name: 'Brave Search', kind: 'brave', apiKey: '', proxy: true },
  { id: 'serper', name: 'Serper（Google）', kind: 'serper', apiKey: '', proxy: true },
  { id: 'searxng', name: 'SearXNG（自建，免费）', kind: 'searxng', apiKey: '', endpoint: '', proxy: true },
]

export const PROVIDER_PRESETS: ProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'],
    proxy: true,
  },
  {
    id: 'qwen',
    name: '通义千问（阿里云）',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    proxy: true,
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKey: '',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    proxy: true,
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'],
    proxy: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    models: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1'],
    proxy: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: '',
    models: ['deepseek/deepseek-chat-v3-0324', 'google/gemini-2.5-flash', 'anthropic/claude-sonnet-4'],
    proxy: false,
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseURL: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'],
    proxy: false,
  },
]

export function defaultSettings(): Settings {
  const providers = PROVIDER_PRESETS.map((p) => ({ ...p, models: [...p.models] }))
  const route = { providerId: 'deepseek', model: 'deepseek-flash' }
  return {
    providers,
    routing: {
      explain: { ...route },
      ask: { ...route },
      critique: { ...route },
      map: { ...route },
    },
    stance: 'socratic',
    noSpoiler: true,
    fontSize: 18,
    zoom: 1,
    theme: 'paper',
    proxyBase: '/api/proxy',
    search: {
      providers: SEARCH_PRESETS.map((p) => ({ ...p })),
      activeId: 'tavily',
      maxResults: 5,
    },
  }
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
