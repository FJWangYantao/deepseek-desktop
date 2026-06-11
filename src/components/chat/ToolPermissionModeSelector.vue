<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { ToolPermissionMode } from '@/types'

const settings = useSettingsStore()
const open = ref(false)

const modes: Array<{ value: ToolPermissionMode; label: string; desc: string }> = [
  { value: 'confirm', label: '确认', desc: '高风险操作前询问' },
  { value: 'auto', label: 'Auto', desc: '安全操作自动执行' },
  { value: 'yolo', label: 'YOLO', desc: '跳过确认，仍拒绝禁用和危险写入' },
]

const current = computed(() => modes.find(m => m.value === settings.toolPermissionMode) ?? modes[0])

async function selectMode(mode: ToolPermissionMode) {
  await settings.setToolPermissionMode(mode)
  open.value = false
}
</script>

<template>
  <div class="relative">
    <button
      @click="open = !open"
      class="px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors"
      :class="settings.toolPermissionMode === 'yolo'
        ? 'border-amber-500/40 text-amber-500 bg-amber-500/10'
        : settings.toolPermissionMode === 'auto'
          ? 'border-app-accent-soft-border text-app-accent bg-app-accent-soft/30'
          : 'border-app-border text-app-muted hover:text-app-heading hover:bg-app-hover'"
      :title="current.desc"
    >
      {{ current.label }}
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-app-border bg-app-card shadow-lg overflow-hidden z-30"
    >
      <button
        v-for="mode in modes"
        :key="mode.value"
        @click="selectMode(mode.value)"
        class="w-full px-3 py-2 text-left hover:bg-app-hover transition-colors"
        :class="settings.toolPermissionMode === mode.value ? 'bg-app-hover' : ''"
      >
        <div class="text-xs font-medium text-app-heading">{{ mode.label }}</div>
        <div class="text-[11px] text-app-muted mt-0.5 leading-relaxed">{{ mode.desc }}</div>
      </button>
    </div>
  </div>
</template>
