<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import ModelSelector from './ModelSelector.vue'
import ThinkingToggle from './ThinkingToggle.vue'
import FileAttach from './FileAttach.vue'
import ToolPermissionModeSelector from './ToolPermissionModeSelector.vue'
import ContextRing from './ContextRing.vue'
import { useTokenCounter } from '@/composables/useTokenCounter'
import { useQuote } from '@/composables/useQuote'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'])

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const tokenCounter = useTokenCounter()
const quote = useQuote()

const inputText = ref('')
const sending = ref(false)
const fileAttachRef = ref<InstanceType<typeof FileAttach>>()
const isDragging = ref(false)

function isImageFile(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase())
}

async function send() {
  const text = inputText.value.trim()
  if (!text || sending.value || chatStore.isGenerating) return
  sending.value = true
  try {
    const parsed = await fileAttachRef.value?.parseAll() ?? []
    const fileInfos = fileAttachRef.value?.files ?? []

    // 分离图片文件和普通文件
    const imageFiles = fileInfos.filter(f => isImageFile(f.ext)).map(f => ({
      path: f.path, name: f.name, ext: f.ext, size: f.size,
    }))
    const normalFiles = parsed.map(pf => {
      const info = fileInfos.find(fi => fi.name === pf.name)
      return { ...pf, size: info?.size ?? 0 }
    })

    fileAttachRef.value?.clearFiles()
    inputText.value = ''
    nextTick(() => {
      const el = document.querySelector('.chat-textarea') as HTMLTextAreaElement
      if (el) { el.style.height = '' }
    })
    const quotesData = quote.quotes.value.length > 0 ? [...quote.quotes.value] : undefined
    quote.clearQuotes()
    await chatStore.sendMessage(
      text,
      normalFiles.length > 0 ? normalFiles : undefined,
      quotesData,
      imageFiles.length > 0 ? imageFiles : undefined,
    )
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
  const clipItems = e.clipboardData?.items
  if (!clipItems || clipItems.length === 0) return

  const list: FileInfo[] = []

  // 检测剪贴板图片（截图等，没有文件路径的 Blob）
  for (const item of clipItems) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue

    e.preventDefault()
    const ext = item.type === 'image/png' ? '.png'
      : item.type === 'image/jpeg' ? '.jpg'
      : item.type === 'image/gif' ? '.gif'
      : item.type === 'image/webp' ? '.webp'
      : '.png'
    const name = `粘贴图片_${new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')}${ext}`

    // 读取为 base64 → IPC 保存为临时文件
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]
      if (!base64) return
      try {
        const filePath = await window.electronAPI!.saveClipboardImage({ base64, ext })
        fileAttachRef.value?.addFiles([{
          path: filePath,
          name,
          size: file.size,
          ext,
        }])
      } catch (err) {
        console.error('[Paste] 保存剪贴板图片失败:', err)
      }
    }
    reader.readAsDataURL(file)
    return // 剪贴板图片已处理，不再处理文件
  }

  // 文件粘贴（从文件管理器复制的文件）
  const files = e.clipboardData?.files
  if (!files || files.length === 0) return
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
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

function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave() {
  isDragging.value = false
}

function handleDrop(e: DragEvent) {
  isDragging.value = false
  const items = e.dataTransfer?.files
  if (!items || items.length === 0) return
  const list: FileInfo[] = []
  for (let i = 0; i < items.length; i++) {
    const f = items[i]
    const path = window.electronAPI?.getFilePath?.(f)
    if (!path) continue
    const parts = f.name.split('.')
    list.push({
      path, name: f.name, size: f.size,
      ext: parts.length > 1 ? '.' + parts.pop()!.toLowerCase() : '',
    })
  }
  if (list.length > 0) fileAttachRef.value?.addFiles(list)
}
</script>

<template>
  <div class="px-6 pb-6 pt-4">
    <div class="max-w-[860px] mx-auto">
      <div
        class="bg-app-input border rounded-2xl overflow-hidden relative transition-colors input-focus-lift"
        :class="isDragging ? 'border-app-accent bg-app-accent-soft/10' : 'border-app-border'"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="handleDrop"
      >
        <!-- 拖拽高亮覆盖层 -->
        <div v-if="isDragging" class="absolute inset-0 z-10 flex items-center justify-center bg-app-accent-soft/10 pointer-events-none">
          <span class="text-sm text-app-accent font-medium">拖拽文件到此处</span>
        </div>
        <!-- 文件标签 -->
        <TransitionGroup name="file-tag" tag="div" v-if="fileAttachRef?.files?.length" class="flex flex-wrap gap-1.5 px-4 pt-3">
          <span
            v-for="(f, i) in fileAttachRef.files"
            :key="f.path"
            class="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] rounded-full
                   bg-app-accent-soft text-app-accent border border-app-accent-soft-border"
          >
            <svg v-if="isImageFile(f.ext)" class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <svg v-else class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span class="truncate max-w-[140px]">{{ f.name }}</span>
            <span class="text-[10px] opacity-60">{{ fileAttachRef.formatSize(f.size) }}</span>
            <button @click="fileAttachRef.removeFile(i)" class="hover:text-red-500 transition-colors">&times;</button>
          </span>
        </TransitionGroup>
        <!-- 引用预览（多条） -->
        <div v-if="quote.hasQuotes.value" class="px-4 py-2 border-b border-app-border bg-app-accent-soft/30">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[11px] text-app-accent font-medium">引用 ({{ quote.quotes.value.length }})</span>
            <button @click="quote.clearQuotes()" class="text-[11px] text-app-muted hover:text-red-500 transition-colors">清除全部</button>
          </div>
          <div class="space-y-1">
            <div v-for="(q, i) in quote.quotes.value" :key="q.messageId + '-' + i" class="flex items-start gap-2">
              <div class="flex-1 min-w-0 text-xs text-app-muted line-clamp-2 leading-[1.6]">{{ q.text }}</div>
              <button @click="quote.removeQuote(i)" class="text-app-muted hover:text-red-500 text-sm leading-none mt-0.5 shrink-0">&times;</button>
            </div>
          </div>
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
            <ToolPermissionModeSelector />
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
              class="px-4 py-1.5 text-sm font-medium rounded-lg text-white transition-colors btn-interactive
                     bg-red-500 hover:bg-red-600"
            >
              停止
            </button>
            <button
              v-else
              @click="send"
              :disabled="!inputText.trim() || sending || chatStore.isGenerating"
              class="px-4 py-1.5 text-sm font-medium rounded-lg text-white transition-colors btn-interactive
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
