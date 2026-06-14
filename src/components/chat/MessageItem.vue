<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { Message } from '@/types'
import { useChatStore } from '@/stores/chat'
import { useSessionStore } from '@/stores/session'
import { useQuote } from '@/composables/useQuote'
import { useNotesStore } from '@/stores/notes'
import ContentBlock from '@/components/renderer/ContentBlock.vue'
import ThinkingBubble from '@/components/renderer/ThinkingBubble.vue'
import ToolCallStatus from './ToolCallStatus.vue'
import ReplixLogo from '@/components/pet/ReplixLogo.vue'
import FavoritePopover from '@/components/notes/FavoritePopover.vue'
import ToastNotification from '@/components/notes/ToastNotification.vue'

const props = defineProps<{
  message: Message
}>()

const chatStore = useChatStore()
const sessionStore = useSessionStore()
const notesStore = useNotesStore()
const { addQuote } = useQuote()
const copied = ref(false)
const exported = ref(false)
const contentRef = ref<HTMLElement>()
const quoteBtnRef = ref<HTMLElement>()
const popoverRef = ref<HTMLElement>()
const showQuoteBtn = ref(false)
const showFavoritePopover = ref(false)
const favSuccess = ref(false)
const quoteBtnPos = ref({ x: 0, y: 0 })
const selectedText = ref('')

function onContentMouseUp() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !contentRef.value) {
    showQuoteBtn.value = false
    return
  }
  const range = sel.getRangeAt(0)
  if (!contentRef.value.contains(range.startContainer)) {
    showQuoteBtn.value = false
    return
  }
  const text = sel.toString().trim()
  if (!text) { showQuoteBtn.value = false; return }
  const rect = range.getBoundingClientRect()
  selectedText.value = text
  quoteBtnPos.value = { x: rect.left + rect.width / 2, y: rect.top - 8 }
  showQuoteBtn.value = true
  showFavoritePopover.value = false
}

// 点击别处时隐藏浮动引用按钮。mousedown 先于按钮的 click，
// 所以点在按钮本身上要放行，否则会在引用动作触发前就被隐藏。
function onGlobalMouseDown(e: MouseEvent) {
  if (!showQuoteBtn.value && !showFavoritePopover.value) return
  if (quoteBtnRef.value?.contains(e.target as Node)) return
  if (popoverRef.value?.contains(e.target as Node)) return
  showQuoteBtn.value = false
  showFavoritePopover.value = false
}

// 选区被清空（键盘操作、点击折叠选区等）时同步隐藏
function onSelectionChange() {
  if (!showQuoteBtn.value) return
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    showQuoteBtn.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onGlobalMouseDown)
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onGlobalMouseDown)
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('keydown', onGlobalKeydown)
})

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (showFavoritePopover.value) {
      showFavoritePopover.value = false
    } else if (showQuoteBtn.value) {
      showQuoteBtn.value = false
    }
  }
}

function handleQuote() {
  addQuote(selectedText.value, props.message.id)
  showQuoteBtn.value = false
  window.getSelection()?.removeAllRanges()
}

function toggleFavorite() {
  showFavoritePopover.value = !showFavoritePopover.value
}

function handleFavoriteSaved(data: { content: string; tags: string[]; color: string; notebookId: string | null }) {
  // 检测重复（同一条消息中的相同文本）
  const isDuplicate = notesStore.insights.some(
    i => i.sourceMessageId === props.message.id && i.content === data.content
  )
  if (isDuplicate) {
    showQuoteBtn.value = false
    showFavoritePopover.value = false
    favSuccess.value = true
    window.getSelection()?.removeAllRanges()
    setTimeout(() => { favSuccess.value = false }, 1500)
    return
  }
  notesStore.addInsight({
    content: data.content,
    sourceMessageId: props.message.id,
    sourceSessionId: sessionStore.currentId,
    sourceRole: props.message.role,
    tags: data.tags,
    color: data.color,
    notebookId: data.notebookId,
  })
  showQuoteBtn.value = false
  showFavoritePopover.value = false
  favSuccess.value = true
  window.getSelection()?.removeAllRanges()
  setTimeout(() => { favSuccess.value = false }, 1500)
}

async function copyContent() {
  try {
    await navigator.clipboard.writeText(props.message.content)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* ignore */ }
}

async function exportMessage(format: 'md' | 'html') {
  if (!window.electronAPI?.exportMessage) return
  const ok = await window.electronAPI.exportMessage(
    JSON.parse(JSON.stringify(props.message)),
    format,
  )
  if (ok) {
    exported.value = true
    setTimeout(() => { exported.value = false }, 2000)
  }
}

function retry() {
  chatStore.retryMessage(props.message.id)
}

// ===== 用户消息编辑重发 =====
const isEditing = ref(false)
const editDraft = ref('')
const editRef = ref<HTMLTextAreaElement>()

function startEdit() {
  if (chatStore.isGenerating) return
  editDraft.value = props.message.content
  isEditing.value = true
  nextTick(() => {
    editRef.value?.focus()
    // 光标移到末尾
    const len = editRef.value!.value.length
    editRef.value!.setSelectionRange(len, len)
  })
}

function cancelEdit() {
  isEditing.value = false
  editDraft.value = ''
}

function saveEdit() {
  const trimmed = editDraft.value.trim()
  if (!trimmed) return
  isEditing.value = false
  editDraft.value = ''
  chatStore.editAndResendMessage(props.message.id, trimmed)
}

// 编辑中按 Ctrl/Cmd+Enter 保存，Esc 取消
function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    saveEdit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}
</script>

<template>
  <div class="mb-8 group">
    <!-- 浮动操作栏（引用 + 收藏） -->
    <Teleport to="body">
      <div
        v-if="showQuoteBtn"
        ref="quoteBtnRef"
        class="fixed z-[9999] flex items-center -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg shadow-lg overflow-hidden"
        :style="{ left: quoteBtnPos.x + 'px', top: quoteBtnPos.y + 'px' }"
      >
        <button
          @click="handleQuote"
          class="px-3 py-1.5 text-xs font-medium bg-app-accent text-white hover:bg-app-accent-hover transition-colors"
        >
          引用
        </button>
        <button
          @click="toggleFavorite"
          class="px-3 py-1.5 text-xs font-medium bg-app-card text-app-accent border border-app-accent/30 hover:bg-app-hover transition-colors"
        >
          收藏
        </button>
      </div>
      <!-- 收藏弹出框 -->
      <FavoritePopover
        ref="popoverRef"
        :visible="showFavoritePopover"
        :position="quoteBtnPos"
        :selected-text="selectedText"
        @saved="handleFavoriteSaved"
        @cancel="showFavoritePopover = false"
      />
      <!-- 已收藏反馈 -->
      <Transition name="toast">
        <div
          v-if="favSuccess"
          class="fixed z-[10001] px-3 py-1.5 text-xs font-medium rounded-lg shadow-lg bg-app-card border border-app-accent/30 text-app-accent -translate-x-1/2 -translate-y-full flex items-center gap-1.5"
          :style="{ left: quoteBtnPos.x + 'px', top: quoteBtnPos.y + 'px' }"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          已收藏
        </div>
      </Transition>
    </Teleport>

    <!-- 用户消息 -->
    <div v-if="message.role === 'user'" class="flex flex-col items-end">
      <!-- 编辑态：textarea + 保存/取消 -->
      <div v-if="isEditing" class="w-full max-w-[80%] px-4 py-2.5 bg-app-card rounded-bubble rounded-br-sm overflow-hidden border border-app-accent/40">
        <textarea
          ref="editRef"
          v-model="editDraft"
          @keydown="onEditKeydown"
          rows="2"
          class="w-full bg-transparent text-app-text whitespace-pre-wrap break-words leading-[1.8] resize-none outline-none border-0 focus:ring-0"
          :style="{ fontSize: 'var(--app-font-size)' }"
        />
        <div class="flex items-center justify-end gap-2 mt-2">
          <button
            @click="cancelEdit"
            class="px-3 py-1 text-xs rounded-md text-app-muted hover:text-app-text hover:bg-app-hover transition-colors"
          >取消<span class="opacity-50 ml-1">Esc</span></button>
          <button
            @click="saveEdit"
            :disabled="!editDraft.trim()"
            class="px-3 py-1 text-xs rounded-md text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            :class="editDraft.trim() ? 'bg-app-accent hover:bg-app-accent-hover' : 'bg-app-accent'"
          >发送<span class="opacity-70 ml-1">⌘↵</span></button>
        </div>
      </div>

      <!-- 正常态 -->
      <div v-else ref="contentRef" @mouseup="onContentMouseUp" class="max-w-[80%] px-4 py-2.5 bg-app-card rounded-bubble rounded-br-sm overflow-hidden">
        <div v-if="message.quotes?.length" class="mb-2 space-y-1">
          <div
            v-for="(q, i) in message.quotes" :key="i"
            class="pl-3 border-l-2 border-app-accent text-app-muted text-[13px] leading-[1.6] line-clamp-3"
            :style="{ fontSize: 'calc(var(--app-font-size) - 1px)' }"
          >{{ q.text }}</div>
        </div>
        <div v-else-if="(message as any).quote" class="mb-2 pl-3 border-l-2 border-app-accent text-app-muted text-[13px] leading-[1.6] line-clamp-3" :style="{ fontSize: 'calc(var(--app-font-size) - 1px)' }">{{ (message as any).quote.text }}</div>
        <p class="text-app-text whitespace-pre-wrap break-words leading-[1.8]" :style="{ fontSize: 'var(--app-font-size)' }">{{ message.content }}</p>
        <div v-if="message.attachments?.length" class="flex flex-wrap gap-1 mt-2 pt-2 border-t border-app-border">
          <span
            v-for="a in message.attachments"
            :key="a.name"
            class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full
                   bg-app-accent-soft text-app-accent border border-app-accent-soft-border"
          >
            <svg v-if="a.type === 'image'" class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <svg v-else class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span class="truncate max-w-[120px]">{{ a.name }}</span>
            <span class="text-[10px] opacity-60">{{ a.size < 1024 ? a.size + 'B' : a.size < 1048576 ? (a.size / 1024).toFixed(1) + 'KB' : (a.size / 1048576).toFixed(1) + 'MB' }}</span>
          </span>
        </div>
      </div>
      <div v-if="!isEditing" class="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          @click="startEdit"
          :disabled="chatStore.isGenerating"
          class="w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          :class="chatStore.isGenerating ? 'text-app-muted' : 'text-app-muted hover:text-app-accent hover:bg-app-accent-soft'"
          title="编辑并重发"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          @click="retry"
          :disabled="chatStore.isGenerating"
          class="w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          :class="chatStore.isGenerating ? 'text-app-muted' : 'text-app-muted hover:text-app-accent hover:bg-app-accent-soft'"
          title="重试"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        <button
          @click="copyContent"
          class="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
          :class="copied ? 'text-green-600 bg-green-50' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
          :title="copied ? '已复制' : '复制'"
        >
          <svg v-if="!copied" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </button>
      </div>
    </div>

    <!-- AI 消息 -->
    <div v-else class="flex items-start gap-4">
      <ReplixLogo size="sm" animate state="idle" class="mt-0.5" />
      <div ref="contentRef" @mouseup="onContentMouseUp" class="min-w-0 flex-1">
        <!-- 顶层思考（仅无 contentBlocks 的老消息显示；有 contentBlocks 时 thinking 已内联到块里） -->
        <ThinkingBubble v-if="message.thinking && !(message.contentBlocks && message.contentBlocks.length > 0)" :thinking="message.thinking" :thinking-expanded="message.thinkingExpanded" />

        <!-- 优先用 contentBlocks 内联渲染（ReAct/Plan 多轮：思考段 ↔ 正文段 ↔ 工具调用段交错） -->
        <template v-if="message.contentBlocks && message.contentBlocks.length > 0">
          <template v-for="(block, i) in message.contentBlocks" :key="i">
            <ThinkingBubble v-if="block.type === 'thinking'" :thinking="block.text" :thinking-expanded="false" />
            <ContentBlock v-else-if="block.type === 'text'" :content="block.text" />
            <ToolCallStatus v-else :calls="block.calls" />
          </template>
        </template>

        <!-- 降级：老消息无 contentBlocks，保持「思考 + 工具调用在前 + 正文」的旧行为 -->
        <template v-else>
          <ThinkingBubble v-if="message.thinking" :thinking="message.thinking" :thinking-expanded="message.thinkingExpanded" />
          <ToolCallStatus v-if="message.toolCalls?.length" :calls="message.toolCalls" />
          <ContentBlock :content="message.content" />
        </template>

        <div class="flex mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity gap-0.5">
          <button
            @click="copyContent"
            class="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            :class="copied ? 'text-green-600 bg-green-50' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
            :title="copied ? '已复制' : '复制'"
          >
            <svg v-if="!copied" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            @click="exportMessage('md')"
            class="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            :class="exported ? 'text-green-600 bg-green-50' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
            :title="exported ? '已导出' : '导出为 Markdown'"
          >
            <svg v-if="!exported" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
