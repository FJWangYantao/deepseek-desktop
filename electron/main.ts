import { app, BrowserWindow, Menu, globalShortcut, shell, screen, clipboard } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { exec } from 'child_process'
import { registerStorageHandlers } from './ipc/storage'
import { registerSecureStorageHandlers } from './ipc/secure-storage'
import { registerAvatarHandlers } from './ipc/avatar'
import { registerFileHandlers } from './ipc/files'
import { registerExportHandlers } from './ipc/export'
import { registerSkillHandlers } from './ipc/skills'
import { registerToolHandlers } from './ipc/tools'
import { registerTokenizerHandlers } from './ipc/tokenizer'
import { registerImageDescribeHandlers } from './ipc/image-describe'
import { registerObservationHandlers } from './ipc/observations'
import { registerAssistantHandlers, setAssistantWindow } from './ipc/assistant'
import { startSelectionWatcher, stopSelectionWatcher, setAssistantFocused, setMouseDownCallback, setSuppressChecker } from './assistant/selectionWatcher'
import { registerBuiltinTools } from './tools'

// Windows 控制台 UTF-8 编码
if (process.platform === 'win32') {
  try { execSync('chcp 65001', { stdio: 'ignore' }) } catch {}
}
const __dirname = dirname(fileURLToPath(import.meta.url))

// preload 由 vite 编译到 dist-electron/preload.cjs（与 main.js 同目录）
// 不要再指向源目录 ../electron/preload.cjs — 那是历史手写副本，已废弃
const preloadPath = join(__dirname, 'preload.cjs')
const iconPath = join(__dirname, '../electron/icon_dl.ico')
console.log('[Main] __dirname:', __dirname)

let mainWindow: BrowserWindow | null = null
let assistantWindow: BrowserWindow | null = null

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

  // 所有外部链接用系统默认浏览器（Chrome）打开，不在 Electron 窗口内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 允许 dev server 热更新和本地文件加载，拦截其余外部导航
    const isLocal = url.startsWith('file://') || url.startsWith(process.env.VITE_DEV_SERVER_URL ?? '__none__')
    if (!isLocal) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
}

// ===== 划词助手窗口 =====
function getOrCreateAssistantWindow(): BrowserWindow {
  if (assistantWindow && !assistantWindow.isDestroyed()) return assistantWindow
  assistantWindow = new BrowserWindow({
    width: 280,
    height: 44,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#fdfcf9',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    assistantWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '#/assistant')
  } else {
    assistantWindow.loadFile(join(__dirname, '../dist/index.html'), { hash: '/assistant' })
  }

  // 焦点状态同步给选区监听器（聚焦时抑制检测，避免自捕获结果文本）
  assistantWindow.on('focus', () => {
    setAssistantFocused(true)
  })

  // 失焦自动隐藏（延迟检查，避免内部按钮点击的瞬时失焦误关）
  assistantWindow.on('blur', () => {
    setAssistantFocused(false)
    setTimeout(() => {
      if (assistantWindow && !assistantWindow.isDestroyed() && assistantWindow.isVisible()) {
        assistantWindow.hide()
      }
    }, 120)
  })

  // 隐藏时务必复位焦点标志 —— 否则经 ✕/Escape 隐藏后标志残留，后续划词全被抑制
  assistantWindow.on('hide', () => {
    setAssistantFocused(false)
  })

  assistantWindow.on('closed', () => {
    assistantWindow = null
    setAssistantFocused(false)
    setAssistantWindow(null)
  })

  // 外部链接走系统浏览器（与主窗口一致），避免在助手窗口里新开 Electron 窗口
  assistantWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  setAssistantWindow(assistantWindow)
  return assistantWindow
}

/** 选区监听回调：捕获到文本后显示助手窗口 */
function onTextCaptured(text: string) {
  const win = getOrCreateAssistantWindow()
  // 重置为小长条尺寸（Windows 下 resizable:false 会忽略 setSize，临时解锁）
  win.setResizable(true)
  win.setSize(280, 44)
  win.setResizable(false)
  // 定位到鼠标附近
  const pos = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pos)
  const x = Math.min(pos.x + 10, display.bounds.x + display.bounds.width - 290)
  const y = Math.min(pos.y + 10, display.bounds.y + display.bounds.height - 54)
  win.setPosition(x, y)

  const sendText = () => win.webContents.send('assistant:text-captured', text)

  // 窗口加载完成后发送文本
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', sendText)
  } else {
    sendText()
  }

  // 显示并聚焦（exe 已在 ~110ms 内完成 Ctrl+C 模拟，等待按键释放后抢焦点）
  win.showInactive()
  win.setAlwaysOnTop(true)
  setTimeout(() => {
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  }, 30)
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
registerSecureStorageHandlers()
registerAvatarHandlers()
registerFileHandlers()
registerExportHandlers()
registerSkillHandlers()
registerBuiltinTools()
registerToolHandlers()
registerTokenizerHandlers()
registerImageDescribeHandlers()
registerObservationHandlers()
registerAssistantHandlers()

app.whenReady().then(() => {
  createWindow()

  // F12 / Ctrl+Shift+I 切换 DevTools
  const toggleDevTools = () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (win && !win.isDestroyed()) win.webContents.toggleDevTools()
  }
  globalShortcut.register('F12', toggleDevTools)
  globalShortcut.register('CommandOrControl+Shift+I', toggleDevTools)

  // 启动全局划词选区监听（仅 Windows）
  if (process.platform === 'win32') {
    startSelectionWatcher(onTextCaptured)
    // 本应用任意窗口聚焦时抑制助手（主聊天窗口的内置引用/收藏选词交互接管，避免打架）。
    // 用 getFocusedWindow() 而非坐标：外部应用聚焦时它返回 null（助手正常弹出），
    // 不受主窗口大小/位置影响——坐标方案在主窗口最大化时会把整屏都判成"主窗口内"，误伤网页选词。
    setSuppressChecker(() => BrowserWindow.getFocusedWindow() !== null)
    // 点击助手窗口外部 → 隐藏（比 blur 事件更可靠）
    setMouseDownCallback(() => {
      if (!assistantWindow || assistantWindow.isDestroyed() || !assistantWindow.isVisible()) return
      // 用 Electron API 取鼠标坐标，确保与 getBounds() 同一坐标系（避免 DPI 缩放偏差）
      const pos = screen.getCursorScreenPoint()
      const b = assistantWindow.getBounds()
      const inside = pos.x >= b.x && pos.x <= b.x + b.width && pos.y >= b.y && pos.y <= b.y + b.height
      if (!inside) {
        assistantWindow.hide()
      }
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (process.platform === 'win32') {
    try { stopSelectionWatcher() } catch { /* ignore */ }
  }
})
