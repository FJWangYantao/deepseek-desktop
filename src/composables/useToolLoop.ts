import { ref, reactive } from 'vue'
import type { ToolCallUIState, ToolCallResult, UsageData } from '@/types'
import { deepSeekChat } from './useDeepSeek'
import { recordObservation } from './useObservationMemory'

const MAX_TOOL_ROUNDS = 100

interface ToolLoopOptions {
  messages: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string; tool_call_id?: string; tool_calls?: any[] }[]
  model: string
  thinking: 'enabled' | 'disabled'
  apiKey: string
  signal?: AbortSignal
  sessionId?: string
  conversationTurnId?: string
  onToken: (token: string) => void
  onThinking: (token: string) => void
  onUsage?: (usage: UsageData) => void
  onToolCallUpdate?: (calls: ToolCallUIState[]) => void
  onNeedsApproval?: (info: { callId: string; name: string; arguments: Record<string, unknown>; reason: string }) => Promise<boolean>
}

interface ToolLoopResult {
  content: string
  thinking: string
  usageList: UsageData[]
  totalUsage: UsageData | null
}

function addUsage(a: UsageData, b: UsageData): UsageData {
  return {
    prompt_tokens: (a.prompt_tokens || 0) + (b.prompt_tokens || 0),
    completion_tokens: (a.completion_tokens || 0) + (b.completion_tokens || 0),
    total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
    prompt_cache_hit_tokens: (a.prompt_cache_hit_tokens || 0) + (b.prompt_cache_hit_tokens || 0),
    prompt_cache_miss_tokens: (a.prompt_cache_miss_tokens || 0) + (b.prompt_cache_miss_tokens || 0),
  }
}

function previewMessages(messages: { role: string; content: string }[]): string {
  return messages.slice(-3).map(m => `${m.role}: ${(m.content || '').slice(0, 500)}`).join('\n')
}

export function useToolLoop() {
  const activeToolCalls = reactive<ToolCallUIState[]>([])
  const toolsSchema = ref<object[]>([])

  async function loadToolsSchema() {
    if (!window.electronAPI?.toolsList) return
    try {
      const resp = await window.electronAPI.toolsList()
      toolsSchema.value = resp.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    } catch (e) {
      console.warn('[ToolLoop] 获取工具列表失败:', e)
    }
  }

  async function executeToolViaIPC(call: { id: string; name: string; arguments: string }, ctx: { sessionId?: string; conversationTurnId?: string }): Promise<ToolCallResult> {
    if (!window.electronAPI?.toolsCall) {
      return {
        callId: call.id,
        name: call.name,
        success: false,
        data: '工具系统不可用（非 Electron 环境）',
        truncated: false,
        totalSize: 0,
        displayedSize: 0,
        offset: 0,
      }
    }
    return window.electronAPI.toolsCall({
      name: call.name,
      arguments: call.arguments,
      callId: call.id,
      sessionId: ctx.sessionId,
      conversationTurnId: ctx.conversationTurnId,
    })
  }

  async function executeApprovedViaIPC(call: { id: string; name: string; arguments: string }, ctx: { sessionId?: string; conversationTurnId?: string }): Promise<ToolCallResult> {
    if (!window.electronAPI?.toolsCallApproved) {
      return executeToolViaIPC(call, ctx)
    }
    return window.electronAPI.toolsCallApproved({
      name: call.name,
      arguments: call.arguments,
      callId: call.id,
      sessionId: ctx.sessionId,
      conversationTurnId: ctx.conversationTurnId,
    })
  }

  async function run(options: ToolLoopOptions): Promise<ToolLoopResult> {
    await loadToolsSchema()

    const hasTools = toolsSchema.value.length > 0
    const messages = [...options.messages]
    let fullContent = ''
    let fullThinking = ''

    let consecutiveSearchRounds = 0
    const usageList: UsageData[] = []
    let totalUsage: UsageData | null = null
    const ctx = { sessionId: options.sessionId, conversationTurnId: options.conversationTurnId }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      activeToolCalls.splice(0, activeToolCalls.length)

      // Observation: LLM 请求
      void recordObservation({
        type: 'llm.request',
        sessionId: ctx.sessionId,
        conversationTurnId: ctx.conversationTurnId,
        round,
        model: options.model,
        thinking: options.thinking,
        messageCount: messages.length,
        hasTools,
        inputPreview: previewMessages(messages as { role: string; content: string }[]),
      })

      const result = await deepSeekChat({
        messages: messages as any,
        model: options.model,
        thinking: options.thinking,
        apiKey: options.apiKey,
        signal: options.signal,
        tools: hasTools ? toolsSchema.value : undefined,
        onToken(token) {
          fullContent += token
          options.onToken(token)
        },
        onThinking(token) {
          fullThinking += token
          options.onThinking(token)
        },
        onUsage(usage) {
          usageList.push(usage)
          totalUsage = totalUsage ? addUsage(totalUsage, usage) : { ...usage }
          void recordObservation({
            type: 'llm.usage',
            sessionId: ctx.sessionId,
            conversationTurnId: ctx.conversationTurnId,
            round,
            model: options.model,
            usage,
          })
          options.onUsage?.(usage)
        },
      })

      if (result.finishReason !== 'tool_calls' || result.toolCalls.length === 0) {
        return { content: fullContent, thinking: fullThinking, usageList, totalUsage }
      }

      messages.push({
        role: 'assistant',
        content: fullContent || '',
        tool_calls: result.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })

      const uiStates: ToolCallUIState[] = result.toolCalls.map(tc => ({
        callId: tc.id,
        name: tc.name,
        arguments: JSON.parse(tc.arguments || '{}'),
        status: 'running' as const,
        timestamp: Date.now(),
      }))
      activeToolCalls.push(...uiStates)
      options.onToolCallUpdate?.(activeToolCalls)

      // Observation: tool.request
      for (const ui of uiStates) {
        void recordObservation({
          type: 'tool.request',
          sessionId: ctx.sessionId,
          conversationTurnId: ctx.conversationTurnId,
          toolCallId: ui.callId,
          toolName: ui.name,
          argumentsPreview: ui.arguments,
        })
      }

      // 串行执行工具调用，避免多个确认弹窗并发导致 UI 卡死
      const toolResults: ToolCallResult[] = []
      for (let i = 0; i < result.toolCalls.length; i++) {
        const tc = result.toolCalls[i]
        try {
          const res = await executeToolViaIPC(tc, ctx)

          if (res.needsApproval && options.onNeedsApproval) {
            uiStates[i].status = 'awaiting-approval'
            options.onToolCallUpdate?.(activeToolCalls)
            void recordObservation({
              type: 'tool.permission',
              sessionId: ctx.sessionId,
              conversationTurnId: ctx.conversationTurnId,
              toolCallId: tc.id,
              toolName: tc.name,
              decision: 'requested',
              reason: res.approvalReason || res.data,
            })

            const approved = await options.onNeedsApproval({
              callId: tc.id,
              name: tc.name,
              arguments: uiStates[i].arguments,
              reason: res.approvalReason || res.data,
            })

            void recordObservation({
              type: 'tool.permission',
              sessionId: ctx.sessionId,
              conversationTurnId: ctx.conversationTurnId,
              toolCallId: tc.id,
              toolName: tc.name,
              decision: approved ? 'approved' : 'denied',
            })

            if (!approved) {
              uiStates[i].status = 'error'
              uiStates[i].error = '用户拒绝'
              options.onToolCallUpdate?.(activeToolCalls)
              const denied = { ...res, data: '用户拒绝执行此操作' }
              toolResults.push(denied)
              void recordObservation({
                type: 'tool.result',
                sessionId: ctx.sessionId,
                conversationTurnId: ctx.conversationTurnId,
                toolCallId: tc.id,
                toolName: tc.name,
                success: false,
                dataPreview: denied.data,
                totalSize: denied.totalSize,
                displayedSize: denied.displayedSize,
                truncated: denied.truncated,
              })
              continue
            }

            uiStates[i].status = 'running'
            options.onToolCallUpdate?.(activeToolCalls)
            const approvedResult = await executeApprovedViaIPC(tc, ctx)
            uiStates[i].status = approvedResult.success ? 'completed' : 'error'
            uiStates[i].result = approvedResult
            if (!approvedResult.success) uiStates[i].error = approvedResult.data
            options.onToolCallUpdate?.(activeToolCalls)
            toolResults.push(approvedResult)
            void recordObservation({
              type: 'tool.result',
              sessionId: ctx.sessionId,
              conversationTurnId: ctx.conversationTurnId,
              toolCallId: tc.id,
              toolName: tc.name,
              success: approvedResult.success,
              dataPreview: approvedResult.data,
              totalSize: approvedResult.totalSize,
              displayedSize: approvedResult.displayedSize,
              truncated: approvedResult.truncated,
            })
            continue
          }

          uiStates[i].status = res.success ? 'completed' : 'error'
          uiStates[i].result = res
          if (!res.success) uiStates[i].error = res.data
          options.onToolCallUpdate?.(activeToolCalls)
          toolResults.push(res)
          void recordObservation({
            type: 'tool.result',
            sessionId: ctx.sessionId,
            conversationTurnId: ctx.conversationTurnId,
            toolCallId: tc.id,
            toolName: tc.name,
            success: res.success,
            dataPreview: res.data,
            totalSize: res.totalSize,
            displayedSize: res.displayedSize,
            truncated: res.truncated,
          })
        } catch (e) {
          uiStates[i].status = 'error'
          uiStates[i].error = e instanceof Error ? e.message : String(e)
          options.onToolCallUpdate?.(activeToolCalls)
          const errRes = {
            callId: tc.id,
            name: tc.name,
            success: false,
            data: `执行异常: ${e instanceof Error ? e.message : String(e)}`,
            truncated: false,
            totalSize: 0,
            displayedSize: 0,
            offset: 0,
          } as ToolCallResult
          toolResults.push(errRes)
          void recordObservation({
            type: 'tool.result',
            sessionId: ctx.sessionId,
            conversationTurnId: ctx.conversationTurnId,
            toolCallId: tc.id,
            toolName: tc.name,
            success: false,
            dataPreview: errRes.data,
            totalSize: 0,
            displayedSize: 0,
            truncated: false,
          })
        }
      }

      for (const tr of toolResults) {
        messages.push({
          role: 'tool',
          content: tr.data,
          tool_call_id: tr.callId,
        })
      }

      // 连续搜索提醒：鼓励用 queries 批量搜索提高效率，但不阻断
      const allSearch = result.toolCalls.every(tc => tc.name === 'web_search')
      if (allSearch) {
        consecutiveSearchRounds++
        if (consecutiveSearchRounds === 3) {
          messages.push({
            role: 'system' as const,
            content: '⚠️ 你已连续搜索 3 轮。提醒：可以用 queries 参数一次传入多个关键词方向并行搜索，比逐轮搜索快得多。',
          })
        }
      } else {
        consecutiveSearchRounds = 0
      }

      fullContent = ''
      fullThinking = ''
    }

    return { content: fullContent || '(工具调用轮次已达上限)', thinking: fullThinking, usageList, totalUsage }
  }

  return {
    activeToolCalls,
    toolsSchema,
    loadToolsSchema,
    run,
  }
}
