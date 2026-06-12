<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Insight } from '@/types/notes'
import { useNotesStore } from '@/stores/notes'

const props = defineProps<{
  insight: Insight
}>()

const emit = defineEmits<{
  edit: [id: string]
  delete: [id: string]
  'drag-start': [id: string]
  'drag-end': []
}>()

const notesStore = useNotesStore()

/** 当前笔记所属的笔记本 */
const notebook = computed(() =>
  props.insight.notebookId
    ? notesStore.allNotebooks.find(nb => nb.id === props.insight.notebookId)
    : null
)

/** 是否为手动创建的笔记（content 为空 = 直接新建） */
const isManual = computed(() => !props.insight.content)

/** 卡片预览文本：优先 content，否则用 note 去除 markdown 符号后前 60 字 */
const previewText = computed(() => {
  if (props.insight.content) return props.insight.content
  const note = props.insight.note ?? ''
  if (!note.trim()) return ''
  return note.replace(/[#*`>\-\[\]\(\)!]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
})

/** 拖拽状态 */
const dragging = ref(false)
const collapsed = ref(false) // 延迟收缩，等浏览器截完 dragImage

function onDragStart(e: DragEvent) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('text/insight-id', props.insight.id)
  e.dataTransfer.effectAllowed = 'move'
  // 克隆整张卡片作为 dragImage — 跟随鼠标的是完整的卡片视觉
  const el = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
  if (el) {
    const clone = el.cloneNode(true) as HTMLElement
    clone.style.cssText = `
      position: absolute; top: -9999px; left: -9999px;
      width: ${el.offsetWidth}px;
      pointer-events: none;
      opacity: 0.92;
      box-shadow: 0 12px 40px rgba(0,0,0,0.16);
      transform: rotate(1.5deg);
      border-radius: 8px;
      background: var(--app-card);
    `
    document.body.appendChild(clone)
    // 保持鼠标在卡片中拖起的位置
    e.dataTransfer.setDragImage(clone, e.offsetX, e.offsetY)
    requestAnimationFrame(() => clone.remove())
  }
  dragging.value = true
  emit('drag-start', props.insight.id)
  // 延迟一帧再收缩：等浏览器截好 dragImage，否则拖拽会被取消
  requestAnimationFrame(() => {
    collapsed.value = true
  })
}

function onDragEnd() {
  dragging.value = false
  collapsed.value = false
  emit('drag-end')
}

/** 相对时间格式化 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

function confirmDelete() {
  if (confirm('确定删除这条笔记？')) {
    emit('delete', props.insight.id)
  }
}
</script>

<template>
  <div
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    class="insight-card bg-app-card border border-app-border rounded-lg px-3.5 py-3 group hover:border-app-accent-soft-border cursor-pointer"
    :class="collapsed ? 'is-dragging' : ''"
    @click="emit('edit', insight.id)"
  >
    <!-- 第一行：颜色点 + 内容预览 -->
    <div class="flex items-start gap-2.5">
      <span
        class="shrink-0 w-2.5 h-2.5 rounded-full mt-1.5"
        :style="{ backgroundColor: insight.color }"
      />
      <p
        v-if="previewText"
        class="text-sm text-app-text leading-relaxed line-clamp-2 flex-1 min-w-0"
      >
        {{ previewText }}
      </p>
      <p
        v-else
        class="text-sm text-app-muted/70 italic leading-relaxed flex-1 min-w-0"
      >
        （空白笔记）
      </p>
    </div>

    <!-- 第二行：标签 + 来源 + 时间 -->
    <div class="flex items-center justify-between mt-2">
      <div class="flex items-center gap-1.5 flex-wrap min-w-0">
        <!-- 笔记本徽章 -->
        <span
          v-if="notebook"
          class="text-[10px] px-1.5 py-0.5 rounded-full text-white shrink-0 inline-flex items-center gap-1"
          :style="{ backgroundColor: notebook.color }"
        >
          <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
              d="M19 11H5m14-7H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z" />
          </svg>
          {{ notebook.name }}
        </span>
        <!-- 标签 -->
        <span
          v-for="tag in insight.tags.slice(0, 3)"
          :key="tag"
          class="text-[10px] px-1.5 py-0.5 rounded-full bg-app-accent-soft text-app-accent shrink-0"
        >{{ tag }}</span>
        <span v-if="insight.tags.length > 3" class="text-[10px] text-app-muted">+{{ insight.tags.length - 3 }}</span>
        <!-- 来源 -->
        <span class="text-[10px] text-app-muted flex items-center gap-0.5">
          <svg v-if="isManual" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <svg v-else-if="insight.sourceRole === 'assistant'" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <svg v-else class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {{ isManual ? '手动' : insight.sourceRole === 'assistant' ? 'AI' : '用户' }}
        </span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <span class="text-[10px] text-app-muted">{{ relativeTime(insight.createdAt) }}</span>
        <!-- 操作按钮 -->
        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            @click.stop="emit('edit', insight.id)"
            class="w-6 h-6 flex items-center justify-center rounded text-app-muted hover:text-app-text hover:bg-app-hover"
            title="编辑"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            @click.stop="confirmDelete"
            class="w-6 h-6 flex items-center justify-center rounded text-app-muted hover:text-red-500 hover:bg-red-50"
            title="删除"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.insight-card {
  /* 平滑过渡：收缩/恢复动画 */
  transition:
    max-height 220ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 180ms ease,
    padding 220ms cubic-bezier(0.4, 0, 0.2, 1),
    margin 220ms cubic-bezier(0.4, 0, 0.2, 1),
    border-width 220ms ease;
  /* 默认给 max-height 一个足够大的值，方便从 0 恢复 */
  max-height: 200px;
}
.insight-card.is-dragging {
  /* 整块收缩为 0 — 下方卡片平滑滑动上来 */
  max-height: 0 !important;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-top: 0;
  margin-bottom: 0;
  border-width: 0;
  overflow: hidden;
  pointer-events: none;
  cursor: grabbing;
}
</style>
