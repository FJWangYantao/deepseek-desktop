/**
 * 全局选区检测器
 *
 * 使用 uiohook-napi 监听全局鼠标事件，检测拖选 / 双击选词：
 * mousedown → 拖动或双击 → mouseup → 模拟 Ctrl+C → 读剪贴板
 *
 * 仅 Windows 平台使用
 */

import { clipboard } from 'electron'
import { execFile } from 'child_process'
import { uIOhook } from 'uiohook-napi'

let isWatching = false
let isCapturing = false // 防止重入
let assistantFocused = false // 助手窗口聚焦时不触发（避免自捕获结果文本）
let mouseDownX = 0
let mouseDownY = 0
let callbackFn: ((text: string) => void) | null = null

const MIN_DRAG_DISTANCE = 8 // 最小拖动距离（像素），过滤单击
const MIN_TEXT_LENGTH = 1 // 最短有效选中文本

// 用 keybd_event 发送真实的 Ctrl+C 物理按键（比 SendKeys 对 Chrome/PDF 等更可靠）
// VK_CONTROL=0x11, VK 'C'=0x43；flags: 0=按下, 2=KEYEVENTF_KEYUP
// 复制后 Start-Sleep 等待剪贴板填充，脚本退出即表示完成
const PS_COPY_SCRIPT = [
  "Add-Type -Name K -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")]public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.IntPtr dwExtraInfo);'",
  '[W.K]::keybd_event(0x11,0,0,[System.IntPtr]::Zero)',
  '[W.K]::keybd_event(0x43,0,0,[System.IntPtr]::Zero)',
  'Start-Sleep -Milliseconds 40',
  '[W.K]::keybd_event(0x43,0,2,[System.IntPtr]::Zero)',
  '[W.K]::keybd_event(0x11,0,2,[System.IntPtr]::Zero)',
  'Start-Sleep -Milliseconds 130',
].join('; ')

/** 模拟 Ctrl+C，返回剪贴板中的新文本（自动恢复原始剪贴板） */
function captureSelection(): Promise<string> {
  const savedClipboard = clipboard.readText()
  // 先清空，便于判断本次复制是否真的产生了内容
  clipboard.writeText('')

  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', PS_COPY_SCRIPT],
      { windowsHide: true },
      () => {
        const newText = clipboard.readText()
        // 恢复原始剪贴板内容
        clipboard.writeText(savedClipboard)
        resolve(newText)
      }
    )
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
