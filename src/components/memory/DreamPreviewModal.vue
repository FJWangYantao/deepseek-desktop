<script setup lang="ts">
import { ref, computed } from 'vue'
import type { DreamPreview, DreamPreviewOp } from '@/types/memory'

const props = defineProps<{
  preview: DreamPreview
}>()

const emit = defineEmits<{
  approve: [preview: DreamPreview]
  approveSelected: [preview: DreamPreview, selectedIds: number[]]
  reject: []
}>()

const expandedOps = ref<Set<number>>(new Set())
const selectedOps = ref<Set<number>>(new Set())
const batchMode = ref(false)

const layerLabel: Record<string, string> = { short: '短期', medium: '中期', long: '长期' }

const typeIcon: Record<DreamPreviewOp['type'], { color: string; icon: string }> = {
  merge:   { color: 'text-amber-600 bg-amber-100', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
  reclassify: { color: 'text-blue-600 bg-blue-100', icon: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4' },
  delete:  { color: 'text-red-600 bg-red-100', icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' },
  new:     { color: 'text-emerald-600 bg-emerald-100', icon: 'M12 6v6m0 0v6m0-6h6m-6 0H6' },
}

function toggleExpand(idx: number) {
  if (expandedOps.value.has(idx)) {
    expandedOps.value.delete(idx)
  } else {
    expandedOps.value.add(idx)
  }
}

function toggleSelect(idx: number) {
  if (selectedOps.value.has(idx)) {
    selectedOps.value.delete(idx)
  } else {
    selectedOps.value.add(idx)
  }
}

function selectAll() {
  for (let i = 0; i < props.preview.operations.length; i++) {
    selectedOps.value.add(i)
  }
}

function deselectAll() {
  selectedOps.value = new Set()
}

function handleApproveAll() {
  emit('approve', props.preview)
}

function handleApproveSelected() {
  emit('approveSelected', props.preview, [...selectedOps.value])
}

const byType = computed(() => {
  const groups: Record<string, number> = { merge: 0, reclassify: 0, delete: 0, new: 0 }
  for (const op of props.preview.operations) {
    groups[op.type]++
  }
  return groups
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('reject')">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col mx-4 overflow-hidden">
      <!-- 头部 -->
      <div class="px-5 py-4 border-b flex items-center justify-between shrink-0">
        <div>
          <h3 class="text-sm font-semibold text-gray-900">记忆整理预览</h3>
          <p class="text-xs text-gray-500 mt-0.5">
            从 {{ preview.beforeCount }} 条 → {{ preview.afterCount }} 条，
            共 {{ preview.operations.length }} 个操作
          </p>
        </div>
        <button @click="emit('reject')" class="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 类型统计 -->
      <div class="px-5 py-2 flex items-center gap-3 text-[10px] text-gray-500 shrink-0">
        <span v-if="byType.merge" class="text-amber-600">合并 {{ byType.merge }}</span>
        <span v-if="byType.reclassify" class="text-blue-600">重分类 {{ byType.reclassify }}</span>
        <span v-if="byType.delete" class="text-red-600">删除 {{ byType.delete }}</span>
        <span v-if="byType.new" class="text-emerald-600">新增 {{ byType.new }}</span>
      </div>

      <!-- 操作列表 -->
      <div class="flex-1 overflow-y-auto px-5 py-2 space-y-1.5">
        <div
          v-for="(op, idx) in preview.operations"
          :key="idx"
          class="border rounded-lg overflow-hidden transition-colors"
          :class="selectedOps.has(idx) ? 'border-app-accent bg-app-accent-soft/30' : 'border-gray-200 bg-gray-50/50'"
        >
          <div class="flex items-center gap-2 px-3 py-2">
            <!-- 逐条审批勾选 -->
            <button
              v-if="batchMode"
              @click="toggleSelect(idx)"
              class="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors"
              :class="selectedOps.has(idx)
                ? 'bg-app-accent border-app-accent text-white'
                : 'border-gray-300 hover:border-gray-400'"
            >
              <svg v-if="selectedOps.has(idx)" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <!-- 类型图标 -->
            <span class="w-6 h-6 rounded-full flex items-center justify-center shrink-0" :class="typeIcon[op.type].color">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="typeIcon[op.type].icon" />
              </svg>
            </span>
            <!-- 描述 -->
            <button @click="toggleExpand(idx)" class="flex-1 text-left min-w-0">
              <span class="text-xs text-gray-700 truncate block">{{ op.description }}</span>
            </button>
            <!-- 展开箭头 -->
            <button @click="toggleExpand(idx)" class="shrink-0">
              <svg
                class="w-3.5 h-3.5 text-gray-400 transition-transform"
                :class="{ 'rotate-180': expandedOps.has(idx) }"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          <!-- 展开详情 -->
          <div v-if="expandedOps.has(idx)" class="px-4 pb-3 border-t border-gray-100">
            <div class="mt-2 space-y-1 text-[10px]">
              <template v-if="op.type === 'merge'">
                <p class="text-gray-500">合并来源：<span class="text-gray-700">{{ op.targetIds.join(', ') }}</span></p>
                <p class="text-gray-500">结果：<span class="text-gray-700">{{ op.resultContent }}</span></p>
                <p class="text-gray-500">层级：<span class="text-gray-700">{{ layerLabel[op.resultLayer || 'short'] }}</span> · 分类：<span class="text-gray-700">{{ op.resultCategory }}</span></p>
              </template>
              <template v-if="op.type === 'reclassify'">
                <p class="text-gray-500">目标 ID：<span class="text-gray-700">{{ op.targetIds[0] }}</span></p>
                <p class="text-gray-500">新层级：<span class="text-gray-700">{{ layerLabel[op.resultLayer || 'short'] }}</span></p>
              </template>
              <template v-if="op.type === 'delete'">
                <p class="text-gray-500">删除 ID：<span class="text-gray-700">{{ op.targetIds.join(', ') }}</span></p>
              </template>
              <template v-if="op.type === 'new'">
                <p class="text-gray-500">新增内容：<span class="text-gray-700">{{ op.resultContent }}</span></p>
                <p class="text-gray-500">层级：<span class="text-gray-700">{{ layerLabel[op.resultLayer || 'short'] }}</span> · 分类：<span class="text-gray-700">{{ op.resultCategory }}</span></p>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="px-5 py-3 border-t flex items-center justify-between shrink-0">
        <button
          @click="batchMode = !batchMode"
          class="text-xs px-2 py-1 rounded transition-colors"
          :class="batchMode ? 'bg-app-accent-soft text-app-accent' : 'text-gray-500 hover:text-gray-700'"
        >逐条审批</button>
        <div v-if="batchMode" class="flex items-center gap-1.5">
          <button @click="selectAll" class="text-[10px] text-app-accent hover:underline">全选</button>
          <span class="text-gray-300">|</span>
          <button @click="deselectAll" class="text-[10px] text-app-accent hover:underline">取消全选</button>
          <button
            @click="handleApproveSelected"
            :disabled="selectedOps.size === 0"
            class="text-xs px-3 py-1 rounded bg-app-accent text-white hover:bg-app-accent-hover disabled:opacity-40 transition-colors"
          >审批选中 ({{ selectedOps.size }})</button>
        </div>
        <div v-else class="flex items-center gap-2">
          <button
            @click="emit('reject')"
            class="text-xs px-4 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
          >全部拒绝</button>
          <button
            @click="handleApproveAll"
            class="text-xs px-4 py-1.5 rounded-lg bg-app-accent text-white hover:bg-app-accent-hover transition-colors"
          >全部确认</button>
        </div>
      </div>
    </div>
  </div>
</template>
