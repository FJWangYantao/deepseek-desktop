import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ChatSession } from '@/types'
import { useSettingsStore } from './settings'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem('ds_sessions')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<ChatSession[]>(loadSessions())
  const currentId = ref<string>('')

  // 持久化（仅保存有效数据，防止意外覆盖）
  watch(sessions, (val) => {
    try {
      localStorage.setItem('ds_sessions', JSON.stringify(val))
    } catch { /* quota exceeded 等 */ }
  }, { deep: true })

  watch(currentId, (val) => {
    if (val) localStorage.setItem('ds_current_session', val)
  })

  function createSession(): string {
    const settings = useSettingsStore()
    const id = generateId()
    const session: ChatSession = {
      id,
      title: '新对话',
      model: settings.defaultModel,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    sessions.value.unshift(session)
    currentId.value = id
    return id
  }

  function switchSession(id: string) {
    currentId.value = id
  }

  function deleteSession(id: string) {
    sessions.value = sessions.value.filter(s => s.id !== id)
    if (currentId.value === id) {
      currentId.value = sessions.value[0]?.id ?? ''
    }
  }

  function updateSessionTitle(id: string, title: string) {
    const session = sessions.value.find(s => s.id === id)
    if (session) {
      session.title = title
      session.updatedAt = Date.now()
    }
  }

  function getCurrentSession(): ChatSession | undefined {
    return sessions.value.find(s => s.id === currentId.value)
  }

  // 确保有一个活跃会话
  function ensureSession(): string {
    if (!currentId.value || !sessions.value.find(s => s.id === currentId.value)) {
      return createSession()
    }
    return currentId.value
  }

  return {
    sessions, currentId,
    createSession, switchSession, deleteSession, updateSessionTitle, getCurrentSession, ensureSession,
  }
})
