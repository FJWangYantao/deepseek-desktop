<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { renderMarkdown } from '@/composables/useMarkdown'
import { useStreamRender } from '@/composables/useStreamRender'
import { DEFAULT_ASSISTANT_TRANSLATE_PROMPT, DEFAULT_ASSISTANT_EXPLAIN_PROMPT } from '@/data/prompts'
import { useAssistantChat } from '@/composables/useAssistantChat'
import { useSettingsStore } from '@/stores/settings'

const capturedText = ref('')
const result = ref('')
// 结果用主渲染器渲染（同聊天窗口）：markdown 排版 + KaTeX 公式 + 链接化 + DOMPurify 净化
const resultHtml = computed(() => (result.value ? renderMarkdown(result.value) : ''))
const loading = ref(false)
const copied = ref(false)

// 三种状态：bar（矮长条）、panel（翻译/解释面板）、chat（划词对话）
type Phase = 'bar' | 'panel' | 'chat'
const phase = ref<Phase>('bar')

let textHandler: ((text: string) => void) | null = null

// ===== 划词对话（chat 模式）=====
const assistantChat = useAssistantChat()
const streamRender = useStreamRender()
// 流式 safe/pending 分离：未闭合 ``` 或 $$ 不闪现到 markdown 渲染
const streamingSafeHtml = computed(() => {
  if (!assistantChat.streamingText.value) return ''
  const { safeContent } = streamRender.processChunk('', assistantChat.streamingText.value)
  return renderMarkdown(safeContent)
})

// apiKey 未就绪提示
const settings = useSettingsStore()
const apiKeyReady = computed(() => !!settings.apiKey)
const inputText = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const messagesEl = ref<HTMLDivElement | null>(null)

// 快捷 chip
const chips = ['总结', '详细说明', '举个例子', '换个角度']

// 粘底标志：用户上滚后停止自动滚，滚回底部附近则恢复。
// 流式 token 只在 stickToBottom 时跟滚；用户主动操作（发消息/进对话）强制粘底。
const stickToBottom = ref(true)
// 容器底部判定阈值：距底 < N px 视为"在底部"（含滚动惯性 + 浮点误差容差）
const STICK_THRESHOLD = 24

function forceScrollToBottom() {
  nextTick(() => {
    const el = messagesEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

/** 用户主动操作（发消息 / 进对话 / 清空）后调用：强制粘底并滚到底。 */
function snapToBottom() {
  stickToBottom.value = true
  forceScrollToBottom()
}

/** 容器 scroll 事件：据此维护 stickToBottom。 */
function onMessagesScroll() {
  const el = messagesEl.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  stickToBottom.value = distanceFromBottom < STICK_THRESHOLD
}

// 流式 token 来时：仅当粘底才跟随滚动（用户上滚则不打扰）
watch(() => assistantChat.streamingText.value, () => {
  if (stickToBottom.value) forceScrollToBottom()
})
// 历史条数变化（新消息入列）：默认粘底
watch(() => assistantChat.messages.value.length, () => {
  if (stickToBottom.value) forceScrollToBottom()
})

async function startChat() {
  if (!capturedText.value) return
  phase.value = 'chat'
  assistantChat.initContext(capturedText.value)
  window.electronAPI?.assistantResize(460, 520)
  await nextTick()
  snapToBottom()
  inputEl.value?.focus()
}

async function sendInput() {
  const text = inputText.value
  if (!text.trim()) return
  if (!apiKeyReady.value) return
  inputText.value = ''
  // 用户主动发送：强制粘底，随后流式 token 会跟滚
  snapToBottom()
  await assistantChat.send(text)
}

async function sendChip(chip: string) {
  if (!apiKeyReady.value) return
  snapToBottom()
  await assistantChat.send(chip)
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void sendInput()
  }
}

function clearChat() {
  assistantChat.clear()
  snapToBottom()
}

onMounted(() => {
  textHandler = (text: string) => {
    capturedText.value = text
    result.value = ''
    loading.value = false
    // 划新词：回到 bar 并清空对话历史（上下文不串）
    phase.value = 'bar'
    assistantChat.clear()
  }
  window.electronAPI?.assistantOnText(textHandler)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') hide()
}

function hide() {
  window.electronAPI?.assistantHide()
}

async function doAction(action: 'translate' | 'explain') {
  if (loading.value || !capturedText.value) return
  phase.value = 'panel'
  loading.value = true
  result.value = ''

  // 通知主进程放大窗口
  window.electronAPI?.assistantResize(420, 340)

  // 取提示词：直接读 localStorage 拿最新值（助手窗口与主窗口共享同源 localStorage，
  // 但各自 pinia 实例不跨窗口响应式，故每次现取而非依赖 store ref）
  const prompt = action === 'translate'
    ? (localStorage.getItem('ds_assistant_translate_prompt') || DEFAULT_ASSISTANT_TRANSLATE_PROMPT)
    : (localStorage.getItem('ds_assistant_explain_prompt') || DEFAULT_ASSISTANT_EXPLAIN_PROMPT)

  try {
    const res = await window.electronAPI?.assistantQuery(capturedText.value, prompt)
    if (res) result.value = res
  } catch {
    // 静默
  } finally {
    loading.value = false
  }
}

async function copyResult() {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(result.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {
    // ignore
  }
}

// 复制划选的原文（bar 长条左一按钮）
async function copyCaptured() {
  if (!capturedText.value) return
  try {
    await navigator.clipboard.writeText(capturedText.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {
    // ignore
  }
}
</script>

<template>
  <!-- 矮长条模式 -->
  <div v-if="phase === 'bar'" class="bar">
    <div class="bar-actions">
      <button class="bar-btn" @click="copyCaptured">{{ copied ? '已复制 ✓' : '复制' }}</button>
      <button class="bar-btn" @click="doAction('translate')">翻译</button>
      <button class="bar-btn" @click="doAction('explain')">解释</button>
      <button class="bar-btn chat-btn" @click="startChat">对话</button>
    </div>
    <!-- 右侧预留区域（未来可扩展更多功能） -->
    <div class="bar-reserve"></div>
    <button class="bar-close" @click="hide">✕</button>
  </div>

  <!-- 翻译/解释面板模式 -->
  <div v-else-if="phase === 'panel'" class="panel">
    <!-- 顶栏 -->
    <div class="panel-header">
      <span class="panel-title">✦ 划词助手</span>
      <button class="panel-close" @click="hide">✕</button>
    </div>
    <!-- 选中文本 -->
    <div class="panel-source">{{ capturedText }}</div>
    <!-- Loading / 结果 -->
    <div v-if="loading" class="panel-result loading">
      <svg class="spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span>AI 处理中...</span>
    </div>
    <div v-else-if="result" class="panel-result">
      <div class="result-text markdown-body prose prose-sm max-w-none break-words prose-p:my-1.5 prose-li:my-0 prose-headings:mb-1 prose-pre:my-2" v-html="resultHtml"></div>
      <button class="copy-btn" @click="copyResult">
        {{ copied ? '已复制 ✓' : '复制' }}
      </button>
    </div>
  </div>

  <!-- 划词对话模式 -->
  <div v-else class="chat">
    <!-- 顶栏 -->
    <div class="chat-header">
      <span class="chat-title">✦ 划词对话</span>
      <div class="chat-actions">
        <button class="chat-mini-btn" @click="clearChat" title="清空对话">清空</button>
        <button class="chat-mini-btn" @click="hide" title="关闭">✕</button>
      </div>
    </div>

    <!-- 消息流 -->
    <div ref="messagesEl" class="chat-messages" @scroll="onMessagesScroll">
      <div
        v-for="m in assistantChat.messages.value"
        :key="m.id"
        class="chat-bubble"
        :class="m.role"
      >
        <div
          v-if="m.role === 'assistant'"
          class="markdown-body prose prose-sm max-w-none break-words prose-p:my-1 prose-li:my-0 prose-headings:mb-1 prose-pre:my-2"
          v-html="renderMarkdown(m.content)"
        ></div>
        <template v-else>{{ m.content }}</template>
      </div>
      <!-- 流式中：渲染累积的 safe 部分 -->
      <div v-if="assistantChat.streaming.value" class="chat-bubble assistant streaming">
        <div
          v-if="streamingSafeHtml"
          class="markdown-body prose prose-sm max-w-none break-words prose-p:my-1 prose-li:my-0 prose-headings:mb-1 prose-pre:my-2"
          v-html="streamingSafeHtml"
        ></div>
        <span v-else class="chat-cursor">…</span>
      </div>
    </div>

    <!-- 快捷 chip -->
    <div class="chat-chips">
      <button
        v-for="c in chips"
        :key="c"
        class="chat-chip"
        :disabled="!apiKeyReady || assistantChat.streaming.value"
        @click="sendChip(c)"
      >{{ c }}</button>
    </div>

    <!-- 输入框 -->
    <div class="chat-input-wrap">
      <textarea
        v-if="apiKeyReady"
        ref="inputEl"
        v-model="inputText"
        class="chat-input"
        :disabled="assistantChat.streaming.value"
        placeholder="追问…（Enter 发送，Shift+Enter 换行）"
        rows="2"
        @keydown="onInputKeydown"
      ></textarea>
      <div v-else class="chat-input chat-input-disabled">请先在设置配置 API Key</div>
      <button
        v-if="apiKeyReady"
        class="chat-send"
        :disabled="!inputText.trim() || assistantChat.streaming.value"
        @click="sendInput"
      >发送</button>
    </div>
  </div>
</template>

<style scoped>
/* ===== 矮长条 ===== */
.bar {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: stretch;
  background: var(--app-card, #fff);
  border: 1px solid var(--app-border, #e5e5e5);
  border-radius: 8px;
  font-family: var(--app-font-family, system-ui, sans-serif);
  user-select: none;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
}

.bar-actions {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
}

.bar-btn {
  padding: 0 14px;
  font-size: 11px;
  font-weight: 500;
  border: none;
  border-right: 1px solid var(--app-border, #e5e5e5);
  background: transparent;
  color: var(--app-text, #333);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.bar-btn:hover {
  color: var(--app-accent, #d97706);
  background: var(--app-accent-soft, rgba(217, 119, 6, 0.08));
}
/* "对话"作为主入口略强调 */
.bar-btn.chat-btn {
  font-weight: 600;
  color: var(--app-accent, #d97706);
}

.bar-reserve {
  flex: 1;
}

.bar-close {
  flex-shrink: 0;
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-left: 1px solid var(--app-border, #e5e5e5);
  background: transparent;
  color: var(--app-muted, #999);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.bar-close:hover {
  background: var(--app-hover, #f0f0f0);
  color: var(--app-text, #333);
}

/* ===== 翻译/解释面板 ===== */
.panel {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-card, #fff);
  border: 1px solid var(--app-border, #e5e5e5);
  border-radius: 10px;
  font-family: var(--app-font-family, system-ui, sans-serif);
  color: var(--app-text, #333);
  overflow: hidden;
  user-select: none;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-bottom: 1px solid var(--app-border, #e5e5e5);
  background: var(--app-surface-alt, #fafaf9);
  -webkit-app-region: drag;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-accent, #d97706);
}

.panel-close {
  -webkit-app-region: no-drag;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--app-muted, #999);
  font-size: 12px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.15s;
}
.panel-close:hover {
  background: var(--app-hover, #f0f0f0);
  color: var(--app-text, #333);
}

.panel-source {
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--app-muted, #666);
  max-height: 60px;
  overflow-y: auto;
  border-bottom: 1px solid var(--app-border, #e5e5e5);
  background: var(--app-hover, #fafafa);
  white-space: pre-wrap;
  word-break: break-all;
}

.panel-result {
  flex: 1;
  padding: 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.panel-result.loading {
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--app-accent, #d97706);
  font-size: 12px;
}

.spin {
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 结果区：交给 prose 排版（公式/列表/段落/标题），不再用 pre-wrap */
.result-text {
  flex: 1;
  overflow-x: auto;
  word-break: break-word;
  color: var(--app-text, #333);
  /* 允许在结果区内选中复制（覆盖面板的 user-select:none） */
  user-select: text;
}

.copy-btn {
  align-self: flex-end;
  margin-top: 6px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--app-border, #e5e5e5);
  border-radius: 5px;
  background: transparent;
  color: var(--app-muted, #999);
  cursor: pointer;
  transition: all 0.15s;
}
.copy-btn:hover {
  border-color: var(--app-accent, #d97706);
  color: var(--app-accent, #d97706);
}

/* ===== 划词对话模式 ===== */
.chat {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-card, #fff);
  border: 1px solid var(--app-border, #e5e5e5);
  border-radius: 10px;
  font-family: var(--app-font-family, system-ui, sans-serif);
  color: var(--app-text, #333);
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-bottom: 1px solid var(--app-border, #e5e5e5);
  background: var(--app-surface-alt, #fafaf9);
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.chat-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-accent, #d97706);
}

.chat-actions {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.chat-mini-btn {
  width: 22px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--app-muted, #999);
  font-size: 11px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.15s;
}
.chat-mini-btn:hover {
  background: var(--app-hover, #f0f0f0);
  color: var(--app-text, #333);
}
/* "清空"文字按钮加宽 */
.chat-mini-btn:first-child {
  width: auto;
  padding: 0 6px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: text;
}

.chat-bubble {
  max-width: 88%;
  padding: 7px 10px;
  border-radius: 10px;
  font-size: 12.5px;
  line-height: 1.55;
  word-break: break-word;
}
.chat-bubble.user {
  align-self: flex-end;
  background: var(--app-accent-soft, rgba(217, 119, 6, 0.12));
  color: var(--app-text, #333);
}
.chat-bubble.assistant {
  align-self: flex-start;
  background: var(--app-hover, #f5f5f4);
  color: var(--app-text, #333);
}
.chat-bubble.streaming {
  opacity: 0.92;
}
.chat-cursor {
  color: var(--app-muted, #999);
}

.chat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 6px 10px 0;
  flex-shrink: 0;
}

.chat-chip {
  padding: 3px 9px;
  font-size: 11px;
  border: 1px solid var(--app-border, #e5e5e5);
  border-radius: 12px;
  background: transparent;
  color: var(--app-muted, #666);
  cursor: pointer;
  transition: all 0.15s;
}
.chat-chip:hover:not(:disabled) {
  border-color: var(--app-accent, #d97706);
  color: var(--app-accent, #d97706);
}
.chat-chip:disabled {
  opacity: 0.5;
  cursor: default;
}

.chat-input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--app-border, #e5e5e5);
  flex-shrink: 0;
}

.chat-input {
  flex: 1;
  resize: none;
  border: 1px solid var(--app-border, #e5e5e5);
  border-radius: 8px;
  padding: 6px 9px;
  font-size: 12.5px;
  line-height: 1.4;
  font-family: inherit;
  background: var(--app-card, #fff);
  color: var(--app-text, #333);
  outline: none;
  user-select: text;
}
.chat-input:focus {
  border-color: var(--app-accent, #d97706);
}
.chat-input:disabled {
  background: var(--app-hover, #f5f5f4);
  color: var(--app-muted, #999);
  cursor: not-allowed;
}
.chat-input-disabled {
  display: flex;
  align-items: center;
  color: var(--app-muted, #999);
  font-size: 12px;
}

.chat-send {
  flex-shrink: 0;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  border-radius: 8px;
  background: var(--app-accent, #d97706);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s;
}
.chat-send:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
