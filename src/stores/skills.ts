import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SkillMeta } from '../../electron/ipc/skills'

export const useSkillStore = defineStore('skills', () => {
  const skills = ref<SkillMeta[]>([])
  const activeSkillId = ref<string | null>(null)
  const loading = ref(false)

  const activeSkill = computed(() =>
    skills.value.find(s => s.id === activeSkillId.value) ?? null
  )

  async function loadSkills() {
    if (!window.electronAPI?.listSkills) return
    loading.value = true
    try {
      skills.value = await window.electronAPI.listSkills()
    } finally {
      loading.value = false
    }
  }

  function selectSkill(id: string | null) {
    activeSkillId.value = id
  }

  async function saveSkill(skill: SkillMeta) {
    if (!window.electronAPI?.saveSkill) return
    await window.electronAPI.saveSkill(skill)
    await loadSkills()
  }

  async function deleteSkill(id: string) {
    if (!window.electronAPI?.deleteSkill) return
    await window.electronAPI.deleteSkill(id)
    if (activeSkillId.value === id) activeSkillId.value = null
    await loadSkills()
  }

  return { skills, activeSkillId, activeSkill, loading, loadSkills, selectSkill, saveSkill, deleteSkill }
})
