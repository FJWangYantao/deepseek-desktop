import { app, BrowserWindow, Menu, globalShortcut } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { registerStorageHandlers } from './ipc/storage'
import { registerSearchHandlers } from './ipc/search'
import { registerAvatarHandlers } from './ipc/avatar'
import { registerFileHandlers } from './ipc/files'
import { registerExportHandlers } from './ipc/export'
import { registerSkillHandlers } from './ipc/skills'
import { registerToolHandlers } from './ipc/tools'
import { registerTokenizerHandlers } from './ipc/tokenizer'
import { registerBuiltinTools } from './tools'

const __dirname = dirname(fileURLToPath(import.meta.url))

const preloadPath = join(__dirname, '../electron/preload.cjs')
const iconPath = join(__dirname, '../electron/icon_dl.ico')
console.log('[Main] __dirname:', __dirname)

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Desktop',
    icon: existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#fdfcf9',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle DevTools',
            accelerator: 'F12',
            click: () => {
              const win = BrowserWindow.getFocusedWindow() ?? mainWindow
              if (win && !win.isDestroyed()) win.webContents.toggleDevTools()
            }
          }
        ]
      }
    ])
  )

registerStorageHandlers()
registerSearchHandlers()
registerAvatarHandlers()
registerFileHandlers()
registerExportHandlers()
registerSkillHandlers()
registerBuiltinTools()
registerToolHandlers()
registerTokenizerHandlers()

app.whenReady().then(() => {
  createWindow()

  // F12 / Ctrl+Shift+I 切换 DevTools
  const toggleDevTools = () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (win && !win.isDestroyed()) win.webContents.toggleDevTools()
  }
  globalShortcut.register('F12', toggleDevTools)
  globalShortcut.register('CommandOrControl+Shift+I', toggleDevTools)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
