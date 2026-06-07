import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import { copyFileSync, existsSync, mkdirSync } from 'fs'

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(args) {
          // 复制 tokenizer.json 到 dist-electron
          const outDir = resolve(__dirname, 'dist-electron')
          const src = resolve(__dirname, 'electron/tokenizer/tokenizer.json')
          const dst = resolve(outDir, 'tokenizer.json')
          if (existsSync(src)) {
            if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
            copyFileSync(src, dst)
          }
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', '@huggingface/tokenizers']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              output: { format: 'cjs' },
            }
          }
        }
      }
    ]),
    electronRenderer()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
