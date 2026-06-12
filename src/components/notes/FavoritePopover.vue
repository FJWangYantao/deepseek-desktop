<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue'
import { INSIGHT_COLORS } from '@/types/notes'
import type { Notebook } from '@/types/notes'
import { useNotesStore } from '@/stores/notes'

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  selectedText: string
}>()

const emit = defineEmits<{
  saved: [data: { content: string; tags: string[]; color: string; notebookId: string | null }]
  cancel: []
}>()

const notesStore = useNotesStore()

const selectedColor = ref<string>(INSIGHT_COLORS[3]) // 默认蓝色
const tagInput = ref('')
const tags = ref<string[]>([])
const selectedNotebookId = ref<string | null>(null)
const popoverEl = ref<HTMLElement>()

// 笔记本扁平排序：父在前、子带 depth=1
const sortedNotebooks = computed(() => {
  const result: Array<{ nb: Notebook; depth: number }> = []
  for (const top of notesStore.topLevelNotebooks) {
    result.push({ nb: top, depth: 0 })
    for (const child of notesStore.childrenOf(top.id)) {
      result.push({ nb: child, depth: 1 })
    }
  }
  return result
})

// 弹出框定位：动态计算，避免超出屏幕
const popoverPos = ref({ left: '0px', top: '0px' })

watch(() => props.visible, async (val) => {
  if (!val) return
  await nextTick()
  const pw = 280 // popover 宽度（稍微加宽以容纳笔记本选择）
  const gap = 36  // 按钮下方间距
  let left = Math.min(props.position.x - pw / 2, window.innerWidth - pw - 12)
  left = Math.max(12, left)
  let top = props.position.y + gap
  // 检查是否超出底部
  const estimatedHeight = 280
  if (top + estimatedHeight > window.innerHeight) {
    top = props.position.y - estimatedHeight - 8
  }
  popoverPos.value = { left: `${left}px`, top: `${top}px` }
})

function addTag() {
  const tag = tagInput.value.trim()
  if (tag && !tags.value.includes(tag)) {
    tags.value = [...tags.value, tag]
  }
  tagInput.value = ''
}

function removeTag(index: number) {
  tags.value = tags.value.filter((_, i) => i !== index)
}

function save() {
  emit('saved', {
    content: props.selectedText.slice(0, 2000),
    tags: [...tags.value],
    color: selectedColor.value,
    notebookId: selectedNotebookId.value,
  })
  // 重置状态
  tags.value = []
  tagInput.value = ''
  selectedColor.value = INSIGHT_COLORS[3]
  selectedNotebookId.value = null
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addTag()
  }
  if (e.key === 'Escape') {
    emit('cancel')
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="fixed z-[10000] w-[280px] bg-app-card border border-app-border rounded-xl shadow-2xl overflow-hidden"
    :style="popoverPos"
    @mousedown.stop
  >
    <!-- 颜色选择 -->
    <div class="px-3 pt-3 pb-2">
      <div class="text-[11px] text-app-muted mb-2">选择颜色</div>
      <div class="flex items-center gap-2">
        <button
          v-for="color in INSIGHT_COLORS"
          :key="color"
          @click="selectedColor = color"
          class="w-6 h-6 rounded-full transition-transform"
          :class="selectedColor === color ? 'ring-2 ring-offset-2 ring-offset-app-card scale-110' : 'hover:scale-105'"
          :style="{ backgroundColor: color, '--tw-ring-color': selectedColor === color ? color : 'transparent' } as any"
        />
      </div>
    </div>

    <!-- 笔记本选择 -->
    <div v-if="notesStore.allNotebooks.length > 0" class="px-3 pb-2">
      <div class="text-[11px] text-app-muted mb-1.5">归入笔记本</div>
      <div class="flex flex-wrap gap-1">
        <button
          @click="selectedNotebookId = null"
          class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full transition-colors"
          :class="selectedNotebookId === null
            ? 'bg-app-accent-soft text-app-accent border border-app-accent-soft-border'
            : 'bg-app-surface-alt text-app-muted hover:text-app-text border border-transparent'"
        >
          不归类
        </button>
        <button
          v-for="item in sortedNotebooks"
          :key="item.nb.id"
          @click="selectedNotebookId = item.nb.id"
          class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full transition-colors"
          :class="selectedNotebookId === item.nb.id
            ? 'text-white'
            : 'bg-app-surface-alt text-app-muted hover:text-app-text border border-transparent'"
          :style="selectedNotebookId === item.nb.id ? { backgroundColor: item.nb.color } : {}"
        >
          <span v-if="item.depth === 1" class="text-[9px] opacity-70">└</span>
          <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ backgroundColor: item.nb.color }" />
          {{ item.nb.name }}
        </button>
      </div>
    </div>

    <!-- 标签输入 -->
    <div class="px-3 pb-2">
      <div class="text-[11px] text-app-muted mb-1.5">标签</div>
      <div class="flex flex-wrap gap-1 mb-1.5">
        <span
          v-for="(tag, i) in tags"
          :key="tag"
          class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-app-accent-soft text-app-accent"
        >
          {{ tag }}
          <button @click="removeTag(i)" class="hover:opacity-70">✕</button>
        </span>
      </div>
      <input
        v-model="tagInput"
        @keydown="handleKeydown"
        placeholder="输入标签，回车添加"
        class="w-full px-2 py-1.5 text-xs bg-app-input border border-app-border rounded-lg text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-accent"
      />
    </div>

    <!-- 操作按钮 -->
    <div class="flex items-center justify-end gap-2 px-3 pb-3">
      <button
        @click="emit('cancel')"
        class="px-3 py-1.5 text-xs rounded-lg text-app-muted hover:text-app-text hover:bg-app-hover transition-colors"
      >
        取消
      </button>
      <button
        @click="save"
        class="px-3 py-1.5 text-xs font-medium rounded-lg text-white transition-colors"
        :style="{ backgroundColor: selectedColor }"
      >
        保存
      </button>
    </div>
  </div>
</template>
