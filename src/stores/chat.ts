import { defineStore } from 'pinia'
import { ref, watch, computed, nextTick } from 'vue'
import type { Message } from '@/types'
import { useSessionStore } from './session'
import { useSettingsStore } from './settings'
import { deepSeekChat } from '@/composables/useDeepSeek'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<Message[]>([])
  const streaming = ref('')
  const streamingThinking = ref('')
  const thinkingEnabled = ref(true)
  const isGenerating = ref(false)

  const sessionStore = useSessionStore()
  const settingsStore = useSettingsStore()

  // 切换到当前会话时加载消息
  function loadFromSession() {
    const session = sessionStore.getCurrentSession()
    messages.value = session?.messages ?? []
    streaming.value = ''
    streamingThinking.value = ''
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
      // 自动更新标题
      const firstUserMsg = val.find(m => m.role === 'user')
      if (firstUserMsg && session.title === '新对话') {
        sessionStore.updateSessionTitle(sid, firstUserMsg.content.slice(0, 30))
      }
    }
  }, { deep: true })

  function toggleThinking() {
    thinkingEnabled.value = !thinkingEnabled.value
  }

  const currentModel = computed(() => {
    const session = sessionStore.getCurrentSession()
    return session?.model ?? settingsStore.defaultModel
  })

  async function sendMessage(text: string) {
    const sid = sessionStore.ensureSession()
    if (!settingsStore.apiKey) {
      alert('请先在设置页面配置 API Key')
      return
    }

    // 添加用户消息
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    messages.value.push(userMsg)

    // 流式生成
    isGenerating.value = true
    streaming.value = ''
    streamingThinking.value = ''

    const historyMessages = messages.value
      .filter(m => m.id !== userMsg.id) // 排除刚发的这条，下面单独构建
      .slice(-50) // 限制上下文长度

    const apiMessages = [
      ...historyMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: text },
    ]

    let fullContent = ''
    let fullThinking = ''

    try {
      await deepSeekChat({
        messages: apiMessages,
        model: currentModel.value,
        thinking: thinkingEnabled.value ? 'enabled' : 'disabled',
        apiKey: settingsStore.apiKey,
        onToken(token) {
          fullContent += token
          streaming.value = fullContent
        },
        onThinking(token) {
          fullThinking += token
          streamingThinking.value = fullThinking
        },
      })

      // 完成，归档消息
      const aiMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: fullContent,
        thinking: fullThinking || undefined,
        timestamp: Date.now(),
      }
      messages.value.push(aiMsg)
    } catch (e) {
      const errMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: `请求失败: ${e instanceof Error ? e.message : '未知错误'}`,
        timestamp: Date.now(),
      }
      messages.value.push(errMsg)
    } finally {
      streaming.value = ''
      streamingThinking.value = ''
      isGenerating.value = false
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
    messages, streaming, streamingThinking, thinkingEnabled, isGenerating, currentModel,
    sendMessage, clearMessages, loadFromSession, toggleThinking, retryMessage,
  }
})
