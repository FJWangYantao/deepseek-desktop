<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { useNoteAI } from '@/composables/useNoteAI'
import './editor.css'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  insightContent: string
  memoryContext?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { summarize, extractKeyPoints, polish, continueWriting } = useNoteAI()

const editor = useEditor({
  content: props.modelValue,
  contentType: 'markdown',
  extensions: [
    StarterKit,
    Markdown,
  ],
  editorProps: {
    attributes: {
      class: 'tiptap-content',
    },
  },
  onUpdate: ({ editor: ed }) => {
    const md = (ed as any).getMarkdown()
    emit('update:modelValue', md)
  },
})

// 外部值变化时同步（仅非聚焦状态，避免光标跳转）
watch(() => props.modelValue, (newVal) => {
  if (!editor.value) return
  if (editor.value.isFocused) return
  const current = (editor.value as any).getMarkdown()
  if (newVal !== current) {
    editor.value.commands.setContent(newVal)
  }
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

// 工具栏按钮状态
const isBold = computed(() => editor.value?.isActive('bold') ?? false)
const isItalic = computed(() => editor.value?.isActive('italic') ?? false)
const isH1 = computed(() => editor.value?.isActive('heading', { level: 1 }) ?? false)
const isH2 = computed(() => editor.value?.isActive('heading', { level: 2 }) ?? false)
const isH3 = computed(() => editor.value?.isActive('heading', { level: 3 }) ?? false)
const isBulletList = computed(() => editor.value?.isActive('bulletList') ?? false)
const isOrderedList = computed(() => editor.value?.isActive('orderedList') ?? false)
const isBlockquote = computed(() => editor.value?.isActive('blockquote') ?? false)
const isCodeBlock = computed(() => editor.value?.isActive('codeBlock') ?? false)

function toggleBold() { editor.value?.chain().focus().toggleBold().run() }
function toggleItalic() { editor.value?.chain().focus().toggleItalic().run() }
function toggleH1() { editor.value?.chain().focus().toggleHeading({ level: 1 }).run() }
function toggleH2() { editor.value?.chain().focus().toggleHeading({ level: 2 }).run() }
function toggleH3() { editor.value?.chain().focus().toggleHeading({ level: 3 }).run() }
function toggleBulletList() { editor.value?.chain().focus().toggleBulletList().run() }
function toggleOrderedList() { editor.value?.chain().focus().toggleOrderedList().run() }
function toggleBlockquote() { editor.value?.chain().focus().toggleBlockquote().run() }
function toggleCodeBlock() { editor.value?.chain().focus().toggleCodeBlock().run() }

// ===== AI 辅助功能 =====
const showAIMenu = ref(false)
const aiLoading = ref(false)
const aiMenuRef = ref<HTMLElement>()

type AIAction = 'summarize' | 'extractKeyPoints' | 'polish' | 'continueWriting'

const aiActions: { key: AIAction; label: string; desc: string }[] = [
  { key: 'summarize', label: '总结摘要', desc: '基于收藏原文生成摘要' },
  { key: 'extractKeyPoints', label: '提炼要点', desc: '提取关键要点列表' },
  { key: 'polish', label: '润色改写', desc: '优化笔记表达' },
  { key: 'continueWriting', label: '继续续写', desc: '延续已有内容继续写' },
]

function toggleAIMenu() {
  if (aiLoading.value) return
  showAIMenu.value = !showAIMenu.value
}

function closeAIMenu() {
  showAIMenu.value = false
}

// 点击外部关闭 AI 菜单
function onAIMenuMouseDown(e: MouseEvent) {
  if (aiMenuRef.value?.contains(e.target as Node)) return
  closeAIMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onAIMenuMouseDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onAIMenuMouseDown)
})

async function handleAIAction(action: AIAction) {
  showAIMenu.value = false
  aiLoading.value = true
  let result = ''

  try {
    const currentNote = (editor.value as any)?.getMarkdown() ?? props.modelValue

    switch (action) {
      case 'summarize':
        result = await summarize(props.insightContent, props.memoryContext)
        break
      case 'extractKeyPoints':
        result = await extractKeyPoints(props.insightContent, currentNote, props.memoryContext)
        break
      case 'polish':
        result = await polish(currentNote)
        break
      case 'continueWriting':
        result = await continueWriting(props.insightContent, currentNote)
        break
    }

    if (!result) return

    // 续写追加，其他覆盖
    if (action === 'continueWriting' && currentNote.trim()) {
      editor.value?.commands.setContent(currentNote + '\n\n' + result)
    } else {
      editor.value?.commands.setContent(result)
    }
  } catch {
    // 静默处理
  } finally {
    aiLoading.value = false
  }
}
</script>

<template>
  <div class="note-editor">
    <!-- 工具栏 -->
    <div class="flex items-center gap-0.5 px-3 py-2 border-b border-app-border bg-app-surface-alt/50">
      <!-- 格式化按钮组 -->
      <button
        @click="toggleBold"
        class="toolbar-btn"
        :class="isBold ? 'bg-app-accent-soft text-app-accent' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
        title="加粗"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
        </svg>
      </button>
      <button
        @click="toggleItalic"
        class="toolbar-btn"
        :class="isItalic ? 'bg-app-accent-soft text-app-accent' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
        title="斜体"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 4h4m-2 0l-4 16m0 0h4" />
        </svg>
      </button>

      <span class="w-px h-4 bg-app-border mx-1" />

      <button
        @click="toggleH1"
        class="toolbar-btn"
        :class="isH1 ? 'bg-app-accent-soft text-app-accent' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
        title="标题 1"
      >
        <span class="text-xs font-bold">H1</span>
      </button>
      <button
        @click="toggleH2"
        class="toolbar-btn"
        :class="isH2 ? 'bg-app-accent-soft text-app-accent' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
        title="标题 2"
      >
        <span class="text-xs font-bold">H2</span>
      </button>
      <button
        @click="toggleH3"
        class="toolbar-btn"
        :class="isH3 ? 'bg-app-accent-soft text-app-accent' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
        title="标题 3"
      >
        <span class="text-xs font-bold">H3</span>
      </button>

      <span class="w-px h-4 bg-app-border mx-1" />

      <button
        @click="toggleBulletList"
        class="toolbar-btn"
        :class="isBulletList ? 'bg-app-accent-soft text-app-accent' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
        title="无序列表"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h.01M8 6h12M4 12h.01M8 12h12M4 18h.01M8 18h12" />
        </svg>
      </button>
      <button
        @click="toggleOrderedList"
        class="toolbar-btn"
        :class="isOrderedList ? 'bg-app-accent-soft text-app-accent' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
        title="有序列表"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h.01M4 10h.01M4 14h.01M4 18h.01M8 6h12M8 10h12M8 14h12M8 18h12" />
        </svg>
      </button>
      <button
        @click="toggleBlockquote"
        class="toolbar-btn"
        :class="isBlockquote ? 'bg-app-accent-soft text-app-accent' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
        title="引用"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>
      <button
        @click="toggleCodeBlock"
        class="toolbar-btn"
        :class="isCodeBlock ? 'bg-app-accent-soft text-app-accent' : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
        title="代码块"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      </button>

      <!-- AI 按钮（右侧） -->
      <span class="flex-1" />
      <span class="w-px h-4 bg-app-border mx-1" />
      <div class="relative" ref="aiMenuRef">
        <button
          @click="toggleAIMenu"
          class="toolbar-btn"
          :class="aiLoading
            ? 'text-app-accent'
            : showAIMenu
              ? 'bg-app-accent-soft text-app-accent'
              : 'text-app-muted hover:text-app-text hover:bg-app-hover'"
          title="AI 辅助"
          :disabled="aiLoading"
        >
          <!-- Loading 旋转动画 -->
          <svg v-if="aiLoading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <!-- Sparkles 图标 -->
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
          </svg>
        </button>

        <!-- AI 下拉菜单 -->
        <Transition name="ai-menu">
          <div
            v-if="showAIMenu"
            class="absolute right-0 top-full mt-1 w-44 bg-app-card border border-app-border rounded-xl shadow-xl overflow-hidden z-50"
          >
            <button
              v-for="action in aiActions"
              :key="action.key"
              @click="handleAIAction(action.key)"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-app-text hover:bg-app-hover transition-colors"
            >
              <span class="text-app-accent text-sm w-4 text-center shrink-0">
                {{ action.key === 'summarize' ? '✦' : action.key === 'extractKeyPoints' ? '☰' : action.key === 'polish' ? '✎' : '↴' }}
              </span>
              <span class="flex flex-col items-start">
                <span class="font-medium">{{ action.label }}</span>
                <span class="text-[10px] text-app-muted leading-tight">{{ action.desc }}</span>
              </span>
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 编辑区域 -->
    <div class="px-4 py-3 min-h-[200px] relative">
      <EditorContent :editor="editor" />
      <!-- AI Loading 遮罩 -->
      <div
        v-if="aiLoading"
        class="absolute inset-0 bg-app-card/60 flex items-center justify-center z-10 rounded-b-xl"
      >
        <div class="flex items-center gap-2 text-xs text-app-muted">
          <svg class="w-4 h-4 animate-spin text-app-accent" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          AI 生成中...
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-editor {
  background: var(--app-card);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  overflow: hidden;
}

.toolbar-btn {
  @apply w-7 h-7 flex items-center justify-center rounded-md transition-colors;
}

/* AI 菜单过渡动画 */
.ai-menu-enter-active {
  transition: opacity 150ms ease-out, transform 150ms cubic-bezier(0.34, 1.4, 0.64, 1);
}
.ai-menu-leave-active {
  transition: opacity 100ms ease-in, transform 100ms ease-in;
}
.ai-menu-enter-from,
.ai-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.95);
}
</style>
