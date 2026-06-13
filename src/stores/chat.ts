import { defineStore } from 'pinia'
import { ref, reactive, watch, computed, nextTick } from 'vue'
import type { Message, QuoteItem, UsageData, ToolCallUIState } from '@/types'
import { useSessionStore } from './session'
import { useSettingsStore } from './settings'
import { useStatsStore } from './stats'
import { useMemory } from '@/composables/useMemory'
import { useSkillStore } from './skills'
import { buildSkillContext } from '@/composables/useSkillContext'
import { useToolLoop } from '@/composables/useToolLoop'
import { workModes } from '@/data/workModes'
import {
  recordMessageCompleted,
  extractLightFromMessageCompleted,
  recordSessionSwitch,
  extractBatchOnSessionSwitch,
} from '@/composables/useObservationMemory'
import {
  useInstinct,
  extractInstinctsOnSessionSwitch,
} from '@/composables/useInstinct'

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
  const bgToolCalls = reactive<Record<string, ToolCallUIState[]>>({})
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

    // 离开正在生成的会话时，保存当前流式内容和工具状态到后台
    if (isGenerating.value && generatingSessionId.value && generatingSessionId.value !== newSid) {
      bgStreams[generatingSessionId.value] = {
        content: streaming.value,
        thinking: streamingThinking.value,
      }
      if (activeToolCalls.value.length > 0) {
        bgToolCalls[generatingSessionId.value] = [...activeToolCalls.value]
      }
    }

    const session = sessionStore.getCurrentSession()
    messages.value = session?.messages ?? []

    // 切换到正在后台生成的会话时，恢复流式内容和工具状态
    if (generatingSessionId.value === newSid) {
      const bg = bgStreams[newSid]
      streaming.value = bg?.content ?? ''
      streamingThinking.value = bg?.thinking ?? ''
      activeToolCalls.value = bgToolCalls[newSid] ? [...bgToolCalls[newSid]] : []
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
  watch(() => sessionStore.currentId, (newId, oldId) => {
    if (oldId && oldId !== newId) {
      void recordSessionSwitch(oldId, newId)
      void extractBatchOnSessionSwitch(oldId, newId, settingsStore.apiKey)
      // Instinct Engine：fire-and-forget；Path A 永远跑，Path B 受设置开关控制
      void extractInstinctsOnSessionSwitch({
        fromSessionId: oldId,
        apiKey: settingsStore.instinctSemanticEnabled ? settingsStore.apiKey : undefined,
        enabled: settingsStore.instinctEnabled,
      })
    }
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

  async function sendMessage(
    text: string,
    files?: {name: string, text: string, size: number}[],
    quotes?: QuoteItem[],
    imageFiles?: { path: string; name: string; ext: string; size: number }[],
  ) {
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
    const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'])
    const allAttachments: { name: string; size: number; ext?: string; text?: string }[] = [
      ...(files ?? []).map(f => ({ name: f.name, size: f.size, text: f.text })),
      ...(imageFiles ?? []).map(img => ({ name: img.name, size: img.size, ext: img.ext })),
    ]
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text,
      attachments: allAttachments.map(f => {
        const ext = f.ext ?? '.' + (f.name.split('.').pop() ?? '').toLowerCase()
        return { name: f.name, size: f.size, type: IMAGE_EXTS.has(ext) ? 'image' as const : 'file' as const, text: f.text }
      }),
      quotes: quotes && quotes.length > 0 ? [...quotes] : undefined,
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

    // ===== 图片描述（在聊天区显示进度） =====
    const imageDescriptions: { name: string; text: string; size: number }[] = []
    if (imageFiles && imageFiles.length > 0) {
      if (!settingsStore.mimoApiKey) {
        for (const img of imageFiles) {
          imageDescriptions.push({ name: img.name, text: '[未配置视觉模型 API Key，无法描述图片内容]', size: img.size })
        }
      } else {
        // 并发描述所有图片，实时更新进度
        const total = imageFiles.length
        let done = 0
        const updateProgress = () => {
          if (sessionStore.currentId === sid) {
            streaming.value = `正在识别图片（${done}/${total}）...`
          }
        }
        updateProgress()

        const tasks = imageFiles.map(async (img) => {
          try {
            const result = await window.electronAPI!.describeImage({
              path: img.path,
              apiKey: settingsStore.mimoApiKey,
              baseUrl: settingsStore.mimoBaseUrl,
              model: settingsStore.mimoModel,
            })
            done++
            updateProgress()
            if (result.error) {
              return { name: img.name, text: `[图片描述失败: ${result.error}]`, size: img.size }
            }
            return { name: img.name, text: result.description, size: img.size }
          } catch (e) {
            done++
            updateProgress()
            return { name: img.name, text: `[图片描述失败: ${e instanceof Error ? e.message : '未知错误'}]`, size: img.size }
          }
        })
        const results = await Promise.all(tasks)
        imageDescriptions.push(...results)

        // 更新 userMsg 的 attachments 中的 text（图片描述结果）
        for (const desc of imageDescriptions) {
          const att = sess?.messages.find(m => m.id === userMsg.id)?.attachments?.find(a => a.name === desc.name)
          if (att) att.text = desc.text
        }
        if (sessionStore.currentId === sid) {
          messages.value = sess?.messages ?? messages.value
        }
      }
    }

    // 合并所有文件内容
    const allFiles = [
      ...(files ?? []),
      ...imageDescriptions,
    ]

    // 提前准备对话历史（搜索判断需要上下文）
    const historyMsgs = messages.value
      .filter(m => m.id !== userMsg.id)
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }))

    // ===== 文件内容注入 =====
    let userContent = text
    if (allFiles.length > 0) {
      userContent = buildFileContext(allFiles) + '\n\n用户问题：' + text
    }
    if (quotes && quotes.length > 0) {
      const count = quotes.length
      const header = count === 1
        ? '[用户引用了对话中的以下内容]\n'
        : `[用户引用了对话中的以下 ${count} 段内容]\n`
      const quoteBlocks = quotes.map((q, i) => {
        const label = count === 1 ? '' : `引用 ${i + 1}：\n`
        return label + `> ${q.text.replace(/\n/g, '\n> ')}`
      }).join('\n\n')
      const quoteSection = header + quoteBlocks + '\n\n'
      if (allFiles.length > 0) {
        userContent = buildFileContext(allFiles) + '\n\n' + quoteSection + '用户问题：' + text
      } else {
        userContent = quoteSection + '用户问题：' + text
      }
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
      '4. 你可以使用 web_search 工具搜索互联网获取实时信息，使用 web_fetch 工具抓取网页内容。当用户的问题可能需要最新信息时，主动调用搜索工具。\n' +
      '5. web_search 的 queries 参数接受关键词数组，一次搜索就能覆盖多个方向（自动并行）。搜索前先想好需要哪些角度，一次性传入中英文、不同表述等变体。\n' +
      '6. 搜索结果的摘要通常就够回答，不需要 web_fetch 抓全文（知乎等有登录墙的网站无法抓取）。\n' +
      '7. 你可以使用 list_dir 工具列出目录内容，使用 file_read 读取文件，使用 file_write 写入文件。当用户提到本地文件或目录时，主动使用这些工具。\n\n'

    // 0.5 工作模式指令
    if (settingsStore.workMode !== 'chat') {
      const modeBlock = workModes.find(m => m.value === settingsStore.workMode)?.promptBlock
      if (modeBlock) {
        systemPrompt += '\n' + modeBlock + '\n\n'
      }
    }

    // 1. 用户自定义 system prompt（含角色模板）
    if (settingsStore.systemPrompt) {
      systemPrompt += settingsStore.systemPrompt + '\n\n'
    }

    // 1.5 Skill Index / loaded Skill（Claude Skills 风格渐进加载）
    const skillStore = useSkillStore()
    if (skillStore.skillIndex.length === 0) await skillStore.loadSkillIndex()
    const skillContext = await buildSkillContext({
      skillIndex: skillStore.skillIndex,
      setLoadedSkill: skillStore.setLoadedSkill,
    })
    if (skillContext.systemBlock) {
      systemPrompt += skillContext.systemBlock + '\n\n'
    }

    // 2. 记忆上下文（用最近用户消息补充检索信号，改善短消息召回率）
    const recentUserTexts = historyMsgs
      .filter(m => m.role === 'user')
      .slice(-4)
      .map(m => typeof m.content === 'string' ? m.content : '')
      .filter(Boolean)
      .join(' ')
    const memoryContext = memory.buildMemoryContext(text, recentUserTexts || undefined)
    if (memoryContext) {
      systemPrompt += memoryContext + '\n\n'
    }

    // 2.5 行为习惯（Instinct Engine）— 注入历史学到的高置信 trigger→action 规则
    if (settingsStore.instinctEnabled) {
      const instinctContext = useInstinct().buildInstinctContext()
      if (instinctContext) {
        systemPrompt += instinctContext + '\n\n'
      }
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
      const conversationTurnId = generateId()
      // 按当前工作模式取能力策略（工具白名单 / 轮次上限 / 是否累积）
      const modePolicy = workModes.find(m => m.value === settingsStore.workMode)?.capabilities
        ?? workModes[0].capabilities
      const loopResult = await toolLoop.run({
        messages: apiMessages,
        model: currentModel.value,
        thinking: thinkingEnabled.value ? 'enabled' : 'disabled',
        apiKey: settingsStore.apiKey,
        signal: abortCtrl.signal,
        sessionId: sid,
        conversationTurnId,
        loadedSkillId: skillStore.loadedSkillId,
        onSkillLoaded(skillId) {
          skillStore.setLoadedSkill(skillId)
        },
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
          if (generatingSessionId.value === sid && sessionStore.currentId === sid) {
            activeToolCalls.value = [...calls]
          } else {
            bgToolCalls[sid] = [...calls]
          }
        },
        onNeedsApproval(info) {
          return new Promise<boolean>((resolve) => {
            approvalResolver = resolve
            pendingApproval.value = info
          })
        },
        modePolicy,
      })

      fullContent = loopResult.content
      fullThinking = loopResult.thinking

      // 完成，归档消息到目标会话（含工具调用记录）
      const finalToolCalls = sessionStore.currentId === sid
        ? [...activeToolCalls.value]
        : (bgToolCalls[sid] ? [...bgToolCalls[sid]] : [])
      const aiMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: fullContent,
        thinking: fullThinking || undefined,
        thinkingExpanded: thinkingManuallyExpanded.value || undefined,
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
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

      // 记忆提取 + Observation（fire-and-forget）
      void recordMessageCompleted({
        sessionId: sid,
        conversationTurnId,
        userMessageId: userMsg.id,
        assistantMessageId: aiMsg.id,
        userText: text,
        assistantText: fullContent,
        toolCallCount: finalToolCalls.length,
        usage: loopResult.totalUsage ?? usageFromApi ?? undefined,
      })
      void extractLightFromMessageCompleted({
        sessionId: sid,
        conversationTurnId,
        userText: text,
        assistantText: fullContent,
        apiKey: settingsStore.apiKey,
      })

      // 记录统计（仅使用 API 返回的真实数据；多轮工具时使用累计 usage）
      const finalUsage = loopResult.totalUsage ?? usageFromApi
      if (finalUsage) {
        const statsStore = useStatsStore()
        statsStore.addRecord({
          id: generateId(),
          model: currentModel.value,
          sessionId: sid,
          sessionTitle: session?.title ?? '',
          usage: finalUsage,
          timestamp: Date.now(),
          cost: 0,
          source: 'api',
          userMessage: text,
          assistantMessage: fullContent,
          apiMessages: apiMessages.map(m => ({ role: m.role, content: m.content })),
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
        if (sid === sessionStore.currentId) {
          messages.value.push(errMsg)
        } else {
          const origSession = sessionStore.sessions.find(s => s.id === sid)
          if (origSession) origSession.messages.push(errMsg)
        }
      }
    } finally {
      delete abortControllers[sid]
      const doneSid = sid
      if (doneSid) {
        generatingSessions.value = { ...generatingSessions.value }
        delete generatingSessions.value[doneSid]
        delete bgStreams[doneSid]
        delete bgToolCalls[doneSid]
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
    // 保存文件和引用信息
    const files = userMsg.attachments?.filter(a => a.text).map(a => ({
      name: a.name, size: a.size, text: a.text!,
    }))
    // 兼容旧 quote 字段：优先使用 quotes，回退到 quote（转为单元素数组）
    let quotesData = userMsg.quotes
    if (!quotesData || quotesData.length === 0) {
      if ((userMsg as any).quote) {
        quotesData = [(userMsg as any).quote]
      }
    }
    // 图片附件：已描述的其 text 已在 files 中；未描述的（如 MiMo 未配置时）保留附件展示，
    // 文件路径未持久化故无法重新调用 MiMo，仅保留元数据用于消息气泡中的图片标签显示
    const imageFiles = userMsg.attachments
      ?.filter(a => a.type === 'image' && !a.text)
      .map(a => {
        const ext = a.name.includes('.') ? ('.' + a.name.split('.').pop()!.toLowerCase()) : '.png'
        return { path: '', name: a.name, ext, size: a.size }
      })
    // 删除这条用户消息及之后的所有回复
    messages.value = messages.value.slice(0, idx)
    await nextTick()
    sendMessage(
      userMsg.content,
      files && files.length > 0 ? files : undefined,
      quotesData,
      imageFiles && imageFiles.length > 0 ? imageFiles : undefined,
    )
  }

  return {
    messages, streaming, streamingThinking, thinkingEnabled, isGenerating, thinkingManuallyExpanded, generatingSessions, unreadSessions, activeToolCalls, pendingApproval, currentModel, lastUsageData,
    sendMessage, clearMessages, loadFromSession, toggleThinking, retryMessage, stopGenerating, resolveApproval,
  }
})
