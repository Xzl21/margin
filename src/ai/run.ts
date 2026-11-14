import type {
  Block, Captured, DepMap, Doc, Note, ProviderConfig, SearchHit, Settings, ThinkingMode, ThinkingTask,
} from '../types'
import { providerById, routeReady, searchReady } from './presets'
import {
  extractJson, isDeepSeek, streamChat,
  type ChatMessage, type StreamInfo, type TokenUsage, type UrlCitation,
} from './client'
import { recordUsage } from './usage'
import { fetchPage, searchWeb } from './search'
import {
  askMessages,
  buildReadContext,
  conceptMessages,
  critiqueMessages,
  explainMessages,
  mapMessages,
  normalizeMap,
  verifyMessages,
  verifyNativeMessages,
} from './prompts'

export type Task = 'explain' | 'concept' | 'ask' | 'verify' | 'critique' | 'map'
/** 真正对应设置里 routing 行的任务（概念复用解释的路由） */
export type RoutedTask = 'explain' | 'ask' | 'verify' | 'critique' | 'map'

/**
 * 锚点引文可能被截断（单块 800 字），也可能只覆盖第一段；
 * 发给模型时优先用完整选区，避免「选中两段却只问了第一段」。
 */
function quoteForModel(captured: Captured): string {
  const excerpt = captured.excerpt?.trim()
  return excerpt && excerpt.length > 12 ? excerpt : captured.quote
}

function routeFor(settings: Settings, task: RoutedTask) {
  if (!routeReady(settings, task)) {
    throw new Error('还没有可用的模型。打开「设置 → 模型」，选一个厂商并填入 API Key（Ollama 本地模型不用填）。')
  }
  const route = settings.routing[task]
  const provider = providerById(settings, route.providerId)
  if (!provider) throw new Error('任务指向的厂商不存在，请到设置里重新选择。')
  return { provider, model: route.model }
}

function ctxFor(doc: Doc, blocks: Block[], blockIdx: number, settings: Settings) {
  return buildReadContext(blocks, blockIdx, doc.frontierIdx, settings.noSpoiler)
}

/** 这个任务该不该先打草稿；老设置里没有 thinking 时默认关掉，保持以前的速度。 */
function thinkingFor(settings: Settings, task: ThinkingTask): ThinkingMode {
  return settings.thinking?.[task] ?? 'off'
}

/** 统一的流式调用：边吐字边收尾，顺带把服务端回报的 token 记到本机用量表。 */
async function streamTask(
  opts: {
    provider: ProviderConfig
    model: string
    messages: ChatMessage[]
    proxyBase: string
    temperature?: number
    thinking?: ThinkingMode
    tools?: unknown[]
    signal?: AbortSignal
    onFinal?: (info: StreamInfo) => void
  },
  task: Task,
  doc: Doc,
  onDelta: (text: string) => void,
): Promise<string> {
  let usage: TokenUsage | undefined
  let out = ''
  for await (const piece of streamChat({ ...opts, onUsage: (u) => { usage = u } })) {
    out += piece
    onDelta(piece)
  }
  if (usage) {
    void recordUsage({
      task,
      provider: opts.provider,
      model: opts.model,
      usage,
      docId: doc.id,
      docTitle: doc.title,
    })
  }
  return out
}

export async function runExplain(
  input: { doc: Doc; blocks: Block[]; settings: Settings; captured: Captured; question?: string },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = routeFor(input.settings, 'explain')
  const messages = explainMessages({
    docTitle: input.doc.title,
    ctx: ctxFor(input.doc, input.blocks, input.captured.blockIdx, input.settings),
    quote: quoteForModel(input.captured),
    question: input.question,
  })
  return streamTask(
    { provider, model, messages, proxyBase: input.settings.proxyBase, signal, temperature: 0.35, thinking: thinkingFor(input.settings, 'explain') },
    'explain',
    input.doc,
    onDelta,
  )
}

/** 概念：比「解释」更短、更聚焦「它是什么」，不分析论证作用。 */
export async function runConcept(
  input: { doc: Doc; blocks: Block[]; settings: Settings; captured: Captured },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = routeFor(input.settings, 'explain')
  const messages = conceptMessages({
    docTitle: input.doc.title,
    ctx: ctxFor(input.doc, input.blocks, input.captured.blockIdx, input.settings),
    quote: quoteForModel(input.captured),
  })
  return streamTask(
    { provider, model, messages, proxyBase: input.settings.proxyBase, signal, temperature: 0.2, thinking: thinkingFor(input.settings, 'concept') },
    'concept',
    input.doc,
    onDelta,
  )
}

export async function runCritique(
  input: {
    doc: Doc
    blocks: Block[]
    settings: Settings
    note: Note
    captured: Captured
    previous: Note[]
  },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = routeFor(input.settings, 'critique')
  const messages = critiqueMessages({
    docTitle: input.doc.title,
    ctx: ctxFor(input.doc, input.blocks, input.captured.blockIdx, input.settings),
    note: input.note,
    quote: quoteForModel(input.captured),
    previous: input.previous,
    stance: input.settings.stance,
  })
  return streamTask(
    {
      provider,
      model,
      messages,
      proxyBase: input.settings.proxyBase,
      signal,
      temperature: input.settings.stance === 'socratic' ? 0.6 : 0.3,
      thinking: thinkingFor(input.settings, 'critique'),
    },
    'critique',
    input.doc,
    onDelta,
  )
}

/** 联网查证：DeepSeek 用原生联网工具（citations 回收出处），其它厂商走「检索 + 抓正文 + 编号引用」。 */
export async function runVerify(
  input: { doc: Doc; blocks: Block[]; settings: Settings; captured: Captured },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = routeFor(input.settings, 'verify')
  const ctx = ctxFor(input.doc, input.blocks, input.captured.blockIdx, input.settings)

  // DeepSeek 官方：把「可以联网」交给模型，它自己决定搜几次、打开哪几页
  if (isDeepSeek(provider) && provider.apiKey.trim().length > 4) {
    let citations: UrlCitation[] = []
    let out = await streamTask(
      {
        provider,
        model,
        messages: verifyNativeMessages({ docTitle: input.doc.title, quote: quoteForModel(input.captured), ctx }),
        proxyBase: input.settings.proxyBase,
        signal,
        thinking: thinkingFor(input.settings, 'verify'),
        tools: [{ type: 'deepseek_web_search' }],
        onFinal: (info) => { citations = info.annotations },
      },
      'verify',
      input.doc,
      onDelta,
    )
    const seen = new Set<string>()
    const unique = citations.filter((c) => {
      if (!c.url || seen.has(c.url)) return false
      seen.add(c.url)
      return true
    })
    const suffix =
      '\n\n---\n\n**资料来源**\n\n' +
      (unique.length
        ? unique.slice(0, 6).map((c, i) => `${i + 1}. [${c.title || c.url}](${c.url})`).join('\n')
        : '（模型这次没有引用网页：可能是问题不需要联网，或换 `deepseek-flash` 再试）')
    out += suffix
    onDelta(suffix)
    return out
  }

  const online = searchReady(input.settings)
  let hits: SearchHit[] = []
  if (online) {
    hits = await searchWeb(input.settings, quoteForModel(input.captured), signal)
  }

  const pages: { url: string; text: string }[] = []
  if (hits.length) {
    const picked = hits.slice(0, 3)
    const texts = await Promise.all(
      picked.map((h) => fetchPage(input.settings, h.url, signal)),
    )
    picked.forEach((h, i) => {
      const text = texts[i]
      if (text && text.length > 200) pages.push({ url: h.url, text })
    })
  }

  const messages = verifyMessages({
    docTitle: input.doc.title,
    quote: quoteForModel(input.captured),
    ctx,
    hits,
    pages,
    online,
  })

  let out = await streamTask(
    {
      provider,
      model,
      messages,
      proxyBase: input.settings.proxyBase,
      signal,
      temperature: 0.2,
      thinking: thinkingFor(input.settings, 'verify'),
    },
    'verify',
    input.doc,
    onDelta,
  )

  const list = hits.slice(0, 6)
  const suffix =
    '\n\n---\n\n**资料来源**\n\n' +
    (list.length
      ? list.map((h, i) => `${i + 1}. [${h.title || h.url}](${h.url})`).join('\n')
      : online
        ? '（这次没有检索到资料）'
        : '（未联网：到「设置 → 联网」配置检索服务后再查证）')
  out += suffix
  onDelta(suffix)
  return out
}

/** 提问：原文上下文 + 模型知识 + 可选联网资料，支持在卡片里多轮追问。 */
export async function runAsk(
  input: {
    doc: Doc
    blocks: Block[]
    settings: Settings
    captured: Captured
    question: string
    history: { role: 'user' | 'assistant'; text: string }[]
  },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = routeFor(input.settings, 'ask')
  const online = searchReady(input.settings)
  let hits: SearchHit[] = []
  if (online) {
    const query = `${input.question} ${quoteForModel(input.captured)}`.trim().slice(0, 120)
    hits = await searchWeb(input.settings, query, signal)
  }
  const pages: { url: string; text: string }[] = []
  if (hits.length) {
    const picked = hits.slice(0, 3)
    const texts = await Promise.all(
      picked.map((h) => fetchPage(input.settings, h.url, signal)),
    )
    picked.forEach((h, i) => {
      const text = texts[i]
      if (text && text.length > 200) pages.push({ url: h.url, text })
    })
  }
  const messages = askMessages({
    docTitle: input.doc.title,
    ctx: ctxFor(input.doc, input.blocks, input.captured.blockIdx, input.settings),
    quote: quoteForModel(input.captured),
    history: input.history,
    question: input.question,
    hits,
    pages,
    online,
  })
  let out = await streamTask(
    { provider, model, messages, proxyBase: input.settings.proxyBase, signal, temperature: 0.4, thinking: thinkingFor(input.settings, 'ask') },
    'ask',
    input.doc,
    onDelta,
  )
  if (hits.length) {
    const suffix =
      '\n\n---\n\n**参考资料**\n\n' +
      hits
        .slice(0, 5)
        .map((h, i) => `${i + 1}. [${h.title || h.url}](${h.url})`)
        .join('\n')
    out += suffix
    onDelta(suffix)
  }
  return out
}

export async function runMap(  input: { doc: Doc; blocks: Block[]; settings: Settings },
  signal?: AbortSignal,
): Promise<DepMap> {
  const { provider, model } = routeFor(input.settings, 'map')
  const outline = input.doc.outline.length
    ? input.doc.outline
    : input.blocks
        .filter((b) => b.kind !== 'p' && b.text.length < 60)
        .slice(0, 40)
        .map((b) => ({ title: b.text, level: 1, blockIdx: b.idx }))
  const excerpt = input.blocks.slice(0, 80).map((b) => b.text).join('\n')
  const messages = mapMessages({ docTitle: input.doc.title, outline, excerpt })
  const out = await streamTask(
    { provider, model, messages, proxyBase: input.settings.proxyBase, signal, temperature: 0.2, thinking: thinkingFor(input.settings, 'map') },
    'map',
    input.doc,
    () => {},
  )
  const raw = extractJson<unknown>(out)
  const map = normalizeMap(raw, Date.now(), model)
  if (!map) throw new Error('模型返回的骨架不是合法 JSON，再试一次，或换一个更强的模型。')
  return map
}
