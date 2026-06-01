<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import SessionList from './SessionList.vue'
import SidebarFooter from './SidebarFooter.vue'

defineProps<{ collapsed: boolean }>()
defineEmits<{ toggle: [] }>()

const sessionStore = useSessionStore()

function createSession() {
  sessionStore.createSession()
}
</script>

<template>
  <aside
    class="h-full bg-app-sidebar border-r border-app-border flex flex-col transition-all duration-200"
    :class="collapsed ? 'w-[48px] min-w-[48px]' : 'w-[250px] min-w-[250px]'"
  >
    <!-- 收起/展开按钮 -->
    <div class="px-2 py-2.5 border-b border-app-border flex" :class="collapsed ? 'justify-center' : 'justify-end'">
      <button
        @click="$emit('toggle')"
        class="w-7 h-7 rounded-md hover:bg-app-hover flex items-center justify-center text-app-muted
               hover:text-app-text transition-colors shrink-0"
        :title="collapsed ? '展开侧栏' : '收起侧栏'"
      >
        <svg v-if="collapsed" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </button>
    </div>

    <!-- 展开时显示的内容 -->
    <template v-if="!collapsed">
      <div class="p-3 border-b border-app-border">
        <button
          @click="createSession"
          class="w-full py-2.5 text-sm font-medium rounded-lg border border-app-border bg-app-card
                 text-app-heading hover:bg-app-hover-strong transition-colors"
        >
          + 新对话
        </button>
      </div>
      <SessionList />
      <SidebarFooter />
    </template>
  </aside>
</template>
