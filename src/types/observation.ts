import type { UsageData, MemoryLayer } from './index'

// ===== Observation 事件类型 =====

export type ObservationEventType =
  | 'session.switch'
  | 'llm.request'
  | 'llm.usage'
  | 'tool.request'
  | 'tool.permission'
  | 'tool.result'
  | 'message.completed'
  | 'app.exit'

export interface ObservationBase {
  id: string
  type: ObservationEventType
  timestamp: number
  schemaVersion: 1
  source: 'renderer' | 'main'
  sessionId?: string
  conversationTurnId?: string
}

export interface SessionSwitchObservation extends ObservationBase {
  type: 'session.switch'
  fromSessionId?: string
  toSessionId?: string
}

export interface LlmRequestObservation extends ObservationBase {
  type: 'llm.request'
  round: number
  model: string
  thinking: 'enabled' | 'disabled'
  messageCount: number
  hasTools: boolean
  inputPreview: string
}

export interface LlmUsageObservation extends ObservationBase {
  type: 'llm.usage'
  round: number
  model: string
  usage: UsageData
}

export interface ToolRequestObservation extends ObservationBase {
  type: 'tool.request'
  toolCallId: string
  toolName: string
  argumentsPreview: Record<string, unknown>
}

export interface ToolPermissionObservation extends ObservationBase {
  type: 'tool.permission'
  toolCallId: string
  toolName: string
  decision: 'requested' | 'approved' | 'denied'
  reason?: string
}

export interface ToolResultObservation extends ObservationBase {
  type: 'tool.result'
  toolCallId: string
  toolName: string
  success: boolean
  dataPreview: string
  totalSize: number
  displayedSize: number
  truncated: boolean
}

export interface MessageCompletedObservation extends ObservationBase {
  type: 'message.completed'
  userMessageId: string
  assistantMessageId: string
  userTextPreview: string
  assistantTextPreview: string
  toolCallCount: number
  usage?: UsageData
}

export interface AppExitObservation extends ObservationBase {
  type: 'app.exit'
}

export type ObservationEvent =
  | SessionSwitchObservation
  | LlmRequestObservation
  | LlmUsageObservation
  | ToolRequestObservation
  | ToolPermissionObservation
  | ToolResultObservation
  | MessageCompletedObservation
  | AppExitObservation

// 渲染层调用时不需要自填 id/timestamp/source/schemaVersion，由 useObservationMemory 统一补齐
// 使用 distributive conditional 保留各 union 成员独有字段
export type ObservationEventInput = ObservationEvent extends infer T
  ? T extends ObservationEvent
    ? Omit<T, 'id' | 'timestamp' | 'source' | 'schemaVersion'>
    : never
  : never

// ===== IPC 响应 =====

export interface ObservationAppendResult {
  ok: boolean
  file?: string
  error?: string
}

// ===== 提炼候选 =====

export interface ObservationMemoryCandidate {
  content: string
  layer: MemoryLayer
  category: string
  confidence: number
  evidence: string
}
