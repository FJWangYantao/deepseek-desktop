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
      },
      animation: {
        'bounce-done': 'bounceDone 300ms ease-out',
        'float-idle': 'floatIdle 3s ease-in-out infinite',
        'breathe-glow': 'breatheGlow 2.5s ease-in-out infinite',
        'shake-warn': 'shakeWarn 400ms ease-in-out',
      },
      keyframes: {
        bounceDone: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.3)' },
          '70%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)' },
        },
        floatIdle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        breatheGlow: {
          '0%, 100%': { opacity: '0.7' },
          '50%': { opacity: '1' },
        },
        shakeWarn: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-2px)' },
          '40%, 80%': { transform: 'translateX(2px)' },
        },
      },
    },
  },
  plugins: [],
}
