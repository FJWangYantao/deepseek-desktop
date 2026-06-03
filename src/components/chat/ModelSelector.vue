<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings'
import { useSessionStore } from '@/stores/session'
import { ref, nextTick, onUnmounted } from 'vue'

const settingsStore = useSettingsStore()
const sessionStore = useSessionStore()
const showDropdown = ref(false)
const btnRef = ref<HTMLElement>()
onUnmounted(() => { showDropdown.value = false })
const dropdownStyle = ref<Record<string, string>>({})

function toggleDropdown() {
  showDropdown.value = !showDropdown.value
  if (showDropdown.value) {
    nextTick(() => {
      if (!btnRef.value) return
      const rect = btnRef.value.getBoundingClientRect()
      dropdownStyle.value = {
        position: 'fixed',
        left: rect.left + 'px',
        bottom: (window.innerHeight - rect.top + 8) + 'px',
        minWidth: '240px',
      }
    })
  }
}

function selectModel(id: string) {
  settingsStore.defaultModel = id
  const session = sessionStore.getCurrentSession()
  if (session) session.model = id
  showDropdown.value = false
}
</script>

<template>
  <div>
    <button
      ref="btnRef"
      @click="toggleDropdown"
      class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors w-[108px] justify-between"
      :class="showDropdown
        ? 'border-app-accent bg-app-accent-soft text-app-accent'
        : 'border-app-border text-app-muted hover:border-app-accent-soft-border hover:text-app-heading'"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
      </svg>
      <span>{{ settingsStore.models.find(m => m.id === settingsStore.defaultModel)?.name ?? '模型' }}</span>
      <svg class="w-3 h-3 transition-transform" :class="{ 'rotate-180': showDropdown }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <Teleport to="body">
      <!-- 点击遮罩关闭 -->
      <div v-if="showDropdown" class="fixed inset-0 z-[99]" @click="showDropdown = false" />
      <div
        v-if="showDropdown"
        class="z-[100] bg-app-input border border-app-border rounded-xl shadow-lg py-1.5"
        :style="dropdownStyle"
      >
        <button
          v-for="m in settingsStore.models"
          :key="m.id"
          @click="selectModel(m.id)"
          class="w-full text-left px-3 py-2.5 mx-1 rounded-lg transition-colors flex items-center justify-between gap-3"
          :class="settingsStore.defaultModel === m.id
            ? 'bg-app-accent-soft'
            : 'hover:bg-app-hover'"
          style="width: calc(100% - 8px);"
        >
          <div class="min-w-0">
            <div class="text-sm font-medium" :class="settingsStore.defaultModel === m.id ? 'text-app-accent' : 'text-app-heading'">{{ m.name }}</div>
            <div class="text-[11px] text-app-muted mt-0.5">{{ m.description }}</div>
          </div>
          <svg
            v-if="settingsStore.defaultModel === m.id"
            class="w-4 h-4 text-app-accent shrink-0"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
          </svg>
        </button>
      </div>
    </Teleport>
  </div>
</template>
