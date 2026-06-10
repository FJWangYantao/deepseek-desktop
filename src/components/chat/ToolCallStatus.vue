<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ToolCallUIState } from '@/types'

const props = defineProps<{ calls: ToolCallUIState[] }>()

const expanded = ref<Record<string, boolean>>({})

function toggleExpand(callId: string) {
  expanded.value[callId] = !expanded.value[callId]
}

// ===== 图标 =====

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

// ===== 标签 =====

const toolLabels: Record<string, string> = {
  web_search: '搜索',
  web_fetch: '抓取网页',
  file_read: '读取文件',
  file_write: '写入文件',
}

function getLabel(name: string) {
  return toolLabels[name] || name
}

// ===== 参数摘要 =====

function getParamSummary(call: ToolCallUIState): string {
  const args = call.arguments
  if (args.query) return String(args.query)
  if (args.url) return String(args.url)
  if (args.path) return String(args.path)
  if (args.content && args.name) return String(args.name)
  // 取第一个有意义的参数值
  const firstVal = Object.values(args).find(v => typeof v === 'string' && v.length > 0)
  return firstVal ? String(firstVal).slice(0, 80) : ''
}

// ===== 结果摘要 =====

interface ResultSummary { text: string; detail: string }

function getResultSummary(call: ToolCallUIState): ResultSummary {
  if (call.status === 'running') return { text: '', detail: '' }
  if (call.status === 'pending') return { text: '', detail: '' }
  if (call.status === 'awaiting-approval') return { text: '等待确认', detail: '' }
  if (call.status === 'error') return { text: '', detail: call.error || '执行失败' }

  const result = call.result
  if (!result) return { text: '', detail: '' }

  if (!result.success) {
    return { text: '', detail: '失败' }
  }

  // 提取结果摘要
  const data = result.data || ''

  if (call.name === 'web_search') {
    // 匹配 [N] 格式的结果条目
    const matches = data.match(/^\[\d+\]/gm)
    const count = matches ? matches.length : 0
    if (count > 0) return { text: `返回 ${count} 条结果`, detail: result.truncated ? `已截断 / ${formatSize(result.totalSize)}` : formatSize(result.totalSize) }
    if (data === '未找到相关结果') return { text: '无结果', detail: '' }
    return { text: formatSize(result.totalSize), detail: '' }
  }

  if (call.name === 'web_fetch') {
    return { text: formatSize(result.totalSize), detail: result.truncated ? '已截断' : '' }
  }

  if (call.name === 'file_read') {
    return { text: formatSize(result.totalSize), detail: result.truncated ? '已截断' : '' }
  }

  if (call.name === 'file_write') {
    return { text: '写入成功', detail: formatSize(result.totalSize) }
  }

  return { text: formatSize(result.totalSize), detail: '' }
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}

// ===== 展开详情：结果展示文本 =====

function getResultDisplay(result: { data: string } | undefined): string {
  if (!result) return ''
  const data = result.data || ''
  // 截取前 2000 字符展示
  if (data.length > 2000) {
    return data.slice(0, 2000) + '\n\n…（结果已截断）'
  }
  return data
}

// 已完成的调用数量
const hasCompleted = computed(() => props.calls.some(c => c.status === 'completed'))
</script>

<template>
  <div v-if="calls.length > 0" class="select-none">
    <div
      v-for="call in calls"
      :key="call.callId"
      class="group"
    >
      <!-- 摘要行 -->
      <button
        class="w-full flex items-center gap-1.5 py-0.5 text-left transition-colors rounded -mx-1 px-1 hover:bg-app-hover"
        :class="call.status === 'error' ? 'text-app-muted' : 'text-app-muted'"
        @click="toggleExpand(call.callId)"
        :title="call.status === 'completed' ? '点击查看详情' : call.status === 'error' ? '点击查看错误详情' : ''"
      >
        <!-- 状态图标 -->
        <span v-if="call.status === 'running'" class="relative flex items-center justify-center w-3.5 h-3.5 shrink-0">
          <svg class="w-3.5 h-3.5 animate-spin text-app-accent" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-20" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-80" />
          </svg>
        </span>
        <span v-else-if="call.status === 'completed'" class="text-green-500 flex items-center justify-center w-3.5 h-3.5 shrink-0">
          <svg class="w-3.5 h-3.5 animate-bounce-done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <span v-else-if="call.status === 'error'" class="text-app-muted flex items-center justify-center w-3.5 h-3.5 shrink-0">
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </span>
        <span v-else-if="call.status === 'awaiting-approval'" class="text-amber-500 flex items-center justify-center w-3.5 h-3.5 shrink-0">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M12 2l10 18H2L12 2z" />
          </svg>
        </span>
        <span v-else class="flex items-center justify-center w-3.5 h-3.5 shrink-0 text-app-muted">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" :d="getIcon(call.name)" />
          </svg>
        </span>

        <!-- 工具名 -->
        <span class="text-xs font-medium text-app-heading">{{ getLabel(call.name) }}</span>

        <!-- 参数摘要 -->
        <span v-if="getParamSummary(call)" class="text-xs text-app-muted truncate max-w-[240px]">
          · "{{ getParamSummary(call) }}"
        </span>

        <!-- 分隔点 + 结果概要 -->
        <template v-if="getResultSummary(call).text">
          <span class="text-app-muted opacity-40">—</span>
          <span class="text-xs text-app-muted">{{ getResultSummary(call).text }}</span>
          <span v-if="getResultSummary(call).detail" class="text-[10px] text-app-muted opacity-60">{{ getResultSummary(call).detail }}</span>
        </template>

        <!-- 展开/收起指示 -->
        <svg
          class="w-3 h-3 text-app-muted opacity-0 group-hover:opacity-100 transition-all ml-auto shrink-0"
          :class="{ 'rotate-180 opacity-60!': expanded[call.callId] }"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <!-- 展开详情 -->
      <Transition name="tool-expand">
        <div
          v-if="expanded[call.callId]"
          class="ml-5 mt-1.5 mb-2 pl-3 border-l-2 border-app-accent-soft-border"
        >
        <!-- 参数 -->
        <div class="mb-2">
          <div class="text-[10px] text-app-muted uppercase tracking-wide mb-1">参数</div>
          <div class="space-y-0.5">
            <div
              v-for="(value, key) in call.arguments"
              :key="key"
              class="flex gap-2 text-xs"
            >
              <span class="text-app-muted shrink-0">{{ key }}:</span>
              <span class="text-app-text break-all">{{ value }}</span>
            </div>
          </div>
        </div>

        <!-- 结果 -->
        <div v-if="call.result">
          <div class="text-[10px] text-app-muted uppercase tracking-wide mb-1">结果</div>
          <div
            v-if="getResultDisplay(call.result)"
            class="text-xs text-app-text whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-[1.6]"
          >{{ getResultDisplay(call.result) }}</div>
          <span v-else class="text-xs text-app-muted">(空)</span>
        </div>

        <!-- 错误 -->
        <div v-if="call.error" class="text-xs text-red-400">{{ call.error }}</div>
      </div>
      </Transition>
    </div>
  </div>
</template>
