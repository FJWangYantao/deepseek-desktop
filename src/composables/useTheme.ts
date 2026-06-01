import { ref, watchEffect } from 'vue'

const theme = ref<'light' | 'dark'>(
  (localStorage.getItem('ds_theme') as 'light' | 'dark') ?? 'light'
)

export function useTheme() {
  watchEffect(() => {
    localStorage.setItem('ds_theme', theme.value)
    document.documentElement.classList.toggle('dark', theme.value === 'dark')
  })

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }

  return { theme, toggleTheme }
}
