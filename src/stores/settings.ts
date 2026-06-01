import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModelOption } from '@/types'

export const useSettingsStore = defineStore('settings', () => {
  const apiKey = ref(localStorage.getItem('ds_api_key') ?? '')
  const defaultModel = ref(localStorage.getItem('ds_default_model') ?? 'deepseek-chat')
  const showKey = ref(false)

  const models: ModelOption[] = [
    { id: 'deepseek-chat', name: 'V4 Chat', description: '通用对话模型，快速响应' },
    { id: 'deepseek-reasoner', name: 'V4 Reasoner', description: '深度推理模型，复杂问题' },
  ]

  // 持久化 API Key
  function setApiKey(key: string) {
    apiKey.value = key
    localStorage.setItem('ds_api_key', key)
  }

  function setDefaultModel(id: string) {
    defaultModel.value = id
    localStorage.setItem('ds_default_model', id)
  }

  function clearAllData() {
    localStorage.clear()
    apiKey.value = ''
    defaultModel.value = 'deepseek-chat'
  }

  return {
    apiKey, defaultModel, showKey, models,
    setApiKey, setDefaultModel, clearAllData,
  }
})
