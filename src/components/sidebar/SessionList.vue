<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import SessionItem from './SessionItem.vue'

const sessionStore = useSessionStore()
</script>

<template>
  <div class="flex-1 overflow-y-auto py-1.5 px-2">
    <SessionItem
      v-for="session in sessionStore.sessions"
      :key="session.id"
      :session="session"
      :active="session.id === sessionStore.currentId"
      @click="sessionStore.switchSession(session.id)"
      @delete="sessionStore.deleteSession(session.id)"
    />
    <div
      v-if="sessionStore.sessions.length === 0"
      class="text-center text-app-muted text-sm py-12"
    >
      暂无对话
    </div>
  </div>
</template>
