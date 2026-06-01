<script setup lang="ts">
import { ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import ModelSelector from './ModelSelector.vue'
import ThinkingToggle from './ThinkingToggle.vue'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()

const inputText = ref('')
const sending = ref(false)

async function send() {
  const text = inputText.value.trim()
  if (!text || sending.value) return
  sending.value = true
  inputText.value = ''
  try {
    await chatStore.sendMessage(text)
  } finally {
    sending.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="px-5 pb-4 pt-2 border-t border-[#f0ede5]">
    <div class="max-w-[768px] mx-auto">
      <div class="bg-white border border-app-border rounded-xl p-2.5">
        <textarea
          v-model="inputText"
          @keydown="onKeydown"
          :disabled="sending"
          rows="1"
          placeholder="输入消息..."
          class="w-full resize-none text-sm px-1.5 py-1 text-app-text placeholder-app-muted
                 bg-transparent border-none outline-none leading-relaxed
                 min-h-[28px] max-h-[160px]"
        ></textarea>
        <div class="flex items-center justify-between pt-1.5 border-t border-gray-50">
          <div class="flex gap-1.5 items-center">
            <ModelSelector />
            <ThinkingToggle />
          </div>
          <button
            @click="send"
            :disabled="!inputText.trim() || sending"
            class="px-4 py-1.5 text-sm font-medium rounded-lg text-white transition-colors
                   bg-app-accent hover:bg-app-accent-hover
                   disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {{ sending ? '...' : '发送' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
