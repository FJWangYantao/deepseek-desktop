<script setup lang="ts">
import { ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import ModelSelector from './ModelSelector.vue'
import ThinkingToggle from './ThinkingToggle.vue'
import WebSearchToggle from './WebSearchToggle.vue'

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
  <div class="px-4 pb-4 pt-2">
    <div class="max-w-[768px] mx-auto">
      <div class="bg-app-input border border-app-border rounded-2xl overflow-hidden">
        <textarea
          v-model="inputText"
          @keydown="onKeydown"
          :disabled="sending"
          rows="1"
          placeholder="输入消息..."
          :style="{ fontSize: 'var(--app-font-size)' }"
          class="w-full resize-none px-4 py-3 text-app-text placeholder-app-muted
                 bg-transparent border-none outline-none leading-[1.8]
                 min-h-[64px] max-h-[200px]"
        ></textarea>
        <div class="flex items-center justify-between px-3 pb-2.5">
          <div class="flex gap-1.5 items-center">
            <ModelSelector />
            <WebSearchToggle />
            <ThinkingToggle />
          </div>
          <button
            v-if="chatStore.isGenerating"
            @click="chatStore.stopGenerating()"
            class="px-4 py-1.5 text-sm font-medium rounded-lg text-white transition-colors
                   bg-red-500 hover:bg-red-600"
          >
            停止
          </button>
          <button
            v-else
            @click="send"
            :disabled="!inputText.trim() || sending"
            class="px-4 py-1.5 text-sm font-medium rounded-lg text-white transition-colors
                   bg-app-accent hover:bg-app-accent-hover
                   disabled:opacity-40 disabled:cursor-not-allowed"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
