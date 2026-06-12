import { useNotesStore } from '@/stores/notes'
import type { InsightInput } from '@/types/notes'

/** 搜索匹配结果 */
export interface InsightSearchResult {
  query: string
  matchedIds: string[]
}

/**
 * 笔记/Insight composable
 * 轻量代理 notes store，提供搜索等高级功能
 */
export function useNotes() {
  const store = useNotesStore()

  /** 从选中文本添加 insight */
  function addInsightFromSelection(input: InsightInput) {
    return store.addInsight(input)
  }

  /** 全文 + 标签搜索 */
  function searchInsights(query: string): InsightSearchResult {
    if (!query.trim()) {
      return { query, matchedIds: store.insights.map(i => i.id) }
    }
    const q = query.toLowerCase()
    const matchedIds: string[] = []
    for (const ins of store.insights) {
      const inContent = ins.content.toLowerCase().includes(q)
      const inNote = ins.note.toLowerCase().includes(q)
      const inTags = ins.tags.some(t => t.toLowerCase().includes(q))
      if (inContent || inNote || inTags) {
        matchedIds.push(ins.id)
      }
    }
    return { query, matchedIds }
  }

  return {
    insights: store.insights,
    allTags: store.allTags,
    count: store.count,
    addInsightFromSelection,
    searchInsights,
    updateInsight: store.updateInsight,
    deleteInsight: store.deleteInsight,
    deleteMultiple: store.deleteMultiple,
    addTagToMultiple: store.addTagToMultiple,
  }
}
