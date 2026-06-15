/**
 * 搜索 benchmark 主入口。
 *
 * 用法：
 *   npx tsx tests/search-bench/runner.ts                 # 跑全部 cases
 *   npx tsx tests/search-bench/runner.ts --intent=howto  # 只跑某类
 *   npx tsx tests/search-bench/runner.ts --diff=baseline.json  # 与基线对比
 *   npx tsx tests/search-bench/runner.ts --save=baseline  # 保存为基线快照
 *
 * 设计：
 * - 直接调底层 searchWebLight + filterResults + scoreAndRank（绕过 web_search tool 的字符串包装），
 *   这样既能拿到结构化 hits 计算指标，又最贴近实际线上调用链路。
 * - 每个 case 收集多维 score（noise/diversity/richness/recall/forbidden），合成总分。
 * - 输出 markdown 报告 + JSON 快照（用于跨次对比）。
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchWebLight, type SearchHit } from '../../electron/search/duckduckgo'
import { filterResults } from '../../electron/search/site-filter'
import { scoreAndRank } from '../../electron/search/rank'
import { preprocessQuery } from '../../electron/search/query-preprocess'
import { cases, type BenchCase } from './cases'
import {
  judgeNoiseRate, judgeDomainDiversity, judgeSnippetRichness,
  judgeKeywordRecall, judgeForbiddenDomains,
} from './judges/heuristic'
import { judgeWithLLM, describeLLMConfig, type LLMJudgeResult } from './judges/llm'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface CaseResult {
  caseId: string
  query: string
  intent: string
  latencyMs: number
  hitCount: number
  /** 各 judge 得分；null 表示该 judge 不适用此 case */
  scores: {
    noise: number
    diversity: number
    richness: number
    recall: number | null
    forbidden: number | null
    /** LLM 综合分；null 表示未启用 LLM 或调用失败 */
    llm: number | null
    overall: number
  }
  details: {
    noiseRate: number
    noiseHits: string[]
    uniqueDomains: number
    domains: string[]
    avgSnippetLen: number
    missedKeywords: string[]
    forbiddenHit: string[]
    /** LLM 子项与解释 */
    llm: LLMJudgeResult['details'] | null
  }
  topHits: { title: string; url: string; snippet: string }[]
  expectations: BenchCase['expectations']
  expectationFailures: string[]
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | true> = {}
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    if (m) args[m[1]] = m[2] ?? true
  }
  return args
}

/**
 * 运行单个 case：调底层搜索管线，跑所有 judge，合成总分，比对硬期望。
 * 不会抛错——搜索失败时返回 0 hits + overall=0，让 benchmark 整体跑完。
 */
async function runCase(c: BenchCase, opts: { useLLM: boolean }): Promise<CaseResult> {
  const start = Date.now()
  let hits: SearchHit[] = []
  try {
    const processed = preprocessQuery(c.query)
    const raw = await searchWebLight(processed)
    const filtered = filterResults(raw)
    hits = scoreAndRank(filtered, c.query).slice(0, 10)
  } catch (e) {
    console.error(`[${c.id}] 搜索失败:`, e)
  }
  const latencyMs = Date.now() - start

  const noise = judgeNoiseRate(hits)
  const diversity = judgeDomainDiversity(hits)
  const richness = judgeSnippetRichness(hits)
  const recall = judgeKeywordRecall(hits, c.expectations?.expectKeywords)
  const forbidden = judgeForbiddenDomains(hits, c.expectations?.forbiddenDomains)

  // LLM judge：news/factual 启用 freshness。仅在 --llm 时调用。
  let llm: LLMJudgeResult | null = null
  if (opts.useLLM && hits.length > 0) {
    const needsFreshness = c.intent === 'news' || c.intent === 'factual'
    llm = await judgeWithLLM(c.query, hits, { needsFreshness, topN: 5 })
  }

  // 合成总分：可用 judge 取算术平均；recall/forbidden/llm 为 null 就跳过
  const components = [noise.score, diversity.score, richness.score]
  if (recall) components.push(recall.score)
  if (forbidden) components.push(forbidden.score)
  if (llm) components.push(llm.score)
  const overall = components.reduce((s, v) => s + v, 0) / components.length

  // 硬期望比对
  const expectationFailures: string[] = []
  if (c.expectations?.noiseRateMax !== undefined && noise.details.rate > c.expectations.noiseRateMax) {
    expectationFailures.push(`noise rate ${(noise.details.rate * 100).toFixed(0)}% > 上限 ${(c.expectations.noiseRateMax * 100).toFixed(0)}%`)
  }
  if (c.expectations?.minUniqueDomains !== undefined && diversity.details.uniqueDomains < c.expectations.minUniqueDomains) {
    expectationFailures.push(`unique domains ${diversity.details.uniqueDomains} < 下限 ${c.expectations.minUniqueDomains}`)
  }
  if (forbidden && forbidden.details.hitDomains.length > 0) {
    expectationFailures.push(`命中禁用域名: ${forbidden.details.hitDomains.join(', ')}`)
  }
  if (recall && recall.score === 0 && c.expectations?.expectKeywords?.length) {
    expectationFailures.push(`未命中任何期望关键词: ${c.expectations.expectKeywords.join('/')}`)
  }

  return {
    caseId: c.id,
    query: c.query,
    intent: c.intent,
    latencyMs,
    hitCount: hits.length,
    scores: {
      noise: noise.score,
      diversity: diversity.score,
      richness: richness.score,
      recall: recall?.score ?? null,
      forbidden: forbidden?.score ?? null,
      llm: llm?.score ?? null,
      overall,
    },
    details: {
      noiseRate: noise.details.rate,
      noiseHits: noise.details.hitsHit,
      uniqueDomains: diversity.details.uniqueDomains,
      domains: diversity.details.domains,
      avgSnippetLen: richness.details.avgLen,
      missedKeywords: recall?.details.missedKeywords ?? [],
      forbiddenHit: forbidden?.details.hitDomains ?? [],
      llm: llm?.details ?? null,
    },
    topHits: hits.slice(0, 5).map(h => ({
      title: h.title.slice(0, 100),
      url: h.url,
      snippet: h.snippet.slice(0, 200),
    })),
    expectations: c.expectations,
    expectationFailures,
  }
}

function fmt(n: number): string {
  return (n * 100).toFixed(0) + '%'
}

/** 渲染整体 markdown 报告 */
function renderReport(results: CaseResult[], baseline?: CaseResult[]): string {
  const lines: string[] = []
  lines.push(`# 搜索 Benchmark 报告`)
  lines.push(`生成时间：${new Date().toISOString()}`)
  lines.push(``)

  // 整体统计
  const overall = avg(results.map(r => r.scores.overall))
  const noise = avg(results.map(r => r.scores.noise))
  const diversity = avg(results.map(r => r.scores.diversity))
  const richness = avg(results.map(r => r.scores.richness))
  const recall = avg(results.map(r => r.scores.recall).filter((v): v is number => v !== null))
  const forbidden = avg(results.map(r => r.scores.forbidden).filter((v): v is number => v !== null))
  const llmScores = results.map(r => r.scores.llm).filter((v): v is number => v !== null)
  const llmAvg = avg(llmScores)
  const llmCachedCount = results.filter(r => r.details.llm?.cached).length
  const latencyP50 = percentile(results.map(r => r.latencyMs), 0.5)
  const latencyP95 = percentile(results.map(r => r.latencyMs), 0.95)
  const failedCount = results.filter(r => r.expectationFailures.length > 0).length
  const zeroHitCount = results.filter(r => r.hitCount === 0).length

  lines.push(`## 总览`)
  lines.push(``)
  lines.push(`| 指标 | 值 | 说明 |`)
  lines.push(`|---|---|---|`)
  lines.push(`| **总分** | **${fmt(overall)}** | 全部 judge 平均（recall/forbidden/llm 仅在适用时计入）|`)
  lines.push(`| 噪声(无噪音率) | ${fmt(noise)} | 1 − 命中黑名单/广告关键词的比例 |`)
  lines.push(`| 域名多样性 | ${fmt(diversity)} | top-10 不同域名的数量 |`)
  lines.push(`| 片段信息量 | ${fmt(richness)} | 平均 snippet 长度 |`)
  lines.push(`| 关键词召回 | ${fmt(recall)} | 期望关键词至少命中一个的比例 |`)
  lines.push(`| 禁域硬约束 | ${fmt(forbidden)} | 不命中 forbiddenDomains 的比例 |`)
  if (llmScores.length > 0) {
    lines.push(`| **LLM judge** | **${fmt(llmAvg)}** | relevance/answerable/credibility(/freshness) 平均；覆盖 ${llmScores.length}/${results.length} case，缓存命中 ${llmCachedCount} |`)
  }
  lines.push(`| 延迟 p50/p95 | ${latencyP50}ms / ${latencyP95}ms | |`)
  lines.push(`| 失败 case | ${failedCount} / ${results.length} | 命中至少一条硬期望违反 |`)
  lines.push(`| 零结果 case | ${zeroHitCount} / ${results.length} | 搜索完全没返回 |`)
  lines.push(``)

  // LLM judge 子项分布
  if (llmScores.length > 0) {
    const relevance = avg(results.map(r => r.details.llm?.relevance ?? null).filter((v): v is number => v !== null))
    const answerable = avg(results.map(r => r.details.llm?.answerable ?? null).filter((v): v is number => v !== null))
    const credibility = avg(results.map(r => r.details.llm?.credibility ?? null).filter((v): v is number => v !== null))
    const freshness = avg(results.map(r => r.details.llm?.freshness ?? null).filter((v): v is number => v !== null))
    lines.push(`### LLM judge 子项`)
    lines.push(``)
    lines.push(`| 子项 | 平均 |`)
    lines.push(`|---|---|`)
    lines.push(`| relevance（相关性） | ${fmt(relevance)} |`)
    lines.push(`| answerable（可回答性） | ${fmt(answerable)} |`)
    lines.push(`| credibility（可信度） | ${fmt(credibility)} |`)
    lines.push(`| freshness（时效性，仅 news/factual） | ${fmt(freshness)} |`)
    lines.push(``)

    // 启发式认为 OK，但 LLM 给低分的 case —— 重点关注，是字面打分捞不到的退化
    const hidden = results
      .filter(r => r.scores.llm !== null && r.expectationFailures.length === 0)
      .filter(r => (r.scores.llm as number) < 0.6)
      .sort((a, b) => (a.scores.llm as number) - (b.scores.llm as number))
      .slice(0, 8)
    if (hidden.length > 0) {
      lines.push(`### LLM 认为质量偏低、但启发式没抓住的 case (${hidden.length})`)
      lines.push(``)
      for (const r of hidden) {
        lines.push(`- **${r.caseId} · ${r.query}** — LLM ${fmt(r.scores.llm as number)}，启发式总分 ${fmt(r.scores.overall)}`)
        if (r.details.llm?.reasoning) lines.push(`  - ${r.details.llm.reasoning}`)
      }
      lines.push(``)
    }
  }

  if (baseline) {
    lines.push(`## 对比基线`)
    lines.push(``)
    lines.push(diffTable(results, baseline))
    lines.push(``)
  }

  // 按 intent 分桶
  lines.push(`## 按意图分布`)
  lines.push(``)
  lines.push(`| Intent | 数量 | 总分 | 噪声 | 多样性 | 信息量 | 召回 |`)
  lines.push(`|---|---|---|---|---|---|---|`)
  const byIntent = groupBy(results, r => r.intent)
  for (const [intent, list] of byIntent) {
    const overall = avg(list.map(r => r.scores.overall))
    const n = avg(list.map(r => r.scores.noise))
    const d = avg(list.map(r => r.scores.diversity))
    const ri = avg(list.map(r => r.scores.richness))
    const re = avg(list.map(r => r.scores.recall).filter((v): v is number => v !== null))
    lines.push(`| ${intent} | ${list.length} | ${fmt(overall)} | ${fmt(n)} | ${fmt(d)} | ${fmt(ri)} | ${fmt(re)} |`)
  }
  lines.push(``)

  // 失败 case 详单
  const failed = results.filter(r => r.expectationFailures.length > 0)
  if (failed.length > 0) {
    lines.push(`## 失败的 case (${failed.length})`)
    lines.push(``)
    for (const r of failed) {
      lines.push(`### ${r.caseId} · ${r.query}`)
      for (const f of r.expectationFailures) lines.push(`- ❌ ${f}`)
      lines.push(`- 总分 ${fmt(r.scores.overall)}; 噪声率 ${fmt(r.details.noiseRate)}; ${r.details.uniqueDomains} 个域名`)
      if (r.details.noiseHits.length > 0) {
        lines.push(`- 噪声命中：${r.details.noiseHits.slice(0, 3).join(' / ')}`)
      }
      lines.push(``)
    }
  }

  // 全部 case 一览
  lines.push(`## 全部 case 一览`)
  lines.push(``)
  const hasLLM = results.some(r => r.scores.llm !== null)
  if (hasLLM) {
    lines.push(`| ID | Query | Intent | 总分 | 噪声 | 多样性 | 信息量 | 召回 | 禁域 | LLM | 延迟 |`)
    lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`)
    for (const r of results) {
      const flag = r.expectationFailures.length > 0 ? '❌' : '✅'
      const llmCell = r.scores.llm === null ? '-' : `${fmt(r.scores.llm)}${r.details.llm?.cached ? ' ·' : ''}`
      lines.push(`| ${flag} ${r.caseId} | ${r.query} | ${r.intent} | ${fmt(r.scores.overall)} | ${fmt(r.scores.noise)} | ${fmt(r.scores.diversity)} | ${fmt(r.scores.richness)} | ${r.scores.recall === null ? '-' : fmt(r.scores.recall)} | ${r.scores.forbidden === null ? '-' : fmt(r.scores.forbidden)} | ${llmCell} | ${r.latencyMs}ms |`)
    }
    lines.push(``)
    lines.push(`> LLM 列后的「·」表示该结果来自缓存(未发生新 API 调用)`)
  } else {
    lines.push(`| ID | Query | Intent | 总分 | 噪声 | 多样性 | 信息量 | 召回 | 禁域 | 延迟 |`)
    lines.push(`|---|---|---|---|---|---|---|---|---|---|`)
    for (const r of results) {
      const flag = r.expectationFailures.length > 0 ? '❌' : '✅'
      lines.push(`| ${flag} ${r.caseId} | ${r.query} | ${r.intent} | ${fmt(r.scores.overall)} | ${fmt(r.scores.noise)} | ${fmt(r.scores.diversity)} | ${fmt(r.scores.richness)} | ${r.scores.recall === null ? '-' : fmt(r.scores.recall)} | ${r.scores.forbidden === null ? '-' : fmt(r.scores.forbidden)} | ${r.latencyMs}ms |`)
    }
  }

  return lines.join('\n')
}

function diffTable(curr: CaseResult[], base: CaseResult[]): string {
  const baseMap = new Map(base.map(r => [r.caseId, r]))
  const lines: string[] = []
  lines.push(`| Case | Δ 总分 | 当前 | 基线 |`)
  lines.push(`|---|---|---|---|`)
  let improved = 0, regressed = 0
  for (const r of curr) {
    const b = baseMap.get(r.caseId)
    if (!b) continue
    const delta = r.scores.overall - b.scores.overall
    if (Math.abs(delta) < 0.02) continue
    const sign = delta > 0 ? '🟢 +' : '🔴 '
    if (delta > 0) improved++
    else regressed++
    lines.push(`| ${r.caseId} (${r.query}) | ${sign}${(delta * 100).toFixed(1)}% | ${fmt(r.scores.overall)} | ${fmt(b.scores.overall)} |`)
  }
  lines.unshift(`改善 ${improved} 个，回退 ${regressed} 个（变动 ≥ 2%）`)
  lines.unshift(``)
  return lines.join('\n')
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

function groupBy<T, K>(arr: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of arr) {
    const k = keyFn(item)
    const list = map.get(k) ?? []
    list.push(item)
    map.set(k, list)
  }
  return map
}

async function main() {
  const args = parseArgs(process.argv)
  const intentFilter = typeof args.intent === 'string' ? args.intent : null
  const diffPath = typeof args.diff === 'string' ? args.diff : null
  const saveName = typeof args.save === 'string' ? args.save : null
  const limit = typeof args.limit === 'string' ? parseInt(args.limit, 10) : null
  const useLLM = args.llm === true || args.llm === '1' || args.llm === 'true'

  if (useLLM) {
    const cfg = describeLLMConfig()
    if (!cfg.hasKey) {
      console.error('启用了 --llm 但找不到 API key；中止')
      console.error('  设置 LLM_JUDGE_API_KEY（推荐，通用）或 DEEPSEEK_API_KEY')
      console.error('  Windows cmd:    set LLM_JUDGE_API_KEY=sk-xxx')
      console.error('  Git Bash / *nix: export LLM_JUDGE_API_KEY=sk-xxx')
      process.exit(2)
    }
    console.log(`已启用 LLM judge`)
    console.log(`  端点: ${cfg.baseURL}`)
    console.log(`  模型: ${cfg.model}`)
    console.log(`  缓存: tests/search-bench/.llm-cache/`)
  }

  let toRun = cases
  if (intentFilter) toRun = toRun.filter(c => c.intent === intentFilter)
  if (limit && limit > 0) toRun = toRun.slice(0, limit)

  console.log(`将运行 ${toRun.length} 个 case`)
  if (intentFilter) console.log(`只跑 intent = ${intentFilter}`)
  console.log()

  const results: CaseResult[] = []
  // 串行：避免对搜索引擎并发太多导致限流；如需提速可改为 chunk 并发
  for (let i = 0; i < toRun.length; i++) {
    const c = toRun[i]
    process.stdout.write(`[${i + 1}/${toRun.length}] ${c.id} - ${c.query} ... `)
    const r = await runCase(c, { useLLM })
    const flag = r.expectationFailures.length > 0 ? '❌' : '✅'
    const llmTag = r.scores.llm !== null
      ? ` LLM${fmt(r.scores.llm)}${r.details.llm?.cached ? '·缓' : ''}`
      : ''
    process.stdout.write(`${flag} 总分${fmt(r.scores.overall)}${llmTag} ${r.latencyMs}ms\n`)
    results.push(r)
  }

  // 加载基线（如指定）
  let baseline: CaseResult[] | undefined
  if (diffPath) {
    const fullPath = join(__dirname, 'snapshots', diffPath)
    if (existsSync(fullPath)) {
      baseline = JSON.parse(readFileSync(fullPath, 'utf-8'))
      console.log(`\n已加载基线: ${diffPath}`)
    } else {
      console.warn(`\n警告：基线文件不存在 ${fullPath}`)
    }
  }

  // 渲染报告
  const report = renderReport(results, baseline)
  const snapDir = join(__dirname, 'snapshots')
  if (!existsSync(snapDir)) mkdirSync(snapDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const reportPath = join(snapDir, `report-${stamp}.md`)
  writeFileSync(reportPath, report, 'utf-8')

  // 保存 JSON 快照
  const jsonName = saveName ? `${saveName}.json` : `snapshot-${stamp}.json`
  const jsonPath = join(snapDir, jsonName)
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8')

  console.log(`\n报告已写入：${reportPath}`)
  console.log(`快照已写入：${jsonPath}`)

  // 退出码：有期望失败时非 0，方便接 CI
  const failed = results.filter(r => r.expectationFailures.length > 0).length
  console.log(`\n${failed === 0 ? '✓' : '✗'} ${results.length - failed}/${results.length} 通过期望`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(e)
  process.exit(2)
})
