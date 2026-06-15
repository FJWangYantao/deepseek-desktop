<script setup lang="ts">
defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <Transition name="tool-confirm">
    <div
      v-if="visible"
      class="px-6 pb-2"
    >
      <div class="max-w-[860px] mx-auto">
        <div
          class="rounded-xl border shadow-lg overflow-hidden
                 bg-app-card/95 backdrop-blur-xl border-emerald-500/30"
        >
          <!-- 头部 -->
          <div class="flex items-center gap-2 px-4 py-2.5 border-b border-emerald-500/20">
            <span class="flex items-center justify-center w-4 h-4 text-emerald-500">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l2 2 4-4" />
              </svg>
            </span>
            <span class="text-xs font-medium text-app-heading">计划已生成</span>
            <span class="mx-1 text-app-muted text-xs">·</span>
            <span class="text-xs text-app-muted">是否开始执行？</span>
          </div>

          <!-- 操作区 -->
          <div class="flex items-center justify-end gap-2 px-4 py-2">
            <button
              @click="emit('cancel')"
              class="text-xs px-3.5 py-1.5 rounded-lg border border-app-border text-app-muted
                     hover:bg-app-hover hover:text-app-heading transition-colors"
            >
              再改改
            </button>
            <button
              @click="emit('confirm')"
              class="text-xs px-3.5 py-1.5 rounded-lg bg-emerald-500 text-white
                     hover:bg-emerald-600 transition-colors flex items-center gap-1"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              执行
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
