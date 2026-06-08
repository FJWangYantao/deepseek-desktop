<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { nextTick, ref, watch, onMounted } from 'vue'
import { useStreamRender } from '@/composables/useStreamRender'
import { fixCjkEmphasis, renderMarkdown } from '@/composables/useMarkdown'
import { useAvatar } from '@/composables/useAvatar'
import MessageItem from './MessageItem.vue'
import StreamCursor from '@/components/renderer/StreamCursor.vue'
import ToolCallStatus from './ToolCallStatus.vue'

const chatStore = useChatStore()
const { avatarUrl, loadAvatar } = useAvatar()
const listRef = ref<HTMLElement>()
const showScrollBtn = ref(false)
onMounted(() => { loadAvatar() })

const { processChunk } = useStreamRender()

const isThinkingActive = computed(() =>
  !!chatStore.streamingThinking && !chatStore.streaming
)

function onThinkingToggle(e: Event) {
  const el = e.target as HTMLDetailsElement
  // 只在思考已结束、正文输出中时记录用户的手动操作
  if (!isThinkingActive.value) {
    chatStore.thinkingManuallyExpanded = el.open
  }
}

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
  return renderMarkdown(fixCjkEmphasis(streamingSafe.value))
})

// 新消息 → 仅用户消息滚到底（助手回复完成时不强制滚动）
watch(
  () => chatStore.messages.length,
  async () => {
    await nextTick()
    const last = chatStore.messages[chatStore.messages.length - 1]
    if (last?.role === 'user') scrollToBottom()
  }
)

// 生成开始 → 滚到底（确保等待指示器可见）
watch(
  () => chatStore.isGenerating,
  async (val) => { if (val) { await nextTick(); scrollToBottom() } }
)

// 工具调用状态变化 → 近底部时滚到底
watch(
  () => chatStore.activeToolCalls.length,
  async () => { await nextTick(); if (isNearBottom()) scrollToBottom() }
)

// 流式内容更新 → 近底部时滚到底
watch(
  () => chatStore.streaming,
  async () => { await nextTick(); if (isNearBottom()) scrollToBottom() }
)

// 思考内容更新 → 近底部时滚到底
watch(
  () => chatStore.streamingThinking,
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
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

function onScroll() {
  showScrollBtn.value = !isNearBottom()
}

// 消息变化后检查是否需要显示按钮
watch(() => chatStore.messages.length, () => {
  nextTick(() => onScroll())
})
</script>

<template>
  <div ref="listRef" class="flex-1 overflow-y-auto px-6 py-6 relative" @scroll="onScroll">
    <div
      v-if="chatStore.messages.length === 0 && !chatStore.streaming"
      class="flex items-center justify-center h-full"
    >
      <div class="flex flex-col items-center select-none">
        <svg class="w-72 h-72" viewBox="0 0 512 394" fill="none">
          <path fill="#e8e5df" opacity="0.6" fill-rule="nonzero" d="M440.898 23.555c-4.001-1.961-5.723 1.776-8.062 3.673-.801.612-1.479 1.407-2.154 2.141-5.848 6.246-12.681 10.349-21.607 9.859-13.048-.734-24.192 3.368-34.04 13.348-2.093-12.307-9.048-19.658-19.635-24.37-5.54-2.449-11.141-4.9-15.02-10.227-2.708-3.795-3.447-8.021-4.801-12.185-.861-2.509-1.725-5.082-4.618-5.512-3.139-.49-4.372 2.142-5.601 4.349-4.925 9.002-6.833 18.921-6.647 28.962.432 22.597 9.972 40.597 28.932 53.397 2.154 1.47 2.707 2.939 2.032 5.082-1.293 4.41-2.832 8.695-4.186 13.105-.862 2.817-2.157 3.429-5.172 2.205-10.402-4.346-19.391-10.778-27.332-18.553-13.481-13.044-25.668-27.434-40.873-38.702a177.614 177.614 0 00-10.834-7.409c-15.512-15.063 2.032-27.434 6.094-28.902 4.247-1.532 1.478-6.797-12.251-6.736-13.727.061-26.285 4.653-42.288 10.777-2.34.92-4.801 1.593-7.326 2.142-14.527-2.756-29.608-3.368-45.367-1.593-29.671 3.305-53.368 17.329-70.788 41.272-20.928 28.785-25.854 61.482-19.821 95.59 6.34 35.943 24.683 65.704 52.876 88.974 29.239 24.123 62.911 35.943 101.32 33.677 23.329-1.346 49.307-4.468 78.607-29.27 7.387 3.673 15.142 5.144 28.008 6.246 9.911.92 19.452-.49 26.839-2.019 11.573-2.449 10.773-13.166 6.586-15.124-33.915-15.797-26.47-9.368-33.24-14.573 17.235-20.39 43.213-41.577 53.369-110.222.8-5.448.121-8.877 0-13.287-.061-2.692.553-3.734 3.632-4.041 8.494-.981 16.742-3.305 24.314-7.471 21.975-12.002 30.84-31.719 32.933-55.355.307-3.612-.061-7.348-3.879-9.245v-.003zM249.4 236.278c-32.872-25.838-48.814-34.352-55.4-33.984-6.155.368-5.048 7.41-3.694 12.002 1.415 4.532 3.264 7.654 5.848 11.634 1.785 2.634 3.017 6.551-1.784 9.493-10.587 6.55-28.993-2.205-29.856-2.635-21.421-12.614-39.334-29.269-51.954-52.047-12.187-21.924-19.267-45.435-20.435-70.542-.308-6.061 1.478-8.207 7.509-9.307 7.94-1.471 16.127-1.778 24.068-.615 33.547 4.9 62.108 19.902 86.054 43.66 13.666 13.531 24.007 29.699 34.658 45.496 11.326 16.778 23.514 32.761 39.026 45.865 5.479 4.592 9.848 8.083 14.035 10.656-12.62 1.407-33.673 1.714-48.075-9.676zm15.899-102.519c.521-2.111 2.421-3.658 4.722-3.658a4.74 4.74 0 011.661.305c.678.246 1.293.614 1.786 1.163.861.859 1.354 2.083 1.354 3.368 0 2.695-2.154 4.837-4.862 4.837a4.748 4.748 0 01-4.738-4.034 5.01 5.01 0 01.077-1.981zm47.208 26.915c-2.606.996-5.2 1.778-7.707 1.88-4.679.244-9.787-1.654-12.556-3.981-4.308-3.612-7.386-5.631-8.679-11.941-.554-2.695-.247-6.858.246-9.246 1.108-5.144-.124-8.451-3.754-11.451-2.954-2.449-6.711-3.122-10.834-3.122-1.539 0-2.954-.673-4.001-1.224-1.724-.856-3.139-3-1.785-5.634.432-.856 2.525-2.939 3.018-3.305 5.6-3.185 12.065-2.144 18.034.244 5.54 2.266 9.727 6.429 15.759 12.307 6.155 7.102 7.263 9.063 10.773 14.39 2.771 4.163 5.294 8.451 7.018 13.348.877 2.561.071 4.74-2.341 6.277-.981.625-2.109 1.044-3.191 1.458z"/>
        </svg>
      </div>
    </div>
    <div class="max-w-[860px] mx-auto">
      <MessageItem
        v-for="msg in chatStore.messages"
        :key="msg.id"
        :message="msg"
      />

      <!-- 等待首 token -->
      <div v-if="chatStore.isGenerating && !chatStore.streaming && !chatStore.streamingThinking" class="mb-6">
        <div class="flex items-start gap-3">
          <div
            :class="[
              'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 overflow-hidden',
              avatarUrl ? 'bg-transparent' : 'bg-app-accent text-white'
            ]"
          >
            <img v-if="avatarUrl" :src="avatarUrl" class="w-full h-full object-contain" />
            <span v-else>D</span>
          </div>
          <div class="flex items-center gap-1 py-1.5">
            <span class="w-2 h-2 rounded-full bg-app-accent animate-bounce" style="animation-delay: 0ms" />
            <span class="w-2 h-2 rounded-full bg-app-accent animate-bounce" style="animation-delay: 150ms" />
            <span class="w-2 h-2 rounded-full bg-app-accent animate-bounce" style="animation-delay: 300ms" />
          </div>
        </div>
      </div>

      <!-- 工具调用状态：仅当当前会话正在生成时显示，防止切换会话后工具结果泄漏 -->
      <ToolCallStatus v-if="chatStore.activeToolCalls.length > 0 && chatStore.isGenerating" :calls="chatStore.activeToolCalls" />

      <!-- 流式输出 -->
      <div v-if="chatStore.streaming || chatStore.streamingThinking" class="mb-6">
        <div class="flex items-start gap-3">
          <div
            :class="[
              'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 overflow-hidden',
              avatarUrl ? 'bg-transparent' : 'bg-app-accent text-white'
            ]"
          >
            <img v-if="avatarUrl" :src="avatarUrl" class="w-full h-full object-contain" />
            <span v-else>D</span>
          </div>
          <div class="min-w-0 flex-1">
            <div v-if="chatStore.streamingThinking" class="mb-3">
              <details :open="isThinkingActive || chatStore.thinkingManuallyExpanded" @toggle="onThinkingToggle" class="text-xs">
                <summary class="text-app-muted hover:text-app-heading cursor-pointer font-medium">
                  {{ isThinkingActive ? '思考中...' : '思考过程' }}
                </summary>
                <div class="mt-2 pl-4 border-l-2 border-app-accent-soft-border text-app-muted leading-[1.8] whitespace-pre-wrap">
                  {{ chatStore.streamingThinking }}
                </div>
              </details>
            </div>
            <!-- 已闭合的 Markdown 部分：用 marked 实时渲染 -->
            <div
              v-if="streamHtml"
              class="text-app-text leading-[1.8] markdown-body prose-sm max-w-none
                     prose-headings:text-app-heading prose-p:text-app-text prose-strong:text-app-text
                     prose-a:text-app-accent prose-a:no-underline
                     prose-code:text-inherit prose-code:bg-transparent prose-code:p-0 prose-code:text-xs prose-code:font-normal
                     prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0
                     prose-li:text-app-text prose-table:border-app-border"
              :style="{ fontSize: 'var(--app-font-size)' }"
              v-html="streamHtml"
            />
            <!-- 未闭合的代码块部分：纯文本 + 光标 -->
            <div class="text-app-text whitespace-pre-wrap leading-[1.8]" :style="{ fontSize: 'var(--app-font-size)' }">
              {{ streamingPending }}<StreamCursor v-if="streamingPending || !streamHtml" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 滚动到底按钮 -->
    <div v-if="showScrollBtn" class="sticky bottom-4 flex justify-end pointer-events-none z-10">
      <button
        @click="scrollToBottom()"
        class="pointer-events-auto w-9 h-9 rounded-full bg-app-card border border-app-border
               flex items-center justify-center text-app-muted hover:text-app-accent hover:border-app-accent
               shadow-md transition-all -mr-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  </div>
</template>
