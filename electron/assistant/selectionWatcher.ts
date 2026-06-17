/**
 * 全局选区检测器
 *
 * 使用 uiohook-napi 监听全局鼠标事件，检测拖选 / 双击选词：
 * mousedown → 拖动或双击 → mouseup → 模拟 Ctrl+C → 读剪贴板
 *
 * 仅 Windows 平台使用
 */

import { clipboard, app } from 'electron'
import { execFile, execFileSync } from 'child_process'
import { join } from 'path'
import { uIOhook } from 'uiohook-napi'

let isWatching = false
let isCapturing = false // 防止重入
let assistantFocused = false // 助手窗口聚焦时不触发（避免自捕获结果文本）
let mouseDownX = 0
let mouseDownY = 0
let callbackFn: ((text: string) => void) | null = null
let mouseDownCbFn: ((x: number, y: number) => void) | null = null
let suppressChecker: (() => boolean) | null = null // 抑制检查器：返回 true 时本次选区不触发助手（本应用窗口内让位给内置选词交互）

const MIN_DRAG_DISTANCE = 8 // 最小拖动距离（像素），过滤单击
const MIN_TEXT_LENGTH = 1 // 最短有效选中文本

/**
 * 终端类前台进程黑名单：在这些进程聚焦时禁用助手。
 * 原因：助手用模拟 Ctrl+C 抓取选区，但终端里 Ctrl+C 是中断信号，会杀掉用户正在跑的命令；
 * 而且会临时擦剪贴板再恢复，干扰用户复制粘贴。这类应用必须完全跳过 capture。
 *
 * 命名以 ProcessName.exe（不含路径）形式，由 get-foreground-proc.exe 输出。
 */
const TERMINAL_PROCESS_BLOCKLIST = new Set([
  'cmd.exe',                // 传统 cmd
  'WindowsTerminal.exe',    // Windows Terminal (wt)
  'OpenConsole.exe',        // Windows Terminal 内嵌 conhost
  'powershell.exe',         // PowerShell 5
  'pwsh.exe',               // PowerShell 7+
  'ConEmu64.exe',           // ConEmu
  'ConEmuC64.exe',
  'mintty.exe',             // Git Bash / MSYS2
  'alacritty.exe',          // Alacritty
  'wezterm-gui.exe',        // WezTerm
  'Tabby.exe',              // Tabby Terminal
])

/** 获取预编译的 Ctrl+C 模拟工具路径（比 PowerShell 启动快 30 倍） */
function getCopyExePath(): string {
  // 开发模式：app.getAppPath() = 项目根目录
  // 打包模式：需要 extraResources 配置将 exe 包进去
  return app.isPackaged
    ? join(process.resourcesPath!, 'assistant', 'copy-selection.exe')
    : join(app.getAppPath(), 'electron', 'assistant', 'native', 'copy-selection.exe')
}

/** 获取前台进程查询工具路径（与 copy-selection.exe 同目录，相同打包逻辑） */
function getForegroundProcExePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath!, 'assistant', 'get-foreground-proc.exe')
    : join(app.getAppPath(), 'electron', 'assistant', 'native', 'get-foreground-proc.exe')
}

/**
 * 同步读取当前前台窗口的进程 exe 名（如 "WindowsTerminal.exe"）。
 * 失败/超时返回空串。同步是为了让 onMouseUp 在发 Ctrl+C 之前就能拦住——
 * helper exe 单次调用约 5ms，值得这点阻塞换"在终端里不杀进程"。
 */
function getForegroundProcessName(): string {
  try {
    const out = execFileSync(getForegroundProcExePath(), [], {
      windowsHide: true,
      timeout: 300,           // 异常情况硬截断，宁可放过也不卡住选词
      encoding: 'utf-8',
    })
    return out.trim()
  } catch {
    return ''
  }
}

/** 模拟 Ctrl+C，返回剪贴板中的新文本（自动恢复原始剪贴板） */
function captureSelection(): Promise<string> {
  const savedClipboard = clipboard.readText()
  clipboard.writeText('')

  return new Promise((resolve) => {
    execFile(getCopyExePath(), [], { windowsHide: true }, () => {
      const newText = clipboard.readText()
      clipboard.writeText(savedClipboard)
      resolve(newText)
    })
  })
}

function onMouseDown(e: { x: number; y: number }) {
  mouseDownX = e.x
  mouseDownY = e.y
  // 通知主进程：有全局 mousedown（用于点击外部关闭助手窗口）
  if (mouseDownCbFn) mouseDownCbFn(e.x, e.y)
}

async function onMouseUp(e: { x: number; y: number; clicks?: number }) {
  // 正在捕获中，或助手窗口聚焦时（用户在面板内操作），不触发
  if (isCapturing || assistantFocused) return
  // 本应用主窗口区域内选词时让位（主聊天窗口有自己的引用/收藏选词交互；
  // 系统级钩子无法区分窗口，否则在应用内选词会与引用收藏按钮同时弹出打架）
  if (suppressChecker && suppressChecker()) {
    console.log('[Assistant] 本应用窗口聚焦，抑制助手（让位给内置选词交互）')
    return
  }

  const dx = e.x - mouseDownX
  const dy = e.y - mouseDownY
  const distance = Math.sqrt(dx * dx + dy * dy)
  const clicks = e.clicks ?? 1

  // 拖选（距离够大）或 双击/三击选词（clicks >= 2）才触发
  const isDrag = distance >= MIN_DRAG_DISTANCE
  const isMultiClick = clicks >= 2
  if (!isDrag && !isMultiClick) return

  // 终端类前台进程下完全跳过（关键：模拟 Ctrl+C 在终端里会中断用户进程，且擦剪贴板）。
  // 放在 isDrag/isMultiClick 之后，避免每次鼠标点击都 spawn helper。
  const fgProc = getForegroundProcessName()
  if (fgProc && TERMINAL_PROCESS_BLOCKLIST.has(fgProc)) {
    console.log(`[Assistant] 终端进程 ${fgProc} 聚焦，跳过捕获（避免 Ctrl+C 中断与剪贴板抖动）`)
    return
  }

  isCapturing = true

  try {
    const text = await captureSelection()
    if (text && text.trim().length >= MIN_TEXT_LENGTH && callbackFn) {
      callbackFn(text.trim())
    }
  } catch {
    // 静默处理
  } finally {
    isCapturing = false
  }
}

/**
 * 启动全局选区监听
 * @param callback 捕获到选中文本后的回调（由主进程调用，负责显示助手窗口）
 */
export function startSelectionWatcher(callback: (text: string) => void) {
  if (isWatching) return
  callbackFn = callback

  uIOhook.on('mousedown', onMouseDown)
  uIOhook.on('mouseup', onMouseUp)
  uIOhook.start()

  isWatching = true
  console.log('[Assistant] 选区监听已启动')
}

/** 停止全局选区监听 */
export function stopSelectionWatcher() {
  if (!isWatching) return

  uIOhook.off('mousedown', onMouseDown)
  uIOhook.off('mouseup', onMouseUp)
  uIOhook.stop()

  isWatching = false
  callbackFn = null
  console.log('[Assistant] 选区监听已停止')
}

/** 设置助手窗口聚焦状态（聚焦时抑制检测，避免选中结果文本造成自捕获） */
export function setAssistantFocused(focused: boolean) {
  assistantFocused = focused
}

/** 设置全局 mousedown 回调（主进程用于检测点击外部关闭助手窗口） */
export function setMouseDownCallback(cb: ((x: number, y: number) => void) | null) {
  mouseDownCbFn = cb
}

/** 设置抑制检查器：返回 true 时本次选区不触发助手（本应用窗口聚焦时让位给内置选词交互） */
export function setSuppressChecker(cb: (() => boolean) | null) {
  suppressChecker = cb
}
