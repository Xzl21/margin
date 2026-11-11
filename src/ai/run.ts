import type { Block, Captured, DepMap, Doc, Note, SearchHit, Settings } from '../types'
import { providerById, routeReady, searchReady } from './presets'
import { extractJson, streamChat } from './client'
import { fetchPageText, searchWeb } from './search'
import {
  askMessages,
  buildReadContext,
  critiqueMessages,
  explainMessages,
  mapMessages,
  normalizeMap,
  verifyMessages,
} from './prompts'

export type Task = 'explain' | 'ask' | 'critique' | 'map'

function routeFor(settings: Settings, task: Task) {
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

export async function runExplain(
  input: { doc: Doc; blocks: Block[]; settings: Settings; captured: Captured; question?: string },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = routeFor(input.settings, 'explain')
  const messages = explainMessages({
    docTitle: input.doc.title,
    ctx: ctxFor(input.doc, input.blocks, input.captured.blockIdx, input.settings),
    quote: input.captured.quote,
    question: input.question,
  })
  let out = ''
  for await (const piece of streamChat({
    provider,
    model,
    messages,
    proxyBase: input.settings.proxyBase,
    signal,
    temperature: 0.35,
  })) {
    out += piece
    onDelta(piece)
  }
  return out
}

export async function runAsk(
  input: { doc: Doc; blocks: Block[]; settings: Settings; captured: Captured; question: string },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = routeFor(input.settings, 'ask')
  const messages = askMessages({
    docTitle: input.doc.title,
    ctx: ctxFor(input.doc, input.blocks, input.captured.blockIdx, input.settings),
    quote: input.captured.quote,
    question: input.question,
  })
  let out = ''
  for await (const piece of streamChat({
    provider,
    model,
    messages,
    proxyBase: input.settings.proxyBase,
    signal,
    temperature: 0.4,
  })) {
    out += piece
    onDelta(piece)
  }
  return out
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
    quote: input.captured.quote,
    previous: input.previous,
    stance: input.settings.stance,
  })
  let out = ''
  for await (const piece of streamChat({
    provider,
    model,
    messages,
    proxyBase: input.settings.proxyBase,
    signal,
    temperature: input.settings.stance === 'socratic' ? 0.6 : 0.3,
  })) {
    out += piece
    onDelta(piece)
  }
  return out
}

/** 联网查证：检索 → 抓正文 → 带编号引用的核查结论。 */
export async function runVerify(
  input: { doc: Doc; blocks: Block[]; settings: Settings; captured: Captured },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = routeFor(input.settings, 'ask')
  const online = searchReady(input.settings)
  let hits: SearchHit[] = []
  if (online) {
    hits = await searchWeb(input.settings, input.captured.quote, signal)
  }

  const pages: { url: string; text: string }[] = []
  if (hits.length) {
    const picked = hits.slice(0, 3)
    const texts = await Promise.all(
      picked.map((h) => fetchPageText(h.url, input.settings.proxyBase, signal)),
    )
    picked.forEach((h, i) => {
      const text = texts[i]
      if (text && text.length > 200) pages.push({ url: h.url, text })
    })
  }

  const messages = verifyMessages({
    docTitle: input.doc.title,
    quote: input.captured.quote,
    ctx: ctxFor(input.doc, input.blocks, input.captured.blockIdx, input.settings),
    hits,
    pages,
    online,
  })

  let out = ''
  for await (const piece of streamChat({
    provider,
    model,
    messages,
    proxyBase: input.settings.proxyBase,
    signal,
    temperature: 0.2,
  })) {
    out += piece
    onDelta(piece)
  }

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
  let out = ''
  for await (const piece of streamChat({
    provider,
    model,
    messages,
    proxyBase: input.settings.proxyBase,
    signal,
    temperature: 0.2,
  })) {
    out += piece
  }
  const raw = extractJson<unknown>(out)
  const map = normalizeMap(raw, Date.now(), model)
  if (!map) throw new Error('模型返回的骨架不是合法 JSON，再试一次，或换一个更强的模型。')
  return map
}
