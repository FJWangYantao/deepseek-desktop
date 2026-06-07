import type { LocalSearchItem, DataSource } from './types'
import { allSources } from './sources'
import { deduplicateAcrossSources } from './aggregator'

export class LocalSearchEngine {
  private items: LocalSearchItem[] = []
  private keywordIndex = new Map<string, Set<number>>()
  private lastUpdate = 0
  private initialized = false
  private initializing: Promise<void> | null = null

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    if (this.initializing) return this.initializing
    this.initializing = this.refreshAll()
    await this.initializing
  }

  async refreshAll(): Promise<void> {
    const results = await Promise.allSettled(
      allSources.map(async (s) => {
        try {
          const items = await s.fetch()
          console.log(`[LocalSearch] ${s.label}: ${items.length} 条`)
          return items
        } catch (e) {
          console.warn(`[LocalSearch] ${s.label} 失败:`, e)
          return [] as LocalSearchItem[]
        }
      })
    )

    const allItems: LocalSearchItem[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') allItems.push(...r.value)
    }

    const deduped = deduplicateAcrossSources(allItems)
    this.rebuildIndex(deduped)
    this.lastUpdate = Date.now()
    this.initialized = true
    console.log(`[LocalSearch] 索引已建立: ${this.items.length} 条, ${this.keywordIndex.size} 个关键词, 来源: [${[...new Set(this.items.map(i => i.source))].join(',')}]`)
  }

  private rebuildIndex(items: LocalSearchItem[]): void {
    this.items = items
    this.keywordIndex.clear()

    for (let i = 0; i < items.length; i++) {
      for (const kw of items[i].keywords) {
        let set = this.keywordIndex.get(kw)
        if (!set) { set = new Set(); this.keywordIndex.set(kw, set) }
        set.add(i)
      }
    }
  }

  search(query: string, options?: { category?: string; limit?: number }): LocalSearchItem[] {
    const limit = options?.limit || 10
    const queryKws = this.extractQueryKeywords(query)

    if (queryKws.length === 0) {
      // 无关键词 → 返回热度排行
      let results = this.items
      if (options?.category) results = results.filter(r => r.category === options.category)
      return results.slice(0, limit)
    }

    // 按匹配关键词数量评分
    const scores = new Map<number, number>()
    for (const qkw of queryKws) {
      const matched = this.keywordIndex.get(qkw)
      if (matched) {
        for (const idx of matched) {
          scores.set(idx, (scores.get(idx) || 0) + 1)
        }
      }
      // 模糊匹配：检查 index 中包含 queryKw 的关键词
      for (const [idxKw, indices] of this.keywordIndex) {
        if (idxKw.includes(qkw) || qkw.includes(idxKw)) {
          for (const idx of indices) {
            scores.set(idx, (scores.get(idx) || 0) + 0.5)
          }
        }
      }
    }

    let results = [...scores.entries()]
      .map(([idx, matchScore]) => ({
        item: this.items[idx],
        score: matchScore + Math.log10(this.items[idx].score + 1) * 0.3,
      }))
      .sort((a, b) => b.score - a.score)

    if (options?.category) {
      results = results.filter(r => r.item.category === options.category)
    }

    return results.slice(0, limit).map(r => r.item)
  }

  private extractQueryKeywords(query: string): string[] {
    const lower = query.toLowerCase()
    const cjk = lower.match(/[一-鿿]{2,4}/g) || []
    const en = lower.match(/[a-z0-9]+/g) || []
    return [...new Set([...cjk, ...en])]
  }

  getStats() {
    return {
      totalItems: this.items.length,
      sources: [...new Set(this.items.map(i => i.source))],
      keywords: this.keywordIndex.size,
      lastUpdate: this.lastUpdate,
    }
  }

  upsertSource(sourceName: string, newItems: LocalSearchItem[]): void {
    this.items = this.items.filter(i => i.source !== sourceName)
    this.items.push(...newItems)
    this.rebuildIndex(this.items)
  }
}

// 全局单例
export const localSearchEngine = new LocalSearchEngine()
