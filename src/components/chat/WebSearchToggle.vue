<script setup lang="ts">
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()
</script>

<template>
  <button
    @click="chatStore.toggleWebSearch()"
    class="flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors"
    :class="chatStore.webSearchEnabled
      ? 'border-app-accent bg-app-accent-soft text-app-accent'
      : 'border-app-border text-app-muted hover:bg-app-hover'"
  >
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
    <span>联网</span>
  </button>
</template>
