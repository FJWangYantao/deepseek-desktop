import { ref, shallowRef } from 'vue'

const avatarUrl = shallowRef<string | null>(null)

async function loadAvatar() {
  if (window.electronAPI?.getAvatar) {
    avatarUrl.value = await window.electronAPI.getAvatar()
  }
}

async function changeAvatar() {
  if (!window.electronAPI?.selectAvatar) return
  const url = await window.electronAPI.selectAvatar()
  if (url) avatarUrl.value = url
}

export function useAvatar() {
  return { avatarUrl, loadAvatar, changeAvatar }
}
