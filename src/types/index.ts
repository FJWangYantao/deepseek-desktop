export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  timestamp: number
}

export interface ChatSession {
  id: string
  title: string
  model: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export interface ModelOption {
  id: string
  name: string
  description: string
}

export type ThinkingMode = 'enabled' | 'disabled'

export type ThemeName = 'amber' | 'ocean' | 'sage' | 'slate'
export type ThemeMode = 'light' | 'dark'

export interface ThemeColors {
  bg: string; sidebar: string; card: string; input: string; border: string
  accent: string; 'accent-hover': string
  text: string; heading: string; muted: string
  hover: string; 'hover-strong': string; 'surface-alt': string
  'border-light': string; scrollbar: string; 'scrollbar-hover': string
  'accent-soft': string; 'accent-soft-border': string
}

export interface ThemeDefinition {
  name: ThemeName
  label: string
  light: ThemeColors
  dark: ThemeColors
}
