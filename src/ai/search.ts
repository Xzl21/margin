// 联网检索：把「这句话到底是不是真的」交给搜索结果，而不是模型记忆。
// 只用 DeepSeek 官方搜索（与模型共用一个 Key），请求可经 /api/proxy 转发绕开 CORS。
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
    return new Error(`${service} 拒绝了这个 Key（${res.status}）。到「设置 → 模型」检查 DeepSeek 的 Key。`)
  }
  if (res.status === 429) return new Error(`${service} 说请求太频繁（429），过一会儿再试。`)
  return new Error(`${service} 返回 ${res.status}${detail ? `：${detail}` : ''}`)
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function toolsBase(provider: SearchProvider): string {
  return provider.endpoint?.trim().replace(/\/+$/, '') || DEEPSEEK_TOOLS_BASE
}

function keyOf(settings: Settings, provider: SearchProvider): string {
  return (deepseekKey(settings) || provider.apiKey).trim()
}

async function deepseekSearch(
  provider: SearchProvider,
  query: string,
  n: number,
  settings: Settings,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const key = keyOf(settings, provider)
  if (!key) {
    throw new Error('联网搜索要用 DeepSeek 的 Key。先到「设置 → 模型」把 DeepSeek 的 Key 填好；搜索和模型共用一个 Key。')
  }
  const res = await fetch(target(provider, `${toolsBase(provider)}/tools/search`, settings.proxyBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, count: n, ori_question: query, need_content: false }),
    signal,
  })
  if (!res.ok) throw await failure('DeepSeek 搜索', res)
  const json = (await res.json()) as {
    results?: Array<Record<string, unknown>>
    data?: { results?: Array<Record<string, unknown>> }
  }
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
  const key = keyOf(settings, provider)
  if (!key) return ''
  try {
    const res = await fetch(target(provider, `${toolsBase(provider)}/tools/fetch`, settings.proxyBase), {
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
  if (!provider) throw new Error('联网搜索还没就绪。到「设置 → 模型」填好 DeepSeek 的 Key。')
  const n = Math.max(1, Math.min(10, settings.search.maxResults || 5))
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!q) return []
  return deepseekSearch(provider, q, n, settings, signal)
}

/** 抓一页正文当证据：优先官方抓取（Markdown），失败再自己扒 HTML。 */
export async function fetchPage(settings: Settings, url: string, signal?: AbortSignal): Promise<string> {
  const provider = searchProviderById(settings, settings.search.activeId)
  if (provider) {
    const text = await deepseekFetch(provider, settings, url, signal)
    if (text) return text
  }
  return fetchPageText(url, settings.proxyBase, signal)
}

/** 兜底：抓 HTML 去标签。官方抓取失败或未配置时使用。 */
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
