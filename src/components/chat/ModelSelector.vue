<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings'
import { useSessionStore } from '@/stores/session'
import { ref } from 'vue'

const settingsStore = useSettingsStore()
const sessionStore = useSessionStore()
const showDropdown = ref(false)

function selectModel(id: string) {
  settingsStore.defaultModel = id
  const session = sessionStore.getCurrentSession()
  if (session) session.model = id
  showDropdown.value = false
}

const currentModel = () => settingsStore.models.find(m => m.id === settingsStore.defaultModel)
</script>

<template>
  <div class="relative">
    <button
      @click="showDropdown = !showDropdown"
      class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md
             bg-app-card text-app-heading hover:bg-app-hover-strong transition-colors"
    >
      <span class="w-1.5 h-1.5 rounded-full bg-app-accent"></span>
      <span>{{ settingsStore.models.find(m => m.id === settingsStore.defaultModel)?.name ?? '模型' }}</span>
      <svg class="w-3 h-3 text-app-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    <div
      v-if="showDropdown"
      class="absolute bottom-full left-0 mb-1 w-52 bg-app-input border border-app-border rounded-lg shadow-sm py-1 z-50"
      @mouseleave="showDropdown = false"
    >
      <button
        v-for="m in settingsStore.models"
        :key="m.id"
        @click="selectModel(m.id)"
        class="w-full text-left px-3 py-2 text-xs hover:bg-app-hover transition-colors"
        :class="settingsStore.defaultModel === m.id ? 'text-app-accent font-medium' : 'text-app-text'"
      >
        <div>{{ m.name }}</div>
        <div class="text-[10px] text-app-muted">{{ m.description }}</div>
      </button>
    </div>
  </div>
</template>
