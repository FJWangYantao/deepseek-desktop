<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  thinking: string
}>()

const expanded = ref(false)

const thinkCount = computed(() => {
  const lines = props.thinking.trim().split('\n').length
  const chars = props.thinking.length
  if (chars > 500) return `${lines} 行 · ${Math.round(chars / 100) / 10}k 字`
  return `${chars} 字`
})
</script>

<template>
  <div class="mb-4">
    <button
      @click="expanded = !expanded"
      class="flex items-center gap-2 text-xs text-app-muted hover:text-app-heading transition-colors group mb-2"
    >
      <svg
        class="w-3 h-3 transition-transform shrink-0"
        :class="{ 'rotate-90': expanded }"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
      <span class="font-medium">思考过程</span>
      <span class="text-[10px] opacity-60">{{ thinkCount }}</span>
    </button>
    <div
      v-if="expanded"
      class="relative pl-4 border-l-2 border-app-accent-soft-border text-xs text-app-muted leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto"
    >
      {{ thinking }}
    </div>
  </div>
</template>
