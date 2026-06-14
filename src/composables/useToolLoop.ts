import { ref, reactive } from 'vue'
import type { ToolCallUIState, ToolCallResult, UsageData, ContentBlock } from '@/types'
import { deepSeekChat } from './useDeepSeek'
import { recordObservation } from './useObservationMemory'
import { filterToolSchema, type ModeCapabilities } from '@/data/workModes'

/**
 * 安全解析工具调用的 arguments JSON。
 * LLM 偶尔会返回格式错误的 JSON（引号未转义、缺逗号、中文字符问题等），
 * 直接 JSON.parse 会让整个请求失败。这里降级：解析失败时把原始字符串
 * 放进 _raw 字段，让工具执行层至少能看到内容（往往也会执行失败，但
 * 不会让整轮对话直接挂掉，用户能从错误信息看出是 LLM 输出问题）。
 */
function safeParseArguments(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { _raw: raw, _parseError: 'arguments 不是合法 JSON' }
  }
}

/** 兜底策略：与改造前行为一致（全工具 + 100 轮 + 不累积），保证未传 modePolicy 时不回归 */
const DEFAULT_MODE_POLICY: ModeCapabilities = {
  maxRounds: 100,
  allowedTools: 'all',
  accumulate: false,
}

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
  /**
   * 每当归档一个内容块（正文段 / 工具调用段）时回调，用于渲染层内联显示。
   * text 块归档后，本轮 token 计数会重置（store 侧据此清空 streaming）。
   */
  onBlock?: (block: ContentBlock) => void
  onNeedsApproval?: (info: { callId: string; name: string; arguments: Record<string, unknown>; reason: string }) => Promise<boolean>
  loadedSkillId?: string | null
  onSkillLoaded?: (skillId: string) => void
  /** 工作模式能力策略。未传时使用 DEFAULT_MODE_POLICY（等同改造前行为） */
  modePolicy?: ModeCapabilities
}

interface ToolLoopResult {
  content: string
  thinking: string
  usageList: UsageData[]
  totalUsage: UsageData | null
  /** 有序内容块（正文段 / 工具调用段交错），用于内联渲染 */
  blocks: ContentBlock[]
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

  async function loadToolsSchema(allowedTools: string[] | 'all') {
    if (!window.electronAPI?.toolsList) return
    try {
      const resp = await window.electronAPI.toolsList()
      const all = resp.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
      toolsSchema.value = filterToolSchema(all, allowedTools)
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
    const policy = options.modePolicy ?? DEFAULT_MODE_POLICY
    await loadToolsSchema(policy.allowedTools)

    const hasTools = toolsSchema.value.length > 0
    const messages = [...options.messages]
    let fullContent = ''      // 本轮累积，flush 后清空（供下一轮从空开始）
    let accumulatedContent = '' // 跨轮累积所有正文段，作为最终 loopResult.content（用于导出/复制/统计）
    let accumulatedThinking = '' // 跨轮累积所有思考段，作为最终 loopResult.thinking（兼容旧字段）
    let fullThinking = ''

    // 内容块序列：记录「正文段 ↔ 思考段 ↔ 工具调用段」的真实交错顺序，用于内联渲染
    const blocks: ContentBlock[] = []
    /** 把当前累积的 fullContent 归档为 text block，并清空本轮累积器 */
    const flushTextBlock = () => {
      if (fullContent) {
        const text = fullContent
        blocks.push({ type: 'text', text })
        accumulatedContent += text
        fullContent = ''
        options.onBlock?.({ type: 'text', text })
      }
    }
    /** 把当前累积的 fullThinking 归档为 thinking block，并清空本轮累积器 */
    const flushThinkingBlock = () => {
      if (fullThinking) {
        const text = fullThinking
        blocks.push({ type: 'thinking', text })
        accumulatedThinking += (accumulatedThinking ? '\n' : '') + text
        fullThinking = ''
        options.onBlock?.({ type: 'thinking', text })
      }
    }
    /** 工具调用前归档本轮产生的思考和正文（按产生顺序：思考先于正文） */
    const flushRoundBlocks = () => {
      flushThinkingBlock()
      flushTextBlock()
    }

    let consecutiveSearchRounds = 0
    const usageList: UsageData[] = []
    let totalUsage: UsageData | null = null
    const ctx = { sessionId: options.sessionId, conversationTurnId: options.conversationTurnId }
    let loadedSkillId = options.loadedSkillId || null

    // 软兜底：maxRounds 是“建议轮次”，达到后注入提醒引导作答；
    // absoluteLimit 是绝对上限，多预留 2 轮让模型基于已有信息收尾，避免硬截断成空答。
    const absoluteLimit = policy.maxRounds + 2
    let budgetWarned = false
    // 兜底标志：检测到「只有思考没有正文」时只救一次，避免死循环
    let emptyAnswerReminded = false

    for (let round = 0; round < absoluteLimit; round++) {
      // 达到模式轮次预算时提醒模型尽快作答（仅注入一次）
      if (round >= policy.maxRounds && !budgetWarned) {
        messages.push({
          role: 'system',
          content: '工具预算已用尽。现在必须用文字回答用户：已查到的信息就总结呈现；没查到就明确回复「未找到相关内容」并简要说明原因（如搜索结果被干扰）。禁止再调用任何工具。',
        })
        budgetWarned = true
      }

      // accumulate=true（ReAct/Plan）：不清空，本轮工具调用行追加到已有轨迹上
      // accumulate=false（Chat）：每轮覆盖，只显示当前轮
      if (!policy.accumulate) {
        activeToolCalls.splice(0, activeToolCalls.length)
      }

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
        // 兜底：本轮只输出了思考、正文为空（DeepSeek 偶发的「只想不答」）。
        // 注入提醒让 LLM 基于思考给出正文回答，只救一次（emptyAnswerReminded），
        // 避免模型反复空答导致死循环。注意：此时不 flush thinking，让下一轮
        // 从干净状态开始，避免用户看到重复的思考块。
        if (!fullContent && fullThinking && !emptyAnswerReminded) {
          emptyAnswerReminded = true
          messages.push({
            role: 'user',
            content: '你刚才只输出了思考过程，没有给出可见的回答。请基于你刚才的思考，用简体中文给出最终回答。不要重复思考过程，直接回答即可。',
          })
          // 清空本轮 thinking 累积器（不归档），下一轮重新开始
          fullThinking = ''
          continue
        }
        // 最终回答：先归档本轮思考，再归档最终回答
        flushRoundBlocks()
        // 二次兜底：救一次后仍空答，给个友好占位，避免 UI 上只有孤零零的思考块。
        // 把占位文字塞进 fullContent 再 flush，走正常的 text block 归档路径，
        // 流式 UI 和归档消息都能看到。
        if (!accumulatedContent && accumulatedThinking) {
          fullContent = '（模型本轮未给出可见回答，请参考上方思考过程，或重新提问 / 重试）'
          flushTextBlock()
        }
        return { content: accumulatedContent, thinking: accumulatedThinking, usageList, totalUsage, blocks }
      }

      // 本轮 LLM 产出的思考/正文：先归档（与接下来的工具调用形成交错）。
      // 记录本轮原始正文用于回传 API（flush 会清空累积器）；
      // reasoning_content 不回传给 DeepSeek API，故 thinking 不需要保留。
      const roundContent = fullContent
      flushRoundBlocks()

      messages.push({
        role: 'assistant',
        content: roundContent || '',
        tool_calls: result.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })

      // 用 reactive() 创建每个 uiState，使其属性变更可被响应式系统追踪。
      // 这样 streamingBlocks 里的 tool 块 calls（引用同一组对象）能实时响应
      // status / result / error 的变化，工具完成时图标立刻更新。
      const uiStates: ToolCallUIState[] = result.toolCalls.map(tc => reactive({
        callId: tc.id,
        name: tc.name,
        arguments: safeParseArguments(tc.arguments),
        status: 'running' as const,
        timestamp: Date.now(),
      }))
      activeToolCalls.push(...uiStates)
      options.onToolCallUpdate?.(activeToolCalls)

      // 工具调用块：calls 引用 activeToolCalls 中同一对象，状态变化自动响应
      const toolBlockCalls = [...uiStates]
      blocks.push({ type: 'tool', calls: toolBlockCalls })
      options.onBlock?.({ type: 'tool', calls: toolBlockCalls })

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
          let res: ToolCallResult
          if (tc.name === 'skill_load') {
            let requestedSkillId = ''
            try { requestedSkillId = String(JSON.parse(tc.arguments || '{}').skill_id || '') } catch { /* ignore */ }
            if (loadedSkillId && requestedSkillId && loadedSkillId !== requestedSkillId) {
              res = {
                callId: tc.id,
                name: tc.name,
                success: false,
                data: `本轮已加载 Skill: ${loadedSkillId}。每轮最多加载一个 Skill，请继续使用当前 Skill，或在下一轮再切换。`,
                truncated: false,
                totalSize: 0,
                displayedSize: 0,
                offset: 0,
              }
            } else {
              res = await executeToolViaIPC(tc, ctx)
              if (res.success && requestedSkillId) {
                loadedSkillId = requestedSkillId
                options.onSkillLoaded?.(requestedSkillId)
              }
            }
          } else {
            res = await executeToolViaIPC(tc, ctx)
          }

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

    // 跑满绝对上限仍想调工具：返回已有内容（兜底，避免空答）
    flushRoundBlocks()
    return {
      content: accumulatedContent || '未能查到相关内容（搜索结果可能不相关或被干扰）。',
      thinking: accumulatedThinking,
      usageList,
      totalUsage,
      blocks,
    }
  }

  return {
    activeToolCalls,
    toolsSchema,
    loadToolsSchema,
    run,
  }
}
