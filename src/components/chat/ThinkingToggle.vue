<script setup lang="ts">
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()
</script>

<template>
  <button
    @click="chatStore.toggleThinking()"
    class="flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors"
    :class="chatStore.thinkingEnabled
      ? 'border-app-accent bg-amber-50 text-app-accent'
      : 'border-app-border text-app-muted hover:bg-[#f3f0eb]'"
  >
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
    <span>{{ chatStore.thinkingEnabled ? '思考' : '快速' }}</span>
  </button>
</template>
