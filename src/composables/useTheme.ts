import { ref, watchEffect, nextTick } from 'vue'
import type { ThemeName, ThemeMode } from '@/types'

const themeName = ref<ThemeName>(
  (localStorage.getItem('ds_theme_name') as ThemeName) ?? 'amber'
)
const themeMode = ref<ThemeMode>(
  (localStorage.getItem('ds_theme_mode') as ThemeMode) ?? 'light'
)

let initialized = false

export function useTheme() {
  watchEffect(() => {
    localStorage.setItem('ds_theme_name', themeName.value)
    localStorage.setItem('ds_theme_mode', themeMode.value)
    document.documentElement.setAttribute('data-theme', themeName.value)
    document.documentElement.setAttribute('data-mode', themeMode.value)
    if (!initialized) {
      initialized = true
      nextTick(() => {
        document.documentElement.classList.add('theme-ready')
      })
    }
  })

  function setTheme(name: ThemeName) {
    themeName.value = name
  }

  function toggleMode() {
    themeMode.value = themeMode.value === 'light' ? 'dark' : 'light'
  }

  const isDark = () => themeMode.value === 'dark'

  return { themeName, themeMode, setTheme, toggleMode, isDark }
}
