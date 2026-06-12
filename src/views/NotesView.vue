<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useNotesStore } from '@/stores/notes'
import { useMemory } from '@/composables/useMemory'
import { INSIGHT_COLORS } from '@/types/notes'
import type { Notebook } from '@/types/notes'
import InsightCard from '@/components/notes/InsightCard.vue'
import NotesToolbar from '@/components/notes/NotesToolbar.vue'
import ToastNotification from '@/components/notes/ToastNotification.vue'
import NoteEditor from '@/components/notes/NoteEditor.vue'

const router = useRouter()
const notesStore = useNotesStore()
const memory = useMemory()

// 视图模式：'list' 或 'edit'
const viewMode = ref<'list' | 'edit'>('list')
const activeInsightId = ref<string | null>(null)

// 当前选中的笔记本（null = 全部笔记）
const activeNotebookId = ref<string | null>(null)

// 笔记本管理 UI 状态
const showNewNotebook = ref(false)            // 顶级新建表单
const newSubNotebookParentId = ref<string | null>(null)  // 正在新建的子笔记本父 ID
const newNotebookName = ref('')
const newNotebookColor = ref<string>(INSIGHT_COLORS[3])
const editingNotebookId = ref<string | null>(null)
const editingNotebookName = ref('')
const notebookMenuId = ref<string | null>(null)
const expandedNotebooks = ref<Set<string>>(new Set())  // 展开的父笔记本
const newNotebookInputRef = ref<HTMLInputElement>()
const renameInputRef = ref<HTMLInputElement>()

// 拖拽状态
const dragOverNotebookId = ref<string | 'all' | null>(null)
const isDragging = ref(false)  // 是否有任何卡片正在被拖动（用于全局视觉提示）
let dragOverHoverTimer: ReturnType<typeof setTimeout> | null = null

// 筛选/搜索状态
const searchQuery = ref('')
const filterTag = ref<string | null>(null)
const filterColor = ref<string | null>(null)
const sortOrder = ref<'newest' | 'oldest'>('newest')

// 编辑模式元数据
const editTags = ref<string[]>([])
const editTagInput = ref('')
const editColor = ref('')
const editNotebookId = ref<string | null>(null)
const memoryContextForActive = ref('')

// Toast 状态
const toastVisible = ref(false)
const toastMessage = ref('')
const toastType = ref<'success' | 'error'>('success')

// 搜索防抖
const searchInput = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { searchQuery.value = val }, 200)
})

// 笔记本扁平排序（父在前，子带 depth=1） — 给编辑模式 chip 列表用
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

// 当前笔记本下的笔记
const filteredInsights = computed(() => {
  let list = notesStore.insights

  // 笔记本筛选
  if (activeNotebookId.value) {
    const node = notesStore.allNotebooks.find(nb => nb.id === activeNotebookId.value)
    if (node && node.parentId === null) {
      // 父：合并自身 + 所有子
      const childIds = notesStore.childrenOf(activeNotebookId.value).map(c => c.id)
      const allowed = new Set([activeNotebookId.value, ...childIds])
      list = list.filter(ins => ins.notebookId !== null && allowed.has(ins.notebookId))
    } else {
      // 子：只匹配自身
      list = list.filter(ins => ins.notebookId === activeNotebookId.value)
    }
  }

  // 文本搜索
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(ins =>
      ins.content.toLowerCase().includes(q) ||
      ins.note.toLowerCase().includes(q) ||
      ins.tags.some(t => t.toLowerCase().includes(q))
    )
  }

  // 标签筛选
  if (filterTag.value) {
    list = list.filter(ins => ins.tags.includes(filterTag.value!))
  }

  // 颜色筛选
  if (filterColor.value) {
    list = list.filter(ins => ins.color === filterColor.value)
  }

  // 排序
  return [...list].sort((a, b) =>
    sortOrder.value === 'newest'
      ? b.createdAt - a.createdAt
      : a.createdAt - b.createdAt
  )
})

// 当前编辑的 insight
const activeInsight = computed(() =>
  activeInsightId.value
    ? notesStore.insights.find(i => i.id === activeInsightId.value)
    : null
)

// 当前活动笔记本对象
const activeNotebook = computed(() =>
  activeNotebookId.value
    ? notesStore.allNotebooks.find(nb => nb.id === activeNotebookId.value)
    : null
)

// ========== 笔记本管理 ==========

function selectNotebook(id: string | null) {
  activeNotebookId.value = id
  notebookMenuId.value = null
}

function toggleExpand(id: string, e: Event) {
  e.stopPropagation()
  if (expandedNotebooks.value.has(id)) {
    expandedNotebooks.value.delete(id)
  } else {
    expandedNotebooks.value.add(id)
  }
  // 触发响应式
  expandedNotebooks.value = new Set(expandedNotebooks.value)
}

function startNewNotebook() {
  showNewNotebook.value = true
  newSubNotebookParentId.value = null
  newNotebookName.value = ''
  newNotebookColor.value = INSIGHT_COLORS[3]
  nextTick(() => newNotebookInputRef.value?.focus())
}

function startNewSubNotebook(parentId: string) {
  showNewNotebook.value = true
  newSubNotebookParentId.value = parentId
  newNotebookName.value = ''
  // 子笔记本继承父颜色作为默认
  const parent = notesStore.allNotebooks.find(nb => nb.id === parentId)
  newNotebookColor.value = parent?.color ?? INSIGHT_COLORS[3]
  // 自动展开父
  expandedNotebooks.value.add(parentId)
  expandedNotebooks.value = new Set(expandedNotebooks.value)
  notebookMenuId.value = null
  nextTick(() => newNotebookInputRef.value?.focus())
}

function confirmNewNotebook() {
  const name = newNotebookName.value.trim()
  if (!name) {
    cancelNewNotebook()
    return
  }
  const parentId = newSubNotebookParentId.value
  const nb = notesStore.createNotebook(name, newNotebookColor.value, parentId)
  showNewNotebook.value = false
  newSubNotebookParentId.value = null
  newNotebookName.value = ''
  // 自动切到新建的笔记本
  activeNotebookId.value = nb.id
  if (parentId) {
    expandedNotebooks.value.add(parentId)
    expandedNotebooks.value = new Set(expandedNotebooks.value)
  }
  showToast(`已创建「${name}」`, 'success')
}

function cancelNewNotebook() {
  showNewNotebook.value = false
  newSubNotebookParentId.value = null
  newNotebookName.value = ''
}

function startRename(id: string, currentName: string) {
  editingNotebookId.value = id
  editingNotebookName.value = currentName
  notebookMenuId.value = null
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

function confirmRename() {
  if (!editingNotebookId.value) return
  const name = editingNotebookName.value.trim()
  if (name) {
    notesStore.renameNotebook(editingNotebookId.value, name)
  }
  editingNotebookId.value = null
  editingNotebookName.value = ''
}

function cancelRename() {
  editingNotebookId.value = null
  editingNotebookName.value = ''
}

function handleDeleteNotebook(id: string) {
  const nb = notesStore.allNotebooks.find(n => n.id === id)
  if (!nb) return
  const directCount = notesStore.notebookCount(id)
  const children = notesStore.childrenOf(id)
  let msg = `确定删除笔记本「${nb.name}」吗？`
  const parts: string[] = []
  if (directCount > 0) parts.push(`其下 ${directCount} 条笔记将归入「全部笔记」`)
  if (children.length > 0) parts.push(`${children.length} 个子笔记本将提升为顶级`)
  if (parts.length > 0) msg += '\n' + parts.join('；') + '。'
  if (!confirm(msg)) return
  notesStore.deleteNotebook(id)
  if (activeNotebookId.value === id) {
    activeNotebookId.value = null
  }
  notebookMenuId.value = null
  showToast(`已删除「${nb.name}」`, 'success')
}

function toggleNotebookMenu(id: string, e: Event) {
  e.stopPropagation()
  notebookMenuId.value = notebookMenuId.value === id ? null : id
}

// ========== 拖拽接收 ==========

function onDragOverNotebook(id: string | 'all', e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  if (dragOverNotebookId.value !== id) {
    dragOverNotebookId.value = id
    // 悬停在父笔记本上 800ms 后自动展开（让用户能拖到子）
    if (dragOverHoverTimer) clearTimeout(dragOverHoverTimer)
    if (typeof id === 'string' && id !== 'all') {
      const node = notesStore.allNotebooks.find(nb => nb.id === id)
      if (node && node.parentId === null && notesStore.childrenOf(id).length > 0 && !expandedNotebooks.value.has(id)) {
        dragOverHoverTimer = setTimeout(() => {
          expandedNotebooks.value.add(id)
          expandedNotebooks.value = new Set(expandedNotebooks.value)
        }, 600)
      }
    }
  }
}

function onDragLeaveNotebook(id: string | 'all') {
  if (dragOverNotebookId.value === id) {
    dragOverNotebookId.value = null
    if (dragOverHoverTimer) { clearTimeout(dragOverHoverTimer); dragOverHoverTimer = null }
  }
}

function onDropToNotebook(targetId: string | null, e: DragEvent) {
  e.preventDefault()
  dragOverNotebookId.value = null
  isDragging.value = false
  if (dragOverHoverTimer) { clearTimeout(dragOverHoverTimer); dragOverHoverTimer = null }
  const insightId = e.dataTransfer?.getData('text/insight-id')
  if (!insightId) return
  const ins = notesStore.insights.find(i => i.id === insightId)
  if (!ins) return
  if (ins.notebookId === targetId) return  // 同位置无操作
  notesStore.updateInsight(insightId, { notebookId: targetId })
  const targetName = targetId
    ? notesStore.allNotebooks.find(nb => nb.id === targetId)?.name ?? '笔记本'
    : '全部笔记'
  showToast(`已移到「${targetName}」`, 'success')
}

function onCardDragStart() {
  isDragging.value = true
}

function onCardDragEnd() {
  isDragging.value = false
  dragOverNotebookId.value = null
  if (dragOverHoverTimer) { clearTimeout(dragOverHoverTimer); dragOverHoverTimer = null }
}

// ========== 笔记编辑 ==========

function openEditor(id: string) {
  const ins = notesStore.insights.find(i => i.id === id)
  if (!ins) return
  activeInsightId.value = id
  editTags.value = [...ins.tags]
  editColor.value = ins.color
  editNotebookId.value = ins.notebookId
  editTagInput.value = ''
  // 仅有原文时才构建记忆上下文（手动笔记没有 query）
  memoryContextForActive.value = ins.content
    ? memory.buildMemoryContext(ins.content, undefined)
    : ''
  viewMode.value = 'edit'
}

function closeEditor() {
  viewMode.value = 'list'
  activeInsightId.value = null
}

function addEditTag() {
  const tag = editTagInput.value.trim()
  if (tag && !editTags.value.includes(tag)) {
    editTags.value = [...editTags.value, tag]
  }
  editTagInput.value = ''
}

function removeEditTag(index: number) {
  editTags.value = editTags.value.filter((_, i) => i !== index)
}

function saveMeta() {
  if (!activeInsightId.value) return
  notesStore.updateInsight(activeInsightId.value, {
    tags: [...editTags.value],
    color: editColor.value,
    notebookId: editNotebookId.value,
  })
  showToast('已保存', 'success')
}

function handleDelete(id: string) {
  notesStore.deleteInsight(id)
  if (activeInsightId.value === id) {
    closeEditor()
  }
}

function handleEditorInput(md: string) {
  if (!activeInsightId.value) return
  notesStore.updateInsight(activeInsightId.value, { note: md })
}

// ========== 浮动新建 ==========

function createBlankNote() {
  // 默认归入当前选中的笔记本
  const ins = notesStore.createBlankInsight(activeNotebookId.value)
  openEditor(ins.id)
}

function showToast(msg: string, type: 'success' | 'error') {
  toastMessage.value = msg
  toastType.value = type
  toastVisible.value = true
}

// Escape 处理
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (notebookMenuId.value) {
      notebookMenuId.value = null
    } else if (showNewNotebook.value) {
      cancelNewNotebook()
    } else if (editingNotebookId.value) {
      cancelRename()
    } else if (viewMode.value === 'edit') {
      closeEditor()
    }
  }
}

// 点击外部关闭笔记本菜单
function handleGlobalClick() {
  notebookMenuId.value = null
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleGlobalClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleGlobalClick)
})

// 按「日期」分组的时间线
const groupedByDate = computed(() => {
  const map = new Map<string, typeof filteredInsights.value>()
  for (const ins of filteredInsights.value) {
    const d = new Date(ins.createdAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(ins)
  }
  return map
})

function formatDateLabel(dateStr: string): string {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  if (dateStr === todayStr) return '今天'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
  if (dateStr === yesterdayStr) return '昨天'
  return dateStr
}
</script>

<template>
  <div class="flex-1 flex flex-col h-full overflow-hidden">
    <!-- 顶栏 -->
    <div class="flex items-center gap-3 px-6 py-4 border-b border-app-border shrink-0">
      <button
        @click="viewMode === 'edit' ? closeEditor() : router.push('/')"
        class="w-8 h-8 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text hover:bg-app-hover transition-colors"
        :title="viewMode === 'edit' ? '返回列表' : '返回'"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h2 class="text-lg font-semibold text-app-heading">
        {{ viewMode === 'edit' ? '编辑笔记' : (activeNotebook?.name ?? '全部笔记') }}
      </h2>
      <span v-if="viewMode === 'list' && filteredInsights.length > 0" class="text-xs text-app-muted bg-app-surface-alt px-2 py-0.5 rounded-full">
        {{ filteredInsights.length }}
      </span>
    </div>

    <!-- ===== 列表模式（双栏） ===== -->
    <template v-if="viewMode === 'list'">
      <div class="flex-1 flex overflow-hidden">
        <!-- 左栏：笔记本列表 -->
        <aside
          class="w-52 shrink-0 border-r border-app-border bg-app-surface-alt/30 flex flex-col transition-colors duration-200"
          :class="isDragging ? 'bg-app-accent-soft/30' : ''"
        >
          <div class="px-3 py-3 flex items-center justify-between">
            <span class="text-[11px] text-app-muted font-medium uppercase tracking-wide">笔记本</span>
            <button
              @click="startNewNotebook"
              class="w-5 h-5 flex items-center justify-center rounded text-app-muted hover:text-app-accent hover:bg-app-hover transition-colors"
              title="新建笔记本"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            <!-- 全部笔记（同时是拖拽目标 = 解除归类） -->
            <button
              @click="selectNotebook(null)"
              @dragover="onDragOverNotebook('all', $event)"
              @dragleave="onDragLeaveNotebook('all')"
              @drop="onDropToNotebook(null, $event)"
              class="drop-target w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all"
              :class="[
                activeNotebookId === null
                  ? 'bg-app-accent-soft text-app-accent'
                  : 'text-app-text hover:bg-app-hover',
                dragOverNotebookId === 'all' ? 'is-drop-active' : ''
              ]"
            >
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 11H5m14-7H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z" />
              </svg>
              <span class="flex-1 text-xs truncate">全部笔记</span>
              <span class="text-[10px] text-app-muted">{{ notesStore.count }}</span>
            </button>

            <!-- 顶级笔记本 + 子笔记本（仅当展开） -->
            <template v-for="nb in notesStore.topLevelNotebooks" :key="nb.id">
              <!-- 顶级项 -->
              <div class="relative group">
                <!-- 重命名模式 -->
                <div
                  v-if="editingNotebookId === nb.id"
                  class="flex items-center gap-2 px-2 py-1.5"
                >
                  <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: nb.color }" />
                  <input
                    v-model="editingNotebookName"
                    @keydown.enter.prevent="confirmRename"
                    @keydown.esc.prevent="cancelRename"
                    @blur="confirmRename"
                    class="flex-1 text-xs bg-app-input border border-app-accent rounded px-1.5 py-0.5 focus:outline-none text-app-text"
                    ref="renameInputRef"
                  />
                </div>
                <!-- 普通模式 -->
                <button
                  v-else
                  @click="selectNotebook(nb.id)"
                  @dragover="onDragOverNotebook(nb.id, $event)"
                  @dragleave="onDragLeaveNotebook(nb.id)"
                  @drop="onDropToNotebook(nb.id, $event)"
                  class="drop-target w-full flex items-center gap-1 px-2 py-1.5 rounded-md text-left transition-all"
                  :class="[
                    activeNotebookId === nb.id
                      ? 'bg-app-accent-soft text-app-accent'
                      : 'text-app-text hover:bg-app-hover',
                    dragOverNotebookId === nb.id ? 'is-drop-active' : ''
                  ]"
                >
                  <!-- 三角折叠（仅有子时） -->
                  <button
                    v-if="notesStore.childrenOf(nb.id).length > 0"
                    @click.stop="toggleExpand(nb.id, $event)"
                    class="w-3.5 h-3.5 flex items-center justify-center text-app-muted hover:text-app-text shrink-0"
                  >
                    <svg
                      class="w-2.5 h-2.5 transition-transform"
                      :class="expandedNotebooks.has(nb.id) ? 'rotate-90' : ''"
                      fill="currentColor"
                      viewBox="0 0 12 12"
                    >
                      <path d="M4 2l4 4-4 4z" />
                    </svg>
                  </button>
                  <span v-else class="w-3.5 shrink-0" />

                  <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: nb.color }" />
                  <span class="flex-1 text-xs truncate">{{ nb.name }}</span>
                  <span class="text-[10px] text-app-muted">
                    {{ notesStore.childrenOf(nb.id).length > 0
                      ? notesStore.notebookCountDeep(nb.id)
                      : notesStore.notebookCount(nb.id) }}
                  </span>
                  <button
                    @click.stop="toggleNotebookMenu(nb.id, $event)"
                    class="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-app-hover-strong transition-opacity"
                    title="更多"
                  >
                    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                    </svg>
                  </button>
                </button>

                <!-- 操作菜单 -->
                <div
                  v-if="notebookMenuId === nb.id"
                  class="absolute right-0 top-full mt-1 z-10 w-32 bg-app-card border border-app-border rounded-lg shadow-lg overflow-hidden"
                  @click.stop
                >
                  <button
                    @click="startNewSubNotebook(nb.id)"
                    class="w-full px-3 py-1.5 text-xs text-left text-app-text hover:bg-app-hover transition-colors flex items-center gap-1.5"
                  >
                    <span class="text-app-accent">+</span> 新建子笔记本
                  </button>
                  <button
                    @click="startRename(nb.id, nb.name)"
                    class="w-full px-3 py-1.5 text-xs text-left text-app-text hover:bg-app-hover transition-colors"
                  >
                    重命名
                  </button>
                  <button
                    @click="handleDeleteNotebook(nb.id)"
                    class="w-full px-3 py-1.5 text-xs text-left text-red-500 hover:bg-app-hover transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>

              <!-- 子笔记本（展开时） -->
              <template v-if="expandedNotebooks.has(nb.id)">
                <div
                  v-for="child in notesStore.childrenOf(nb.id)"
                  :key="child.id"
                  class="relative group pl-5"
                >
                  <!-- 重命名 -->
                  <div
                    v-if="editingNotebookId === child.id"
                    class="flex items-center gap-2 px-2 py-1.5"
                  >
                    <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: child.color }" />
                    <input
                      v-model="editingNotebookName"
                      @keydown.enter.prevent="confirmRename"
                      @keydown.esc.prevent="cancelRename"
                      @blur="confirmRename"
                      class="flex-1 text-xs bg-app-input border border-app-accent rounded px-1.5 py-0.5 focus:outline-none text-app-text"
                      ref="renameInputRef"
                    />
                  </div>
                  <button
                    v-else
                    @click="selectNotebook(child.id)"
                    @dragover="onDragOverNotebook(child.id, $event)"
                    @dragleave="onDragLeaveNotebook(child.id)"
                    @drop="onDropToNotebook(child.id, $event)"
                    class="drop-target w-full flex items-center gap-2 px-2 py-1 rounded-md text-left transition-all"
                    :class="[
                      activeNotebookId === child.id
                        ? 'bg-app-accent-soft text-app-accent'
                        : 'text-app-text hover:bg-app-hover',
                      dragOverNotebookId === child.id ? 'is-drop-active' : ''
                    ]"
                  >
                    <span class="text-app-muted text-[10px] shrink-0">└</span>
                    <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: child.color }" />
                    <span class="flex-1 text-xs truncate">{{ child.name }}</span>
                    <span class="text-[10px] text-app-muted">{{ notesStore.notebookCount(child.id) }}</span>
                    <button
                      @click.stop="toggleNotebookMenu(child.id, $event)"
                      class="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-app-hover-strong transition-opacity"
                      title="更多"
                    >
                      <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                      </svg>
                    </button>
                  </button>
                  <!-- 子笔记本菜单（不含「新建子」） -->
                  <div
                    v-if="notebookMenuId === child.id"
                    class="absolute right-0 top-full mt-1 z-10 w-28 bg-app-card border border-app-border rounded-lg shadow-lg overflow-hidden"
                    @click.stop
                  >
                    <button
                      @click="startRename(child.id, child.name)"
                      class="w-full px-3 py-1.5 text-xs text-left text-app-text hover:bg-app-hover transition-colors"
                    >
                      重命名
                    </button>
                    <button
                      @click="handleDeleteNotebook(child.id)"
                      class="w-full px-3 py-1.5 text-xs text-left text-red-500 hover:bg-app-hover transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </template>

              <!-- 新建子笔记本表单（只在父项之后显示） -->
              <div
                v-if="showNewNotebook && newSubNotebookParentId === nb.id"
                class="ml-5 px-2 py-2 bg-app-card rounded-md border border-app-accent/30"
              >
                <input
                  v-model="newNotebookName"
                  @keydown.enter.prevent="confirmNewNotebook"
                  @keydown.esc.prevent="cancelNewNotebook"
                  placeholder="子笔记本名称"
                  class="w-full text-xs bg-app-input border border-app-border rounded px-1.5 py-1 mb-1.5 focus:outline-none focus:border-app-accent text-app-text"
                  ref="newNotebookInputRef"
                />
                <div class="flex items-center gap-1 mb-1.5 flex-wrap">
                  <button
                    v-for="color in INSIGHT_COLORS"
                    :key="color"
                    @click="newNotebookColor = color"
                    class="w-4 h-4 rounded-full transition-transform"
                    :class="newNotebookColor === color ? 'ring-1 ring-offset-1 ring-offset-app-card scale-110' : ''"
                    :style="{ backgroundColor: color, '--tw-ring-color': newNotebookColor === color ? color : 'transparent' } as any"
                  />
                </div>
                <div class="flex items-center justify-end gap-1">
                  <button
                    @click="cancelNewNotebook"
                    class="px-2 py-0.5 text-[10px] rounded text-app-muted hover:text-app-text"
                  >取消</button>
                  <button
                    @click="confirmNewNotebook"
                    class="px-2 py-0.5 text-[10px] rounded text-white"
                    :style="{ backgroundColor: newNotebookColor }"
                  >创建</button>
                </div>
              </div>
            </template>

            <!-- 顶级新建表单（只在没指定父时显示） -->
            <div
              v-if="showNewNotebook && newSubNotebookParentId === null"
              class="px-2 py-2 mt-1 bg-app-card rounded-md border border-app-accent/30"
            >
              <input
                v-model="newNotebookName"
                @keydown.enter.prevent="confirmNewNotebook"
                @keydown.esc.prevent="cancelNewNotebook"
                placeholder="笔记本名称"
                class="w-full text-xs bg-app-input border border-app-border rounded px-1.5 py-1 mb-1.5 focus:outline-none focus:border-app-accent text-app-text"
                ref="newNotebookInputRef"
              />
              <div class="flex items-center gap-1 mb-1.5 flex-wrap">
                <button
                  v-for="color in INSIGHT_COLORS"
                  :key="color"
                  @click="newNotebookColor = color"
                  class="w-4 h-4 rounded-full transition-transform"
                  :class="newNotebookColor === color ? 'ring-1 ring-offset-1 ring-offset-app-card scale-110' : ''"
                  :style="{ backgroundColor: color, '--tw-ring-color': newNotebookColor === color ? color : 'transparent' } as any"
                />
              </div>
              <div class="flex items-center justify-end gap-1">
                <button
                  @click="cancelNewNotebook"
                  class="px-2 py-0.5 text-[10px] rounded text-app-muted hover:text-app-text"
                >取消</button>
                <button
                  @click="confirmNewNotebook"
                  class="px-2 py-0.5 text-[10px] rounded text-white"
                  :style="{ backgroundColor: newNotebookColor }"
                >创建</button>
              </div>
            </div>
          </div>
        </aside>

        <!-- 右栏：笔记列表 -->
        <div class="flex-1 overflow-hidden flex flex-col relative">
          <!-- 空状态 -->
          <div
            v-if="notesStore.insights.length === 0"
            class="flex-1 flex items-center justify-center"
          >
            <div class="text-center space-y-4">
              <div class="w-16 h-16 mx-auto rounded-2xl bg-app-surface-alt flex items-center justify-center">
                <svg class="w-8 h-8 text-app-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </div>
              <div>
                <p class="text-app-muted text-sm">还没有笔记</p>
                <p class="text-app-muted text-xs mt-1">划词收藏 · 或点击右下角 + 新建</p>
              </div>
            </div>
          </div>

          <!-- 有数据 -->
          <div v-else class="flex-1 overflow-y-auto">
            <div class="max-w-2xl mx-auto px-6 py-5 space-y-4">
              <!-- 工具栏 -->
              <NotesToolbar
                :all-tags="notesStore.allTags"
                :model-search-query="searchQuery"
                :model-filter-tag="filterTag"
                :model-filter-color="filterColor"
                :model-sort-order="sortOrder"
                @update:model-search-query="searchQuery = $event"
                @update:model-filter-tag="filterTag = $event"
                @update:model-filter-color="filterColor = $event"
                @update:model-sort-order="sortOrder = $event"
              />

              <!-- 无匹配 -->
              <div v-if="filteredInsights.length === 0" class="text-center py-12">
                <p class="text-app-muted text-sm">
                  {{ activeNotebookId ? '该笔记本下还没有笔记' : '没有匹配的笔记' }}
                </p>
              </div>

              <!-- 时间线列表 -->
              <template v-else>
                <div v-for="[date, items] in groupedByDate" :key="date" class="space-y-2">
                  <div class="text-xs text-app-muted font-medium pt-2">{{ formatDateLabel(date) }}</div>
                  <div class="space-y-2">
                    <InsightCard
                      v-for="ins in items"
                      :key="ins.id"
                      :insight="ins"
                      @edit="openEditor"
                      @delete="handleDelete"
                      @drag-start="onCardDragStart"
                      @drag-end="onCardDragEnd"
                    />
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- 浮动 + 按钮 -->
          <button
            @click="createBlankNote"
            class="absolute bottom-6 right-6 w-12 h-12 rounded-full bg-app-accent text-white shadow-xl
                   hover:scale-105 hover:shadow-2xl transition-all flex items-center justify-center z-20"
            title="新建笔记"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>
    </template>

    <!-- ===== 编辑模式 ===== -->
    <template v-if="viewMode === 'edit' && activeInsight">
      <div class="flex-1 overflow-y-auto">
        <div class="max-w-2xl mx-auto px-6 py-5 space-y-4">
          <!-- 原始收藏内容（仅划词收藏时显示） -->
          <div
            v-if="activeInsight.content"
            class="bg-app-surface-alt rounded-xl p-4 border border-app-border"
          >
            <div class="text-[11px] text-app-muted mb-1.5 flex items-center gap-1.5">
              <span
                class="w-2.5 h-2.5 rounded-full inline-block"
                :style="{ backgroundColor: activeInsight.color }"
              />
              收藏原文
            </div>
            <p class="text-sm text-app-text leading-relaxed whitespace-pre-wrap">{{ activeInsight.content }}</p>
            <div class="text-[10px] text-app-muted mt-2 flex items-center gap-2">
              <span>{{ activeInsight.sourceRole === 'assistant' ? '来自 AI 回复' : '来自用户消息' }}</span>
              <span>·</span>
              <span>{{ new Date(activeInsight.createdAt).toLocaleString('zh-CN') }}</span>
            </div>
          </div>

          <!-- 笔记编辑区 -->
          <NoteEditor
            v-if="viewMode === 'edit' && activeInsight"
            :key="activeInsightId ?? ''"
            :model-value="activeInsight.note"
            :insight-content="activeInsight.content"
            :memory-context="memoryContextForActive"
            placeholder="在这里写笔记..."
            @update:model-value="handleEditorInput"
          />

          <!-- 元数据编辑面板 -->
          <div class="bg-app-card rounded-xl border border-app-border p-4 space-y-3">
            <!-- 笔记本归属 -->
            <div v-if="notesStore.allNotebooks.length > 0">
              <div class="text-[11px] text-app-muted mb-1.5">所属笔记本</div>
              <div class="flex flex-wrap gap-1">
                <button
                  @click="editNotebookId = null; saveMeta()"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full transition-colors"
                  :class="editNotebookId === null
                    ? 'bg-app-accent-soft text-app-accent border border-app-accent-soft-border'
                    : 'bg-app-surface-alt text-app-muted hover:text-app-text border border-transparent'"
                >
                  不归类
                </button>
                <button
                  v-for="item in sortedNotebooks"
                  :key="item.nb.id"
                  @click="editNotebookId = item.nb.id; saveMeta()"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full transition-colors"
                  :class="editNotebookId === item.nb.id
                    ? 'text-white'
                    : 'bg-app-surface-alt text-app-muted hover:text-app-text border border-transparent'"
                  :style="editNotebookId === item.nb.id ? { backgroundColor: item.nb.color } : {}"
                >
                  <span v-if="item.depth === 1" class="text-[9px] opacity-70">└</span>
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ backgroundColor: item.nb.color }" />
                  {{ item.nb.name }}
                </button>
              </div>
            </div>

            <!-- 颜色 -->
            <div>
              <div class="text-[11px] text-app-muted mb-1.5">颜色标记</div>
              <div class="flex items-center gap-2">
                <button
                  v-for="color in INSIGHT_COLORS"
                  :key="color"
                  @click="editColor = color; saveMeta()"
                  class="w-6 h-6 rounded-full transition-transform"
                  :class="editColor === color ? 'ring-2 ring-offset-2 ring-offset-app-card scale-110' : 'hover:scale-105'"
                  :style="{ backgroundColor: color, '--tw-ring-color': editColor === color ? color : 'transparent' } as any"
                />
              </div>
            </div>
            <!-- 标签 -->
            <div>
              <div class="text-[11px] text-app-muted mb-1.5">标签</div>
              <div class="flex flex-wrap gap-1 mb-1.5">
                <span
                  v-for="(tag, i) in editTags"
                  :key="tag"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-app-accent-soft text-app-accent"
                >
                  {{ tag }}
                  <button @click="removeEditTag(i); saveMeta()" class="hover:opacity-70">✕</button>
                </span>
              </div>
              <input
                v-model="editTagInput"
                @keydown.enter.prevent="addEditTag(); saveMeta()"
                placeholder="添加标签，回车确认"
                class="w-full px-2 py-1.5 text-xs bg-app-input border border-app-border rounded-lg text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-accent"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Toast -->
    <ToastNotification
      :message="toastMessage"
      :type="toastType"
      v-model:visible="toastVisible"
    />
  </div>
</template>

<style scoped>
/* 拖拽放置目标：悬停时柔和填充 + 左侧强调条 + 轻微右移，替代生硬的 ring */
.drop-target {
  position: relative;
}
.drop-target.is-drop-active {
  background: var(--app-accent-soft);
  color: var(--app-accent);
  transform: translateX(2px);
  box-shadow: inset 0 0 0 1px var(--app-accent);
}
.drop-target.is-drop-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 15%;
  bottom: 15%;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--app-accent);
}
</style>
