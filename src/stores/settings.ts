import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ModelOption } from '@/types'
import { useStatsStore } from './stats'
import { promptTemplates, DEFAULT_ROLE_ID } from '@/data/prompts'

export const useSettingsStore = defineStore('settings', () => {
  const apiKey = ref(localStorage.getItem('ds_api_key') ?? '')
  const defaultModel = ref(localStorage.getItem('ds_default_model') ?? 'deepseek-v4-pro')
  const fontSize = ref(Number(localStorage.getItem('ds_font_size') ?? '14'))
  const fontFamily = ref(localStorage.getItem('ds_font_family') ?? '')
  const codeTheme = ref(localStorage.getItem('ds_code_theme') ?? 'dark')
  const systemPrompt = ref(localStorage.getItem('ds_system_prompt') ?? '')
  const showKey = ref(false)

  // 视觉模型配置（伪多模态）
  const mimoApiKey = ref(localStorage.getItem('ds_mimo_api_key') ?? '')
  const mimoBaseUrl = ref(localStorage.getItem('ds_mimo_base_url') ?? 'https://api.xiaomimimo.com/v1')
  const mimoModel = ref(localStorage.getItem('ds_mimo_model') ?? 'mimo-v2.5')

  const models: ModelOption[] = [
    { id: 'deepseek-v4-pro', name: 'V4 Pro', description: '旗舰模型，最强性能', contextLength: 1000000 },
    { id: 'deepseek-v4-flash', name: 'V4 Flash', description: '快速模型，高性价比', contextLength: 1000000 },
  ]

  const codeThemes = [
    { value: 'dark', label: '暗色' },
    { value: 'light', label: '亮色' },
    { value: 'minimal', label: '极简' },
  ]

  const fontOptions = [
    { value: '', label: '系统默认' },
    { value: "'Microsoft YaHei', 'PingFang SC', sans-serif", label: '微软雅黑' },
    { value: "'Source Han Sans SC', 'Noto Sans SC', sans-serif", label: '思源黑体' },
    { value: "'LXGW WenKai', 'KaiTi', serif", label: '霞鹜文楷' },
    { value: "'SimSun', 'Noto Serif SC', serif", label: '宋体' },
    { value: "'KaiTi', 'STKaiti', serif", label: '楷体' },
    { value: "'JetBrains Mono', 'Fira Code', monospace", label: 'JetBrains Mono' },
    { value: "'DengXian', sans-serif", label: '等线' },
  ]

  const activeRoleId = ref(localStorage.getItem('ds_active_role') ?? DEFAULT_ROLE_ID)

  function selectRole(id: string) {
    activeRoleId.value = id
    const template = promptTemplates.find(r => r.id === id)
    systemPrompt.value = template?.prompt ?? ''
    try { localStorage.setItem('ds_active_role', id) } catch { /* ignore */ }
  }

  // 持久化写入
  watch(apiKey, (val) => {
    try { localStorage.setItem('ds_api_key', val) } catch { /* ignore */ }
  })
  watch(defaultModel, (val) => {
    try { localStorage.setItem('ds_default_model', val) } catch { /* ignore */ }
  })
  watch(fontSize, (val) => {
    try { localStorage.setItem('ds_font_size', String(val)) } catch { /* ignore */ }
  })
  watch(fontFamily, (val) => {
    try { localStorage.setItem('ds_font_family', val) } catch { /* ignore */ }
  })
  watch(codeTheme, (val) => {
    try { localStorage.setItem('ds_code_theme', val) } catch { /* ignore */ }
  })
  watch(systemPrompt, (val) => {
    try { localStorage.setItem('ds_system_prompt', val) } catch { /* ignore */ }
  })
  watch(mimoApiKey, (val) => {
    try { localStorage.setItem('ds_mimo_api_key', val) } catch { /* ignore */ }
  })
  watch(mimoBaseUrl, (val) => {
    try { localStorage.setItem('ds_mimo_base_url', val) } catch { /* ignore */ }
  })
  watch(mimoModel, (val) => {
    try { localStorage.setItem('ds_mimo_model', val) } catch { /* ignore */ }
  })

  function clearAllData() {
    useStatsStore().clearAllStats()
    localStorage.clear()
    apiKey.value = ''
    defaultModel.value = 'deepseek-v4-pro'
    fontSize.value = 14
    fontFamily.value = ''
    codeTheme.value = 'dark'
    systemPrompt.value = ''
    activeRoleId.value = DEFAULT_ROLE_ID
    mimoApiKey.value = ''
    mimoBaseUrl.value = 'https://api.xiaomimimo.com/v1'
    mimoModel.value = 'mimo-v2.5'
  }

  return {
    apiKey, defaultModel, fontSize, fontFamily, codeTheme, systemPrompt, showKey, mimoApiKey, mimoBaseUrl, mimoModel, models, codeThemes, fontOptions, promptTemplates, activeRoleId, selectRole,
    clearAllData,
  }
})
