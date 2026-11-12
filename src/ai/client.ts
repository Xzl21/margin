import type { ProviderConfig } from '../types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

export interface StreamOptions {
  provider: ProviderConfig
  model: string
  messages: ChatMessage[]
  proxyBase: string
  temperature?: number
  signal?: AbortSignal
  /** 服务端在流末尾回报 token 用量时回调（不支持的厂商不会触发） */
  onUsage?: (usage: TokenUsage) => void
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

/** 逐段产出模型输出的文本增量 */
export async function* streamChat(opts: StreamOptions): AsyncGenerator<string> {
  const url = chatEndpoint(opts.provider, opts.proxyBase)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.provider.apiKey.trim()) headers.authorization = `Bearer ${opts.provider.apiKey.trim()}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: opts.temperature ?? 0.4,
      }),
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
      if (payload === '[DONE]') return
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string; reasoning_content?: string } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
          error?: { message?: string }
        }
        if (json.error?.message) throw new LlmError(json.error.message)
        if (json.usage && !usageReported) {
          usageReported = true
          opts.onUsage?.({
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
          })
        }
        const delta = json.choices?.[0]?.delta
        if (delta?.content) yield delta.content
      } catch (err) {
        if (err instanceof LlmError) throw err
        // 单个坏包跳过，别中断整段
      }
    }
  }
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
