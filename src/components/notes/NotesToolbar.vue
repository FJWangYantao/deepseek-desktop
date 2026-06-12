<script setup lang="ts">
import { ref, watch } from 'vue'
import { INSIGHT_COLORS } from '@/types/notes'

const props = defineProps<{
  allTags: string[]
  modelSearchQuery: string
  modelFilterTag: string | null
  modelFilterColor: string | null
  modelSortOrder: 'newest' | 'oldest'
}>()

const emit = defineEmits<{
  'update:modelSearchQuery': [value: string]
  'update:modelFilterTag': [value: string | null]
  'update:modelFilterColor': [value: string | null]
  'update:modelSortOrder': [value: 'newest' | 'oldest']
}>()

// 搜索防抖
const searchInput = ref(props.modelSearchQuery)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => emit('update:modelSearchQuery', val), 200)
})

function toggleTag(tag: string) {
  emit('update:modelFilterTag', props.modelFilterTag === tag ? null : tag)
}

function toggleColor(color: string) {
  emit('update:modelFilterColor', props.modelFilterColor === color ? null : color)
}
</script>

<template>
  <div class="space-y-2">
    <!-- 搜索框 -->
    <div class="relative">
      <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-app-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        v-model="searchInput"
        placeholder="搜索笔记..."
        class="w-full pl-8 pr-3 py-2 text-sm bg-app-input border border-app-border rounded-lg text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-accent"
      />
    </div>

    <!-- 筛选行 -->
    <div class="flex items-center gap-2 flex-wrap">
      <!-- 颜色筛选 -->
      <div class="flex items-center gap-1">
        <button
          v-for="color in INSIGHT_COLORS"
          :key="color"
          @click="toggleColor(color)"
          class="w-4 h-4 rounded-full transition-all"
          :class="modelFilterColor === color ? 'ring-2 ring-offset-1 ring-offset-app-bg scale-125' : 'opacity-60 hover:opacity-100'"
          :style="{ backgroundColor: color, '--tw-ring-color': color } as any"
          :title="'筛选颜色'"
        />
      </div>

      <span class="text-app-border">|</span>

      <!-- 标签筛选 -->
      <button
        v-for="tag in allTags.slice(0, 8)"
        :key="tag"
        @click="toggleTag(tag)"
        class="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
        :class="modelFilterTag === tag
          ? 'bg-app-accent text-white border-app-accent'
          : 'text-app-muted border-app-border hover:text-app-text hover:border-app-accent/50'"
      >
        {{ tag }}
      </button>

      <span class="flex-1" />

      <!-- 排序 -->
      <button
        @click="emit('update:modelSortOrder', modelSortOrder === 'newest' ? 'oldest' : 'newest')"
        class="text-[11px] px-2 py-0.5 rounded-full text-app-muted hover:text-app-text hover:bg-app-hover transition-colors flex items-center gap-1"
        :title="modelSortOrder === 'newest' ? '最新优先' : '最早优先'"
      >
        <svg class="w-3.5 h-3.5" :class="{ 'rotate-180': modelSortOrder === 'oldest' }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
        {{ modelSortOrder === 'newest' ? '最新' : '最早' }}
      </button>
    </div>
  </div>
</template>
