import { ref, computed } from 'vue'
import type { QuoteItem } from '@/types'

const MAX_QUOTES = 5

const quotes = ref<QuoteItem[]>([])

export function useQuote() {
  const hasQuotes = computed(() => quotes.value.length > 0)

  /**
   * 追加一条引用。messageId + text 去重，超过 MAX_QUOTES 时 FIFO 移除最早的。
   */
  function addQuote(text: string, messageId: string) {
    const exists = quotes.value.some(
      q => q.messageId === messageId && q.text === text
    )
    if (exists) return

    if (quotes.value.length >= MAX_QUOTES) {
      quotes.value = quotes.value.slice(1)
    }

    quotes.value = [...quotes.value, { text, messageId }]
  }

  /** 移除指定索引的引用 */
  function removeQuote(index: number) {
    quotes.value = quotes.value.filter((_, i) => i !== index)
  }

  /** 清空所有引用 */
  function clearQuotes() {
    quotes.value = []
  }

  return { quotes, hasQuotes, addQuote, removeQuote, clearQuotes }
}
