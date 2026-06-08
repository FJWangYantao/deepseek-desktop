<script setup lang="ts">
import { ref } from 'vue'

const files = ref<FileInfo[]>([])
const parsing = ref(false)

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'])

function isImage(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase())
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

async function selectFiles() {
  if (!window.electronAPI?.selectFiles) return
  const result = await window.electronAPI.selectFiles()
  if (result.length > 0) {
    files.value = [...files.value, ...result].slice(0, 5)
  }
}

function addFiles(list: FileInfo[]) {
  files.value = [...files.value, ...list].slice(0, 5)
}

function removeFile(index: number) {
  files.value.splice(index, 1)
}

async function parseAll(): Promise<ParsedFile[]> {
  if (files.value.length === 0) return []
  parsing.value = true
  try {
    // 跳过图片文件，只解析文本文件
    const nonImagePaths = files.value
      .filter(f => !IMAGE_EXTS.has(f.ext.toLowerCase()))
      .map(f => f.path)
    if (nonImagePaths.length === 0) return []
    return await window.electronAPI!.parseFiles(nonImagePaths)
  } finally {
    parsing.value = false
  }
}

function clearFiles() {
  files.value = []
}

defineExpose({ files, parsing, parseAll, clearFiles, removeFile, addFiles, formatSize })
</script>

<template>
  <button
    @click="selectFiles"
    :disabled="parsing"
    class="w-7 h-7 rounded-full border border-app-border flex items-center justify-center
           text-app-muted hover:border-app-accent hover:text-app-accent transition-colors
           disabled:opacity-50"
    title="添加文件"
  >
    <svg v-if="!parsing" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
    </svg>
    <svg v-else class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  </button>
</template>
