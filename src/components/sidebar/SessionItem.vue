<script setup lang="ts">
import type { ChatSession } from '@/types'
import { useChatStore } from '@/stores/chat'

defineProps<{
  session: ChatSession
  active: boolean
}>()

defineEmits<{
  click: []
  delete: []
}>()

const chatStore = useChatStore()
</script>

<template>
  <div
    class="sidebar-item-indicator group relative flex items-center px-3 py-2.5 mb-0.5 rounded-lg cursor-pointer transition-colors text-sm"
    :class="[
      active ? 'bg-app-card text-app-text active' : 'text-app-heading hover:bg-app-hover',
    ]"
    @click="$emit('click')"
  >
    <span class="flex-1 truncate">{{ session.title }}</span>
    <svg
      v-if="chatStore.generatingSessions[session.id] && !active"
      class="w-3.5 h-3.5 ml-2 animate-spin text-app-accent shrink-0"
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
    <span
      v-else-if="chatStore.unreadSessions[session.id] && !active"
      class="w-2 h-2 ml-2 rounded-full bg-app-accent shrink-0"
    />
    <button
      class="opacity-0 group-hover:opacity-100 ml-2 w-5 h-5 flex items-center justify-center rounded
             text-app-muted hover:text-red-500 hover:bg-red-50 hover:animate-shake-warn transition-all text-xs"
      @click.stop="$emit('delete')"
      title="删除对话"
    >
      &times;
    </button>
  </div>
</template>
