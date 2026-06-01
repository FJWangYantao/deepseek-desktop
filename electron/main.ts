import { app, BrowserWindow, Menu } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { registerStorageHandlers } from './ipc/storage'
import { registerSearchHandlers } from './ipc/search'

const __dirname = dirname(fileURLToPath(import.meta.url))

const preloadPath = join(__dirname, 'preload.cjs')
console.log('[Main] __dirname:', __dirname)
console.log('[Main] preloadPath:', preloadPath)
console.log('[Main] preloadPath 存在:', existsSync(preloadPath))

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Chat',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#fdfcf9',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  // 开发模式自动打开 DevTools
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

// 最小菜单：保留 DevTools 快捷键
const menu = Menu.buildFromTemplate([
  {
    label: 'App',
    submenu: [
      { role: 'reload', label: '刷新' },
      { role: 'toggleDevTools', label: '开发者工具' },
      { type: 'separator' },
      { role: 'quit', label: '退出' },
    ],
  },
])
Menu.setApplicationMenu(menu)

registerStorageHandlers()
registerSearchHandlers()

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
