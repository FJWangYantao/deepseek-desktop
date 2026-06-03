<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { computed, toRaw } from 'vue'
import RoleSelector from './RoleSelector.vue'

const sessionStore = useSessionStore()
const settings = useSettingsStore()

const title = computed(() => {
  const session = sessionStore.sessions.find(s => s.id === sessionStore.currentId)
  return session?.title ?? 'DeepSeek Desktop'
})

const currentSession = computed(() =>
  sessionStore.sessions.find(s => s.id === sessionStore.currentId)
)

async function exportSession(format: 'md' | 'html') {
  const session = currentSession.value
  if (!session) { console.warn('[Export] 无当前会话'); return }
  if (!window.electronAPI?.exportSession) { console.warn('[Export] electronAPI 不可用，可能在浏览器开发模式'); return }
  console.log('[Export] 开始导出:', session.title)
  const ok = await window.electronAPI.exportSession(toRaw(session), format)
  console.log('[Export] 导出结果:', ok)
}
</script>

<template>
  <div class="px-5 py-3 border-b border-app-border flex items-center justify-between">
    <h1 class="text-sm font-medium text-app-heading truncate">{{ title }}</h1>
    <div class="flex items-center gap-2 shrink-0 ml-4">
      <RoleSelector />
      <button
        @click="exportSession('md')"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-app-border
               text-app-muted hover:border-app-accent-soft-border hover:text-app-heading transition-colors"
        title="导出 Markdown"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span>导出</span>
      </button>
    </div>
  </div>
</template>
