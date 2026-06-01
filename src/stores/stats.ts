import { defineStore } from 'pinia'
import { ref, watch, computed } from 'vue'
import type { UsageRecord, UsageData, DailyStats, BalanceInfo } from '@/types'

// 官方定价 CNY / 百万 token（2026年5月）
const PRICING: Record<string, { cacheHit: number; cacheMiss: number; output: number }> = {
  'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3.00, output: 6.00 },
  'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1.00, output: 2.00 },
}

function calculateCost(model: string, usage: UsageData): number {
  const p = PRICING[model] ?? PRICING['deepseek-v4-pro']
  const hit = usage.prompt_cache_hit_tokens
  const miss = usage.prompt_cache_miss_tokens
  const out = usage.completion_tokens
  return (hit * p.cacheHit + miss * p.cacheMiss + out * p.output) / 1_000_000
}

function loadRecords(): UsageRecord[] {
  try {
    const raw = localStorage.getItem('ds_stats_records')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K`
    : String(n)
}

export const useStatsStore = defineStore('stats', () => {
  const records = ref<UsageRecord[]>(loadRecords())
  const balance = ref<BalanceInfo[]>([])

  watch(records, (val) => {
    try { localStorage.setItem('ds_stats_records', JSON.stringify(val)) }
    catch { /* quota */ }
  }, { deep: true })

  function addRecord(r: UsageRecord) {
    r.cost = calculateCost(r.model, r.usage)
    records.value.push(r)
  }

  const totalConversations = computed(() => records.value.length)
  const totalTokens = computed(() => records.value.reduce((s, r) => s + r.usage.total_tokens, 0))
  const totalInputTokens = computed(() => records.value.reduce((s, r) => s + r.usage.prompt_tokens, 0))
  const totalOutputTokens = computed(() => records.value.reduce((s, r) => s + r.usage.completion_tokens, 0))
  const totalCacheHits = computed(() => records.value.reduce((s, r) => s + r.usage.prompt_cache_hit_tokens, 0))
  const cacheHitRate = computed(() => {
    const total = totalInputTokens.value
    return total ? Math.round(totalCacheHits.value / total * 100) : 0
  })
  const totalCost = computed(() => records.value.reduce((s, r) => s + r.cost, 0))
  const apiCount = computed(() => records.value.filter(r => r.source === 'api').length)
  const estimatedCount = computed(() => records.value.filter(r => r.source !== 'api').length)

  const fmtTotalTokens = computed(() => fmt(totalTokens.value))
  const fmtCacheHits = computed(() => fmt(totalCacheHits.value))
  const fmtCost = computed(() => `¥${totalCost.value.toFixed(6)}`)

  // 按天聚合
  const dailyMap = computed(() => {
    const map = new Map<string, DailyStats>()
    for (const r of records.value) {
      const d = new Date(r.timestamp)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      let entry = map.get(key)
      if (!entry) {
        entry = { date: key, totalTokens: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, conversationCount: 0, cost: 0, proTokens: 0, flashTokens: 0 }
        map.set(key, entry)
      }
      entry.totalTokens += r.usage.total_tokens
      entry.promptTokens += r.usage.prompt_tokens
      entry.completionTokens += r.usage.completion_tokens
      entry.cacheHitTokens += r.usage.prompt_cache_hit_tokens
      entry.conversationCount++
      entry.cost += r.cost
      if (r.model === 'deepseek-v4-pro') entry.proTokens += r.usage.total_tokens
      else entry.flashTokens += r.usage.total_tokens
    }
    return map
  })

  const dailyStats = computed(() => [...dailyMap.value.values()].sort((a, b) => a.date.localeCompare(b.date)))

  const recentStats = computed(() => {
    const result: DailyStats[] = []
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const entry = dailyMap.value.get(key)
      result.push(entry ?? { date: key, totalTokens: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, conversationCount: 0, cost: 0, proTokens: 0, flashTokens: 0 })
    }
    return result
  })

  // 按小时聚合
  const hourlyMap = computed(() => {
    const map = new Map<string, DailyStats>()
    for (const r of records.value) {
      const d = new Date(r.timestamp)
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:00`
      let e = map.get(key)
      if (!e) {
        e = { date: key, totalTokens: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, conversationCount: 0, cost: 0, proTokens: 0, flashTokens: 0 }
        map.set(key, e)
      }
      e.totalTokens += r.usage.total_tokens
      e.promptTokens += r.usage.prompt_tokens
      e.completionTokens += r.usage.completion_tokens
      e.cacheHitTokens += r.usage.prompt_cache_hit_tokens
      e.conversationCount++
      e.cost += r.cost
      if (r.model === 'deepseek-v4-pro') e.proTokens += r.usage.total_tokens
      else e.flashTokens += r.usage.total_tokens
    }
    return map
  })

  const recentHours = computed(() => {
    const result: DailyStats[] = []
    const now = new Date()
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now)
      d.setHours(d.getHours() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:00`
      result.push(hourlyMap.value.get(key) ?? { date: key, totalTokens: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, conversationCount: 0, cost: 0, proTokens: 0, flashTokens: 0 })
    }
    return result
  })

  // 按会话聚合
  const sessionStats = computed(() => {
    const map = new Map<string, { sessionId: string; title: string; model: string; count: number; promptTokens: number; completionTokens: number; cacheHits: number; cost: number; lastDate: number }>()
    for (const r of records.value) {
      let e = map.get(r.sessionId)
      if (!e) {
        e = { sessionId: r.sessionId, title: r.sessionTitle, model: r.model, count: 0, promptTokens: 0, completionTokens: 0, cacheHits: 0, cost: 0, lastDate: 0 }
        map.set(r.sessionId, e)
      }
      e.count++
      e.promptTokens += r.usage.prompt_tokens
      e.completionTokens += r.usage.completion_tokens
      e.cacheHits += r.usage.prompt_cache_hit_tokens
      e.cost += r.cost
      e.lastDate = Math.max(e.lastDate, r.timestamp)
    }
    return [...map.values()].sort((a, b) => b.lastDate - a.lastDate)
  })

  function clearAllStats() {
    records.value = []
    localStorage.removeItem('ds_stats_records')
  }

  return {
    records, balance,
    totalConversations, totalTokens, totalInputTokens, totalOutputTokens,
    totalCacheHits, cacheHitRate, totalCost, apiCount, estimatedCount,
    fmtTotalTokens, fmtCacheHits, fmtCost,
    dailyMap, dailyStats, recentStats, hourlyMap, recentHours, sessionStats,
    addRecord, clearAllStats,
  }
})
