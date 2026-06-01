<script setup lang="ts">
import { ref, computed } from 'vue'
import type { UsageRecord } from '@/types'

const props = defineProps<{ data: UsageRecord[] }>()

const sortKey = ref<string>('timestamp')
const sortDir = ref<'asc' | 'desc'>('desc')

function setSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

const sorted = computed(() => {
  const arr = [...props.data]
  const k = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  arr.sort((a, b) => {
    const va = k === 'cost' ? a.cost : k === 'prompt' ? a.usage.prompt_tokens : k === 'completion' ? a.usage.completion_tokens : k === 'cache' ? a.usage.prompt_cache_hit_tokens : (a as any)[k]
    const vb = k === 'cost' ? b.cost : k === 'prompt' ? b.usage.prompt_tokens : k === 'completion' ? b.usage.completion_tokens : k === 'cache' ? b.usage.prompt_cache_hit_tokens : (b as any)[k]
    return (va - vb) * dir
  })
  return arr
})

function arrow(key: string): string {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? ' ↑' : ' ↓'
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtCost(c: number): string {
  return '¥' + c.toFixed(6)
}
</script>

<template>
  <div v-if="data.length" class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-app-border text-app-muted text-xs">
          <th class="text-left py-2 px-2 cursor-pointer hover:text-app-heading" @click="setSort('timestamp')">时间{{ arrow('timestamp') }}</th>
          <th class="text-left py-2 px-2 cursor-pointer hover:text-app-heading" @click="setSort('model')">模型{{ arrow('model') }}</th>
          <th class="text-right py-2 px-2 cursor-pointer hover:text-app-heading" @click="setSort('prompt')">输入{{ arrow('prompt') }}</th>
          <th class="text-right py-2 px-2 cursor-pointer hover:text-app-heading" @click="setSort('completion')">输出{{ arrow('completion') }}</th>
          <th class="text-right py-2 px-2 cursor-pointer hover:text-app-heading" @click="setSort('cache')">缓存命中{{ arrow('cache') }}</th>
          <th class="text-right py-2 px-2 cursor-pointer hover:text-app-heading" @click="setSort('cost')">费用{{ arrow('cost') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in sorted" :key="row.id" class="border-b border-app-border-light hover:bg-app-hover transition-colors">
          <td class="py-2 px-2 text-app-muted text-xs whitespace-nowrap">{{ fmtTime(row.timestamp) }}</td>
          <td class="py-2 px-2 text-app-muted text-xs">{{ row.model === 'deepseek-v4-pro' ? 'V4 Pro' : row.model === 'deepseek-v4-flash' ? 'V4 Flash' : row.model }}</td>
          <td class="py-2 px-2 text-app-text text-right tabular-nums">{{ row.usage.prompt_tokens.toLocaleString() }}</td>
          <td class="py-2 px-2 text-app-text text-right tabular-nums">{{ row.usage.completion_tokens.toLocaleString() }}</td>
          <td class="py-2 px-2 text-right tabular-nums" :class="row.usage.prompt_cache_hit_tokens > 0 ? 'text-green-600' : 'text-app-muted'">{{ row.usage.prompt_cache_hit_tokens.toLocaleString() }}</td>
          <td class="py-2 px-2 text-app-text text-right tabular-nums">{{ fmtCost(row.cost) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-else class="text-center text-app-muted text-sm py-12">暂无数据</div>
</template>
