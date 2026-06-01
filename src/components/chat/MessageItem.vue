<script setup lang="ts">
import type { Message } from '@/types'
import ContentBlock from '@/components/renderer/ContentBlock.vue'
import ThinkingBubble from '@/components/renderer/ThinkingBubble.vue'

defineProps<{
  message: Message
}>()
</script>

<template>
  <div class="mb-6">
    <!-- 用户消息 -->
    <div v-if="message.role === 'user'" class="flex justify-end">
      <div class="max-w-[80%] px-4 py-2.5 bg-app-card rounded-bubble rounded-br-sm">
        <p class="text-sm text-app-text whitespace-pre-wrap leading-relaxed">{{ message.content }}</p>
      </div>
    </div>

    <!-- AI 消息 -->
    <div v-else class="flex items-start gap-3">
      <div class="w-7 h-7 rounded-lg bg-app-accent flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
        D
      </div>
      <div class="min-w-0 flex-1">
        <ThinkingBubble v-if="message.thinking" :thinking="message.thinking" />
        <ContentBlock :content="message.content" />
      </div>
    </div>
  </div>
</template>
