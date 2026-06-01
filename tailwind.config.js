/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        app: {
          bg:                'var(--app-bg)',
          sidebar:           'var(--app-sidebar)',
          card:              'var(--app-card)',
          input:             'var(--app-input)',
          border:            'var(--app-border)',
          accent:            'var(--app-accent)',
          'accent-hover':    'var(--app-accent-hover)',
          text:              'var(--app-text)',
          heading:           'var(--app-heading)',
          muted:             'var(--app-muted)',
          hover:             'var(--app-hover)',
          'hover-strong':    'var(--app-hover-strong)',
          'surface-alt':     'var(--app-surface-alt)',
          'border-light':    'var(--app-border-light)',
          scrollbar:         'var(--app-scrollbar)',
          'scrollbar-hover': 'var(--app-scrollbar-hover)',
          'accent-soft':     'var(--app-accent-soft)',
          'accent-soft-border': 'var(--app-accent-soft-border)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      borderRadius: {
        'bubble': '14px',
      }
    },
  },
  plugins: [],
}
