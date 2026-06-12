<script setup lang="ts">
import Sidebar from '@/components/sidebar/Sidebar.vue'
import ChatView from '@/views/ChatView.vue'
import SettingsView from '@/views/SettingsView.vue'
import StatsView from '@/views/StatsView.vue'
import MemoryView from '@/views/MemoryView.vue'
import SkillsView from '@/views/SkillsView.vue'
import NotesView from '@/views/NotesView.vue'
import SessionsView from '@/views/SessionsView.vue'
import MessageDetailView from '@/views/MessageDetailView.vue'
import AssistantView from '@/views/AssistantView.vue'
import { useSettingsStore } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'
import { useRoute } from 'vue-router'
import { watch, onMounted, onBeforeUnmount, ref, nextTick } from 'vue'
import { recordAppExit } from '@/composables/useObservationMemory'

const route = useRoute()
const settings = useSettingsStore()
const theme = useTheme()

function applyFontSize(size: number) {
  document.documentElement.style.setProperty('--app-font-size', `${size}px`)
}

function applyFontFamily(family: string) {
  document.documentElement.style.setProperty('--app-font-family', family)
  // 等宽字体：如果用户选了 JetBrains Mono 就用它，否则保持默认
  // 等宽字体独立于正文字体，仅当用户选 JetBrains Mono 时才同步
  const monoFamily = family.includes('Mono') || family.includes('mono') ? family : ''
  document.documentElement.style.setProperty('--app-font-mono', monoFamily || "'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', 'SF Mono', 'Menlo', 'Monaco', monospace")
}

function applyCodeTheme(theme: string) {
  document.documentElement.setAttribute('data-code-theme', theme)
}

onMounted(() => {
  applyFontSize(settings.fontSize)
  applyFontFamily(settings.fontFamily)
  applyCodeTheme(settings.codeTheme)
})

function handleBeforeUnload() {
  try {
    recordAppExit()
    void window.electronAPI?.observationsFlush?.()
  } catch {
    // ignore
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

watch(() => settings.fontSize, applyFontSize)
watch(() => settings.fontFamily, applyFontFamily)
watch(() => settings.codeTheme, applyCodeTheme)

// ===== 滚动位置记忆 =====
// v-show 切换 display:none 时浏览器会重置 scrollTop，
// 在路由变化前保存、变化后恢复，实现页面间跳转不丢位置
const chatViewRef = ref()
const settingsViewRef = ref()
const statsViewRef = ref()
const sessionsViewRef = ref()
const messageDetailRef = ref()
const memoryViewRef = ref()
const skillsViewRef = ref()
const notesViewRef = ref()

/** 路由 path → 对应 view 的 template ref */
function getViewRef(path: string) {
  if (path === '/') return chatViewRef.value
  if (path === '/settings') return settingsViewRef.value
  if (path === '/stats') return statsViewRef.value
  if (path === '/sessions') return sessionsViewRef.value
  if (path === '/memory') return memoryViewRef.value
  if (path === '/skills') return skillsViewRef.value
  if (path === '/notes') return notesViewRef.value
  if (path.startsWith('/message/')) return messageDetailRef.value
  return null
}

const scrollMemory = new Map<string, number[]>()

/** 查找元素内所有 overflow-y-auto / overflow-auto 子元素的 scrollTop */
function captureScroll(viewEl: HTMLElement): number[] {
  return Array.from(viewEl.querySelectorAll('.overflow-y-auto, .overflow-auto'))
    .map(el => (el as HTMLElement).scrollTop)
}

/** 将保存的 scrollTop 写回对应的滚动容器 */
function applyScroll(viewEl: HTMLElement, positions: number[]) {
  const containers = viewEl.querySelectorAll('.overflow-y-auto, .overflow-auto')
  containers.forEach((el, i) => {
    if (i < positions.length && positions[i] > 0) {
      (el as HTMLElement).scrollTop = positions[i]
    }
  })
}

watch(() => route.path, (newPath, oldPath) => {
  // 1) 保存旧页面的滚动位置（此时 DOM 还没更新，旧页面仍然可见）
  if (oldPath) {
    const oldView = getViewRef(oldPath)
    if (oldView?.$el) {
      const positions = captureScroll(oldView.$el)
      if (positions.some(p => p > 0)) {
        scrollMemory.set(oldPath, positions)
      }
    }
  }
  // 2) 等 DOM 更新（v-show 切换完成）后恢复新页面的滚动位置
  nextTick(() => {
    const newView = getViewRef(newPath)
    const saved = scrollMemory.get(newPath)
    if (newView?.$el && saved) {
      applyScroll(newView.$el, saved)
    }
  })
})
</script>

<template>
  <!-- 划词助手：独立浮动面板，不带侧边栏 -->
  <AssistantView v-if="route.path === '/assistant'" />
  <!-- 正常主窗口 -->
  <div v-else class="h-full flex">
    <Sidebar />
    <ChatView v-show="route.path === '/'" ref="chatViewRef" />
    <SettingsView v-show="route.path === '/settings'" ref="settingsViewRef" />
    <StatsView v-show="route.path === '/stats'" ref="statsViewRef" />
    <SessionsView v-show="route.path === '/sessions'" ref="sessionsViewRef" />
    <MessageDetailView v-show="route.path.startsWith('/message/')" ref="messageDetailRef" />
    <MemoryView v-show="route.path === '/memory'" ref="memoryViewRef" />
    <SkillsView v-show="route.path === '/skills'" ref="skillsViewRef" />
    <NotesView v-show="route.path === '/notes'" ref="notesViewRef" />
  </div>
</template>
