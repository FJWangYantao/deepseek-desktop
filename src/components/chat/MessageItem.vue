<script setup lang="ts">
import { ref } from 'vue'
import type { Message } from '@/types'
import { useChatStore } from '@/stores/chat'
import { useQuote } from '@/composables/useQuote'
import ContentBlock from '@/components/renderer/ContentBlock.vue'
import ThinkingBubble from '@/components/renderer/ThinkingBubble.vue'
import ReplixLogo from '@/components/pet/ReplixLogo.vue'

const props = defineProps<{
  message: Message
}>()

const chatStore = useChatStore()
const { addQuote } = useQuote()
const copied = ref(false)
const exported = ref(false)
const contentRef = ref<HTMLElement>()
const showQuoteBtn = ref(false)
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
}

function handleQuote() {
  addQuote(selectedText.value, props.message.id)
  showQuoteBtn.value = false
  window.getSelection()?.removeAllRanges()
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
</script>

<template>
  <div class="mb-8 group">
    <!-- 浮动引用按钮 -->
    <Teleport to="body">
      <button
        v-if="showQuoteBtn"
        @click="handleQuote"
        class="fixed z-[9999] px-3 py-1.5 text-xs font-medium rounded-lg shadow-lg
               bg-app-accent text-white hover:bg-app-accent-hover transition-colors
               -translate-x-1/2 -translate-y-full whitespace-nowrap"
        :style="{ left: quoteBtnPos.x + 'px', top: quoteBtnPos.y + 'px' }"
      >
        引用
      </button>
    </Teleport>

    <!-- 用户消息 -->
    <div v-if="message.role === 'user'" class="flex flex-col items-end">
      <div ref="contentRef" @mouseup="onContentMouseUp" class="max-w-[80%] px-4 py-2.5 bg-app-card rounded-bubble rounded-br-sm overflow-hidden">
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
      <div class="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          @click="retry"
          class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:text-app-accent hover:bg-app-accent-soft transition-colors"
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
        <ThinkingBubble v-if="message.thinking" :thinking="message.thinking" :thinking-expanded="message.thinkingExpanded" />
        <ContentBlock :content="message.content" />
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
