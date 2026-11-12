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
    docId: input.docId,
    docTitle: input.docTitle,
  }
  try {
    await db.usage.put(row)
  } catch {
    // 存储被拒（隐私模式/配额满）时静默跳过
  }
}

export interface UsageTotals {
  calls: number
  promptTokens: number
  completionTokens: number
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

const EMPTY: UsageTotals = { calls: 0, promptTokens: 0, completionTokens: 0 }

function add(into: UsageTotals, row: UsageRow): void {
  into.calls += 1
  into.promptTokens += row.promptTokens
  into.completionTokens += row.completionTokens
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

export const TASK_NAME: Record<string, string> = {
  explain: '解释',
  concept: '概念',
  ask: '提问',
  verify: '查证',
  critique: '点评',
  map: '路线骨架',
  recap: '回顾',
}
