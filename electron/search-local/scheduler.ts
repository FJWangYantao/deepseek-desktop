import type { LocalSearchEngine } from './engine'
import type { DataSource } from './types'
import { allSources } from './sources'

export class RefreshScheduler {
  private timers: ReturnType<typeof setInterval>[] = []
  private callCounts = new Map<string, number>()
  private lastResetDate = ''

  start(engine: LocalSearchEngine): void {
    this.resetDailyCounts()

    console.log('[Scheduler] 调度配置：')
    for (const source of allSources) {
      const interval = this.calcInterval(source)
      const limitLabel = source.dailyLimit ? `${source.dailyLimit}次/天` : '无限'
      console.log(`  ${source.label.padEnd(8)} → 每 ${String(Math.round(interval / 60000)).padStart(3)} 分钟 (${limitLabel})`)

      const timer = setInterval(async () => {
        this.checkDateReset()

        if (source.dailyLimit && source.dailyLimit > 0) {
          const used = this.callCounts.get(source.name) || 0
          if (used >= source.dailyLimit) {
            console.log(`[Scheduler] ${source.label}: 今日限额 ${source.dailyLimit} 已用完，跳过`)
            return
          }
        }

        try {
          const items = await source.fetch()
          this.callCounts.set(source.name, (this.callCounts.get(source.name) || 0) + 1)
          if (items.length > 0) {
            engine.upsertSource(source.name, items)
            const used = this.callCounts.get(source.name) || 0
            const limitInfo = source.dailyLimit ? ` (今日第 ${used}/${source.dailyLimit} 次)` : ''
            console.log(`[Scheduler] ${source.label}: ${items.length} 条${limitInfo}`)
          }
        } catch (e) {
          console.warn(`[Scheduler] ${source.label} 刷新失败:`, e)
        }
      }, interval)

      this.timers.push(timer)
    }
  }

  private calcInterval(source: DataSource): number {
    if (source.dailyLimit && source.dailyLimit > 0) {
      return Math.floor((24 * 60 * 60 * 1000) / source.dailyLimit * 0.9)
    }
    return source.refreshInterval
  }

  private checkDateReset(): void {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.lastResetDate) {
      this.resetDailyCounts()
      console.log(`[Scheduler] 日期变更 → 调用计数已重置 (${today})`)
    }
  }

  private resetDailyCounts(): void {
    this.lastResetDate = new Date().toISOString().slice(0, 10)
    this.callCounts.clear()
    for (const s of allSources) this.callCounts.set(s.name, 0)
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  getStats(): Record<string, { limit: number; used: number; interval: number }> {
    const stats: Record<string, { limit: number; used: number; interval: number }> = {}
    for (const s of allSources) {
      stats[s.name] = {
        limit: s.dailyLimit || 0,
        used: this.callCounts.get(s.name) || 0,
        interval: Math.round(this.calcInterval(s) / 60000),
      }
    }
    return stats
  }
}

export const refreshScheduler = new RefreshScheduler()
