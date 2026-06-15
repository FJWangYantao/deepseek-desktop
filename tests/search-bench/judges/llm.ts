/**
 * LLM judge：调任意 OpenAI 兼容的 chat/completions 端点（DeepSeek、RightCode、
 * OpenAI 官方、阿里百炼、字节 Doubao 等），让模型对一组搜索结果给出语义化打分。
 *
 * 当前默认硬编码到 RightCode 的 Claude 通道（claude-opus-4-8）。
 * 想切别的端点，要么改 DEFAULT_* 常量，要么用环境变量覆盖：
 *   LLM_JUDGE_BASE_URL   完整端点 URL，要包含到 /v1/chat/completions
 *   LLM_JUDGE_API_KEY    Bearer token
 *   LLM_JUDGE_MODEL      模型名
 *
 * ⚠️ 警告：硬编码的 API key 会随 git 一起提交。在公开仓库 / 分享给他人前，
 *    务必把 DEFAULT_API_KEY 改回空字符串或 undefined，让它退回到 env 读取。
 *
 * 为什么补这一层：
 * - 启发式 judge 字面看 title/snippet，命中关键词就 1，不命中就 0；
 *   但很多 case 实际上 snippet 给出了等价信息（"创建 venv" 写成了 "python -m venv 环境名"）。
 * - 启发式不会区分"看似相关、实际答非所问"的结果，比如搜「比特币 价格 今日」
 *   返回一堆"字节、bit、KB"的文章——域名不在黑名单、长度也够，但完全没用。
 *
 * 评分维度（每条 0..1，最后取平均当 LLM 分数）：
 *   1. relevance   语义相关性：top-N 平均与 query 的匹配度
 *   2. answerable  可推导性：仅看 snippet 能否大致回答 query
 *   3. credibility 来源可信度：是官方/权威/社区，还是 SEO 农场/转载站
 *   4. freshness   时效性（仅对 news/factual 类计算）
 *
 * 约束：
 * - 默认 off，跑 benchmark 时加 --llm 才启用
 * - 带磁盘缓存（key = sha1(query + top-N urls + titles + model)），跑同样的 case 不重复花钱；
 *   不同 provider/model 的缓存彼此独立——切了模型不会读到上次别人打的分
 * - 调不通时返回 null，benchmark 整体跑下去
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SearchHitLike } from './heuristic'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, '..', '.llm-cache')
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })

export interface LLMJudgeResult {
  score: number
  details: {
    relevance: number
    answerable: number
    credibility: number
    freshness: number | null
    reasoning: string
    cached: boolean
  }
}

export interface LLMJudgeOptions {
  /** 让模型也评估时效性（news/factual 用） */
  needsFreshness?: boolean
  /** top-N 送给模型评估，默认 5（再多 token 涨太快） */
  topN?: number
  /** 模型名；不传则按 LLM_JUDGE_MODEL → 'deepseek-chat' 兜底 */
  model?: string
  /** API key；不传则按 LLM_JUDGE_API_KEY → DEEPSEEK_API_KEY 兜底 */
  apiKey?: string
  /** 完整端点 URL；不传则按 LLM_JUDGE_BASE_URL → DeepSeek 兜底 */
  baseURL?: string
}

const DEFAULT_BASE_URL = 'https://right.codes/claude-aws/v1/chat/completions'
const DEFAULT_MODEL = 'claude-opus-4-8'
// API key 不硬编码，从环境变量读：
//   LLM_JUDGE_API_KEY (优先) → DEEPSEEK_API_KEY (回落)
// 临时本地试用想硬编码，把这里换成 'sk-xxx' 即可，但务必在 push 前改回空串。
const DEFAULT_API_KEY = ''

function resolveConfig(opts: LLMJudgeOptions): { baseURL: string; apiKey: string | undefined; model: string } {
  // 空串视为"没设"，让 callLLM 的 !apiKey 检查能拦住
  const fromEnv = process.env.LLM_JUDGE_API_KEY || process.env.DEEPSEEK_API_KEY || DEFAULT_API_KEY
  return {
    baseURL: opts.baseURL ?? process.env.LLM_JUDGE_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey: opts.apiKey ?? (fromEnv || undefined),
    model: opts.model ?? process.env.LLM_JUDGE_MODEL ?? DEFAULT_MODEL,
  }
}

/** 给外部用的，比如 main() 在启动时打印 "已启用 LLM judge / 端点 xxx / 模型 yyy" */
export function describeLLMConfig(opts: LLMJudgeOptions = {}): { baseURL: string; model: string; hasKey: boolean } {
  const cfg = resolveConfig(opts)
  return { baseURL: cfg.baseURL, model: cfg.model, hasKey: !!cfg.apiKey }
}

const SYSTEM_PROMPT = `你是搜索结果质量评审。对一组 top-N 搜索结果按维度打 0~1 分（保留 1 位小数），输出严格 JSON。

维度：
- relevance：top-N 整体与 query 的语义相关度（1=全都直接相关，0.5=半数相关，0=都跑题）
- answerable：仅依据这些 snippet（不查原文），用户能否大致回答 query（1=能直接回答，0.5=能拼出一半，0=完全答不上）
- credibility：来源整体可信度（1=权威官网/官方文档/学术站，0.5=主流媒体/技术博客，0.3=知乎/百家号/转载站，0=SEO 农场/广告页）
- freshness：仅当 needsFreshness=true 时打分；snippet 中的时间信息是否足够新（1=最近 1 月内或常青内容，0.5=半年内，0=明显过期或没时间线索）。needsFreshness=false 时此字段输出 null。

输出 JSON 格式（不要多余文字）：
{"relevance": 0.x, "answerable": 0.x, "credibility": 0.x, "freshness": 0.x|null, "reasoning": "一句话解释主要扣分点"}`

function hashKey(query: string, hits: SearchHitLike[], topN: number, needsFreshness: boolean, model: string): string {
  const top = hits.slice(0, topN)
  const sig = JSON.stringify({
    q: query,
    f: needsFreshness,
    m: model,                                    // 不同模型/通道的缓存独立
    items: top.map(h => ({ u: h.url, t: h.title.slice(0, 80) })),
  })
  return createHash('sha1').update(sig).digest('hex').slice(0, 16)
}

function loadCache(key: string): LLMJudgeResult | null {
  const path = join(CACHE_DIR, `${key}.json`)
  if (!existsSync(path)) return null
  try {
    const r = JSON.parse(readFileSync(path, 'utf-8')) as LLMJudgeResult
    r.details.cached = true
    return r
  } catch {
    return null
  }
}

function saveCache(key: string, result: LLMJudgeResult): void {
  const path = join(CACHE_DIR, `${key}.json`)
  // 缓存里把 cached 字段固定为 false，加载时再改 true。这样写盘是一次性的、稳定的。
  writeFileSync(path, JSON.stringify({ ...result, details: { ...result.details, cached: false } }, null, 2), 'utf-8')
}

/** 把 hits 渲染成发给 LLM 的 user 消息 */
function renderUserMessage(query: string, hits: SearchHitLike[], topN: number, needsFreshness: boolean): string {
  const top = hits.slice(0, topN)
  const lines = [`query: ${query}`, `needsFreshness: ${needsFreshness}`, '', `搜索结果 top-${top.length}:`]
  for (let i = 0; i < top.length; i++) {
    const h = top[i]
    lines.push(`[${i + 1}] ${h.title}`)
    lines.push(`    url: ${h.url}`)
    lines.push(`    snippet: ${h.snippet.slice(0, 240)}`)
  }
  return lines.join('\n')
}

interface DeepSeekResponse {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

/**
 * 单次调 LLM。失败/解析不出 JSON 时返回 null（让 benchmark 跑完）。
 */
async function callLLM(query: string, hits: SearchHitLike[], opts: LLMJudgeOptions): Promise<LLMJudgeResult | null> {
  const cfg = resolveConfig(opts)
  if (!cfg.apiKey) {
    console.warn('[llm-judge] 没有 API key（环境变量 LLM_JUDGE_API_KEY / DEEPSEEK_API_KEY 都未设），跳过')
    return null
  }
  const topN = opts.topN ?? 5
  const needsFreshness = !!opts.needsFreshness
  const userMsg = renderUserMessage(query, hits, topN, needsFreshness)

  // 不是所有 OpenAI 兼容端点都支持 response_format: json_object
  // （Claude/Anthropic 通过中转转译时偶有不兼容；DeepSeek/OpenAI 都支持）。
  // 这里在 prompt 里也明确要求纯 JSON，不依赖该字段强约束。
  const body: Record<string, unknown> = {
    model: cfg.model,
    stream: false,
    response_format: { type: 'json_object' },
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
  }

  try {
    const resp = await fetch(cfg.baseURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      // 一些 Claude 中转不认 response_format，错误码 400 时退化重试一次
      if (resp.status === 400 && body.response_format) {
        delete body.response_format
        const retry = await fetch(cfg.baseURL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(body),
        })
        if (!retry.ok) {
          const t = await retry.text().catch(() => '')
          console.warn(`[llm-judge] HTTP ${retry.status}（重试无效）: ${t.slice(0, 200)}`)
          return null
        }
        return parseLLMResponse(await retry.json(), needsFreshness)
      }
      console.warn(`[llm-judge] HTTP ${resp.status}: ${errText.slice(0, 200)}`)
      return null
    }
    return parseLLMResponse(await resp.json(), needsFreshness)
  } catch (e) {
    console.warn(`[llm-judge] 调用失败:`, e instanceof Error ? e.message : e)
    return null
  }
}

function parseLLMResponse(data: DeepSeekResponse, needsFreshness: boolean): LLMJudgeResult | null {
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    console.warn('[llm-judge] 响应里没有 content')
    return null
  }
  let parsed: { relevance?: number; answerable?: number; credibility?: number; freshness?: number | null; reasoning?: string }
  try {
    parsed = JSON.parse(content)
  } catch {
    // 兜底：从内容里抠 JSON 块（Claude 偶尔会把 JSON 包在 ```json ... ``` 或带前置说明）
    const m = content.match(/\{[\s\S]*\}/)
    if (!m) { console.warn('[llm-judge] 解析 JSON 失败'); return null }
    try { parsed = JSON.parse(m[0]) } catch { console.warn('[llm-judge] 解析 JSON 失败 2'); return null }
  }

  const clip = (n: unknown): number => {
    const v = typeof n === 'number' ? n : Number(n)
    if (!Number.isFinite(v)) return 0
    return Math.max(0, Math.min(1, v))
  }
  const relevance = clip(parsed.relevance)
  const answerable = clip(parsed.answerable)
  const credibility = clip(parsed.credibility)
  const freshness = needsFreshness && typeof parsed.freshness === 'number'
    ? clip(parsed.freshness)
    : null

  const components = [relevance, answerable, credibility]
  if (freshness !== null) components.push(freshness)
  const score = components.reduce((s, v) => s + v, 0) / components.length

  return {
    score,
    details: {
      relevance, answerable, credibility, freshness,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 300) : '',
      cached: false,
    },
  }
}

/**
 * 主入口：带缓存 + 容错的 LLM judge。
 * 命中缓存直接返回；不命中才打网络。同 case+top-N+model 重复跑 0 成本。
 */
export async function judgeWithLLM(
  query: string,
  hits: SearchHitLike[],
  opts: LLMJudgeOptions = {},
): Promise<LLMJudgeResult | null> {
  if (hits.length === 0) return null
  const topN = opts.topN ?? 5
  const needsFreshness = !!opts.needsFreshness
  const cfg = resolveConfig(opts)
  const key = hashKey(query, hits, topN, needsFreshness, cfg.model)
  const cached = loadCache(key)
  if (cached) return cached
  const result = await callLLM(query, hits, opts)
  if (result) saveCache(key, result)
  return result
}
