<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useSkillStore } from '@/stores/skills'

const store = useSkillStore()
const show = ref(false)
const btnRef = ref<HTMLElement>()
const dropdownStyle = ref<Record<string, string>>({})

const loadedLabel = computed(() => {
  const loaded = store.loadedSkill
  if (!loaded) return 'none'
  return loaded.displayName || loaded.name
})

const activeLabel = computed(() => {
  if (store.loadedSkill) return `Loaded: ${loadedLabel.value}`
  return 'Index on · Auto'
})

const modeDesc = computed(() => 'Skill Index 始终注入，由模型根据任务自动判断是否加载一个 Skill。')

onMounted(() => { store.loadSkillIndex() })
onUnmounted(() => { show.value = false })

function updatePosition() {
  nextTick(() => {
    if (!btnRef.value) return
    const rect = btnRef.value.getBoundingClientRect()
    dropdownStyle.value = {
      position: 'fixed',
      left: rect.left + 'px',
      bottom: (window.innerHeight - rect.top + 8) + 'px',
      minWidth: '300px',
      maxHeight: '360px',
      overflowY: 'auto',
    }
  })
}

function toggle() {
  show.value = !show.value
  if (show.value) updatePosition()
}

function badgeClass(kind: string) {
  return kind === 'package'
    ? 'bg-app-accent-soft text-app-accent'
    : 'bg-amber-500/10 text-amber-500'
}
</script>

<template>
  <div>
    <button
      ref="btnRef"
      @click="toggle"
      class="flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors max-w-[170px]"
      :class="show || store.loadedSkillId
        ? 'border-app-accent bg-app-accent-soft text-app-accent'
        : 'border-app-border text-app-muted hover:border-app-accent-soft-border hover:text-app-heading'"
      :title="modeDesc"
    >
      <span class="truncate">{{ activeLabel }}</span>
      <svg class="w-3 h-3 transition-transform shrink-0" :class="{ 'rotate-180': show }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <Teleport to="body">
      <div v-if="show" class="fixed inset-0 z-[99]" @click="show = false" />
      <div
        v-if="show"
        class="z-[100] bg-app-input border border-app-border rounded-xl shadow-lg py-1.5"
        :style="dropdownStyle"
      >
        <div class="px-3 py-2 border-b border-app-border/50">
          <div class="text-xs font-medium text-app-heading">Skill Index 始终开启</div>
          <div class="text-[11px] text-app-muted mt-0.5 leading-relaxed">
            像 Claude Code 一样，模型会根据任务自行判断是否加载 Skill；这里不需要手动选择。
          </div>
          <div class="text-[11px] text-app-muted mt-1">
            当前 Loaded：<span class="text-app-accent">{{ loadedLabel }}</span>
          </div>
        </div>

        <div class="px-3 py-2 border-b border-app-border/50">
          <div class="text-xs text-app-heading">Auto</div>
          <div class="text-[11px] text-app-muted mt-0.5 leading-relaxed">
            不预加载任何 Skill。每轮对话都会注入索引，模型最多按需加载一个最相关 Skill。
          </div>
        </div>

        <div v-if="store.skillIndex.length > 0" class="px-3 py-2 text-[11px] text-app-muted">
          可被模型加载的 Skill
        </div>
        <div
          v-for="s in store.skillIndex"
          :key="s.id"
          class="w-[calc(100%-8px)] px-3 py-2 mx-1 rounded-lg text-sm"
          :class="store.loadedSkillId === s.id ? 'bg-app-accent-soft text-app-accent' : 'text-app-heading'"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="truncate">{{ s.displayName || s.name }}</span>
            <span class="text-[9px] px-1 py-px rounded shrink-0" :class="badgeClass(s.kind)">{{ s.kind === 'package' ? 'PKG' : 'LEGACY' }}</span>
            <span v-if="store.loadedSkillId === s.id" class="text-[9px] px-1 py-px rounded bg-app-accent-soft text-app-accent shrink-0">loaded</span>
            <span v-if="s.hasScripts" class="text-[9px] px-1 py-px rounded bg-app-border/30 text-app-muted shrink-0">scripts</span>
          </div>
          <div class="text-[11px] text-app-muted mt-0.5 line-clamp-2 leading-relaxed">{{ s.description }}</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
