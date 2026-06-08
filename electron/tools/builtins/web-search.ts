import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { searchWebLight } from '../../search/duckduckgo'
import { preprocessQuery } from '../../search/query-preprocess'
import { filterResults } from '../../search/site-filter'
import { scoreAndRank } from '../../search/rank'
import { localSearchEngine } from '../../search-local/engine'
import { searchAll } from '../../search/zhihu-search'
import type { ZhihuSearchResult } from '../../search/zhihu-search'

const definition: ToolDefinition = {
  name: 'web_search',
  description: '搜索互联网获取信息。优先从本地索引库检索（毫秒级，聚合微博/知乎/B站/百度/头条/新浪财经/GitHub/HN等平台实时数据），未命中时自动使用搜索引擎。',
  category: 'search',
  permissions: 'auto',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
    },
    required: ['query'],
  },
}

export const webSearchTool: ToolExecutor = {
  definition,
  async execute(args) {
    const query = args.query as string
    if (!query) throw new Error('缺少搜索关键词')

    // 第一阶段：本地索引搜索
    try {
      await localSearchEngine.ensureInitialized()
      const stats = localSearchEngine.getStats()
      console.log(`[web_search] 本地索引状态: ${stats.totalItems} 条, 来源: [${stats.sources.join(',')}]`)
      const localResults = localSearchEngine.search(query, { limit: 15 })
      console.log(`[web_search] 本地命中: ${localResults.length} 条`)
      if (localResults.length >= 1) {
        return '【本地热点索引】\n' + localResults
          .map((r, i) => {
            const hot = r.score >= 10000 ? (r.score / 10000).toFixed(1) + '万' : String(r.score)
            return `[${i + 1}] ${r.title}\n    来源: ${r.source} · 热度: ${hot}\n    ${r.url}`
          })
          .join('\n\n')
      }
    } catch (e) {
      console.warn('[web_search] 本地索引查询失败，回退到搜索引擎:', e)
    }

    // 第二阶段：Bing/DDG + 知乎 API 并行兜底
    console.log('[web_search] 本地未命中，并行调用 Bing/DDG + 知乎 API')
    const processed = preprocessQuery(query)

    const [webResults, zhihuResults] = await Promise.allSettled([
      searchWebLight(processed),
      searchAll(query),
    ])

    const results = webResults.status === 'fulfilled' ? webResults.value : []
    const filtered = filterResults(results)
    const ranked = scoreAndRank(filtered, query)

    const zhihu = zhihuResults.status === 'fulfilled' ? zhihuResults.value : { zhihu: [], global: [] }
    console.log(`[web_search] 知乎API: 站内${zhihu.zhihu.length}条, 全网${zhihu.global.length}条`)

    const parts: string[] = []
    if (ranked.length > 0) {
      parts.push(ranked.slice(0, 8).map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`).join('\n\n'))
    }
    const zhihuAll = [...zhihu.zhihu, ...zhihu.global]
    if (zhihuAll.length > 0) {
      parts.push('【知乎搜索】\n' + zhihuAll.slice(0, 5).map(r => `[${r.source}] ${r.title}\n    ${r.url}\n    ${r.snippet}`).join('\n\n'))
    }

    if (parts.length === 0) return '未找到相关结果'
    return parts.join('\n\n')
  },
}
