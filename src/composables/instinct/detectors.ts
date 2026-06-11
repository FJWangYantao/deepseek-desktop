// Path A: 硬编码统计检测器
// 从 ObservationEvent[] 中识别确定性行为模式，产出 InstinctCandidate[]。
//
// 每个 detector 都返回 initialConfidence=0.5 的候选，由 mergeAndEvolve 决定新建还是强化。
// 阈值故意定得保守（≥3 / ≥5 次），避免单次偶发被误识别为模式。

import type { ObservationEvent } from '@/types/observation'
import type { InstinctCandidate } from '@/types/instinct'

// ===== 阈值 =====

const PERMISSION_DENIED_MIN = 3   // 连续 denied 次数
const PERMISSION_APPROVED_MIN = 5 // 连续 approved 次数
const SEARCH_KEYWORD_MIN_TURNS = 3 // 多少轮共享同一搜索关键词
const KEYWORD_MIN_LEN = 2          // 关键词最小字符数（过滤"的"、"a"）

// ===== 主入口 =====

export function detectStatisticalPatterns(events: ObservationEvent[]): InstinctCandidate[] {
  const out: InstinctCandidate[] = []
  out.push(...detectFailureRecoverySequence(events))
  out.push(...detectPermissionDenialPattern(events))
  out.push(...detectPermissionTrustPattern(events))
  out.push(...detectRepeatedSearchKeywords(events))
  return out
}

// ===== Detector 1: 失败 → 成功 序列 =====
//
// 同一 conversationTurnId 下，工具 A 失败后紧接换工具 B 成功，且 args 中有共同关键词
// → 候选"对这类查询，优先使用工具 B 而不是 A"。

function detectFailureRecoverySequence(events: ObservationEvent[]): InstinctCandidate[] {
  const out: InstinctCandidate[] = []
  // 按 conversationTurnId 分组
  const byTurn = groupBy(events, e => e.conversationTurnId ?? '')
  for (const [turnId, group] of Object.entries(byTurn)) {
    if (!turnId || group.length < 2) continue
    const results = group.filter((e): e is Extract<ObservationEvent, { type: 'tool.result' }> => e.type === 'tool.result')
    if (results.length < 2) continue

    // 找"失败后紧接的成功（不同工具）"
    for (let i = 0; i < results.length - 1; i++) {
      const a = results[i], b = results[i + 1]
      if (a.success || !b.success) continue
      if (a.toolName === b.toolName) continue

      // 找 args 中共同关键词（best-effort，跨中英文场景下可能为空）
      const argsA = findToolArgs(group, a.toolCallId)
      const argsB = findToolArgs(group, b.toolCallId)
      const keywordsA = extractArgKeywords(argsA)
      const keywordsB = extractArgKeywords(argsB)
      const shared = keywordsA.filter(k => keywordsB.includes(k))

      // 即使没有共同关键词，"工具序列失败-恢复"本身就是有价值的信号
      // 用 A 的关键词作为主题描述（更贴近用户原意，比如中文查询词）
      const topicKeywords = shared.length > 0 ? shared : keywordsA.slice(0, 3)
      if (topicKeywords.length === 0) continue   // 至少要有一边能提取出关键词
      const topic = topicKeywords.slice(0, 3).join('/')

      out.push({
        trigger: `当用户查询涉及"${topic}"类话题时`,
        action: `优先使用 ${b.toolName} 而不是 ${a.toolName}（${a.toolName} 在此场景失败概率高）`,
        domain: 'tool-strategy',
        source: 'statistical',
        evidence: `turn ${turnId.slice(0, 8)}: ${a.toolName} 失败 → ${b.toolName} 成功${shared.length ? '，共同关键词: ' + shared.join(', ') : '（关键词跨语言未匹配，仅按序列推断）'}`,
        initialConfidence: 0.5,
      })
    }
  }
  return out
}

// ===== Detector 2: 用户拒绝模式 =====
//
// 同一 toolName 连续 ≥3 次 decision=denied → 候选"用户倾向拒绝 toolX"。

function detectPermissionDenialPattern(events: ObservationEvent[]): InstinctCandidate[] {
  const out: InstinctCandidate[] = []
  const perms = events.filter((e): e is Extract<ObservationEvent, { type: 'tool.permission' }> => e.type === 'tool.permission')
  const denied = new Map<string, number>()
  for (const p of perms) {
    if (p.decision === 'denied') denied.set(p.toolName, (denied.get(p.toolName) ?? 0) + 1)
  }
  for (const [toolName, n] of denied) {
    if (n < PERMISSION_DENIED_MIN) continue
    out.push({
      trigger: `当需要调用 ${toolName} 工具时`,
      action: `用户倾向拒绝该工具，建议先解释原因/必要性，或寻找替代方案`,
      domain: 'tool-preference',
      source: 'statistical',
      evidence: `本批次观察到 ${toolName} 被拒绝 ${n} 次`,
      initialConfidence: 0.5,
    })
  }
  return out
}

// ===== Detector 3: 用户信任模式 =====
//
// 同一 toolName ≥5 次 approved 且 0 次 denied → 候选"用户信任 toolX"。

function detectPermissionTrustPattern(events: ObservationEvent[]): InstinctCandidate[] {
  const out: InstinctCandidate[] = []
  const perms = events.filter((e): e is Extract<ObservationEvent, { type: 'tool.permission' }> => e.type === 'tool.permission')
  const stats = new Map<string, { approved: number; denied: number }>()
  for (const p of perms) {
    const s = stats.get(p.toolName) ?? { approved: 0, denied: 0 }
    if (p.decision === 'approved') s.approved++
    else if (p.decision === 'denied') s.denied++
    stats.set(p.toolName, s)
  }
  for (const [toolName, s] of stats) {
    if (s.approved < PERMISSION_APPROVED_MIN || s.denied > 0) continue
    out.push({
      trigger: `当需要调用 ${toolName} 工具时`,
      action: `用户高度信任该工具（历史上多次批准且无拒绝），可主动使用无需过多确认`,
      domain: 'tool-preference',
      source: 'statistical',
      evidence: `本批次观察到 ${toolName} 被批准 ${s.approved} 次、0 拒绝`,
      initialConfidence: 0.5,
    })
  }
  return out
}

// ===== Detector 4: 重复搜索关键词 =====
//
// 连续多个 web_search 请求共享某关键词 → 候选"用户研究领域 X"。

function detectRepeatedSearchKeywords(events: ObservationEvent[]): InstinctCandidate[] {
  const out: InstinctCandidate[] = []
  const searches = events.filter(
    (e): e is Extract<ObservationEvent, { type: 'tool.request' }> => e.type === 'tool.request' && e.toolName === 'web_search'
  )
  if (searches.length < SEARCH_KEYWORD_MIN_TURNS) return out

  // 收集所有 query 关键词，统计出现次数
  const keywordCount = new Map<string, number>()
  for (const s of searches) {
    const kws = extractArgKeywords(s.argumentsPreview)
    const unique = [...new Set(kws)]
    for (const k of unique) keywordCount.set(k, (keywordCount.get(k) ?? 0) + 1)
  }
  // 选出现 ≥ MIN_TURNS 次的关键词
  const hot = [...keywordCount.entries()]
    .filter(([k, n]) => n >= SEARCH_KEYWORD_MIN_TURNS && k.length >= KEYWORD_MIN_LEN)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (hot.length === 0) return out

  const topic = hot.map(([k]) => k).join('/')
  out.push({
    trigger: `当对话涉及"${topic}"主题时`,
    action: `用户持续关注此话题，可主动整合相关上下文、引用已知信息`,
    domain: 'context-pattern',
    source: 'statistical',
    evidence: `本批次 web_search 中关键词 "${hot.map(([k, n]) => `${k}×${n}`).join(', ')}" 反复出现`,
    initialConfidence: 0.5,
  })
  return out
}

// ===== 工具函数 =====

function groupBy<T>(arr: T[], keyFn: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const x of arr) {
    const k = keyFn(x)
    if (!out[k]) out[k] = []
    out[k].push(x)
  }
  return out
}

function findToolArgs(group: ObservationEvent[], toolCallId: string): Record<string, unknown> | undefined {
  for (const e of group) {
    if (e.type === 'tool.request' && e.toolCallId === toolCallId) return e.argumentsPreview
  }
  return undefined
}

/**
 * 从工具参数中抽取关键词（任何字符串值），用于匹配跨工具的共同主题。
 * 主要服务于 web_search.queries / web_fetch.url 等。
 */
function extractArgKeywords(args: Record<string, unknown> | undefined): string[] {
  if (!args) return []
  const out: string[] = []
  function walk(v: unknown) {
    if (typeof v === 'string') {
      // 按非字母数字/中日韩字符切分
      const tokens = v.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter(t => t.length >= KEYWORD_MIN_LEN)
      out.push(...tokens)
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x)
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x)
    }
  }
  walk(args)
  return [...new Set(out)]
}
