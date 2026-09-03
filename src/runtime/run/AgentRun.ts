import type {
  AgentRound,
  AgentRun,
  CreateAgentRoundInput,
  CreateAgentRunInput,
} from '../types'

export type {
  AgentRound,
  AgentRun,
  AgentRunStatus,
  CreateAgentRoundInput,
  CreateAgentRunInput,
  RuntimeMessage,
  RuntimeMessageRole,
  RuntimeToolCall,
  RuntimeToolExecution,
  RuntimeToolResult,
} from '../types'

function createRuntimeId(prefix: string): string {
  const runtimeCrypto = globalThis.crypto
  if (runtimeCrypto?.randomUUID) return `${prefix}_${runtimeCrypto.randomUUID()}`

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 创建一次 Agent Run 的初始实体。
 *
 * Phase 1 只负责建立领域对象，不启动 LLM、Tool 或任何 UI 生命周期。
 * 新 Run 从 created 状态开始，后续由 AgentRuntime 推进到 running/终态。
 */
export function createAgentRun(input: CreateAgentRunInput): AgentRun {
  return {
    id: input.id ?? createRuntimeId('run'),
    sessionId: input.sessionId,
    conversationTurnId: input.conversationTurnId,
    status: 'created',
    mode: input.mode,
    rounds: [],
    createdAt: input.createdAt ?? Date.now(),
  }
}

/** 创建一轮尚未产出 LLM 结果的 AgentRound。 */
export function createAgentRound(input: CreateAgentRoundInput): AgentRound {
  return {
    roundId: input.roundId ?? createRuntimeId('round'),
    index: input.index,
    inputMessages: input.inputMessages ? [...input.inputMessages] : [],
    tools: [],
    startedAt: input.startedAt ?? Date.now(),
  }
}

/**
 * 将一轮追加到 Run 中，并阻止相同 roundId 被重复写入。
 * 这样 Run 可以作为后续 Trace、Review 和 Replay 的单一事实来源。
 */
export function appendAgentRound(run: AgentRun, round: AgentRound): AgentRun {
  if (run.rounds.some(existing => existing.roundId === round.roundId)) {
    throw new Error(`重复的 AgentRound: ${round.roundId}`)
  }

  const expectedIndex = run.rounds.length
  if (round.index !== expectedIndex) {
    throw new Error(`AgentRound index 非法: expected=${expectedIndex}, actual=${round.index}`)
  }

  run.rounds.push(round)
  return run
}

/**
 * 将一个新建的 Run 标记为真正开始执行，并记录执行起始时间。
 * 创建和启动分开，便于后续计算排队延迟（startedAt - createdAt）。
 */
export function startAgentRun(run: AgentRun, startedAt = Date.now()): AgentRun {
  if (run.status !== 'created') {
    throw new Error(`AgentRun 只能从 created 启动，当前状态: ${run.status}`)
  }

  run.status = 'running'
  run.startedAt = startedAt
  return run
}
