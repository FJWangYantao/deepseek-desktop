<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import { nextTick, ref, watch } from 'vue'
import MessageItem from './MessageItem.vue'
import StreamCursor from '@/components/renderer/StreamCursor.vue'

const chatStore = useChatStore()
const listRef = ref<HTMLElement>()

watch(
  () => chatStore.messages.length,
  async () => { await nextTick(); scrollToBottom() }
)

watch(
  () => chatStore.streaming,
  async () => { await nextTick(); scrollToBottom() }
)

function scrollToBottom() {
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight
  }
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
      <!-- 流式输出 -->
      <div v-if="chatStore.streaming" class="mb-6">
        <div class="flex items-start gap-3">
          <div class="w-7 h-7 rounded-lg bg-app-accent flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
            D
          </div>
          <div class="min-w-0 flex-1">
            <div v-if="chatStore.streamingThinking" class="mb-2">
              <details class="text-sm">
                <summary class="text-app-muted cursor-pointer">思考中...</summary>
                <div class="mt-1 p-2.5 bg-amber-50 rounded-lg border border-amber-100 text-app-muted text-xs whitespace-pre-wrap">
                  {{ chatStore.streamingThinking }}
                </div>
              </details>
            </div>
            <div class="text-sm text-app-text whitespace-pre-wrap leading-relaxed">
              {{ chatStore.streaming }}<StreamCursor />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
