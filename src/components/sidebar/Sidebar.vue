<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import SidebarFooter from './SidebarFooter.vue'
import ReplixLogo from '@/components/pet/ReplixLogo.vue'

const router = useRouter()
const sessionStore = useSessionStore()

function createSession() {
  const current = sessionStore.sessions.find(s => s.id === sessionStore.currentId)
  if (current && current.messages.length === 0) return
  sessionStore.createSession()
  router.push('/')
}
</script>

<template>
  <aside
    class="h-full w-[56px] min-w-[56px] bg-app-sidebar border-r border-app-border flex flex-col items-center py-3 gap-2 z-20"
  >
    <!-- 顶部 Logo -->
    <button
      @click="router.push('/')"
      class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-app-hover transition-colors btn-interactive"
      title="首页"
    >
      <ReplixLogo size="sm" />
    </button>

    <!-- 中间功能图标 -->
    <div class="flex-1 flex flex-col items-center gap-1 pt-2">
      <!-- 对话列表 -->
      <button
        @click="router.push('/sessions')"
        class="w-9 h-9 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text hover:bg-app-hover transition-colors btn-interactive"
        title="对话列表"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>

      <!-- 新建对话 -->
      <button
        @click="createSession"
        class="w-9 h-9 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text hover:bg-app-hover transition-colors btn-interactive"
        title="新建对话"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      </button>
    </div>

    <!-- 底部导航 -->
    <SidebarFooter />
  </aside>
</template>
