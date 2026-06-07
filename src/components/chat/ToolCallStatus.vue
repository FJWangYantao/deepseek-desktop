<script setup lang="ts">
import { ref } from 'vue'
import type { ToolCallUIState } from '@/types'

const props = defineProps<{ calls: ToolCallUIState[] }>()

const expanded = ref<Record<string, boolean>>({})

function toggleExpand(callId: string) {
  expanded.value[callId] = !expanded.value[callId]
}

const toolIcons: Record<string, string> = {
  web_search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  web_fetch: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  file_read: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  file_write: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
}

function getIcon(name: string) {
  return toolIcons[name] || 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z'
}

const toolLabels: Record<string, string> = {
  web_search: '搜索',
  web_fetch: '抓取网页',
  file_read: '读取文件',
  file_write: '写入文件',
}

function getLabel(name: string) {
  return toolLabels[name] || name
}
</script>

<template>
  <div v-if="calls.length > 0" class="mb-4 space-y-2">
    <div
      v-for="call in calls"
      :key="call.callId"
      class="rounded-lg border border-app-border bg-app-card overflow-hidden text-xs"
    >
      <!-- 头部：工具名 + 状态 -->
      <button
        class="w-full flex items-center gap-2 px-3 py-2 hover:bg-app-hover transition-colors text-left"
        @click="toggleExpand(call.callId)"
      >
        <!-- 状态图标 -->
        <span v-if="call.status === 'running'" class="text-app-accent">
          <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </span>
        <span v-else-if="call.status === 'completed'" class="text-green-500">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <span v-else-if="call.status === 'error'" class="text-red-400">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
        <span v-else class="text-app-muted">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIcon(call.name)" />
          </svg>
        </span>

        <!-- 工具名 + 参数摘要 -->
        <span class="text-app-text font-medium">{{ getLabel(call.name) }}</span>
        <span v-if="call.arguments.query" class="text-app-muted truncate max-w-[200px]">
          {{ call.arguments.query }}
        </span>
        <span v-else-if="call.arguments.url" class="text-app-muted truncate max-w-[200px]">
          {{ call.arguments.url }}
        </span>
        <span v-else-if="call.arguments.path" class="text-app-muted truncate max-w-[200px]">
          {{ call.arguments.path }}
        </span>

        <!-- 展开/折叠箭头 -->
        <svg
          class="w-3 h-3 text-app-muted ml-auto transition-transform"
          :class="{ 'rotate-180': expanded[call.callId] }"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <!-- 展开详情 -->
      <div v-if="expanded[call.callId]" class="border-t border-app-border px-3 py-2 bg-app-surface-alt">
        <div class="text-app-muted mb-1">参数：</div>
        <pre class="text-app-text whitespace-pre-wrap break-all mb-2">{{ JSON.stringify(call.arguments, null, 2) }}</pre>
        <div v-if="call.result" class="text-app-muted mb-1">结果：</div>
        <pre
          v-if="call.result"
          class="text-app-text whitespace-pre-wrap break-all max-h-40 overflow-y-auto"
        >{{ call.result.data }}</pre>
        <div v-if="call.error" class="text-red-400 mt-1">{{ call.error }}</div>
      </div>
    </div>
  </div>
</template>
