<script setup lang="ts">
import { computed } from 'vue'
import type { TodoItem } from '@/types'

const props = defineProps<{
  items: TodoItem[]
}>()

// 工具图标 SVG path（与 ToolCallStatus 复用同套映射）
const toolIcons: Record<string, string> = {
  web_search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  web_fetch: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  file_read: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  file_write: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  list_dir: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
}
const defaultToolIcon = 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z'

function getIcon(name?: string) {
  return (name && toolIcons[name]) || defaultToolIcon
}

const doneCount = computed(() => props.items.filter(i => i.done).length)
const totalCount = computed(() => props.items.length)
const allDone = computed(() => totalCount.value > 0 && doneCount.value === totalCount.value)
</script>

<template>
  <div class="my-3 rounded-xl border border-app-border bg-app-surface-alt/50 overflow-hidden">
    <!-- 头部：进度 -->
    <div class="flex items-center gap-2 px-3.5 py-2 border-b border-app-border bg-app-hover/30">
      <svg class="w-3.5 h-3.5 text-app-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l2 2 4-4" />
      </svg>
      <span class="text-xs font-medium text-app-heading">执行计划</span>
      <span class="text-[11px] text-app-muted">{{ doneCount }}/{{ totalCount }}</span>
      <!-- 进度条 -->
      <div class="flex-1 h-1 rounded-full bg-app-border overflow-hidden ml-1">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="allDone ? 'bg-emerald-500' : 'bg-app-accent'"
          :style="{ width: totalCount > 0 ? (doneCount / totalCount * 100) + '%' : '0%' }"
        ></div>
      </div>
      <svg v-if="allDone" class="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>

    <!-- 待办项 -->
    <div class="px-2 py-1.5">
      <div
        v-for="item in items"
        :key="item.step"
        class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors"
        :class="item.done ? 'opacity-50' : ''"
      >
        <!-- 复选框 -->
        <span
          class="flex items-center justify-center w-4 h-4 rounded-full border-2 shrink-0 transition-all"
          :class="item.done
            ? 'bg-emerald-500 border-emerald-500'
            : 'border-app-border bg-transparent'"
        >
          <svg v-if="item.done" class="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>

        <!-- 步骤号 -->
        <span class="text-[10px] font-mono text-app-muted shrink-0 w-4 text-right">{{ item.step }}</span>

        <!-- 工具图标（可选） -->
        <svg
          v-if="item.tool"
          class="w-3 h-3 text-app-muted/60 shrink-0"
          fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" :d="getIcon(item.tool)" />
        </svg>

        <!-- 标题 -->
        <span
          class="text-xs leading-relaxed"
          :class="item.done ? 'text-app-muted line-through' : 'text-app-text'"
        >{{ item.title }}</span>
      </div>
    </div>
  </div>
</template>
