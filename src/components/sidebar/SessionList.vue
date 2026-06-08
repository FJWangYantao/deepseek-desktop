<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStore } from '@/stores/session'
import SessionItem from './SessionItem.vue'

const sessionStore = useSessionStore()

// 只显示有消息的会话 + 当前会话（即使为空），避免侧栏堆积空对话
const visibleSessions = computed(() =>
  sessionStore.sessions.filter(s =>
    s.messages.length > 0 || s.id === sessionStore.currentId
  )
)
</script>

<template>
  <div class="flex-1 overflow-y-auto py-1.5 px-2">
    <SessionItem
      v-for="session in visibleSessions"
      :key="session.id"
      :session="session"
      :active="session.id === sessionStore.currentId"
      @click="sessionStore.switchSession(session.id)"
      @delete="sessionStore.deleteSession(session.id)"
    />
    <div
      v-if="visibleSessions.length === 0"
      class="text-center text-app-muted text-sm py-12"
    >
      暂无对话
    </div>
  </div>
</template>
