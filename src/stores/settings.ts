import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ModelOption } from '@/types'

export const useSettingsStore = defineStore('settings', () => {
  const apiKey = ref(localStorage.getItem('ds_api_key') ?? '')
  const defaultModel = ref(localStorage.getItem('ds_default_model') ?? 'deepseek-v4-pro')
  const showKey = ref(false)

  const models: ModelOption[] = [
    { id: 'deepseek-v4-pro', name: 'V4 Pro', description: '旗舰模型，最强性能' },
    { id: 'deepseek-v4-flash', name: 'V4 Flash', description: '快速模型，高性价比' },
  ]

  // 持久化写入
  watch(apiKey, (val) => { localStorage.setItem('ds_api_key', val) })
  watch(defaultModel, (val) => { localStorage.setItem('ds_default_model', val) })

  function clearAllData() {
    localStorage.clear()
    apiKey.value = ''
    defaultModel.value = 'deepseek-v4-pro'
  }

  return {
    apiKey, defaultModel, showKey, models,
    clearAllData,
  }
})
