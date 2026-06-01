<script setup lang="ts">
import Sidebar from '@/components/sidebar/Sidebar.vue'
import { useSettingsStore } from '@/stores/settings'
import { watch, onMounted } from 'vue'

const settings = useSettingsStore()

function applyFontSize(size: number) {
  document.documentElement.style.setProperty('--app-font-size', `${size}px`)
}

onMounted(() => applyFontSize(settings.fontSize))
watch(() => settings.fontSize, applyFontSize)
</script>

<template>
  <div class="h-full flex">
    <Sidebar />
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </div>
</template>
