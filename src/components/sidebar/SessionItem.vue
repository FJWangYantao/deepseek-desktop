<script setup lang="ts">
import type { ChatSession } from '@/types'

defineProps<{
  session: ChatSession
  active: boolean
}>()

defineEmits<{
  click: []
  delete: []
}>()
</script>

<template>
  <div
    class="group relative flex items-center px-3 py-2.5 mb-0.5 rounded-lg cursor-pointer transition-colors text-sm"
    :class="active ? 'bg-app-card text-app-text' : 'text-app-heading hover:bg-[#f3f0eb]'"
    @click="$emit('click')"
  >
    <span class="flex-1 truncate">{{ session.title }}</span>
    <button
      class="opacity-0 group-hover:opacity-100 ml-2 w-5 h-5 flex items-center justify-center rounded
             text-app-muted hover:text-red-500 hover:bg-red-50 transition-all text-xs"
      @click.stop="$emit('delete')"
      title="删除对话"
    >
      &times;
    </button>
  </div>
</template>
