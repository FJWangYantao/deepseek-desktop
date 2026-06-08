import { ref } from 'vue'

const quoteText = ref('')
const quoteMessageId = ref('')

export function useQuote() {
  function setQuote(text: string, messageId: string) {
    quoteText.value = text
    quoteMessageId.value = messageId
  }

  function clearQuote() {
    quoteText.value = ''
    quoteMessageId.value = ''
  }

  return { quoteText, quoteMessageId, setQuote, clearQuote }
}
