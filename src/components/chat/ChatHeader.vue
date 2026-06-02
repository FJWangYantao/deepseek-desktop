<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import { computed } from 'vue'

const sessionStore = useSessionStore()
const title = computed(() => {
  const session = sessionStore.sessions.find(s => s.id === sessionStore.currentId)
  return session?.title ?? 'DeepSeek Desktop'
})
</script>

<template>
  <div class="px-5 py-3 border-b border-app-border flex items-center">
    <h1 class="text-sm font-medium text-app-heading truncate">{{ title }}</h1>
  </div>
</template>
