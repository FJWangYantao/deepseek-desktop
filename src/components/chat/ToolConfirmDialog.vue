<script setup lang="ts">
import { ref, watch } from 'vue'

export interface ApprovalInfo {
  callId: string
  name: string
  arguments: Record<string, unknown>
  reason: string
}

const props = defineProps<{
  info: ApprovalInfo | null
}>()

const emit = defineEmits<{
  approve: []
  deny: []
}>()

const visible = ref(false)

watch(() => props.info, (val) => {
  visible.value = !!val
})

const toolLabels: Record<string, string> = {
  web_search: '网页搜索',
  web_fetch: '网页抓取',
  file_read: '读取文件',
  file_write: '写入文件',
}

function getLabel(name: string) {
  return toolLabels[name] || name
}
</script>

<template>
  <div
    v-if="visible && info"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @click.self="emit('deny')"
  >
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
      <div class="flex items-center gap-2 mb-3">
        <svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <h3 class="text-sm font-semibold text-gray-900">工具权限确认</h3>
      </div>

      <p class="text-sm text-gray-600 mb-3">
        AI 请求执行 <span class="font-medium text-gray-900">{{ getLabel(info.name) }}</span>
      </p>

      <div class="bg-gray-50 rounded-lg p-3 mb-4 text-xs space-y-1">
        <div v-for="(value, key) in info.arguments" :key="key" class="flex gap-2">
          <span class="text-gray-500 shrink-0">{{ key }}:</span>
          <span class="text-gray-800 break-all">{{ value }}</span>
        </div>
      </div>

      <p class="text-xs text-amber-600 mb-5">{{ info.reason }}</p>

      <div class="flex items-center justify-end gap-2">
        <button
          @click="emit('deny')"
          class="text-xs px-4 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
        >拒绝</button>
        <button
          @click="emit('approve')"
          class="text-xs px-4 py-1.5 rounded-lg bg-app-accent text-white hover:bg-app-accent-hover transition-colors"
        >允许执行</button>
      </div>
    </div>
  </div>
</template>
