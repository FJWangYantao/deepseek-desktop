<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { nextTick, ref, watch } from 'vue'
import { marked } from 'marked'
import { useStreamRender } from '@/composables/useStreamRender'
import { fixCjkEmphasis } from '@/composables/useMarkdown'
import MessageItem from './MessageItem.vue'
import StreamCursor from '@/components/renderer/StreamCursor.vue'

const chatStore = useChatStore()
const listRef = ref<HTMLElement>()

const { processChunk } = useStreamRender()

// 将流式内容分离为可安全渲染和待处理两部分
const streamingSafe = computed(() => {
  if (!chatStore.streaming) return ''
  return processChunk('', chatStore.streaming).safeContent
})

const streamingPending = computed(() => {
  if (!chatStore.streaming) return ''
  return processChunk('', chatStore.streaming).pendingContent
})

const streamHtml = computed(() => {
  if (!streamingSafe.value) return ''
  return marked.parse(fixCjkEmphasis(streamingSafe.value), { breaks: true, gfm: true }) as string
})

watch(
  () => chatStore.messages.length,
  async () => { await nextTick(); scrollToBottom() }
)

watch(
  () => chatStore.streaming,
  async () => { await nextTick(); if (isNearBottom()) scrollToBottom() }
)

function scrollToBottom() {
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight
  }
}

function isNearBottom(): boolean {
  if (!listRef.value) return true
  const el = listRef.value
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80
}
</script>

<template>
  <div ref="listRef" class="flex-1 overflow-y-auto px-6 py-6">
    <div
      v-if="chatStore.messages.length === 0 && !chatStore.streaming"
      class="flex items-center justify-center h-full"
    >
      <p class="text-app-muted text-sm">发送消息开始对话</p>
    </div>
    <div class="max-w-[768px] mx-auto">
      <MessageItem
        v-for="msg in chatStore.messages"
        :key="msg.id"
        :message="msg"
      />

      <!-- 等待首 token -->
      <div v-if="chatStore.isGenerating && !chatStore.streaming && !chatStore.streamingThinking" class="mb-6">
        <div class="flex items-start gap-3">
          <div class="w-7 h-7 rounded-lg bg-app-accent flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
            D
          </div>
          <div class="flex items-center gap-1 py-1.5">
            <span class="w-2 h-2 rounded-full bg-app-accent animate-bounce" style="animation-delay: 0ms" />
            <span class="w-2 h-2 rounded-full bg-app-accent animate-bounce" style="animation-delay: 150ms" />
            <span class="w-2 h-2 rounded-full bg-app-accent animate-bounce" style="animation-delay: 300ms" />
          </div>
        </div>
      </div>

      <!-- 流式输出 -->
      <div v-if="chatStore.streaming" class="mb-6">
        <div class="flex items-start gap-3">
          <div class="w-7 h-7 rounded-lg bg-app-accent flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
            D
          </div>
          <div class="min-w-0 flex-1">
            <div v-if="chatStore.streamingThinking" class="mb-3">
              <details open class="text-xs">
                <summary class="text-app-muted hover:text-app-heading cursor-pointer font-medium">思考中...</summary>
                <div class="mt-2 pl-4 border-l-2 border-amber-200 text-app-muted leading-relaxed whitespace-pre-wrap">
                  {{ chatStore.streamingThinking }}
                </div>
              </details>
            </div>
            <!-- 已闭合的 Markdown 部分：用 marked 实时渲染 -->
            <div
              v-if="streamHtml"
              class="text-sm text-app-text leading-relaxed markdown-body prose-sm max-w-none
                     prose-headings:text-app-heading prose-p:text-app-text prose-strong:text-app-text
                     prose-a:text-app-accent prose-a:no-underline
                     prose-code:text-app-accent prose-code:bg-amber-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                     prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0
                     prose-li:text-app-text prose-table:border-app-border"
              v-html="streamHtml"
            />
            <!-- 未闭合的代码块部分：纯文本 + 光标 -->
            <div class="text-sm text-app-text whitespace-pre-wrap leading-relaxed">
              {{ streamingPending }}<StreamCursor v-if="streamingPending || !streamHtml" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
