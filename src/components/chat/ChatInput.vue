<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import ModelSelector from './ModelSelector.vue'
import ThinkingToggle from './ThinkingToggle.vue'
import FileAttach from './FileAttach.vue'
import SkillSelector from './SkillSelector.vue'
import ContextRing from './ContextRing.vue'
import { useTokenCounter } from '@/composables/useTokenCounter'
import { useQuote } from '@/composables/useQuote'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const tokenCounter = useTokenCounter()
const quote = useQuote()

const inputText = ref('')
const sending = ref(false)
const fileAttachRef = ref<InstanceType<typeof FileAttach>>()

async function send() {
  const text = inputText.value.trim()
  if (!text || sending.value || chatStore.isGenerating) return
  sending.value = true
  try {
    const parsed = await fileAttachRef.value?.parseAll() ?? []
    const fileInfos = fileAttachRef.value?.files ?? []
    const files = parsed.map(pf => {
      const info = fileInfos.find(fi => fi.name === pf.name)
      return { ...pf, size: info?.size ?? 0 }
    })
    fileAttachRef.value?.clearFiles()
    inputText.value = ''
    nextTick(() => {
      const el = document.querySelector('.chat-textarea') as HTMLTextAreaElement
      if (el) { el.style.height = '' }
    })
    const quoteData = quote.quoteText.value
      ? { text: quote.quoteText.value, messageId: quote.quoteMessageId.value }
      : undefined
    quote.clearQuote()
    await chatStore.sendMessage(text, files.length > 0 ? files : undefined, quoteData)
  } catch {
    // sendMessage 内部已处理错误提示
  } finally {
    sending.value = false
  }
}

function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 400) + 'px'
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.files
  if (!items || items.length === 0) return
  const list: FileInfo[] = []
  for (let i = 0; i < items.length; i++) {
    const f = items[i]
    const path = window.electronAPI?.getFilePath?.(f)
    if (!path) continue
    const parts = f.name.split('.')
    list.push({
      path,
      name: f.name,
      size: f.size,
      ext: parts.length > 1 ? '.' + parts.pop()!.toLowerCase() : '',
    })
  }
  if (list.length > 0) {
    e.preventDefault()
    fileAttachRef.value?.addFiles(list)
  }
}
</script>

<template>
  <div class="px-4 pb-4 pt-2">
    <div class="max-w-[860px] mx-auto">
      <div class="bg-app-input border border-app-border rounded-2xl overflow-hidden">
        <!-- 文件标签：左上角椭形 -->
        <div v-if="fileAttachRef?.files?.length" class="flex flex-wrap gap-1.5 px-4 pt-3">
          <span
            v-for="(f, i) in fileAttachRef.files"
            :key="f.path"
            class="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] rounded-full
                   bg-app-accent-soft text-app-accent border border-app-accent-soft-border"
          >
            <span class="truncate max-w-[140px]">{{ f.name }}</span>
            <span class="text-[10px] opacity-60">{{ fileAttachRef.formatSize(f.size) }}</span>
            <button @click="fileAttachRef.removeFile(i)" class="hover:text-red-500 transition-colors">&times;</button>
          </span>
        </div>
        <!-- 引用预览 -->
        <div v-if="quote.quoteText.value" class="flex items-start gap-2 px-4 py-2 border-b border-app-border bg-app-accent-soft/30">
          <div class="flex-1 min-w-0">
            <div class="text-[11px] text-app-accent font-medium mb-0.5">引用</div>
            <div class="text-xs text-app-muted line-clamp-2 leading-[1.6]">{{ quote.quoteText.value }}</div>
          </div>
          <button @click="quote.clearQuote()" class="text-app-muted hover:text-red-500 text-lg leading-none mt-0.5">&times;</button>
        </div>
        <textarea
          v-model="inputText"
          @keydown="onKeydown"
          @paste="onPaste"
          @input="autoResize"
          :disabled="sending"
          rows="1"
          placeholder="输入消息..."
          :style="{ fontSize: 'var(--app-font-size)' }"
          class="chat-textarea w-full resize-none px-4 py-3 text-app-text placeholder-app-muted
                 bg-transparent border-none outline-none leading-[1.8]
                 min-h-[64px] max-h-[400px]"
        ></textarea>
        <div class="flex items-center justify-between px-3 pb-2.5">
          <div class="flex gap-1.5 items-center">
            <ModelSelector />
            <ThinkingToggle />
            <SkillSelector />
            <ContextRing
              :percentage="tokenCounter.percentage.value"
              :token-count="tokenCounter.tokenCount.value"
              :context-length="tokenCounter.contextLength.value"
              :message-count="tokenCounter.messageCount.value"
            />
          </div>
          <div class="flex items-center gap-1.5">
            <FileAttach ref="fileAttachRef" />
            <button
              v-if="chatStore.isGenerating"
              @click="chatStore.stopGenerating()"
              class="px-4 py-1.5 text-sm font-medium rounded-lg text-white transition-colors
                     bg-red-500 hover:bg-red-600"
            >
              停止
            </button>
            <button
              v-else
              @click="send"
              :disabled="!inputText.trim() || sending || chatStore.isGenerating"
              class="px-4 py-1.5 text-sm font-medium rounded-lg text-white transition-colors
                     bg-app-accent hover:bg-app-accent-hover
                     disabled:opacity-40 disabled:cursor-not-allowed"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
