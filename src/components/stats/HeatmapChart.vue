<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import type { DailyStats } from '@/types'

const props = defineProps<{ data: Map<string, DailyStats> }>()

const tooltip = ref<{ show: boolean; date: string; tokens: number; cost: number; x: number; y: number; right: boolean }>({ show: false, date: '', tokens: 0, cost: 0, x: 0, y: 0, right: false })
onUnmounted(() => { tooltip.value.show = false })

const TT_W = 200

function show(e: MouseEvent, day: { date: string; tokens: number }) {
  const entry = props.data.get(day.date)
  const right = e.clientX + TT_W + 20 > window.innerWidth
  tooltip.value = { show: true, date: day.date, tokens: day.tokens, cost: entry?.cost ?? 0, x: e.clientX, y: e.clientY, right }
}
function move(e: MouseEvent) {
  const right = e.clientX + TT_W + 20 > window.innerWidth
  tooltip.value.x = e.clientX; tooltip.value.y = e.clientY; tooltip.value.right = right
}
function hide() { tooltip.value.show = false }

const ttStyle = computed(() => {
  if (!tooltip.value.show) return { display: 'none' }
  const { x, y, right } = tooltip.value
  return right
    ? { right: (window.innerWidth - x + 12) + 'px', top: (y - 10) + 'px' }
    : { left: (x + 12) + 'px', top: (y - 10) + 'px' }
})

const weeks = computed(() => {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  start.setDate(start.getDate() - 365)
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
    if (cur.getDay() === 0) { result.push(week); week = [] }
    cur.setDate(cur.getDate() + 1)
  }
  if (week.length) result.push(week)

  let maxTokens = 0
  for (const w of result) for (const d of w) if (d.tokens > maxTokens) maxTokens = d.tokens
  for (const w of result) for (const d of w) d.level = maxTokens > 0 ? Math.ceil((d.tokens / maxTokens) * 4) : 0

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
          class="w-3 h-3 rounded-[2px] cursor-pointer"
          :style="{ backgroundColor: levelColor(day.level) }"
          @mouseenter="show($event, day)"
          @mouseleave="hide"
          @mousemove="move"
        />
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="tooltip.show"
        class="fixed z-50 bg-app-input border border-app-border rounded-lg shadow-lg p-2.5 text-xs pointer-events-none"
        :style="ttStyle"
      >
        <p class="font-medium text-app-text mb-1">{{ tooltip.date }}</p>
        <div class="text-app-muted space-y-0.5">
          <div class="flex justify-between gap-4">
            <span>Tokens</span>
            <span class="text-app-text">{{ tooltip.tokens.toLocaleString() }}</span>
          </div>
          <div class="flex justify-between gap-4">
            <span>费用</span>
            <span class="text-app-text">¥{{ tooltip.cost.toFixed(6) }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
