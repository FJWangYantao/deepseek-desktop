<script setup lang="ts">
import { watch } from 'vue'

const props = defineProps<{
  message: string
  type?: 'success' | 'error'
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

// 2 秒后自动隐藏
watch(() => props.visible, (val) => {
  if (val) {
    setTimeout(() => emit('update:visible', false), 2000)
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div
        v-if="visible"
        class="fixed bottom-6 right-6 z-[10001] flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-2xl text-sm font-medium border"
        :class="type === 'error'
          ? 'bg-red-50 border-red-200 text-red-600'
          : 'bg-app-card border-app-border text-app-accent'"
      >
        <svg v-if="type !== 'error'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
        {{ message }}
      </div>
    </Transition>
  </Teleport>
</template>
