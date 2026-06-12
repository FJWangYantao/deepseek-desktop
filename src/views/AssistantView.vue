<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'

const capturedText = ref('')
const result = ref('')
const loading = ref(false)
const copied = ref(false)

// 两种状态：bar（矮长条）和 panel（展开面板）
type Phase = 'bar' | 'panel'
const phase = ref<Phase>('bar')

const truncatedText = computed(() => {
  const t = capturedText.value
  if (!t) return ''
  return t.length > 30 ? t.slice(0, 30) + '…' : t
})

let textHandler: ((text: string) => void) | null = null

onMounted(() => {
  textHandler = (text: string) => {
    capturedText.value = text
    result.value = ''
    loading.value = false
    phase.value = 'bar'
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

  try {
    const res = await window.electronAPI?.assistantQuery(capturedText.value, action)
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
</script>

<template>
  <!-- 矮长条模式 -->
  <div v-if="phase === 'bar'" class="bar">
    <span class="bar-logo">✦</span>
    <span class="bar-text" :title="capturedText">{{ truncatedText }}</span>
    <button class="bar-btn" @click="doAction('translate')">翻译</button>
    <button class="bar-btn" @click="doAction('explain')">解释</button>
    <button class="bar-close" @click="hide">✕</button>
  </div>

  <!-- 展开面板模式 -->
  <div v-else class="panel">
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
      <div class="result-text">{{ result }}</div>
      <button class="copy-btn" @click="copyResult">
        {{ copied ? '已复制 ✓' : '复制' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ===== 矮长条 ===== */
.bar {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: var(--app-card, #fff);
  border: 1px solid var(--app-border, #e5e5e5);
  border-radius: 8px;
  font-family: var(--app-font-family, system-ui, sans-serif);
  user-select: none;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
}

.bar-logo {
  color: var(--app-accent, #d97706);
  font-size: 14px;
  flex-shrink: 0;
}

.bar-text {
  flex: 1;
  font-size: 12px;
  color: var(--app-text, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  line-height: 1;
}

.bar-btn {
  flex-shrink: 0;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--app-border, #e5e5e5);
  border-radius: 5px;
  background: transparent;
  color: var(--app-text, #333);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.bar-btn:hover {
  border-color: var(--app-accent, #d97706);
  color: var(--app-accent, #d97706);
  background: var(--app-accent-soft, rgba(217, 119, 6, 0.08));
}

.bar-close {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
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
.bar-close:hover {
  background: var(--app-hover, #f0f0f0);
  color: var(--app-text, #333);
}

/* ===== 展开面板 ===== */
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

.result-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--app-text, #333);
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
</style>
