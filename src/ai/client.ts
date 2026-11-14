import type { ProviderConfig, ThinkingMode } from '../types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  /** 命中上下文缓存的输入 token */
  cacheTokens?: number
  /** 思考 token */
  thinkingTokens?: number
  /** 计费的联网搜索 / 抓取次数（只在使用服务端工具时出现） */
  toolSearch?: number
  toolFetch?: number
}

export interface UrlCitation {
  url: string
  title?: string
}

export interface StreamInfo {
  /** 模型回答里引用的网页（DeepSeek 服务端搜索返回） */
  annotations: UrlCitation[]
  /** 服务端工具调用明细，原样保留（多轮追问时要回传） */
  serverToolCalls?: unknown
}

export interface StreamOptions {
  provider: ProviderConfig
  model: string
  messages: ChatMessage[]
  proxyBase: string
  temperature?: number
  /** 思考档位；只对 DeepSeek 生效 */
  thinking?: ThinkingMode
  /** 服务端工具声明，例如 [{ type: 'deepseek_web_search' }] */
  tools?: unknown[]
  signal?: AbortSignal
  /** 服务端在流末尾回报 token 用量时回调（不支持的厂商不会触发） */
  onUsage?: (usage: TokenUsage) => void
  /** 流结束时回调引用与工具明细 */
  onFinal?: (info: StreamInfo) => void
}

/** 只有 DeepSeek 认 thinking / reasoning_effort / 服务端工具，别的厂商会报错。 */
export function isDeepSeek(provider: ProviderConfig): boolean {
  return provider.id === 'deepseek' || /deepseek\.com/i.test(provider.baseURL)
}

function chatEndpoint(provider: ProviderConfig, proxyBase: string): string {
  const base = provider.baseURL.replace(/\/+$/, '')
  const target = `${base}/chat/completions`
  if (!provider.proxy) return target
  const proxy = proxyBase.replace(/\/+$/, '')
  return `${proxy}?url=${encodeURIComponent(target)}`
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/** DeepSeek 流里返回的引用结构（Chat Completions） */
interface RawAnnotation {
  type?: string
  url_citation?: { url?: string; title?: string }
}

interface RawUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  cache_read_input_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
  output_tokens_details?: { thinking_tokens?: number }
  server_tool_use?: { tool_search?: number; tool_fetch?: number }
}

/** 逐段产出模型输出的文本增量 */
export async function* streamChat(opts: StreamOptions): AsyncGenerator<string> {
  const url = chatEndpoint(opts.provider, opts.proxyBase)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.provider.apiKey.trim()) headers.authorization = `Bearer ${opts.provider.apiKey.trim()}`

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: opts.temperature ?? 0.4,
  }
  if (isDeepSeek(opts.provider)) {
    // off = 关掉思考，直接答；low / high = 先打草稿再答
    if (opts.thinking) {
      body.thinking = { type: opts.thinking === 'off' ? 'disabled' : 'enabled' }
      if (opts.thinking !== 'off') body.reasoning_effort = opts.thinking
    }
    if (opts.tools?.length) body.tools = opts.tools
  }
  // 声明服务端工具后这些采样参数本来就会被忽略，干脆不传，免得用户以为调了没用
  if (opts.tools?.length) delete body.temperature

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      signal: opts.signal,
      body: JSON.stringify(body),
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new LlmError(
      '请求没发出去。常见原因：浏览器直连被 CORS 拦了，或 baseURL 写错。把该 provider 的「经本地转发」打开，或检查网络。',
      undefined,
      (err as Error).message,
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new LlmError(
      `模型返回 ${res.status}${res.status === 401 ? '（密钥不对）' : res.status === 402 ? '（余额不足）' : res.status === 429 ? '（限流/额度用尽）' : ''}`,
      res.status,
      text.slice(0, 600),
    )
  }

  const reader = res.body?.getReader()
  if (!reader) throw new LlmError('模型没有返回内容流')
  const decoder = new TextDecoder()
  let buffer = ''
  let usageReported = false
  let annotations: UrlCitation[] = []
  let serverToolCalls: unknown
  let finalized = false
  const finalize = () => {
    if (finalized) return
    finalized = true
    opts.onFinal?.({ annotations, serverToolCalls })
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const raw of parts) {
      const line = raw.trim()
      if (!line || !line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        finalize()
        return
      }
      try {
        const json = JSON.parse(payload) as {
          choices?: {
            delta?: { content?: string; annotations?: RawAnnotation[]; server_tool_calls?: unknown }
            message?: { annotations?: RawAnnotation[] }
          }[]
          usage?: RawUsage
          error?: { message?: string }
        }
        if (json.error?.message) throw new LlmError(json.error.message)
        if (json.usage && !usageReported) {
          usageReported = true
          const u = json.usage
          opts.onUsage?.({
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            cacheTokens:
              u.prompt_cache_hit_tokens ??
              u.cache_read_input_tokens ??
              u.prompt_tokens_details?.cached_tokens ??
              0,
            thinkingTokens:
              u.completion_tokens_details?.reasoning_tokens ??
              u.output_tokens_details?.thinking_tokens ??
              0,
            toolSearch: u.server_tool_use?.tool_search ?? 0,
            toolFetch: u.server_tool_use?.tool_fetch ?? 0,
          })
        }
        const choice = json.choices?.[0]
        const rawAnnotations = choice?.delta?.annotations ?? choice?.message?.annotations
        if (rawAnnotations?.length) {
          // 完整引用在最后一个 chunk 里给全，所以覆盖而不是累加
          annotations = rawAnnotations
            .map((a) => ({ url: a.url_citation?.url ?? '', title: a.url_citation?.title }))
            .filter((a) => a.url)
        }
        if (choice?.delta?.server_tool_calls) serverToolCalls = choice.delta.server_tool_calls
        if (choice?.delta?.content) yield choice.delta.content
      } catch (err) {
        if (err instanceof LlmError) throw err
        // 单个坏包跳过，别中断整段
      }
    }
  }
  finalize()
}

export async function collectChat(opts: StreamOptions): Promise<string> {
  let out = ''
  for await (const piece of streamChat(opts)) out += piece
  return out
}

/** 从可能带 ```json 围栏的回复里抠出第一个 JSON 对象 */
export function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
