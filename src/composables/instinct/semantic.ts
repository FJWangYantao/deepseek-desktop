// Path B: LLM 语义分析
// 把 observation 流交给 DeepSeek，让它提炼出"用户在哪种情况下倾向做什么"的规律。
//
// 设计要点：
// - 置信度上限 0.7（低于统计路径），因为 LLM 提炼存在编造风险
// - 失败/格式错只返回空数组，不抛错，不影响主流程
// - prompt 明确要求 evidence 必须能在数据里找到

import type { ObservationEvent } from '@/types/observation'
import type { InstinctCandidate, InstinctDomain } from '@/types/instinct'
import { formatObservationsForLLM } from '../useObservationMemory'

const VALID_DOMAINS: InstinctDomain[] = [
  'tool-strategy',
  'workflow',
  'tool-preference',
  'search-pattern',
  'context-pattern',
]

const SEMANTIC_PROMPT = `你是行为模式分析师。下面是用户最近一个会话的行为流（包含 LLM 请求、工具调用、消息完成等事件）。

请提炼出"用户在哪种情况下倾向做什么"的规律，输出 JSON 数组，每条形如：
{
  "trigger": "条件句，描述什么场景下适用",
  "action": "建议句，描述应该采取什么行为",
  "domain": "tool-strategy | workflow | tool-preference | search-pattern | context-pattern 之一",
  "evidence": "可在数据中找到的具体证据",
  "confidence": 0.4 ~ 0.7
}

规则：
- 只输出 JSON 数组，无前后缀、无 markdown 代码块。
- 不要提取简单统计模式（如"用户拒绝工具 X N 次"），这些已由统计路径覆盖。
- 关注语义层面的规律：任务类型 → 行为偏好，跨工具的工作流模式，等等。
- trigger 必须是条件句（以"当…时"开头）；action 必须是建议句。
- 没有可提炼的规律，输出 [] 。
- evidence 必须能在数据里找到，不要捏造。
- confidence 范围 0.4 ~ 0.7，不要超过 0.7。
- 每条 trigger 不超过 100 字，action 不超过 120 字。
- 不要重复同一规律。最多 5 条。
- 不输出涉及 API Key、token、password、完整本地路径的内容。`

export async function extractSemanticPatterns(
  events: ObservationEvent[],
  apiKey: string,
): Promise<InstinctCandidate[]> {
  if (!apiKey || events.length === 0) return []
  const text = formatObservationsForLLM(events).slice(0, 8000)
  if (!text.trim()) return []

  let raw = ''
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: SEMANTIC_PROMPT },
          { role: 'user', content: text },
        ],
        thinking: { type: 'disabled' },
        max_tokens: 1200,
      }),
    })
    if (!res.ok) {
      console.warn('[Instinct/B] API', res.status)
      return []
    }
    const data = await res.json()
    raw = (data.choices?.[0]?.message?.content ?? '').trim()
    if (!raw) return []
  } catch (e) {
    console.warn('[Instinct/B] fetch failed:', e)
    return []
  }

  // 抓 JSON 数组
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) {
    console.warn('[Instinct/B] no JSON array in response:', raw.slice(0, 200))
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(m[0])
  } catch (e) {
    console.warn('[Instinct/B] JSON parse failed:', e)
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: InstinctCandidate[] = []
  for (const item of parsed) {
    const cand = normalizeCandidate(item)
    if (cand) out.push(cand)
  }
  return out
}

function normalizeCandidate(raw: unknown): InstinctCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const trigger = typeof r.trigger === 'string' ? r.trigger.trim() : ''
  const action = typeof r.action === 'string' ? r.action.trim() : ''
  const evidence = typeof r.evidence === 'string' ? r.evidence.trim() : ''
  if (!trigger || !action) return null
  if (trigger.length > 200 || action.length > 240) return null

  let domain: InstinctDomain = 'tool-strategy'
  if (typeof r.domain === 'string' && (VALID_DOMAINS as string[]).includes(r.domain)) {
    domain = r.domain as InstinctDomain
  }

  let confidence = typeof r.confidence === 'number' ? r.confidence : 0.5
  // 语义路径硬上限 0.7
  confidence = Math.min(0.7, Math.max(0.4, confidence))

  return {
    trigger,
    action,
    domain,
    source: 'semantic',
    evidence: evidence.slice(0, 300),
    initialConfidence: confidence,
  }
}
