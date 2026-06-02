import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ModelOption } from '@/types'
import { useStatsStore } from './stats'

export const useSettingsStore = defineStore('settings', () => {
  const apiKey = ref(localStorage.getItem('ds_api_key') ?? '')
  const defaultModel = ref(localStorage.getItem('ds_default_model') ?? 'deepseek-v4-pro')
  const fontSize = ref(Number(localStorage.getItem('ds_font_size') ?? '14'))
  const fontFamily = ref(localStorage.getItem('ds_font_family') ?? '')
  const systemPrompt = ref(localStorage.getItem('ds_system_prompt') ?? '')
  const showKey = ref(false)

  const models: ModelOption[] = [
    { id: 'deepseek-v4-pro', name: 'V4 Pro', description: '旗舰模型，最强性能' },
    { id: 'deepseek-v4-flash', name: 'V4 Flash', description: '快速模型，高性价比' },
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

  const roleTemplates = [
    { id: 'default', name: '默认', icon: '💬', prompt: '' },
    { id: 'coder', name: '代码专家', icon: '💻', prompt: '你是一位资深软件工程师。回答技术问题时：1）先分析问题本质 2）给出最佳实践方案 3）标注代码语言和关键逻辑 4）指出潜在陷阱和替代方案。代码要简洁、可读、有适当注释。' },
    { id: 'translator', name: '翻译官', icon: '🌐', prompt: '你是一位专业翻译。中英互译时：1）保持原意和语气 2）技术术语准确 3）符合目标语言习惯表达 4）必要时标注翻译说明。' },
    { id: 'writer', name: '写作助手', icon: '✍️', prompt: '你是一位专业写作助手。帮助用户：润色文字使其更流畅、改写以适配不同场景、校对语法和拼写、优化文章结构和逻辑。保持用户原意，不做过度修改。' },
    { id: 'interviewer', name: '面试官', icon: '🎯', prompt: '你是一位技术面试官。模拟真实面试场景：1）针对用户的技术栈提出有深度的问题 2）追问细节考察理解程度 3）评估回答并给出改进建议 4）提供参考答案和知识点总结。' },
    { id: 'teacher', name: '教师', icon: '📚', prompt: '你是一位耐心的教师。讲解概念时：1）用通俗易懂的语言 2）从简单到复杂循序渐进 3）举生活中的例子辅助理解 4）确认学生理解后再进入下一话题。' },
    { id: 'analyst', name: '数据分析师', icon: '📊', prompt: '你是一位数据分析师。分析数据时：1）先理解数据结构和含义 2）给出统计摘要和趋势 3）发现异常值和模式 4）用可视化友好的方式描述结果 5）提供 actionable 的建议。' },
  ]

  const activeRoleId = ref(localStorage.getItem('ds_active_role') ?? 'default')

  function selectRole(id: string) {
    activeRoleId.value = id
    const template = roleTemplates.find(r => r.id === id)
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
  watch(systemPrompt, (val) => {
    try { localStorage.setItem('ds_system_prompt', val) } catch { /* ignore */ }
  })

  function clearAllData() {
    useStatsStore().clearAllStats()
    localStorage.clear()
    apiKey.value = ''
    defaultModel.value = 'deepseek-v4-pro'
    fontSize.value = 14
    fontFamily.value = ''
    systemPrompt.value = ''
  }

  return {
    apiKey, defaultModel, fontSize, fontFamily, systemPrompt, showKey, models, fontOptions, roleTemplates, activeRoleId, selectRole,
    clearAllData,
  }
})
