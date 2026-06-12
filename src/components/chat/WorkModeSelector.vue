<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { workModes } from '@/data/workModes'

const settings = useSettingsStore()

const current = computed(() =>
  workModes.find(m => m.value === settings.workMode) ?? workModes[0]
)

async function cycleMode() {
  const index = workModes.findIndex(m => m.value === settings.workMode)
  const next = workModes[(index + 1) % workModes.length]
  await settings.setWorkMode(next.value)
}
</script>

<template>
  <button
    @click="cycleMode"
    class="w-[68px] px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors text-center"
    :class="settings.workMode === 'plan'
      ? 'border-blue-500/40 text-blue-500 bg-blue-500/10'
      : settings.workMode === 'react'
        ? 'border-purple-500/40 text-purple-500 bg-purple-500/10'
        : 'border-app-border text-app-muted hover:text-app-heading hover:bg-app-hover'"
    :title="current.desc"
  >
    {{ current.label }}
  </button>
</template>
