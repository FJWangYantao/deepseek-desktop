<script setup lang="ts">
import { computed } from 'vue'
import type { DailyStats } from '@/types'

const props = defineProps<{ data: Map<string, DailyStats> }>()

const weeks = computed(() => {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  start.setDate(start.getDate() - 365)
  // align to Monday
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  end.setDate(end.getDate() + (day === 0 ? 0 : 7 - end.getDay()))

  const result: { date: string; level: number; tokens: number }[][] = []
  const cur = new Date(start)
  let week: { date: string; level: number; tokens: number }[] = []
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    const entry = props.data.get(key)
    const tokens = entry?.totalTokens ?? 0
    week.push({ date: key, level: 0, tokens })
    if (cur.getDay() === 0) {
      result.push(week)
      week = []
    }
    cur.setDate(cur.getDate() + 1)
  }
  if (week.length) result.push(week)

  // 计算色阶
  let maxTokens = 0
  for (const w of result) for (const d of w) if (d.tokens > maxTokens) maxTokens = d.tokens
  for (const w of result) {
    for (const d of w) {
      d.level = maxTokens > 0 ? Math.ceil((d.tokens / maxTokens) * 4) : 0
    }
  }

  return result
})

function levelColor(lv: number): string {
  if (lv === 0) return 'var(--app-border-light)'
  const colors = [
    'color-mix(in srgb, var(--app-accent) 25%, transparent)',
    'color-mix(in srgb, var(--app-accent) 50%, transparent)',
    'color-mix(in srgb, var(--app-accent) 75%, transparent)',
    'var(--app-accent)',
  ]
  return colors[lv - 1]
}
</script>

<template>
  <div class="overflow-x-auto">
    <div class="flex gap-[2px] min-w-max">
      <div v-for="(week, wi) in weeks" :key="wi" class="flex flex-col gap-[2px]">
        <div
          v-for="(day, di) in week"
          :key="di"
          class="w-3 h-3 rounded-[2px]"
          :style="{ backgroundColor: levelColor(day.level) }"
          :title="`${day.date}: ${day.tokens.toLocaleString()} tokens`"
        />
      </div>
    </div>
  </div>
</template>
