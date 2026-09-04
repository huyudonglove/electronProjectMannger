import { computed, onMounted, ref } from 'vue'

export type AppTheme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'electron-manager-theme'

export function useTheme() {
  const theme = ref<AppTheme>('light')
  const activeThemeIcon = computed(() => theme.value === 'dark' ? 'moon' : 'sun')

  function applyTheme(value: string | null | undefined) {
    theme.value = value === 'light' ? 'light' : 'dark'
    document.body.dataset.theme = theme.value
  }

  function toggleTheme() {
    applyTheme(theme.value === 'dark' ? 'light' : 'dark')
    localStorage.setItem(THEME_STORAGE_KEY, theme.value)
  }

  onMounted(() => {
    applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'light')
  })

  return {
    theme,
    activeThemeIcon,
    applyTheme,
    toggleTheme,
  }
}
