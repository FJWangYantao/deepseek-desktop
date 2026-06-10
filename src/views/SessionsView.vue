<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import SessionItem from '@/components/sidebar/SessionItem.vue'

const router = useRouter()
const sessionStore = useSessionStore()
const searchQuery = ref('')

const visibleSessions = computed(() =>
  sessionStore.sessions.filter(s =>
    s.messages.length > 0 || s.id === sessionStore.currentId
  )
)

const filteredSessions = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return visibleSessions.value
  return visibleSessions.value.filter(s =>
    s.title.toLowerCase().includes(q)
  )
})

function createSession() {
  const current = sessionStore.sessions.find(s => s.id === sessionStore.currentId)
  if (current && current.messages.length === 0) return
  sessionStore.createSession()
}

function selectSession(id: string) {
  sessionStore.switchSession(id)
  router.push('/')
}
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <!-- 顶部导航 -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-app-border">
      <button
        @click="router.push('/')"
        class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:bg-app-card transition-colors"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h1 class="text-base font-semibold text-app-text">对话</h1>
    </div>

    <!-- 内容 -->
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-[860px] mx-auto px-8 py-10">
        <!-- 新建对话 -->
        <button
          @click="createSession"
          class="w-full py-3 text-sm font-medium rounded-xl border border-dashed border-app-border
                 text-app-muted hover:text-app-heading hover:border-app-accent hover:bg-app-accent-soft/20
                 transition-colors mb-6"
        >
          + 新对话
        </button>

        <!-- 搜索 -->
        <div class="relative mb-8">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索对话..."
            class="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg border border-app-border bg-app-input
                   text-app-text placeholder-app-muted focus:outline-none focus:border-app-accent
                   transition-colors"
          />
        </div>

        <!-- 会话列表 -->
        <template v-if="filteredSessions.length > 0">
          <SessionItem
            v-for="session in filteredSessions"
            :key="session.id"
            :session="session"
            :active="session.id === sessionStore.currentId"
            @click="selectSession(session.id)"
            @delete="sessionStore.deleteSession(session.id)"
          />
        </template>
        <div v-else class="text-center text-app-muted text-sm py-20">
          {{ searchQuery ? '无匹配对话' : '暂无对话' }}
        </div>
      </div>
    </div>
  </div>
</template>
