import { ref, reactive } from 'vue'
import type { ToolCallUIState, ToolCallResult, UsageData } from '@/types'
import { deepSeekChat } from './useDeepSeek'

const MAX_TOOL_ROUNDS = 100

interface ToolLoopOptions {
  messages: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string; tool_call_id?: string; tool_calls?: any[] }[]
  model: string
  thinking: 'enabled' | 'disabled'
  apiKey: string
  signal?: AbortSignal
  onToken: (token: string) => void
  onThinking: (token: string) => void
  onUsage?: (usage: UsageData) => void
  onToolCallUpdate?: (calls: ToolCallUIState[]) => void
  onNeedsApproval?: (info: { callId: string; name: string; arguments: Record<string, unknown>; reason: string }) => Promise<boolean>
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

  async function executeToolViaIPC(call: { id: string; name: string; arguments: string }): Promise<ToolCallResult> {
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
    })
  }

  async function executeApprovedViaIPC(call: { id: string; name: string; arguments: string }): Promise<ToolCallResult> {
    if (!window.electronAPI?.toolsCallApproved) {
      return executeToolViaIPC(call)
    }
    return window.electronAPI.toolsCallApproved({
      name: call.name,
      arguments: call.arguments,
      callId: call.id,
    })
  }

  async function run(options: ToolLoopOptions): Promise<{ content: string; thinking: string }> {
    await loadToolsSchema()

    const hasTools = toolsSchema.value.length > 0
    const messages = [...options.messages]
    let fullContent = ''
    let fullThinking = ''

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      activeToolCalls.splice(0, activeToolCalls.length)

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
        onUsage: options.onUsage,
      })

      if (result.finishReason !== 'tool_calls' || result.toolCalls.length === 0) {
        return { content: fullContent, thinking: fullThinking }
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

      const toolResults = await Promise.all(
        result.toolCalls.map(async (tc, i) => {
          try {
            const res = await executeToolViaIPC(tc)

            // 需要用户审批
            if (res.needsApproval && options.onNeedsApproval) {
              uiStates[i].status = 'awaiting-approval'
              options.onToolCallUpdate?.(activeToolCalls)

              const approved = await options.onNeedsApproval({
                callId: tc.id,
                name: tc.name,
                arguments: uiStates[i].arguments,
                reason: res.approvalReason || res.data,
              })

              if (!approved) {
                uiStates[i].status = 'error'
                uiStates[i].error = '用户拒绝'
                options.onToolCallUpdate?.(activeToolCalls)
                return { ...res, data: '用户拒绝执行此操作' }
              }

              // 用户批准，重新执行
              uiStates[i].status = 'running'
              options.onToolCallUpdate?.(activeToolCalls)
              const approvedResult = await executeApprovedViaIPC(tc)
              uiStates[i].status = approvedResult.success ? 'completed' : 'error'
              uiStates[i].result = approvedResult
              if (!approvedResult.success) uiStates[i].error = approvedResult.data
              options.onToolCallUpdate?.(activeToolCalls)
              return approvedResult
            }

            uiStates[i].status = res.success ? 'completed' : 'error'
            uiStates[i].result = res
            if (!res.success) uiStates[i].error = res.data
            options.onToolCallUpdate?.(activeToolCalls)
            return res
          } catch (e) {
            uiStates[i].status = 'error'
            uiStates[i].error = e instanceof Error ? e.message : String(e)
            options.onToolCallUpdate?.(activeToolCalls)
            return {
              callId: tc.id,
              name: tc.name,
              success: false,
              data: `执行异常: ${e instanceof Error ? e.message : String(e)}`,
              truncated: false,
              totalSize: 0,
              displayedSize: 0,
              offset: 0,
            } as ToolCallResult
          }
        })
      )

      for (const tr of toolResults) {
        messages.push({
          role: 'tool',
          content: tr.data,
          tool_call_id: tr.callId,
        })
      }

      fullContent = ''
      fullThinking = ''
    }

    return { content: fullContent || '(工具调用轮次已达上限)', thinking: fullThinking }
  }

  return {
    activeToolCalls,
    toolsSchema,
    loadToolsSchema,
    run,
  }
}
