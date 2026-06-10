<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import type { DailyStats } from '@/types'

const props = defineProps<{ data: DailyStats[] }>()

const maxTokens = computed(() => Math.max(...props.data.map(d => d.totalTokens), 1))
const tooltip = ref<{ show: boolean; d: DailyStats | null; x: number; y: number; right: boolean }>({ show: false, d: null, x: 0, y: 0, right: false })
onUnmounted(() => { tooltip.value.show = false })

function pct(tokens: number): string {
  if (tokens === 0) return '4px'
  return `${Math.max((tokens / maxTokens.value) * 100, 6)}%`
}

const TOOLTIP_W = 220 // 预估 tooltip 宽度

function updateTooltip(e: MouseEvent, d: DailyStats) {
  const right = e.clientX + TOOLTIP_W + 20 > window.innerWidth
  tooltip.value = { show: true, d, x: e.clientX, y: e.clientY, right }
}
function hideTooltip() {
  tooltip.value.show = false
}

const tooltipStyle = computed(() => {
  if (!tooltip.value.show) return { display: 'none' }
  const { x, y, right } = tooltip.value
  return right
    ? { right: (window.innerWidth - x + 12) + 'px', top: (y - 10) + 'px' }
    : { left: (x + 12) + 'px', top: (y - 10) + 'px' }
})

// 采样：避免标签堆叠
function shouldShowLabel(d: DailyStats, idx: number, total: number): boolean {
  if (idx === 0 || idx === total - 1) return true
  if (d.date.includes(' ')) {
    // 24h 模式：每 4 小时一个
    const hour = parseInt(d.date.slice(11, 13), 10)
    return hour % 4 === 0
  }
  // 30d 模式：月初 + 每 5 天
  return d.date.endsWith('-01') || idx % 5 === 0
}

function formatLabel(d: DailyStats): string {
  if (d.date.includes(' ')) return d.date.slice(11, 13) // HH
  return d.date.slice(5) // MM-DD
}
</script>

<template>
  <div v-if="data.length" class="relative">
    <div class="flex items-end gap-[1px] h-40">
      <div
        v-for="d in data"
        :key="d.date"
        class="flex-1 rounded-t-[3px] transition-colors cursor-pointer"
        :style="{ height: pct(d.totalTokens), backgroundColor: 'var(--app-accent)', opacity: d.totalTokens > 0 ? '0.8' : '0.15' }"
        @mouseenter="updateTooltip($event, d)"
        @mouseleave="hideTooltip"
        @mousemove="(e: MouseEvent) => updateTooltip(e, d)"
      />
    </div>
    <div class="relative h-4 mt-1">
      <template v-for="(d, idx) in data" :key="'l'+d.date">
        <span
          v-if="shouldShowLabel(d, idx, data.length)"
          class="absolute text-[10px] text-app-muted/60 tabular-nums -translate-x-1/2"
          :style="{ left: ((idx + 0.5) / data.length * 100) + '%' }"
        >{{ formatLabel(d) }}</span>
      </template>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltip.show && tooltip.d"
        class="fixed z-50 bg-app-input border border-app-border rounded-lg shadow-lg p-3 text-xs min-w-[200px] pointer-events-none"
        :style="tooltipStyle"
      >
        <p class="font-medium text-app-text mb-2">{{ tooltip.d.date }}</p>
        <div class="space-y-1 text-app-muted">
          <div class="flex justify-between">
            <span>费用</span>
            <span class="text-app-text font-medium">¥{{ tooltip.d.cost.toFixed(6) }}</span>
          </div>
          <div class="flex justify-between">
            <span>V4 Pro</span>
            <span class="text-app-text">{{ tooltip.d.proTokens.toLocaleString() }} tokens</span>
          </div>
          <div class="flex justify-between">
            <span>V4 Flash</span>
            <span class="text-app-text">{{ tooltip.d.flashTokens.toLocaleString() }} tokens</span>
          </div>
          <div class="flex justify-between">
            <span>缓存命中</span>
            <span class="text-app-text">
              {{ tooltip.d.cacheHitTokens.toLocaleString() }}
              <span v-if="tooltip.d.promptTokens > 0">({{ Math.round(tooltip.d.cacheHitTokens / tooltip.d.promptTokens * 100) }}%)</span>
            </span>
          </div>
          <div class="flex justify-between">
            <span>输入 / 输出</span>
            <span class="text-app-text">{{ tooltip.d.promptTokens.toLocaleString() }} / {{ tooltip.d.completionTokens.toLocaleString() }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
  <div v-else class="text-center text-app-muted text-sm py-12">暂无数据</div>
</template>
