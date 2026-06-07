import { defineStore } from 'pinia'
import { ref, reactive, watch, computed, nextTick } from 'vue'
import type { Message, UsageData, SearchResult, ToolCallUIState } from '@/types'
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
  const webSearchEnabled = ref(false)
  const isGenerating = ref(false)
  const generatingSessionId = ref<string | null>(null)
  const thinkingManuallyExpanded = ref(false)
  const bgStreams = reactive<Record<string, { content: string; thinking: string }>>({})
  const generatingSessions = ref<Record<string, boolean>>({})
  const unreadSessions = ref<Record<string, boolean>>({})
  const activeToolCalls = ref<ToolCallUIState[]>([])

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

  interface SearchStatus {
    phase: 'idle' | 'searching' | 'fetched'
    queries: string[]
    resultCount: number
    topTitles: string[]
  }
  const searchStatus = ref<SearchStatus>({ phase: 'idle', queries: [], resultCount: 0, topTitles: [] })

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

  function toggleWebSearch() {
    webSearchEnabled.value = !webSearchEnabled.value
  }

  async function buildSearchQueries(userText: string, contextMessages: { role: string; content: string }[]): Promise<string[]> {
    const now = new Date()
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`

    if (!settingsStore.apiKey) return [userText]

    try {
      const apiMessages: { role: string; content: string }[] = [
        { role: 'system', content: `将用户最新问题转化为3个搜索引擎关键词。参考对话历史理解指代和上下文。至少1条英文。保持核心概念组合。每条20字内。一行一个。当前日期：${dateStr}。` },
      ]
      // 注入最近4条对话历史作为上下文
      for (const m of contextMessages.slice(-4)) {
        apiMessages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content.slice(0, 200) })
      }
      apiMessages.push({ role: 'user', content: userText })

      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settingsStore.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: apiMessages,
          thinking: { type: 'disabled' },
          max_tokens: 100,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const text = data.choices?.[0]?.message?.content?.trim()
        if (text) {
          const queries = text.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
          if (queries.length > 0) {
            console.log('[Search] AI 生成搜索词:', userText, '→', queries)
            return queries
          }
        }
      }
    } catch (e) {
      console.warn('[Search] 搜索词生成失败，使用原文:', e)
    }
    return [userText]
  }

  async function shouldSearch(userText: string, contextMessages: { role: string; content: string }[]): Promise<boolean> {
    if (!settingsStore.apiKey) return true
    try {
      const apiMessages: { role: string; content: string }[] = [
        { role: 'system', content: '用户开启了联网搜索，判断此问题是否能从搜索结果中获益。需要搜索（概念解释、最新信息、事件、数据、教程、对比、评测、新闻等）回复Y，不需要（纯数学计算、纯翻译、纯代码语法纠错等）回复N。倾向回复Y。只输出一个字母。' },
      ]
      for (const m of contextMessages.slice(-4)) {
        apiMessages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content.slice(0, 200) })
      }
      apiMessages.push({ role: 'user', content: userText })

      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settingsStore.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: apiMessages,
          thinking: { type: 'disabled' },
          max_tokens: 1,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase()
        console.log('[Search] AI 判断是否需要搜索:', userText, '→', answer === 'Y')
        return answer === 'Y'
      }
    } catch {}
    return true // 判断失败默认搜索
  }

  function extractUrls(text: string): string[] {
    const re = /https?:\/\/[^\s,，。；;！!？?)]+/g
    const matches = text.match(re)
    if (!matches) return []
    return [...new Set(matches)]
  }

  function buildSearchContext(results: SearchResult[]): string {
    if (results.length === 0) return ''
    const lines = ['[系统提示] 以下是与问题相关的网络搜索结果，请基于这些信息回答：', '']
    results.forEach((r, i) => {
      lines.push(`【来源 ${i + 1}】${r.title}\n  URL: ${r.url}`)
      if (r.snippet) lines.push(`  摘要: ${r.snippet}`)
      if (r.content) lines.push(`  内容: ${r.content}`)
      lines.push('')
    })
    return lines.join('\n')
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

  function buildFetchContext(url: string, content: string): string {
    if (!content) return ''
    return `[系统提示] 以下是从 ${url} 获取的网页内容，请基于这些信息回答：\n\n${content}\n\n`
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

    // 添加用户消息
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text,
      attachments: files?.map(f => ({ name: f.name, size: f.size })),
      timestamp: Date.now(),
    }
    messages.value.push(userMsg)

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

    // ===== 文件内容 + 联网搜索 + URL 抓取 =====
    let injectedContext = ''

    // 文件内容注入
    if (files && files.length > 0) {
      injectedContext += buildFileContext(files)
      console.log('[File] 注入文件内容，长度:', injectedContext.length)
    }

    console.log('[Search] ===== 开始搜索流程 =====')
    console.log('[Search] webSearchEnabled:', webSearchEnabled.value)
    console.log('[Search] electronAPI 存在:', !!window.electronAPI)
    console.log('[Search] electronAPI.webSearch 存在:', !!window.electronAPI?.webSearch)

    // URL 自动检测抓取
    const urls = extractUrls(text)
    if (urls.length > 0 && window.electronAPI?.fetchUrl) {
      console.log('[Search] 检测到 URL:', urls)
      for (const url of urls) {
        try {
          const content = await window.electronAPI.fetchUrl(url)
          if (content) {
            injectedContext += buildFetchContext(url, content)
            console.log('[Search] URL 抓取成功:', url, '内容长度:', content.length)
          }
        } catch {
          // 抓取失败，跳过
        }
      }
    }

    // 联网搜索（多词并行）—— AI自行判断是否需要搜索
    if (webSearchEnabled.value && window.electronAPI?.webSearch && urls.length === 0) {
      const needSearch = await shouldSearch(text, historyMsgs)
      if (!needSearch) {
        console.log('[Search] AI 判断无需搜索，跳过')
      } else {
        // 1. AI 生成多角度搜索词
        const queries = await buildSearchQueries(text, historyMsgs)
      console.log('[Search] 准备并行搜索，词数:', queries.length)
      searchStatus.value = { phase: 'searching', queries, resultCount: 0, topTitles: [] }

      // 2. 所有搜索词并行执行
      try {
        const allResults = await Promise.all(
          queries.map(q =>
            Promise.race([
              window.electronAPI!.webSearch(q),
              new Promise<SearchResult[]>((_, reject) =>
                setTimeout(() => reject(new Error('搜索超时')), 25000)
              ),
            ]).catch((e) => {
              console.warn(`[Search] 搜索词 "${q}" 失败:`, e)
              return [] as SearchResult[]
            })
          )
        )

        // 3. 合并 + URL去重
        const seen = new Set<string>()
        const merged: SearchResult[] = []
        for (const batch of allResults) {
          for (const r of batch) {
            if (!seen.has(r.url)) {
              seen.add(r.url)
              merged.push(r)
            }
          }
        }

        console.log('[Search] 合并去重后结果数:', merged.length)
        searchStatus.value = {
          phase: 'fetched',
          queries,
          resultCount: merged.length,
          topTitles: merged.slice(0, 8).map(r => r.title),
        }
        if (merged.length > 0) {
          merged.forEach((r, i) => console.log(`[Search] 结果${i+1}: ${r.title} | ${r.url}`))
          injectedContext += buildSearchContext(merged.slice(0, 10))
        } else {
          console.warn('[Search] 全部搜索返回空结果')
        }
        } catch (e) {
          console.warn('[Search] 联网搜索失败，继续普通对话:', e)
        }
      } // end if needSearch
    } else if (webSearchEnabled.value) {
      console.warn('[Search] electronAPI 不可用，跳过搜索（是否在浏览器开发模式？）')
    }

    console.log('[Search] injectedContext 长度:', injectedContext.length)
    const userContent = injectedContext
      ? `${injectedContext}\n\n用户问题：${text}`
      : text
    console.log('[Search] 最终 userContent 前500字:', userContent.substring(0, 500))

    const today = new Date()
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()]

    // ===== 构建 system prompt =====
    // 1. 用户自定义 system prompt（含角色模板）
    let systemPrompt = ''
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
        searchStatus.value = { phase: 'idle', queries: [], resultCount: 0, topTitles: [] }

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
            context: { userInput: text, files, date: `${dateStr} 星期${weekDay}`, searchResults: injectedContext },
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

    // 4. 搜索状态
    if (injectedContext.length > 0) {
      systemPrompt += '\n联网搜索结果已注入。正文中用【来源 N】标注，末尾列出所有来源，每条格式：\n【来源 N】标题\nURL\n（URL必须单独一行，以http开头）'
    } else if (webSearchEnabled.value) {
      systemPrompt += '\n联网搜索已开启但本次未能获取结果。请如实告知用户搜索暂时不可用，建议稍后重试或更换关键词。'
    } else {
      systemPrompt += '\n用户可以使用"联网搜索"功能获取实时信息。当被问到新闻、实时数据等超出你知识范围的问题时，请告诉用户："需要实时信息，请点输入框下方"联网"按钮后再问一次。"'
    }

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

    // 清除搜索状态，准备流式输出
    searchStatus.value = { phase: 'idle', queries: [], resultCount: 0, topTitles: [] }
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
    messages, streaming, streamingThinking, thinkingEnabled, webSearchEnabled, isGenerating, thinkingManuallyExpanded, generatingSessions, unreadSessions, searchStatus, activeToolCalls, pendingApproval, currentModel,
    sendMessage, clearMessages, loadFromSession, toggleThinking, toggleWebSearch, retryMessage, stopGenerating, resolveApproval,
  }
})
