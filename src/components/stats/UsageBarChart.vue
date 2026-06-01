<script setup lang="ts">
import { computed } from 'vue'
import type { DailyStats } from '@/types'

const props = defineProps<{ data: DailyStats[] }>()

const maxTokens = computed(() => Math.max(...props.data.map(d => d.totalTokens), 1))

function pct(tokens: number): string {
  return `${Math.max((tokens / maxTokens.value) * 100, 2)}%`
}
</script>

<template>
  <div v-if="data.length" class="flex items-end gap-0.5 h-40">
    <div
      v-for="d in data"
      :key="d.date"
      class="flex-1 rounded-t-[3px] transition-colors"
      :style="{ height: pct(d.totalTokens), backgroundColor: 'var(--app-accent)', opacity: '0.8' }"
      :title="`${d.date}: ${d.totalTokens.toLocaleString()} tokens`"
    />
  </div>
  <div v-else class="text-center text-app-muted text-sm py-12">暂无数据</div>
</template>
