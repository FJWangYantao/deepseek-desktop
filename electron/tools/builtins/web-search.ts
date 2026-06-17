import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { searchWebLight, type SearchHit } from '../../search/duckduckgo'
import { preprocessQuery } from '../../search/query-preprocess'
import { filterResults } from '../../search/site-filter'
import { scoreAndRank } from '../../search/rank'
import { searchAll } from '../../search/zhihu-search'
import type { ZhihuSearchResult } from '../../search/zhihu-search'

// ===== 查询意图分类 =====

type QueryIntent = 'definitional' | 'howto' | 'comparison' | 'news' | 'factual' | 'policy' | 'generic'

export function classifyQuery(q: string): QueryIntent {
  if (/什么是|是什么|定义|概念|含义|意思/.test(q)) return 'definitional'
  if (/怎么|如何|教程|步骤|方法|怎样/.test(q)) return 'howto'
  if (/对比|比较|区别|差异|vs|和.{1,6}哪个/.test(q)) return 'comparison'
  if (/最新|新闻|今天|今日|昨天|消息|动态|刚刚/.test(q)) return 'news'
  if (/多少|几个|哪里|哪些|谁|什么时候|何时|数值|年份/.test(q)) return 'factual'
  if (/政策|条例|法规|办法|通知|公告|规定|意见|标准|文件/.test(q)) return 'policy'
  return 'generic'
}

// ===== 查询扩展：自动生成多角度变体，一轮覆盖充分 =====

const NEWS_SITES = 'site:sina.com.cn OR site:163.com OR site:qq.com OR site:sohu.com OR site:36kr.com OR site:thepaper.cn'

export function expandQueries(query: string, sites?: string[]): string[] {
  // 用户指定了 sites 就不做自动扩展
  if (sites?.length) {
    const siteStr = ' ' + sites.map(s => `site:${s}`).join(' OR ')
    return [query.trim() + siteStr]
  }

  const variants: string[] = []
  const q = query.trim()

  // 原始查询永远保留
  variants.push(q)

  const isChinese = /[一-鿿]/.test(q)

  if (!isChinese) {
    // 英文查询不做额外扩展，三引擎并行已足够
    return [q]
  }

  const intent = classifyQuery(q)

  switch (intent) {
    case 'definitional':
      // 不再追加 "+ 定义 解释"：这条变体反而把搜索引擎引向词典释义，
      // 词典站本身已被 site-filter 排除，再加这条变体只会增加噪声。
      break
    case 'howto':
      variants.push(q.replace(/怎么|如何|怎样/, '').trim() + ' 教程 方法')
      break
    case 'comparison':
      break
    case 'news':
      // 新闻类：加新闻站点限定
      variants.push(q + ' ' + NEWS_SITES)
      break
    case 'factual':
      break
    case 'policy':
      variants.push(q + ' 全文')
      break
    case 'generic': {
      // 不再为 generic 自动加新闻门户限定：
      // 这些门户上低质标题党/广告页比例高，主搜本身已能覆盖正经来源。
      // 真要查最新动态，模型可以显式传 news 倾向的关键词或在 queries 里指定。
      break
    }
  }

  return [...new Set(variants)]
}

const definition: ToolDefinition = {
  name: 'web_search',
  description: '搜索互联网获取信息。传入多个关键词方向自动并行搜索，覆盖更全面。支持 sites 参数限定域名。',
  category: 'search',
  permissions: 'auto',
  parameters: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: '搜索关键词列表，每个元素是一个搜索方向。建议传入 2-4 个不同角度的关键词（如中英文、不同表述），系统会自动并行搜索并合并结果。例如 ["黄仁勋 女儿 订婚", "Jensen Huang daughter engaged", "英伟达 高管 结婚"]',
      },
      sites: {
        type: 'array',
        description: '可选，限定搜索的域名列表。例如 ["gov.cn"] 只搜政府网站。不填则全网搜索。',
        items: { type: 'string' },
      },
    },
    required: ['queries'],
  },
}


// 可注入的搜索依赖：默认走真实网络（searchWebLight + 知乎 searchAll）；
// 测试注入 fixture 数据即可离线、确定性端到端验证 tool 的过滤/排序/包装。
interface SearchDeps {
  search: (q: string) => Promise<SearchHit[]>
  zhihu: (q: string) => Promise<{ zhihu: ZhihuSearchResult[]; global: ZhihuSearchResult[] }>
}

/**
 * web_search 核心逻辑，从 execute 抽出以便依赖注入。
 * execute(args) 只解析参数；"搜 → 过滤 → 排序 → 片段质量过滤 → 包装成给 LLM 的字符串"全在这。
 */
export async function runWebSearch(
  queryList: string[],
  sites: string[] | undefined,
  deps: SearchDeps = { search: searchWebLight, zhihu: searchAll },
): Promise<string> {
  const siteFilter = sites?.length
    ? sites.map(s => `site:${s}`).join(' OR ')
    : ''
  const hasSiteFilter = !!siteFilter

  // 所有查询并行执行，每个查询内部再做变体扩展
  const allSearchTasks: Promise<SearchHit[]>[] = []
  const allQueryVariants: string[] = []

  for (const q of queryList) {
    const variants = expandQueries(q, sites)
    allQueryVariants.push(...variants)
    const processed = variants.map(v => preprocessQuery(v))
    for (const pq of processed) {
      allSearchTasks.push(deps.search(pq).catch(() => [] as SearchHit[]))
    }
  }

  console.log(`[web_search] ${queryList.length} 个查询方向, 共 ${allQueryVariants.length} 个变体 → ${allQueryVariants.map(q => `"${q}"`).join(', ')}`)

  // 知乎搜索（仅在无 site 限定时，用第一个查询）
  const primaryQuery = queryList[0]
  const zhihuTask = hasSiteFilter
    ? Promise.resolve({ zhihu: [] as ZhihuSearchResult[], global: [] as ZhihuSearchResult[] })
    : deps.zhihu(primaryQuery).catch(() => ({ zhihu: [] as ZhihuSearchResult[], global: [] as ZhihuSearchResult[] }))

  const [searchResultArrays, zhihuResults] = await Promise.all([
    Promise.all(allSearchTasks),
    zhihuTask,
  ])

  // 合并去重
  const seenUrls = new Set<string>()
  const merged: SearchHit[] = []
  for (const batch of searchResultArrays) {
    for (const r of batch) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url)
        merged.push(r)
      }
    }
  }

  console.log(`[web_search] ${allQueryVariants.length} 个变体共返回 ${merged.length} 条（去重后）`)

  const filtered = filterResults(merged)
  const ranked = scoreAndRank(filtered, primaryQuery)

  // 片段质量过滤：去除垃圾片段，长片段优先
  // 广告/SEO 文案常见的诱导词：命中即丢
  const adPattern = /(立即下载|马上下载|点击进入|点击查看|限时优惠|限时折扣|0元领|免费领取|官方授权|加微信|加客服|私聊|在线咨询|了解详情)/
  const qualityRanked = ranked.filter(r => {
    if (!r.snippet || r.snippet.length < 20) return false
    const navChars = (r.snippet.match(/[|>»›→·]/g) || []).length
    if (navChars > 5) return false
    if (adPattern.test(r.title) || adPattern.test(r.snippet)) return false
    return true
  }).sort((a, b) => {
    const scoreA = ranked.indexOf(a)
    const scoreB = ranked.indexOf(b)
    const lenBonus = (s: string) => s.length > 200 ? -2 : s.length > 100 ? -1 : 0
    return (scoreA + lenBonus(a.snippet)) - (scoreB + lenBonus(b.snippet))
  })

  const zhihu = zhihuResults
  console.log(`[web_search] 最终: ${qualityRanked.length} 条, 知乎: 站内${zhihu.zhihu.length}条/全网${zhihu.global.length}条`)

  const parts: string[] = []

  if (qualityRanked.length > 0) {
    const label = hasSiteFilter ? `【限定域名: ${sites!.join(', ')}】` : '【搜索结果】'
    parts.push(label + ` (${queryList.length} 个查询方向, ${allQueryVariants.length} 个变体)\n` +
      qualityRanked.slice(0, 10).map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`).join('\n\n'))
  }

  // 知乎结果：只保留有实质内容的（摘要≥50字符），并标注不要抓取
  const zhihuAll = [...zhihu.zhihu, ...zhihu.global]
    .filter(r => !seenUrls.has(r.url) && r.snippet.length >= 50)
  if (zhihuAll.length > 0) {
    parts.push('【知乎】⚠️ 知乎页面有登录墙无法抓取全文，以下摘要即是最佳可用内容，请勿调用 web_fetch：\n' +
      zhihuAll.slice(0, 5).map(r => `[${r.source}] ${r.title}\n    ${r.url}\n    ${r.snippet}`).join('\n\n'))
  }

  if (parts.length === 0) {
    if (hasSiteFilter) {
      return `在 ${sites!.join(', ')} 内未找到与"${primaryQuery}"相关的结果。\n\n尝试了以下关键词变体：\n${allQueryVariants.map(q => `  • ${q}`).join('\n')}\n\n建议去掉网站限定扩大搜索范围。`
    }
    return `未找到与"${primaryQuery}"相关的结果。\n\n尝试了以下关键词变体：\n${allQueryVariants.map(q => `  • ${q}`).join('\n')}\n\n建议更换更具体的关键词重试。`
  }

  return parts.join('\n\n')
}

export const webSearchTool: ToolExecutor = {
  definition,
  async execute(args) {
    const batchQueries = args.queries as string[] | undefined
    const sites = args.sites as string[] | undefined
    // 兼容旧的 query 参数（万一模型还是传了单个 string）
    const singleQuery = args.query as string | undefined
    const queryList: string[] = []
    if (batchQueries && batchQueries.length > 0) {
      queryList.push(...batchQueries.slice(0, 5))
    } else if (singleQuery) {
      queryList.push(singleQuery)
    } else {
      throw new Error('需要提供 queries 参数')
    }
    return runWebSearch(queryList, sites)
  },
}
