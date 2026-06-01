<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  thinking: string
}>()

const expanded = ref(false)
</script>

<template>
  <div class="mb-3">
    <button
      @click="expanded = !expanded"
      class="flex items-center gap-1.5 text-xs text-app-muted hover:text-app-heading transition-colors"
    >
      <svg
        class="w-3.5 h-3.5 transition-transform"
        :class="{ 'rotate-90': expanded }"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
      思考过程
    </button>
    <div
      v-if="expanded"
      class="mt-2 p-3 bg-amber-50/50 rounded-lg border border-amber-100/50 text-app-muted text-xs
             whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto"
    >
      {{ thinking }}
    </div>
  </div>
</template>
