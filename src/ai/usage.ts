import { db } from '../db'
import type { ProviderConfig, TaskKind, UsageRow } from '../types'
import type { TokenUsage } from './client'
import { uuid } from '../lib/util'

/** 写一条用量记录。失败只是少一条统计，不影响正在进行的回答。 */
export async function recordUsage(input: {
  task: TaskKind
  provider: ProviderConfig
  model: string
  usage: TokenUsage
  docId?: string
  docTitle?: string
}): Promise<void> {
  const row: UsageRow = {
    id: uuid(),
    at: Date.now(),
    task: input.task,
    providerId: input.provider.id,
    providerName: input.provider.name,
    model: input.model,
    promptTokens: Math.max(0, Math.round(input.usage.promptTokens)),
    completionTokens: Math.max(0, Math.round(input.usage.completionTokens)),
    cacheTokens: Math.max(0, Math.round(input.usage.cacheTokens ?? 0)),
    thinkingTokens: Math.max(0, Math.round(input.usage.thinkingTokens ?? 0)),
    toolSearch: Math.max(0, Math.round(input.usage.toolSearch ?? 0)),
    toolFetch: Math.max(0, Math.round(input.usage.toolFetch ?? 0)),
    docId: input.docId,
    docTitle: input.docTitle,
  }
  try {
    await db.usage.put(row)
  } catch {
    // 存储被拒（隐私模式/配额满）时静默跳过
  }
}

/**
 * 价目表（元 / 百万 token，空闲时段；高峰约为两倍）。
 * $0.75/1000 次搜索与抓取 ≈ 5 元/1000 次，按次折算。
 */
const PRICES: Record<string, { hit: number; miss: number; out: number }> = {
  'deepseek-flash': { hit: 0.02, miss: 1, out: 4 },
  'deepseek-v4-flash': { hit: 0.02, miss: 1, out: 4 },
  'deepseek-v4-pro': { hit: 0.15, miss: 4.5, out: 13.5 },
}
const TOOL_CALL_PRICE = 5 / 1000
const FALLBACK_PRICE = PRICES['deepseek-flash']

/** 估算一次调用的花费（元）；不认识的模型返回 null，不硬编一个数字糊弄人。 */
export function estimateCost(row: UsageRow): number | null {
  const price = PRICES[row.model] ?? (/^deepseek/i.test(row.model) ? FALLBACK_PRICE : null)
  if (!price) return null
  const cached = Math.min(row.cacheTokens ?? 0, row.promptTokens)
  const fresh = Math.max(0, row.promptTokens - cached)
  const tokens = (fresh * price.miss + cached * price.hit + row.completionTokens * price.out) / 1_000_000
  const tools = ((row.toolSearch ?? 0) + (row.toolFetch ?? 0)) * TOOL_CALL_PRICE
  return tokens + tools
}

export interface UsageTotals {
  calls: number
  promptTokens: number
  completionTokens: number
  cacheTokens: number
  thinkingTokens: number
  toolCalls: number
  /** 能估算出价格的调用次数；显示费用时用它判断「有没有数据」 */
  pricedCalls: number
  cost: number
}

export interface UsageBucket extends UsageTotals {
  key: string
  label: string
}

export interface UsageSummary {
  today: UsageTotals
  week: UsageTotals
  total: UsageTotals
  byTask: UsageBucket[]
  byModel: UsageBucket[]
  recent: UsageRow[]
}

const EMPTY: UsageTotals = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cacheTokens: 0,
  thinkingTokens: 0,
  toolCalls: 0,
  pricedCalls: 0,
  cost: 0,
}

function add(into: UsageTotals, row: UsageRow): void {
  into.calls += 1
  into.promptTokens += row.promptTokens
  into.completionTokens += row.completionTokens
  into.cacheTokens += row.cacheTokens ?? 0
  into.thinkingTokens += row.thinkingTokens ?? 0
  into.toolCalls += (row.toolSearch ?? 0) + (row.toolFetch ?? 0)
  const cost = estimateCost(row)
  if (cost !== null) {
    into.pricedCalls += 1
    into.cost += cost
  }
}

export async function loadUsage(recentLimit = 60): Promise<UsageSummary> {
  let rows: UsageRow[] = []
  try {
    rows = await db.usage.toArray()
  } catch {
    rows = []
  }
  rows.sort((a, b) => b.at - a.at)

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000

  const today: UsageTotals = { ...EMPTY }
  const week: UsageTotals = { ...EMPTY }
  const total: UsageTotals = { ...EMPTY }
  const tasks = new Map<string, UsageBucket>()
  const models = new Map<string, UsageBucket>()

  for (const row of rows) {
    add(total, row)
    if (row.at >= startOfToday) add(today, row)
    if (row.at >= weekAgo) add(week, row)

    const t = tasks.get(row.task) ?? { key: row.task, label: row.task, ...EMPTY }
    add(t, row)
    tasks.set(row.task, t)

    const m = models.get(row.model) ?? { key: row.model, label: row.model, ...EMPTY }
    add(m, row)
    models.set(row.model, m)
  }

  const byTokens = (a: UsageBucket, b: UsageBucket) =>
    b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens)

  return {
    today,
    week,
    total,
    byTask: [...tasks.values()].sort(byTokens),
    byModel: [...models.values()].sort(byTokens),
    recent: rows.slice(0, recentLimit),
  }
}

export async function clearUsage(): Promise<void> {
  await db.usage.clear()
}

export function formatCost(cost: number): string {
  if (!cost) return '¥0'
  if (cost < 0.01) return `¥${cost.toFixed(4)}`
  if (cost < 1) return `¥${cost.toFixed(3)}`
  return `¥${cost.toFixed(2)}`
}

export const TASK_NAME: Record<string, string> = {
  explain: '解释',
  concept: '概念',
  ask: '提问',
  verify: '查证',
  critique: '点评',
  map: '路线骨架',
  recap: '回顾',
}
