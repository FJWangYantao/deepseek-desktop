<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { ToolPermissionMode } from '@/types'

const settings = useSettingsStore()

const modes: Array<{ value: ToolPermissionMode; label: string; desc: string }> = [
  { value: 'auto', label: 'Auto', desc: '安全操作自动执行' },
  { value: 'yolo', label: 'YOLO', desc: '跳过确认，仍拒绝禁用和危险写入' },
  { value: 'confirm', label: 'Manual', desc: '操作前手动确认' },
]

const current = computed(() => modes.find(m => m.value === settings.toolPermissionMode) ?? modes[2])

async function cycleMode() {
  const index = modes.findIndex(m => m.value === settings.toolPermissionMode)
  const next = modes[(index + 1) % modes.length]
  await settings.setToolPermissionMode(next.value)
}
</script>

<template>
  <button
    @click="cycleMode"
    class="w-[68px] px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors text-center"
    :class="settings.toolPermissionMode === 'yolo'
      ? 'border-amber-500/40 text-amber-500 bg-amber-500/10'
      : settings.toolPermissionMode === 'auto'
        ? 'border-app-accent-soft-border text-app-accent bg-app-accent-soft/30'
        : 'border-app-border text-app-muted hover:text-app-heading hover:bg-app-hover'"
    :title="current.desc"
  >
    {{ current.label }}
  </button>
</template>
