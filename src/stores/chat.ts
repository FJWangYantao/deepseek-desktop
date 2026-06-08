import { defineStore } from 'pinia'
import { ref, reactive, watch, computed, nextTick } from 'vue'
import type { Message, UsageData, ToolCallUIState } from '@/types'
import { useSessionStore } from './session'
import { useSettingsStore } from './settings'
import { useStatsStore } from './stats'
import { useMemory } from '@/composables/useMemory'
import { useSkillStore } from './skills'
import { useToolLoop } from '@/composables/useToolLoop'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<Message[]>([])
  const streaming = ref('')
  const streamingThinking = ref('')
  const thinkingEnabled = ref(true)
  const isGenerating = ref(false)
  const generatingSessionId = ref<string | null>(null)
  const thinkingManuallyExpanded = ref(false)
  const bgStreams = reactive<Record<string, { content: string; thinking: string }>>({})
  const generatingSessions = ref<Record<string, boolean>>({})
  const unreadSessions = ref<Record<string, boolean>>({})
  const activeToolCalls = ref<ToolCallUIState[]>([])
  const lastUsageData = ref<UsageData | null>(null)

  // 工具权限审批状态
  interface ApprovalInfo { callId: string; name: string; arguments: Record<string, unknown>; reason: string }
  const pendingApproval = ref<ApprovalInfo | null>(null)
  let approvalResolver: ((approved: boolean) => void) | null = null

  function resolveApproval(approved: boolean) {
    if (approvalResolver) {
      approvalResolver(approved)
      approvalResolver = null
    }
    pendingApproval.value = null
  }

  const sessionStore = useSessionStore()
  const settingsStore = useSettingsStore()
  const memory = useMemory()

  // 切换到当前会话时加载消息
  function loadFromSession() {
    const newSid = sessionStore.currentId

    // 离开正在生成的会话时，保存当前流式内容到后台
    if (isGenerating.value && generatingSessionId.value && generatingSessionId.value !== newSid) {
      bgStreams[generatingSessionId.value] = {
        content: streaming.value,
        thinking: streamingThinking.value,
      }
    }

    const session = sessionStore.getCurrentSession()
    messages.value = session?.messages ?? []

    // 切换到正在后台生成的会话时，恢复流式内容
    if (generatingSessionId.value === newSid) {
      const bg = bgStreams[newSid]
      streaming.value = bg?.content ?? ''
      streamingThinking.value = bg?.thinking ?? ''
      isGenerating.value = true
    } else {
      streaming.value = ''
      streamingThinking.value = ''
      isGenerating.value = false
      activeToolCalls.value = []
    }

    // 清除未读标记
    if (unreadSessions.value[newSid]) {
      unreadSessions.value = { ...unreadSessions.value }
      delete unreadSessions.value[newSid]
    }

    memory.promoteShortTerm()
    memory.checkAutoDream(settingsStore.apiKey)
  }

  // 监听会话切换
  watch(() => sessionStore.currentId, () => {
    loadFromSession()
  }, { immediate: true })

  // 消息变化时同步到 session
  watch(messages, (val) => {
    const sid = sessionStore.currentId
    if (!sid) return
    const session = sessionStore.sessions.find(s => s.id === sid)
    if (session) {
      session.messages = val
      session.updatedAt = Date.now()
    }
  }, { deep: true })

  const abortControllers = reactive<Record<string, AbortController>>({})

  function toggleThinking() {
    thinkingEnabled.value = !thinkingEnabled.value
  }

  function buildFileContext(files: {name: string, text: string}[]): string {
    const lines = ['[系统提示] 用户上传了以下文件，请基于这些内容回答用户问题：', '']
    for (const f of files) {
      lines.push(`=== ${f.name} ===`)
      lines.push(f.text)
      lines.push('')
    }
    return lines.join('\n')
  }

  function stopGenerating() {
    const sid = sessionStore.currentId
    abortControllers[sid]?.abort()
    delete abortControllers[sid]
  }

  const currentModel = computed(() => settingsStore.defaultModel)

  async function generateTitle(sid: string, text: string) {
    if (!settingsStore.apiKey) return
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settingsStore.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: '你是一个标题生成助手。根据用户消息生成一个简短的对话标题（5-10个汉字），只输出标题，不要多余内容。' },
            { role: 'user', content: `为以下对话生成标题：${text}` },
          ],
          thinking: { type: 'disabled' },
        }),
      })
      if (!res.ok) {
      console.warn('[Title] API 错误:', res.status)
      return
    }
    const data = await res.json()
    const title = data.choices?.[0]?.message?.content?.trim()
    if (title) {
      sessionStore.updateSessionTitle(sid, title.slice(0, 20))
      console.warn('[Title] 标题已生成:', title)
    } else {
      console.warn('[Title] 未收到标题内容')
    }
    } catch (e) {
      console.warn('[Title] 异常:', e)
    }
  }

  async function sendMessage(text: string, files?: {name: string, text: string, size: number}[]) {
    const sid = sessionStore.ensureSession()
    generatingSessionId.value = sid
    generatingSessions.value = { ...generatingSessions.value, [sid]: true }
    if (!settingsStore.apiKey) {
      alert('请先在设置页面配置 API Key')
      generatingSessionId.value = null
      return
    }

    // 新对话自动生成标题（fire-and-forget）
    const session = sessionStore.sessions.find(s => s.id === sid)
    if (session && session.title === '新对话') {
      generateTitle(sid, text)
    }

    // 添加用户消息（直接写入 session 再同步，避免 loadFromSession 竞争覆盖）
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text,
      attachments: files?.map(f => ({ name: f.name, size: f.size })),
      timestamp: Date.now(),
    }
    const sess = sessionStore.sessions.find(s => s.id === sid)
    if (sess) sess.messages.push(userMsg)
    if (sessionStore.currentId === sid) {
      messages.value = sess?.messages ?? messages.value
    }

    // 流式生成
    isGenerating.value = true
    streaming.value = ''
    streamingThinking.value = ''
    thinkingManuallyExpanded.value = false

    // 提前准备对话历史（搜索判断需要上下文）
    const historyMsgs = messages.value
      .filter(m => m.id !== userMsg.id)
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }))

    // ===== 文件内容注入 =====
    let userContent = text
    if (files && files.length > 0) {
      userContent = buildFileContext(files) + '\n\n用户问题：' + text
    }

    const today = new Date()
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()]

    // ===== 构建 system prompt =====
    // 0. 固定前缀（前缀缓存友好，不可变部分放最前面）
    let systemPrompt = '你是一个诚实、严谨的AI助手。遵守以下行为准则：\n' +
      '1. 当用户质疑你的回答时，先独立核实事实再决定是否修正，不要仅因用户表示惊讶或质疑就自动认错。\n' +
      '2. 如果你确信自己的回答是正确的，应该礼貌地坚持并解释理由，而不是盲目迎合用户。\n' +
      '3. 对不确定的内容，明确标注不确定性，而不是编造事实。\n' +
      '4. 你可以使用 web_search 工具搜索互联网获取实时信息，使用 web_fetch 工具抓取网页内容。当用户的问题可能需要最新信息时，主动调用搜索工具。\n\n'

    // 1. 用户自定义 system prompt（含角色模板）
    if (settingsStore.systemPrompt) {
      systemPrompt += settingsStore.systemPrompt + '\n\n'
    }

    // 1.5 Skill prompt / DSL runner
    const skillStore = useSkillStore()
    if (skillStore.activeSkill) {
      const { parseDSL } = await import('@/utils/dsl-parser')
      const dslResult = parseDSL(skillStore.activeSkill.content)
      if (dslResult.isDSL && dslResult.steps && dslResult.steps.length > 0) {
        // === DSL 执行路径 ===
        const { useDSLRunner } = await import('@/composables/useDSLRunner')
        const runner = useDSLRunner()
        const dslOutputs: { stage: string; content: string }[] = []

        const abortCtrl = new AbortController()
        abortControllers[sid] = abortCtrl

        try {
          // 先发一条"执行中"占位消息
          const placeholderMsg: Message = {
            id: generateId(), role: 'assistant',
            content: '🤖 DSL 技能执行中...',
            timestamp: Date.now(),
          }
          const targetSession = sessionStore.sessions.find(s => s.id === sid)
          if (targetSession) targetSession.messages.push(placeholderMsg)
          if (sessionStore.currentId === sid) {
            messages.value = targetSession?.messages ?? messages.value
          }

          await runner.startExecution({
            steps: dslResult.steps,
            context: { userInput: text, files, date: `${dateStr} 星期${weekDay}` },
            apiKey: settingsStore.apiKey,
            model: currentModel.value,
            thinking: thinkingEnabled.value ? 'enabled' : 'disabled',
            signal: abortCtrl.signal,
            onStepOutput: (o) => {
              dslOutputs.push({ stage: o.stage, content: o.content })
              // 实时更新占位消息为当前步骤进度
              const stepsDone = dslOutputs.map(s => `**${s.stage}** ✅`).join('  ')
              if (sessionStore.currentId === sid) {
                streaming.value = `${stepsDone}\n\n---\n\n正在执行下一步：**${o.stage}**\n\n${o.content.slice(0, 500)}`
              }
            },
          })

          const combinedContent = dslOutputs.map(o => `## ${o.stage}\n${o.content}`).join('\n\n---\n\n')
          // 替换占位消息
          const ts = sessionStore.sessions.find(s => s.id === sid)
          if (ts) {
            const idx = ts.messages.findIndex(m => m.id === placeholderMsg.id)
            if (idx >= 0) {
              ts.messages[idx] = { ...ts.messages[idx], content: combinedContent || '(DSL 执行完成)' }
            }
          }
          if (sessionStore.currentId === sid) {
            messages.value = ts?.messages ?? messages.value
          } else if (ts) {
            unreadSessions.value = { ...unreadSessions.value, [sid]: true }
          }
        } catch (dslError: any) {
          const errMsg: Message = {
            id: generateId(), role: 'assistant',
            content: `DSL 执行失败: ${dslError?.message || '未知错误'}`,
            timestamp: Date.now(),
          }
          messages.value.push(errMsg)
        } finally {
          delete abortControllers[sid]
          const doneSid = sid
          if (doneSid) {
            generatingSessions.value = { ...generatingSessions.value }
            delete generatingSessions.value[doneSid]
            delete bgStreams[doneSid]
          }
          streaming.value = ''
          streamingThinking.value = ''
          isGenerating.value = false
          generatingSessionId.value = null
        }
        return  // EARLY RETURN - skip normal flow
      }
      // 无 DSL → 传统 system prompt 注入
      systemPrompt += `[Skill: ${skillStore.activeSkill.name}]\n${skillStore.activeSkill.content}\n\n`
    }

    // 2. 记忆上下文
    const memoryContext = memory.buildMemoryContext(text)
    if (memoryContext) {
      systemPrompt += memoryContext + '\n\n'
    }

    // 3. 日期信息
    systemPrompt += `当前日期：${dateStr} 星期${weekDay}。`

    const apiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...historyMsgs.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: userContent },
    ]

    let fullContent = ''
    let fullThinking = ''
    let usageFromApi: UsageData | null = null

    const abortCtrl = new AbortController()
    abortControllers[sid] = abortCtrl

    // 准备流式输出
    activeToolCalls.value = []

    try {
      const toolLoop = useToolLoop()
      const loopResult = await toolLoop.run({
        messages: apiMessages,
        model: currentModel.value,
        thinking: thinkingEnabled.value ? 'enabled' : 'disabled',
        apiKey: settingsStore.apiKey,
        signal: abortCtrl.signal,
        onToken(token) {
          fullContent += token
          if (sessionStore.currentId === sid) {
            streaming.value = fullContent
          } else {
            if (!bgStreams[sid]) bgStreams[sid] = { content: '', thinking: '' }
            bgStreams[sid].content = fullContent
          }
        },
        onThinking(token) {
          fullThinking += token
          if (sessionStore.currentId === sid) {
            streamingThinking.value = fullThinking
          } else {
            if (!bgStreams[sid]) bgStreams[sid] = { content: '', thinking: '' }
            bgStreams[sid].thinking = fullThinking
          }
        },
        onUsage(usage) {
          usageFromApi = usage
          lastUsageData.value = usage
        },
        onToolCallUpdate(calls) {
          activeToolCalls.value = [...calls]
        },
        onNeedsApproval(info) {
          return new Promise<boolean>((resolve) => {
            approvalResolver = resolve
            pendingApproval.value = info
          })
        },
      })

      fullContent = loopResult.content
      fullThinking = loopResult.thinking

      // 完成，归档消息到目标会话
      const aiMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: fullContent,
        thinking: fullThinking || undefined,
        thinkingExpanded: thinkingManuallyExpanded.value || undefined,
        timestamp: Date.now(),
      }
      const targetSession = sessionStore.sessions.find(s => s.id === sid)
      if (targetSession) {
        targetSession.messages.push(aiMsg)
      }
      // 如果是当前会话，同步显示；否则标记为未读
      if (sessionStore.currentId === sid) {
        messages.value = targetSession?.messages ?? messages.value
      } else {
        unreadSessions.value = { ...unreadSessions.value, [sid]: true }
      }

      // 记忆提取（fire-and-forget）
      memory.extractFromExchange(text, fullContent, settingsStore.apiKey)

      // 记录统计（仅使用 API 返回的真实数据）
      if (usageFromApi) {
        const statsStore = useStatsStore()
        statsStore.addRecord({
          id: generateId(),
          model: currentModel.value,
          sessionId: sid,
          sessionTitle: session?.title ?? '',
          usage: usageFromApi,
          timestamp: Date.now(),
          cost: 0,
          source: 'api',
        })
      } else {
        console.warn('[Stats] 未收到 API usage 数据，跳过记录')
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        if (fullContent || fullThinking) {
          const partialMsg: Message = {
            id: generateId(),
            role: 'assistant',
            content: fullContent || '(已中断)',
            thinking: fullThinking || undefined,
            timestamp: Date.now(),
          }
          if (sid === sessionStore.currentId) {
            messages.value.push(partialMsg)
          } else {
            const origSession = sessionStore.sessions.find(s => s.id === sid)
            if (origSession) origSession.messages.push(partialMsg)
          }
        }
      } else {
        const errMsg: Message = {
          id: generateId(),
          role: 'assistant',
          content: `请求失败: ${e instanceof Error ? e.message : '未知错误'}`,
          timestamp: Date.now(),
        }
        messages.value.push(errMsg)
      }
    } finally {
      delete abortControllers[sid]
      const doneSid = sid
      if (doneSid) {
        generatingSessions.value = { ...generatingSessions.value }
        delete generatingSessions.value[doneSid]
        delete bgStreams[doneSid]
      }
      streaming.value = ''
      streamingThinking.value = ''
      isGenerating.value = false
      generatingSessionId.value = null
    }
  }

  function clearMessages() {
    messages.value = []
  }

  async function retryMessage(messageId: string) {
    const idx = messages.value.findIndex(m => m.id === messageId)
    if (idx === -1) return
    const userMsg = messages.value[idx]
    if (userMsg.role !== 'user') return
    // 删除这条用户消息及之后的所有回复
    messages.value = messages.value.slice(0, idx)
    await nextTick()
    sendMessage(userMsg.content)
  }

  return {
    messages, streaming, streamingThinking, thinkingEnabled, isGenerating, thinkingManuallyExpanded, generatingSessions, unreadSessions, activeToolCalls, pendingApproval, currentModel, lastUsageData,
    sendMessage, clearMessages, loadFromSession, toggleThinking, retryMessage, stopGenerating, resolveApproval,
  }
})
