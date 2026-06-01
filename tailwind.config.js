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
          bg: '#fdfcf9',
          sidebar: '#f9f8f5',
          card: '#f0ede5',
          input: '#ffffff',
          border: '#e0ddd6',
          accent: '#d97706',
          'accent-hover': '#b45309',
          text: '#3d352d',
          heading: '#6b625a',
          muted: '#a39b8f',
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
