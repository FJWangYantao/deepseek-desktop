import { ref, computed, watch, readonly } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const PER_MESSAGE_OVERHEAD = 7

function fallbackCount(text: string): number {
  const chinese = (text.match(/[一-鿿]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  return Math.ceil(chinese * 1.5 + english * 1.3)
}

function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

export function useTokenCounter() {
  const chatStore = useChatStore()
  const settingsStore = useSettingsStore()

  const tokenCount = ref(0)
  const messageCount = computed(() => chatStore.messages.length)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let tokenCache = new Map<string, number>()

  const contextLength = computed(() => {
    const model = settingsStore.models.find(m => m.id === chatStore.currentModel)
    return model?.contextLength ?? 131072
  })

  const percentage = computed(() => {
    if (contextLength.value === 0) return 0
    return Math.min(100, Math.round((tokenCount.value / contextLength.value) * 10000) / 100)
  })

  const formattedCount = computed(() => {
    return `${formatTokens(tokenCount.value)} / ${formatTokens(contextLength.value)}`
  })

  async function countSingle(text: string): Promise<number> {
    if (!text) return 0
    if (tokenCache.has(text)) return tokenCache.get(text)!
    try {
      const count = await window.electronAPI!.tokenizerCount!(text)
      tokenCache.set(text, count)
      return count
    } catch {
      return fallbackCount(text)
    }
  }

  async function recount() {
    const msgs = chatStore.messages
    let total = 0

    // 批量计数
    const promises = msgs.map(async (msg) => {
      const tokens = await countSingle(msg.content || '')
      return tokens + PER_MESSAGE_OVERHEAD
    })

    const counts = await Promise.all(promises)
    total = counts.reduce((sum, c) => sum + c, 0)

    // 正在生成的消息
    if (chatStore.streaming) {
      total += await countSingle(chatStore.streaming) + PER_MESSAGE_OVERHEAD
    }

    // 如果有 API 返回的准确数据，用其校准
    const usage = chatStore.lastUsageData
    if (usage && usage.prompt_tokens > 0) {
      // API 的 prompt_tokens 是实际发送给 API 的 token 数
      // 我们的本地计数可能偏小（缺少特殊格式 token）
      // 用一个偏移量来校准
      const localEstimateWithoutLatest = total
      // 不覆盖本地计数，保持实时更新能力
    }

    tokenCount.value = total

    // 缓存淘汰：超过 500 条目时清理
    if (tokenCache.size > 500) {
      const keys = Array.from(tokenCache.keys())
      for (let i = 0; i < 250; i++) tokenCache.delete(keys[i])
    }
  }

  function scheduleRecount() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(recount, 300)
  }

  // 监听消息变化
  watch(
    () => [chatStore.messages, chatStore.streaming],
    () => scheduleRecount(),
    { deep: true }
  )

  // 监听 API usage 数据校准
  watch(
    () => chatStore.lastUsageData,
    (usage) => {
      if (usage && usage.prompt_tokens > 0) {
        tokenCount.value = usage.prompt_tokens
      }
    }
  )

  return {
    tokenCount: readonly(tokenCount),
    contextLength,
    percentage,
    formattedCount,
    messageCount,
    refresh: recount,
  }
}
