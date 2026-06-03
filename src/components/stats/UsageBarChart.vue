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
    <div class="flex gap-[1px] mt-1">
      <div v-for="d in data" :key="'l'+d.date" class="flex-1 text-[9px] text-app-muted text-center">
        <template v-if="d.date.includes(' ')">{{ d.date.slice(11, 16) }}</template>
        <template v-else>{{ d.date.endsWith('-01') || d.date === data[0]?.date || d.date === data[data.length-1]?.date ? d.date.slice(5) : '' }}</template>
      </div>
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
