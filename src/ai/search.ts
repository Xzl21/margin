// 联网检索：把「这句话到底是不是真的」交给搜索结果，而不是模型记忆。
// 所有请求都可以经 /api/proxy 转发（检索 API 基本都不允许浏览器直连）。
import type { SearchHit, SearchProvider, Settings } from '../types'
import { deepseekKey, searchProviderById } from './presets'

const MAX_PAGE_CHARS = 2200
const MAX_DEEPSEEK_PAGE_CHARS = 5000
const DEEPSEEK_TOOLS_BASE = 'https://api.deepseek.com/v1'

function proxied(url: string, proxyBase: string): string {
  const base = proxyBase.trim().replace(/\/+$/, '')
  return base ? `${base}?url=${encodeURIComponent(url)}` : url
}

function target(provider: SearchProvider, url: string, proxyBase: string): string {
  return provider.proxy ? proxied(url, proxyBase) : url
}

async function failure(service: string, res: Response): Promise<Error> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 200)
  } catch {
    /* ignore */
  }
  if (res.status === 401 || res.status === 403) {
    return new Error(`${service} 拒绝了这个 Key（${res.status}）。到「设置 → 联网」检查 Key 和权限。`)
  }
  if (res.status === 429) return new Error(`${service} 说请求太频繁（429），过一会儿再试。`)
  return new Error(`${service} 返回 ${res.status}${detail ? `：${detail}` : ''}`)
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

async function tavily(
  provider: SearchProvider,
  query: string,
  n: number,
  proxyBase: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  // endpoint 留空就用官方地址；填了则当作完整请求地址（自建中转时用得上）
  const url = provider.endpoint?.trim() || 'https://api.tavily.com/search'
  const res = await fetch(target(provider, url, proxyBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: provider.apiKey.trim(),
      query,
      max_results: n,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
    }),
    signal,
  })
  if (!res.ok) throw await failure('Tavily', res)
  const json = (await res.json()) as { results?: Array<Record<string, unknown>> }
  return (json.results ?? []).map((r) => ({
    title: clean(r.title),
    url: clean(r.url),
    snippet: clean(r.content),
  })).filter((h) => h.url)
}

async function brave(
  provider: SearchProvider,
  query: string,
  n: number,
  proxyBase: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`
  const res = await fetch(target(provider, url, proxyBase), {
    headers: { accept: 'application/json', 'x-subscription-token': provider.apiKey.trim() },
    signal,
  })
  if (!res.ok) throw await failure('Brave Search', res)
  const json = (await res.json()) as { web?: { results?: Array<Record<string, unknown>> } }
  return (json.web?.results ?? []).map((r) => ({
    title: clean(r.title),
    url: clean(r.url),
    snippet: clean(r.description),
  })).filter((h) => h.url)
}

async function serper(
  provider: SearchProvider,
  query: string,
  n: number,
  proxyBase: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const res = await fetch(target(provider, 'https://google.serper.dev/search', proxyBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': provider.apiKey.trim() },
    body: JSON.stringify({ q: query, num: n }),
    signal,
  })
  if (!res.ok) throw await failure('Serper', res)
  const json = (await res.json()) as { organic?: Array<Record<string, unknown>> }
  return (json.organic ?? []).map((r) => ({
    title: clean(r.title),
    url: clean(r.link),
    snippet: clean(r.snippet),
  })).filter((h) => h.url)
}

async function searxng(
  provider: SearchProvider,
  query: string,
  n: number,
  proxyBase: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const base = provider.endpoint?.trim().replace(/\/+$/, '')
  if (!base) throw new Error('SearXNG 还没填实例地址。到「设置 → 联网」填一个，例如 https://searx.be。')
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`
  const res = await fetch(target(provider, url, proxyBase), { headers: { accept: 'application/json' }, signal })
  if (!res.ok) throw await failure('SearXNG', res)
  const json = (await res.json()) as { results?: Array<Record<string, unknown>> }
  return (json.results ?? []).slice(0, n).map((r) => ({
    title: clean(r.title),
    url: clean(r.url),
    snippet: clean(r.content ?? r.snippet),
  })).filter((h) => h.url)
}

async function deepseekSearch(
  provider: SearchProvider,
  query: string,
  n: number,
  settings: Settings,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const key = (deepseekKey(settings) || provider.apiKey).trim()
  if (!key) {
    throw new Error('DeepSeek 搜索要用 DeepSeek 的 Key。先到「设置 → 模型」把 DeepSeek 的 Key 填好；官方搜索和模型共用一个 Key。')
  }
  const base = provider.endpoint?.trim().replace(/\/+$/, '') || DEEPSEEK_TOOLS_BASE
  const res = await fetch(target(provider, `${base}/tools/search`, settings.proxyBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, count: n, ori_question: query, need_content: false }),
    signal,
  })
  if (!res.ok) throw await failure('DeepSeek 搜索', res)
  const json = (await res.json()) as { results?: Array<Record<string, unknown>>; data?: { results?: Array<Record<string, unknown>> } }
  const rows = json.results ?? json.data?.results ?? []
  return rows
    .map((r) => {
      const summary = clean(r.summary)
      return {
        title: clean(r.title) || clean(r.site_name) || clean(r.url),
        url: clean(r.url),
        snippet: clean(r.snippet) || summary.slice(0, 180),
        summary: summary || undefined,
      }
    })
    .filter((h) => h.url)
}

/** 用官方抓取拿正文（直接是 Markdown，比我们自己扒 HTML 干净）。失败返回空串，外层会回退。 */
async function deepseekFetch(
  provider: SearchProvider,
  settings: Settings,
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const key = (deepseekKey(settings) || provider.apiKey).trim()
  if (!key) return ''
  const base = provider.endpoint?.trim().replace(/\/+$/, '') || DEEPSEEK_TOOLS_BASE
  try {
    const res = await fetch(target(provider, `${base}/tools/fetch`, settings.proxyBase), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ url }),
      signal,
    })
    if (!res.ok) return ''
    const json = (await res.json()) as { content?: string }
    const content = typeof json.content === 'string' ? json.content : ''
    return content.trim().slice(0, MAX_DEEPSEEK_PAGE_CHARS)
  } catch {
    return ''
  }
}

export async function searchWeb(settings: Settings, query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const provider = searchProviderById(settings, settings.search.activeId)
  if (!provider) throw new Error('还没有配置联网检索服务。打开「设置 → 联网」，选一个服务填好 Key。')
  const n = Math.max(1, Math.min(10, settings.search.maxResults || 5))
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!q) return []
  switch (provider.kind) {
    case 'deepseek':
      return deepseekSearch(provider, q, n, settings, signal)
    case 'brave':
      return brave(provider, q, n, settings.proxyBase, signal)
    case 'serper':
      return serper(provider, q, n, settings.proxyBase, signal)
    case 'searxng':
      return searxng(provider, q, n, settings.proxyBase, signal)
    default:
      return tavily(provider, q, n, settings.proxyBase, signal)
  }
}

/** 抓一页正文当证据：DeepSeek 搜索用官方抓取，其它服务仍自己扒 HTML。 */
export async function fetchPage(settings: Settings, url: string, signal?: AbortSignal): Promise<string> {
  const provider = searchProviderById(settings, settings.search.activeId)
  if (provider?.kind === 'deepseek') {
    const text = await deepseekFetch(provider, settings, url, signal)
    if (text) return text
  }
  return fetchPageText(url, settings.proxyBase, signal)
}

/** 抓一页正文，给「查证」当证据；失败就当没有，不影响整体。 */
export async function fetchPageText(url: string, proxyBase: string, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(proxied(url, proxyBase), {
      headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' },
      signal,
    })
    if (!res.ok) return ''
    const type = res.headers.get('content-type') ?? ''
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) return ''
    const raw = await res.text()
    if (!raw) return ''
    const Parser = (globalThis as unknown as { DOMParser?: typeof DOMParser }).DOMParser
    if (!Parser) return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_CHARS)
    const dom = new Parser().parseFromString(raw, 'text/html')
    dom
      .querySelectorAll('script,style,noscript,svg,form,header,footer,nav,aside,iframe')
      .forEach((el) => el.remove())
    const main = dom.querySelector('article') ?? dom.querySelector('main') ?? dom.body
    const text = (main?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return text.slice(0, MAX_PAGE_CHARS)
  } catch {
    return ''
  }
}
