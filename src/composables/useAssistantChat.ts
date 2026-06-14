import { ref } from 'vue'
import type { Message } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { deepSeekChat } from '@/composables/useDeepSeek'
import { trimHistory } from '@/composables/assistantChat/trimHistory'

/**
 * 划词助手"对话"模式：划选内容作为 system 上下文，多轮流式追问。
 *
 * 设计要点（见 docs/superpowers/specs/2026-06-14-selection-context-chat-design.md）：
 * - 划选内容完整注入 system role，不截断、不在窗内显示原文
 * - 每次划词重置（initContext）；clear() 仅清对话历史、保留上下文
 * - 模型固定 deepseek-v4-flash，thinking 关闭，纯文本问答
 * - 历史超 20 条丢弃最早 user/assistant（system 上下文每次发送时即时组装，不在 messages 里）
 */

const MODEL = 'deepseek-v4-flash'

const SYSTEM_PREFIX = '以下划选内容作为讨论背景，回答时据此为准：\n\n'

export function useAssistantChat() {
  // 划选上下文（system role 用；窗内不显示）
  const systemContext = ref('')
  // 对话历史：仅 user/assistant，不含 system
  const messages = ref<Message[]>([])
  const streaming = ref(false)
  // 流式累积文本（最新一条 assistant 在途内容）
  const streamingText = ref('')

  // 生成简单 id（助手窗口内不持久化，时间戳+随机即可）
  function genId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  /** 划词/进对话时调：存 system 上下文 + 清空历史。完整不截断。 */
  function initContext(text: string) {
    systemContext.value = text
    messages.value = []
    streamingText.value = ''
    streaming.value = false
  }

  /** 清空对话历史，保留 system 上下文（顶栏"清空"按钮）。 */
  function clear() {
    messages.value = []
    streamingText.value = ''
    streaming.value = false
  }

  /**
   * 发送一条：push user → 流式调 API → push assistant。
   * - 空输入忽略
   * - apiKey 未就绪返回 false（调用方提示）
   * - API 失败：push 一条"(请求失败，请重试)"的 assistant 消息
   */
  async function send(text: string): Promise<boolean> {
    const trimmed = text.trim()
    if (!trimmed || streaming.value) return false

    const settings = useSettingsStore()
    const apiKey = settings.apiKey
    if (!apiKey) return false

    // 组装本次请求的 messages：system(上下文) + 裁剪后的历史 + 本次 user
    const apiMessages = [
      { role: 'system' as const, content: SYSTEM_PREFIX + systemContext.value },
      ...trimHistory(messages.value).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: trimmed },
    ]

    // 先把 user 消息入历史
    messages.value.push({ id: genId(), role: 'user', content: trimmed, timestamp: Date.now() })

    streaming.value = true
    streamingText.value = ''
    let full = ''
    try {
      await deepSeekChat({
        messages: apiMessages,
        model: MODEL,
        thinking: 'disabled',
        apiKey,
        onToken(token) {
          full += token
          streamingText.value = full
        },
        onThinking() {
          // flash + 关闭思考，不会有内容；占位即可
        },
      })
      if (!full) full = '（请求失败，请重试）'
    } catch {
      full = full || '（请求失败，请重试）'
    } finally {
      messages.value.push({
        id: genId(),
        role: 'assistant',
        content: full,
        timestamp: Date.now(),
      })
      streaming.value = false
      streamingText.value = ''
    }
    return true
  }

  return {
    systemContext,
    messages,
    streaming,
    streamingText,
    initContext,
    send,
    clear,
  }
}
