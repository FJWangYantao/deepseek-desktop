<script setup lang="ts">
import Sidebar from '@/components/sidebar/Sidebar.vue'
import ChatView from '@/views/ChatView.vue'
import SettingsView from '@/views/SettingsView.vue'
import StatsView from '@/views/StatsView.vue'
import MemoryView from '@/views/MemoryView.vue'
import SkillsView from '@/views/SkillsView.vue'
import SessionsView from '@/views/SessionsView.vue'
import { useSettingsStore } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'
import { useRoute } from 'vue-router'
import { watch, onMounted } from 'vue'

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
watch(() => settings.fontSize, applyFontSize)
watch(() => settings.fontFamily, applyFontFamily)
watch(() => settings.codeTheme, applyCodeTheme)
</script>

<template>
  <div class="h-full flex">
    <Sidebar />
    <ChatView v-show="route.path === '/'" />
    <SettingsView v-show="route.path === '/settings'" />
    <StatsView v-show="route.path === '/stats'" />
    <SessionsView v-show="route.path === '/sessions'" />
    <MemoryView v-show="route.path === '/memory'" />
    <SkillsView v-show="route.path === '/skills'" />
  </div>
</template>
