<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import { useRouter } from 'vue-router'
import SessionList from './SessionList.vue'
import SidebarFooter from './SidebarFooter.vue'

const sessionStore = useSessionStore()
const router = useRouter()

function createSession() {
  sessionStore.createSession()
}
</script>

<template>
  <aside class="w-[250px] min-w-[250px] h-full bg-app-sidebar border-r border-app-border flex flex-col">
    <div class="p-3 border-b border-app-border">
      <button
        @click="createSession"
        class="w-full py-2.5 text-sm font-medium rounded-lg border border-app-border bg-app-card
               text-app-heading hover:bg-[#e8e5db] transition-colors"
      >
        + 新对话
      </button>
    </div>
    <SessionList />
    <SidebarFooter />
  </aside>
</template>
