// Instinct Engine — 行为模式提炼与注入
//
// 数据流：会话切换时 → 跑统计/语义双路径产出 candidates →
//        与现有 store 演化合并（Jaccard 去重 + 置信度演化）→ saveStore
// 注入流：chat.ts 构建 system prompt 时 → buildInstinctContext() → 拼到末尾
//
// 设计参考 Claude Code 的 Instinct Engine（auto-analyze-instincts.py + auto-evolve.py），
// 但简化为 localStorage 单文件存储 + 渲染进程内运行，不写盘 .md。

import { ref } from 'vue'
import type {
  Instinct,
  InstinctCandidate,
  InstinctDomain,
  InstinctStoreShape,
} from '@/types/instinct'
import { getRecentObservations } from './useObservationMemory'
import { detectStatisticalPatterns } from './instinct/detectors'
import { extractSemanticPatterns } from './instinct/semantic'

// ===== 常量 =====

const STORAGE_KEY = 'ds_instincts'

const INJECT_THRESHOLD = 0.7        // ≥ 0.7 注入 system prompt
const NEW_CONFIDENCE = 0.5          // 路径 A 新发现初始置信度
const CONFIDENCE_BOOST = 0.05       // 每次验证 +0.05
const CONFIDENCE_DECAY = 0.05       // 长期未触发 -0.05
const CONFIDENCE_CAP = 0.9          // 上限
const DEPRECATE_THRESHOLD = 0.55    // < 0.55 标记 deprecated
const REVIVE_THRESHOLD = 0.6        // deprecated 但 ≥ 0.6 取消废弃
const JACCARD_SIM_THRESHOLD = 0.5
const DECAY_AFTER_MS = 14 * 24 * 3600 * 1000  // 14 天

const MAX_INJECT = 8                 // 注入最多 8 条
const MAX_INSTINCTS = 200            // 存储上限，超出按 confidence 升序裁剪

// 英文停用词（Jaccard 用，避免高频虚词干扰相似度）
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'when', 'then', 'this', 'that', 'use', 'using',
  'user', 'before', 'after', 'should', 'would', 'will', 'can', 'may', 'has',
  'have', 'are', 'was', 'were', 'not', 'but', 'from', 'into', 'out', 'over',
  'just', 'also', 'one', 'two', 'all', 'any', 'some', 'each', 'than', 'such',
])

// ===== 模块级单例 store =====

function loadStore(): InstinctStoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { instincts: [], updatedAt: 0 }
    const parsed = JSON.parse(raw) as InstinctStoreShape
    if (!parsed || !Array.isArray(parsed.instincts)) return { instincts: [], updatedAt: 0 }
    return parsed
  } catch {
    return { instincts: [], updatedAt: 0 }
  }
}

const store = ref<InstinctStoreShape>(loadStore())

function saveStore() {
  try {
    store.value.updatedAt = new Date().getTime()
    // 容量保护：超过上限按 confidence 升序砍掉最弱的
    if (store.value.instincts.length > MAX_INSTINCTS) {
      store.value.instincts.sort((a, b) => b.confidence - a.confidence)
      store.value.instincts.length = MAX_INSTINCTS
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.value))
  } catch (e) {
    console.warn('[Instinct] saveStore failed:', e)
  }
}

// ===== 工具函数 =====

function generateInstinctId(): string {
  return 'inst_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** 抽取英文关键词（仅字母 + 下划线，长度 ≥ 3，去停用词，去重） */
export function extractEnglishKeywords(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z][a-z_]{2,}/g) ?? []
  const filtered = tokens.filter(t => !STOP_WORDS.has(t))
  return [...new Set(filtered)]
}

/** Jaccard 相似度：交集 / 并集 */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const sa = new Set(a), sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : inter / union
}

// ===== 演化：合并 candidates 到 store =====

/**
 * 把 candidates 演化进 store：
 * - 命中已有（Jaccard ≥ 0.5）→ confidence +0.05、observedCount +1、lastObservedAt 更新
 * - 未命中 → 新建
 * - 顺便对所有 14 天未触发的 instinct -0.05，跌破 0.55 标记 deprecated
 */
export function mergeAndEvolve(candidates: InstinctCandidate[]): {
  created: number
  reinforced: number
  decayed: number
  deprecated: number
} {
  const now = new Date().getTime()
  let created = 0, reinforced = 0, decayed = 0, deprecated = 0

  for (const cand of candidates) {
    const keywords = extractEnglishKeywords(cand.trigger + ' ' + cand.action + ' ' + cand.domain)
    let bestMatchIdx = -1
    let bestSim = 0
    for (let i = 0; i < store.value.instincts.length; i++) {
      const sim = jaccard(keywords, store.value.instincts[i].keywords)
      if (sim > bestSim) { bestSim = sim; bestMatchIdx = i }
    }

    if (bestMatchIdx >= 0 && bestSim >= JACCARD_SIM_THRESHOLD) {
      const inst = store.value.instincts[bestMatchIdx]
      inst.confidence = Math.min(CONFIDENCE_CAP, inst.confidence + CONFIDENCE_BOOST)
      inst.observedCount += 1
      inst.lastObservedAt = now
      // evidence 用最新一条，便于用户看为什么强化
      if (cand.evidence) inst.evidence = cand.evidence
      if (inst.deprecated && inst.confidence >= REVIVE_THRESHOLD) inst.deprecated = false
      reinforced++
    } else {
      const inst: Instinct = {
        id: generateInstinctId(),
        trigger: cand.trigger,
        action: cand.action,
        domain: cand.domain,
        confidence: cand.initialConfidence,
        source: cand.source,
        evidence: cand.evidence,
        observedCount: 1,
        validatedCount: 0,
        lastObservedAt: now,
        createdAt: now,
        deprecated: false,
        keywords,
      }
      store.value.instincts.push(inst)
      created++
    }
  }

  // 顺手衰减
  const decayResult = decayUnusedInstincts()
  decayed = decayResult.decayed
  deprecated = decayResult.deprecated

  saveStore()
  return { created, reinforced, decayed, deprecated }
}

/** 对超过 DECAY_AFTER_MS 没触发的 instinct 衰减 -0.05；< DEPRECATE_THRESHOLD 标记 deprecated */
export function decayUnusedInstincts(): { decayed: number; deprecated: number } {
  const now = new Date().getTime()
  let decayed = 0, deprecated = 0
  for (const inst of store.value.instincts) {
    if (inst.deprecated) continue
    if (now - inst.lastObservedAt > DECAY_AFTER_MS) {
      inst.confidence = Math.max(0, inst.confidence - CONFIDENCE_DECAY)
      decayed++
      if (inst.confidence < DEPRECATE_THRESHOLD) {
        inst.deprecated = true
        deprecated++
      }
    }
  }
  return { decayed, deprecated }
}

// ===== 注入 system prompt =====

/**
 * 构建 instinct 注入段，会读取 settings.instinctEnabled 开关；关闭时返回空。
 * 调用方：chat.ts 构建 system prompt 时。
 */
export function buildInstinctContext(): string {
  // 这里不引入 settings store（避免循环依赖与 SSR 顾虑），由调用方根据开关决定是否调用
  const active = store.value.instincts
    .filter(i => !i.deprecated && i.confidence >= INJECT_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_INJECT)
  if (active.length === 0) return ''
  const lines: string[] = ['[行为习惯（基于历史观察自动学习，可参考）]']
  for (const i of active) {
    // 单条做长度保护，避免单条爆 prompt
    const trigger = i.trigger.length > 100 ? i.trigger.slice(0, 100) + '…' : i.trigger
    const action = i.action.length > 120 ? i.action.slice(0, 120) + '…' : i.action
    lines.push(`- ${trigger} → ${action}`)
  }
  return lines.join('\n')
}

// ===== UI 操作 =====

export function deleteInstinct(id: string) {
  const i = store.value.instincts.findIndex(x => x.id === id)
  if (i >= 0) {
    store.value.instincts.splice(i, 1)
    saveStore()
  }
}

export function toggleDeprecated(id: string) {
  const inst = store.value.instincts.find(x => x.id === id)
  if (!inst) return
  inst.deprecated = !inst.deprecated
  saveStore()
}

export function clearAllInstincts() {
  store.value.instincts = []
  saveStore()
}

// ===== Path A / Path B 实现位于 ./instinct/*.ts，这里 re-export 给外部 =====

export { detectStatisticalPatterns, extractSemanticPatterns }

// ===== 高层入口（chat.ts 调用） =====

/**
 * 会话切换时触发的 instinct 提炼。fire-and-forget，吞掉所有错误。
 * 由调用方根据 settings.instinctSemanticEnabled 决定是否传 apiKey 启用 Path B。
 */
export async function extractInstinctsOnSessionSwitch(opts: {
  fromSessionId: string
  apiKey?: string         // 提供 → 启用 Path B；不提供 → 仅 Path A
  enabled?: boolean       // 总开关，false 直接 return
}): Promise<void> {
  if (opts.enabled === false) return
  if (!opts.fromSessionId) return

  try {
    const events = getRecentObservations({ sessionId: opts.fromSessionId, limit: 50 })
    if (events.length === 0) return

    const candidates: InstinctCandidate[] = []

    // Path A：永远跑（零成本）
    try {
      const a = detectStatisticalPatterns(events)
      candidates.push(...a)
    } catch (e) {
      console.warn('[Instinct] Path A failed:', e)
    }

    // Path B：仅在提供 apiKey 时跑
    if (opts.apiKey) {
      try {
        const b = await extractSemanticPatterns(events, opts.apiKey)
        candidates.push(...b)
      } catch (e) {
        console.warn('[Instinct] Path B failed:', e)
      }
    }

    if (candidates.length > 0) {
      const r = mergeAndEvolve(candidates)
      console.log(`[Instinct] merge: +${r.created} new, ${r.reinforced} reinforced, ${r.decayed} decayed, ${r.deprecated} deprecated`)
    } else {
      // 没有 candidate 也跑一次衰减
      const r = decayUnusedInstincts()
      if (r.decayed > 0) saveStore()
    }
  } catch (e) {
    console.warn('[Instinct] extractInstinctsOnSessionSwitch failed:', e)
  }
}

// ===== Composable 入口 =====

export function useInstinct() {
  return {
    store,
    buildInstinctContext,
    deleteInstinct,
    toggleDeprecated,
    clearAllInstincts,
    mergeAndEvolve,
    decayUnusedInstincts,
    // 工具函数，便于 UI / 测试调用
    extractEnglishKeywords,
    jaccard,
  }
}

// 便于外部（如 SettingsView "清空所有数据"按钮）重置
export function resetInstinctStore() {
  store.value = { instincts: [], updatedAt: 0 }
  saveStore()
}

// 常量导出，供 UI 显示阈值条
export const INSTINCT_CONFIG = {
  INJECT_THRESHOLD,
  NEW_CONFIDENCE,
  DEPRECATE_THRESHOLD,
  CONFIDENCE_CAP,
  DECAY_AFTER_MS,
  MAX_INJECT,
} as const

export type { InstinctDomain }
