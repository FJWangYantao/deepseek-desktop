import type {
  ObservationEvent,
  ObservationEventInput,
  ObservationMemoryCandidate,
} from '@/types/observation'
import { useMemory } from './useMemory'

// 简单 id 生成器，避免依赖 useMemory.generateId
function generateObsId(): string {
  return 'obs_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// 渲染层最近事件 buffer，用于会话切换/退出时批量提炼
const MAX_BUFFER = 100
const buffer: ObservationEvent[] = []

function pushBuffer(event: ObservationEvent) {
  buffer.push(event)
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
}

function nowTs(): number {
  return new Date().getTime()
}

/** 渲染层统一记录入口 */
export async function recordObservation(input: ObservationEventInput): Promise<void> {
  const event: ObservationEvent = {
    id: generateObsId(),
    timestamp: nowTs(),
    schemaVersion: 1,
    source: 'renderer',
    ...input,
  } as ObservationEvent
  pushBuffer(event)
  try {
    await window.electronAPI?.observationsAppend?.(event)
  } catch (e) {
    console.warn('[Observation] append failed:', e)
  }
}

/** 同步入 buffer + 触发 best-effort append；用于 beforeunload 等同步场景 */
export function recordObservationSync(input: ObservationEventInput): void {
  const event: ObservationEvent = {
    id: generateObsId(),
    timestamp: nowTs(),
    schemaVersion: 1,
    source: 'renderer',
    ...input,
  } as ObservationEvent
  pushBuffer(event)
  try {
    void window.electronAPI?.observationsAppend?.(event)
  } catch (e) {
    console.warn('[Observation] sync append failed:', e)
  }
}

/** 取最近事件（用于批量提炼） */
export function getRecentObservations(opts: { sessionId?: string; limit?: number } = {}): ObservationEvent[] {
  const { sessionId, limit = 30 } = opts
  let list = buffer
  if (sessionId) list = list.filter(e => e.sessionId === sessionId)
  return list.slice(-limit)
}

/** 清空 buffer 中已处理 session 的事件 */
export function clearObservationsForSession(sessionId: string) {
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].sessionId === sessionId) buffer.splice(i, 1)
  }
}

/** 把事件渲染为 LLM 可读文本，供提炼 prompt 使用 */
export function formatObservationsForLLM(events: ObservationEvent[]): string {
  const lines: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'message.completed':
        lines.push(`[消息完成] 用户：${e.userTextPreview}\nAI：${e.assistantTextPreview}`)
        break
      case 'tool.request':
        lines.push(`[工具请求] ${e.toolName} args=${JSON.stringify(e.argumentsPreview).slice(0, 300)}`)
        break
      case 'tool.result':
        lines.push(`[工具结果] ${e.toolName} success=${e.success} preview=${e.dataPreview.slice(0, 300)}`)
        break
      case 'tool.permission':
        lines.push(`[工具权限] ${e.toolName} decision=${e.decision} reason=${e.reason ?? ''}`)
        break
      case 'llm.request':
        lines.push(`[LLM请求] round=${e.round} model=${e.model} hasTools=${e.hasTools}`)
        break
      case 'llm.usage':
        lines.push(`[LLM用量] round=${e.round} total=${e.usage.total_tokens}`)
        break
      case 'session.switch':
        lines.push(`[切换会话] ${e.fromSessionId ?? ''} → ${e.toSessionId ?? ''}`)
        break
      case 'app.exit':
        lines.push('[应用退出]')
        break
    }
  }
  return lines.join('\n')
}

// 占位：Step 4 已由 useMemory 提供 extractFromObservationBatch
type ExtractFn = (text: string, apiKey: string, mode: 'light' | 'batch') => Promise<{
  autoAdded: number
  previewAdded: number
  total: number
  error?: string
}>

let extractor: ExtractFn | null = null
let extracting = false

export function bindMemoryExtractor(fn: ExtractFn) {
  extractor = fn
}

function getExtractor(): ExtractFn {
  if (extractor) return extractor
  // 默认绑定到 useMemory().extractFromObservationBatch
  const memory = useMemory()
  return (text, apiKey, mode) => memory.extractFromObservationBatch(text, apiKey, { mode })
}

async function safeExtract(text: string, apiKey: string, mode: 'light' | 'batch'): Promise<void> {
  if (!apiKey || !text || extracting) return
  extracting = true
  try {
    const fn = getExtractor()
    const r = await fn(text, apiKey, mode)
    if (r.error) console.warn('[ObservationMemory] extract error:', r.error)
    else console.log(`[ObservationMemory] extract ok mode=${mode} auto=${r.autoAdded} preview=${r.previewAdded}`)
  } catch (e) {
    console.warn('[ObservationMemory] extract failed:', e)
  } finally {
    extracting = false
  }
}

// ===== 高层入口（被 chat.ts 调用） =====

export async function recordMessageCompleted(input: {
  sessionId: string
  conversationTurnId: string
  userMessageId: string
  assistantMessageId: string
  userText: string
  assistantText: string
  toolCallCount: number
  usage?: import('@/types').UsageData
}) {
  await recordObservation({
    type: 'message.completed',
    sessionId: input.sessionId,
    conversationTurnId: input.conversationTurnId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    userTextPreview: input.userText,
    assistantTextPreview: input.assistantText,
    toolCallCount: input.toolCallCount,
    usage: input.usage,
  })
}

export async function extractLightFromMessageCompleted(input: {
  sessionId: string
  conversationTurnId: string
  userText: string
  assistantText: string
  apiKey: string
}) {
  const text = `[消息完成] 用户：${input.userText}\n\nAI 回复摘要：${input.assistantText.slice(0, 2000)}`
  await safeExtract(text, input.apiKey, 'light')
}

export async function recordSessionSwitch(fromSessionId: string | undefined, toSessionId: string | undefined) {
  await recordObservation({
    type: 'session.switch',
    sessionId: toSessionId,
    fromSessionId,
    toSessionId,
  })
}

export async function extractBatchOnSessionSwitch(fromSessionId: string | undefined, _toSessionId: string | undefined, apiKey: string) {
  if (!fromSessionId) return
  const events = getRecentObservations({ sessionId: fromSessionId, limit: 30 })
  if (events.length === 0) return
  const text = formatObservationsForLLM(events)
  await safeExtract(text, apiKey, 'batch')
  clearObservationsForSession(fromSessionId)
}

export function recordAppExit() {
  recordObservationSync({ type: 'app.exit' })
}

export type { ObservationMemoryCandidate }
