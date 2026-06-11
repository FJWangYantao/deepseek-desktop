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

// 工具图标 SVG path
const toolIcons: Record<string, string> = {
  web_search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  web_fetch: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  file_read: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  file_write: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
}

const defaultToolIcon = 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z'

function getIcon(name: string) {
  return toolIcons[name] || defaultToolIcon
}
</script>

<template>
  <Transition name="tool-confirm">
    <div
      v-if="visible && info"
      class="px-6 pb-2"
    >
      <div class="max-w-[860px] mx-auto">
        <div
          class="rounded-xl border shadow-lg overflow-hidden
                 bg-app-card/95 backdrop-blur-xl border-app-accent-soft-border"
        >
          <!-- 头部：工具名 + 警告标识 -->
          <div class="flex items-center gap-2 px-4 py-2.5 border-b border-app-accent-soft-border/50">
            <span class="flex items-center justify-center w-4 h-4 text-amber-500">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M12 2l10 18H2L12 2z" />
              </svg>
            </span>
            <span class="text-xs font-medium text-app-heading">工具权限确认</span>
            <span class="mx-1 text-app-muted text-xs">·</span>
            <svg class="w-3.5 h-3.5 text-app-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" :d="getIcon(info.name)" />
            </svg>
            <span class="text-xs font-medium text-app-accent">{{ getLabel(info.name) }}</span>
          </div>

          <!-- 内容区：参数预览 -->
          <div class="px-4 py-2.5">
            <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <template v-for="(value, key) in info.arguments" :key="key">
                <span class="text-app-muted font-medium shrink-0">{{ key }}</span>
                <span class="text-app-text break-all line-clamp-2">{{ value }}</span>
              </template>
            </div>
            <p v-if="info.reason" class="text-[11px] text-amber-600/80 mt-1.5">
              {{ info.reason }}
            </p>
          </div>

          <!-- 操作区 -->
          <div class="flex items-center justify-end gap-2 px-4 py-2 border-t border-app-border-light/50">
            <button
              @click="emit('deny')"
              class="text-xs px-3.5 py-1.5 rounded-lg border border-app-border text-app-muted
                     hover:bg-app-hover hover:text-app-heading transition-colors"
            >
              拒绝
            </button>
            <button
              @click="emit('approve')"
              class="text-xs px-3.5 py-1.5 rounded-lg bg-app-accent text-white
                     hover:bg-app-accent-hover transition-colors"
            >
              允许执行
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
