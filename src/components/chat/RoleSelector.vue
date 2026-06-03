<script setup lang="ts">
import { ref, nextTick, onUnmounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const show = ref(false)
const btnRef = ref<HTMLElement>()
onUnmounted(() => { show.value = false })
const dropdownStyle = ref<Record<string, string>>({})

const activeTemplate = settings.roleTemplates.find(r => r.id === settings.activeRoleId)

function toggle() {
  show.value = !show.value
  if (show.value) {
    nextTick(() => {
      if (!btnRef.value) return
      const rect = btnRef.value.getBoundingClientRect()
      dropdownStyle.value = {
        position: 'fixed',
        left: rect.left + 'px',
        top: (rect.bottom + 6) + 'px',
        minWidth: '180px',
      }
    })
  }
}

function select(id: string) {
  settings.selectRole(id)
  show.value = false
}
</script>

<template>
  <div class="relative">
    <button
      ref="btnRef"
      @click="toggle"
      class="flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors"
      :class="show
        ? 'border-app-accent bg-app-accent-soft text-app-accent'
        : 'border-app-border text-app-muted hover:border-app-accent-soft-border hover:text-app-heading'"
    >
      <span>{{ activeTemplate?.icon ?? '💬' }}</span>
      <span class="max-w-[80px] truncate">{{ activeTemplate?.name ?? '默认' }}</span>
      <svg class="w-3 h-3 transition-transform" :class="{ 'rotate-180': show }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <Teleport to="body">
      <div v-if="show" class="fixed inset-0 z-[99]" @click="show = false" />
      <div
        v-if="show"
        class="z-[100] bg-app-input border border-app-border rounded-xl shadow-lg py-1.5"
        :style="dropdownStyle"
      >
        <button
          v-for="r in settings.roleTemplates"
          :key="r.id"
          @click="select(r.id)"
          class="w-full text-left px-3 py-2.5 mx-1 rounded-lg transition-colors flex items-center gap-2.5"
          :class="settings.activeRoleId === r.id ? 'bg-app-accent-soft' : 'hover:bg-app-hover'"
          style="width: calc(100% - 8px);"
        >
          <span class="text-base">{{ r.icon }}</span>
          <span class="text-sm" :class="settings.activeRoleId === r.id ? 'text-app-accent font-medium' : 'text-app-heading'">{{ r.name }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
