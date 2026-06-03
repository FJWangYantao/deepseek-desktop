<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useSkillStore } from '@/stores/skills'

const store = useSkillStore()
const show = ref(false)
const btnRef = ref<HTMLElement>()
const dropdownStyle = ref<Record<string, string>>({})

onMounted(() => { store.loadSkills() })
onUnmounted(() => { show.value = false })

function toggle() {
  show.value = !show.value
  if (show.value) {
    nextTick(() => {
      if (!btnRef.value) return
      const rect = btnRef.value.getBoundingClientRect()
      dropdownStyle.value = {
        position: 'fixed',
        left: rect.left + 'px',
        bottom: (window.innerHeight - rect.top + 8) + 'px',
        minWidth: '220px',
        maxHeight: '320px',
        overflowY: 'auto',
      }
    })
  }
}

function select(id: string | null) {
  store.selectSkill(id)
  show.value = false
}

const activeLabel = store.activeSkill ? `⚡${store.activeSkill.name}` : 'Skill'
</script>

<template>
  <div>
    <button
      ref="btnRef"
      @click="toggle"
      class="flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors"
      :class="show || store.activeSkillId
        ? 'border-app-accent bg-app-accent-soft text-app-accent'
        : 'border-app-border text-app-muted hover:border-app-accent-soft-border hover:text-app-heading'"
    >
      <span class="max-w-[60px] truncate">{{ activeLabel }}</span>
      <svg class="w-3 h-3 transition-transform" :class="{ 'rotate-180': show }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <button
          @click="select(null)"
          class="w-full text-left px-3 py-2 mx-1 rounded-lg transition-colors text-sm"
          :class="!store.activeSkillId ? 'bg-app-accent-soft text-app-accent font-medium' : 'text-app-muted hover:bg-app-hover'"
          style="width: calc(100% - 8px);"
        >
          无 Skill
        </button>
        <div v-if="store.skills.length > 0" class="border-t border-app-border my-1" />
        <button
          v-for="s in store.skills"
          :key="s.id"
          @click="select(s.id)"
          class="w-full text-left px-3 py-2 mx-1 rounded-lg transition-colors text-sm"
          :class="store.activeSkillId === s.id ? 'bg-app-accent-soft text-app-accent font-medium' : 'text-app-heading hover:bg-app-hover'"
          style="width: calc(100% - 8px);"
        >
          <span>{{ s.name }}</span>
          <span class="text-[11px] text-app-muted ml-2">{{ s.description }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
