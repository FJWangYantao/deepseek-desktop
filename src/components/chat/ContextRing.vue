<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue'

const props = defineProps<{
  percentage: number
  tokenCount: number
  contextLength: number
  messageCount: number
}>()

const showPanel = ref(false)
const ringEl = ref<HTMLElement | null>(null)
const panelPos = ref({ x: 0, y: 0 })

const radius = 10
const circumference = 2 * Math.PI * radius
const stroke = 2.5

const dashOffset = computed(() => {
  const pct = Math.min(100, Math.max(0, props.percentage))
  return circumference * (1 - pct / 100)
})

const ringColor = computed(() => {
  if (props.percentage < 50) return '#22c55e'
  if (props.percentage < 80) return '#eab308'
  return '#ef4444'
})

const barWidth = computed(() => Math.min(100, props.percentage))

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

const pctDisplay = computed(() => {
  if (props.percentage < 0.01) return '0'
  if (props.percentage < 1) return props.percentage.toFixed(2)
  if (props.percentage < 10) return props.percentage.toFixed(1)
  return Math.round(props.percentage).toString()
})

const remaining = computed(() => Math.max(0, props.contextLength - props.tokenCount))

const displayPct = computed(() => {
  if (props.percentage < 1) return '<1'
  return Math.round(props.percentage).toString()
})

function updatePos() {
  if (!ringEl.value) return
  const rect = ringEl.value.getBoundingClientRect()
  panelPos.value = {
    x: rect.left + rect.width / 2,
    y: rect.top - 8,
  }
}

function onEnter() {
  updatePos()
  showPanel.value = true
}

function onLeave() {
  showPanel.value = false
}

// 窗口滚动/resize 时更新位置
window.addEventListener('scroll', updatePos, true)
window.addEventListener('resize', updatePos)
onBeforeUnmount(() => {
  window.removeEventListener('scroll', updatePos, true)
  window.removeEventListener('resize', updatePos)
})
</script>

<template>
  <div
    ref="ringEl"
    class="flex items-center"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <svg width="28" height="28" viewBox="0 0 28 28" class="cursor-pointer">
      <circle cx="14" cy="14" :r="radius" fill="none"
        stroke="var(--app-border)" :stroke-width="stroke" />
      <circle cx="14" cy="14" :r="radius" fill="none"
        :stroke="ringColor" :stroke-width="stroke"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        transform="rotate(-90 14 14)"
        style="transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease" />
      <text x="14" y="17.5" text-anchor="middle"
        font-size="7" font-weight="600" :fill="ringColor">{{ displayPct }}</text>
    </svg>
  </div>

  <Teleport to="body">
    <Transition name="panel">
      <div v-if="showPanel"
        class="fixed z-[9999] w-56 rounded-xl border border-app-border bg-app-card shadow-lg
               px-3.5 py-3 pointer-events-none"
        :style="{ left: panelPos.x + 'px', top: panelPos.y + 'px', transform: 'translate(-50%, -100%)' }">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] font-semibold text-app-heading">上下文窗口</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            :style="{ background: ringColor + '18', color: ringColor }">
            {{ pctDisplay }}%
          </span>
        </div>
        <div class="h-1.5 rounded-full bg-app-border mb-2.5 overflow-hidden">
          <div class="h-full rounded-full transition-all duration-500"
            :style="{ width: barWidth + '%', background: ringColor }" />
        </div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          <div>
            <div class="text-app-muted">已使用</div>
            <div class="font-medium text-app-heading">{{ fmt(tokenCount) }}</div>
          </div>
          <div>
            <div class="text-app-muted">总容量</div>
            <div class="font-medium text-app-heading">{{ fmt(contextLength) }}</div>
          </div>
          <div>
            <div class="text-app-muted">剩余</div>
            <div class="font-medium" :style="{ color: ringColor }">{{ fmt(remaining) }}</div>
          </div>
          <div>
            <div class="text-app-muted">消息数</div>
            <div class="font-medium text-app-heading">{{ messageCount }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.panel-enter-active { transition: opacity 0.12s ease, transform 0.12s ease; }
.panel-leave-active { transition: opacity 0.1s ease, transform 0.1s ease; }
.panel-enter-from, .panel-leave-to {
  opacity: 0;
}
.panel-enter-from {
  transform: translate(-50%, calc(-100% + 4px)) !important;
}
</style>
