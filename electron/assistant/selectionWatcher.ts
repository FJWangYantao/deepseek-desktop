/**
 * 全局选区检测器
 *
 * 使用 uiohook-napi 监听全局鼠标事件，检测拖选 / 双击选词：
 * mousedown → 拖动或双击 → mouseup → 模拟 Ctrl+C → 读剪贴板
 *
 * 仅 Windows 平台使用
 */

import { clipboard, app } from 'electron'
import { execFile } from 'child_process'
import { join } from 'path'
import { uIOhook } from 'uiohook-napi'

let isWatching = false
let isCapturing = false // 防止重入
let assistantFocused = false // 助手窗口聚焦时不触发（避免自捕获结果文本）
let mouseDownX = 0
let mouseDownY = 0
let callbackFn: ((text: string) => void) | null = null

const MIN_DRAG_DISTANCE = 8 // 最小拖动距离（像素），过滤单击
const MIN_TEXT_LENGTH = 1 // 最短有效选中文本

/** 获取预编译的 Ctrl+C 模拟工具路径（比 PowerShell 启动快 30 倍） */
function getCopyExePath(): string {
  // 开发模式：app.getAppPath() = 项目根目录
  // 打包模式：需要 extraResources 配置将 exe 包进去
  return app.isPackaged
    ? join(process.resourcesPath!, 'assistant', 'copy-selection.exe')
    : join(app.getAppPath(), 'electron', 'assistant', 'native', 'copy-selection.exe')
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
}

async function onMouseUp(e: { x: number; y: number; clicks?: number }) {
  // 正在捕获中，或助手窗口聚焦时（用户在面板内操作），不触发
  if (isCapturing || assistantFocused) return

  const dx = e.x - mouseDownX
  const dy = e.y - mouseDownY
  const distance = Math.sqrt(dx * dx + dy * dy)
  const clicks = e.clicks ?? 1

  // 拖选（距离够大）或 双击/三击选词（clicks >= 2）才触发
  const isDrag = distance >= MIN_DRAG_DISTANCE
  const isMultiClick = clicks >= 2
  if (!isDrag && !isMultiClick) return

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
