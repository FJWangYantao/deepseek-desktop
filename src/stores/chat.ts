import { defineStore } from 'pinia'
import { ref, watch, computed, nextTick } from 'vue'
import type { Message, UsageData, SearchResult } from '@/types'
import { useSessionStore } from './session'
import { useSettingsStore } from './settings'
import { useStatsStore } from './stats'
import { useMemory } from '@/composables/useMemory'
import { deepSeekChat } from '@/composables/useDeepSeek'

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

  const sessionStore = useSessionStore()
  const settingsStore = useSettingsStore()
  const memory = useMemory()

  // 切换到当前会话时加载消息
  function loadFromSession() {
    // 如有正在进行的生成，中止并确保内容留在原会话
    if (isGenerating.value && generatingSessionId.value) {
      stopGenerating()
    }
    const session = sessionStore.getCurrentSession()
    messages.value = session?.messages ?? []
    streaming.value = ''
    streamingThinking.value = ''
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

  let abortController: AbortController | null = null

  function toggleThinking() {
    thinkingEnabled.value = !thinkingEnabled.value
  }

  function toggleWebSearch() {
    webSearchEnabled.value = !webSearchEnabled.value
  }

  async function buildSearchQueries(userText: string): Promise<string[]> {
    const now = new Date()
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`

    if (!settingsStore.apiKey) return [userText]

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
            { role: 'system', content: `你是一个搜索词生成助手。根据用户的自然语言问题，生成2-3个不同角度的英文或中文搜索关键词（每个15字以内），一行一个，不要编号、不要解释。当前日期：${dateStr}。` },
            { role: 'user', content: userText },
          ],
          thinking: { type: 'disabled' },
          max_tokens: 80,
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

  async function shouldSearch(userText: string): Promise<boolean> {
    if (!settingsStore.apiKey) return true
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
            { role: 'system', content: '判断用户问题是否需要联网搜索最新信息。需要搜索（实时新闻、最新数据、当前事件、价格查询、天气等）回复Y，不需要（基础知识、数学计算、翻译、编程语法等）回复N。只输出一个字母。' },
            { role: 'user', content: userText },
          ],
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
      lines.push(`【来源 ${i + 1}】${r.title}`)
      lines.push(`URL: ${r.url}`)
      if (r.snippet) lines.push(`摘要: ${r.snippet}`)
      if (r.content) lines.push(`页面内容: ${r.content}`)
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
    if (abortController) {
      abortController.abort()
      abortController = null
    }
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
    if (!settingsStore.apiKey) {
      alert('请先在设置页面配置 API Key')
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
      const needSearch = await shouldSearch(text)
      if (!needSearch) {
        console.log('[Search] AI 判断无需搜索，跳过')
      } else {
        // 1. AI 生成多角度搜索词
        const queries = await buildSearchQueries(text)
      console.log('[Search] 准备并行搜索，词数:', queries.length)

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
    // 1. 用户自定义 system prompt
    let systemPrompt = ''
    if (settingsStore.systemPrompt) {
      systemPrompt += settingsStore.systemPrompt + '\n\n'
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
      systemPrompt += '\n联网搜索/URL抓取已获取内容并注入到用户消息中，请基于这些内容回答，在末尾标注来源。'
    } else if (webSearchEnabled.value) {
      systemPrompt += '\n联网搜索已开启但本次未能获取结果。请如实告知用户搜索暂时不可用，建议稍后重试或更换关键词。'
    } else {
      systemPrompt += '\n用户可以使用"联网搜索"功能获取实时信息。当被问到新闻、实时数据等超出你知识范围的问题时，请告诉用户："需要实时信息，请点输入框下方"联网"按钮后再问一次。"'
    }

    const historyMessages = messages.value
      .filter(m => m.id !== userMsg.id)
      .slice(-50)

    const apiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...historyMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: userContent },
    ]

    let fullContent = ''
    let fullThinking = ''
    let usageFromApi: UsageData | null = null

    abortController = new AbortController()

    try {
      await deepSeekChat({
        messages: apiMessages,
        model: currentModel.value,
        thinking: thinkingEnabled.value ? 'enabled' : 'disabled',
        apiKey: settingsStore.apiKey,
        signal: abortController.signal,
        onToken(token) {
          fullContent += token
          streaming.value = fullContent
        },
        onThinking(token) {
          fullThinking += token
          streamingThinking.value = fullThinking
        },
        onUsage(usage) {
          usageFromApi = usage
        },
      })

      // 完成，归档消息
      const aiMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: fullContent,
        thinking: fullThinking || undefined,
        thinkingExpanded: thinkingManuallyExpanded.value || undefined,
        timestamp: Date.now(),
      }
      messages.value.push(aiMsg)

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
          // 确保保存到生成所属的会话（切换会话时可能已变更）
          if (generatingSessionId.value === sessionStore.currentId) {
            messages.value.push(partialMsg)
          } else {
            const origSession = sessionStore.sessions.find(s => s.id === generatingSessionId.value)
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
      abortController = null
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
    messages, streaming, streamingThinking, thinkingEnabled, webSearchEnabled, isGenerating, thinkingManuallyExpanded, currentModel,
    sendMessage, clearMessages, loadFromSession, toggleThinking, toggleWebSearch, retryMessage, stopGenerating,
  }
})
