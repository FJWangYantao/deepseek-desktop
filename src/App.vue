<script setup lang="ts">
import Sidebar from '@/components/sidebar/Sidebar.vue'
import ChatView from '@/views/ChatView.vue'
import SettingsView from '@/views/SettingsView.vue'
import StatsView from '@/views/StatsView.vue'
import { useSettingsStore } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'
import { useRoute } from 'vue-router'
import { watch, onMounted, ref } from 'vue'

const route = useRoute()
const settings = useSettingsStore()
const theme = useTheme()
const sidebarCollapsed = ref(false)

function applyFontSize(size: number) {
  document.documentElement.style.setProperty('--app-font-size', `${size}px`)
}

onMounted(() => {
  applyFontSize(settings.fontSize)
})
watch(() => settings.fontSize, applyFontSize)
</script>

<template>
  <div class="h-full flex">
    <Sidebar :collapsed="sidebarCollapsed" @toggle="sidebarCollapsed = !sidebarCollapsed" />
    <ChatView v-show="route.path === '/'" />
    <SettingsView v-show="route.path === '/settings'" />
    <StatsView v-show="route.path === '/stats'" />
  </div>
</template>
