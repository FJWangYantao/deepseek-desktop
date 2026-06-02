<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Message } from '@/types'
import { useChatStore } from '@/stores/chat'
import { useAvatar } from '@/composables/useAvatar'
import ContentBlock from '@/components/renderer/ContentBlock.vue'
import ThinkingBubble from '@/components/renderer/ThinkingBubble.vue'

const props = defineProps<{
  message: Message
}>()

const chatStore = useChatStore()
const { avatarUrl, loadAvatar } = useAvatar()
const copied = ref(false)

onMounted(() => { loadAvatar() })

async function copyContent() {
  try {
    await navigator.clipboard.writeText(props.message.content)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* ignore */ }
}

function retry() {
  chatStore.retryMessage(props.message.id)
}
</script>

<template>
  <div class="mb-6 group">
    <!-- 用户消息 -->
    <div v-if="message.role === 'user'" class="flex flex-col items-end">
      <div class="max-w-[80%] px-4 py-2.5 bg-app-card rounded-bubble rounded-br-sm overflow-hidden">
        <p class="text-app-text whitespace-pre-wrap break-words leading-[1.8]" :style="{ fontSize: 'var(--app-font-size)' }">{{ message.content }}</p>
      </div>
      <div class="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          @click="retry"
          class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:text-app-accent hover:bg-app-accent-soft transition-colors"
          title="重试"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        <button
          @click="copyContent"
          class="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
          :class="copied ? 'text-green-600 bg-green-50' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
          :title="copied ? '已复制' : '复制'"
        >
          <svg v-if="!copied" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </button>
      </div>
    </div>

    <!-- AI 消息 -->
    <div v-else class="flex items-start gap-3">
      <div
        :class="[
          'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 overflow-hidden',
          avatarUrl ? 'bg-transparent' : 'bg-app-accent text-white'
        ]"
      >
        <img v-if="avatarUrl" :src="avatarUrl" class="w-full h-full object-contain" />
        <span v-else>D</span>
      </div>
      <div class="min-w-0 flex-1">
        <ThinkingBubble v-if="message.thinking" :thinking="message.thinking" />
        <ContentBlock :content="message.content" />
        <div class="flex mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            @click="copyContent"
            class="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            :class="copied ? 'text-green-600 bg-green-50' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
            :title="copied ? '已复制' : '复制'"
          >
            <svg v-if="!copied" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
