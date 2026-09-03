import type { UsageData } from '../types'

/** Agent Run 的生命周期状态。 */
export type AgentRunStatus =
  | 'created'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Runtime 内部统一使用的消息角色。 */
export type RuntimeMessageRole = 'system' | 'user' | 'assistant' | 'tool'

/** 一次 LLM 输出中的工具调用。arguments 保留为 JSON 字符串，以便无损回传模型。 */
export interface RuntimeToolCall {
  id: string
  name: string
  arguments: string
}

/** Runtime 内部的消息格式，不携带 Vue 或 Pinia 状态。 */
export interface RuntimeMessage {
  /** 历史消息没有 id 时可以暂缺；Runtime 新生成的消息应尽量补齐。 */
  id?: string
  role: RuntimeMessageRole
  content: string
  /** tool 消息对应的工具调用 id。 */
  toolCallId?: string
  /** assistant 消息在本轮请求工具时携带的调用列表。 */
  toolCalls?: RuntimeToolCall[]
  /** 某些模型协议会在 tool 消息上携带工具名。 */
  name?: string
}

/** 工具执行完成后回填给 Agent Loop 的结果。 */
export interface RuntimeToolResult {
  callId: string
  name: string
  success: boolean
  data: string
  truncated: boolean
  totalSize: number
  displayedSize: number
  offset: number
  /** 工具层发现需要用户批准时使用。 */
  needsApproval?: boolean
  approvalReason?: string
}

/** 一次工具调用从请求到结束的 Runtime 记录。 */
export interface RuntimeToolExecution extends RuntimeToolCall {
  status: 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'
  result?: RuntimeToolResult
  error?: string
  requestedAt?: number
  startedAt?: number
  finishedAt?: number
}

/** 一轮 LLM 输出。roundId 用于跨事件、日志和未来 IPC 稳定关联同一轮。 */
export interface AgentRound {
  roundId: string
  /** 从 0 开始的轮次序号。 */
  index: number
  inputMessages: RuntimeMessage[]

  output?: {
    content: string
    thinking?: string
    toolCalls?: RuntimeToolCall[]
  }

  tools: RuntimeToolExecution[]
  usage?: UsageData
  startedAt?: number
  finishedAt?: number
}

/** 一次用户请求对应的完整 Agent 执行实体。 */
export interface AgentRun {
  /** Run 的稳定 id；后续事件中的 runId 对应这里的 id。 */
  id: string
  sessionId: string
  conversationTurnId: string

  status: AgentRunStatus
  mode: string
  rounds: AgentRound[]
  /** Run 实体创建时间。 */
  createdAt: number
  /** Runtime 真正开始执行的时间；created 状态下尚未设置。 */
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface CreateAgentRunInput {
  sessionId: string
  conversationTurnId: string
  mode: string
  /** 允许调用方注入 id，便于恢复、测试和未来跨进程关联。 */
  id?: string
  createdAt?: number
}

export interface CreateAgentRoundInput {
  index: number
  inputMessages?: RuntimeMessage[]
  roundId?: string
  startedAt?: number
}
