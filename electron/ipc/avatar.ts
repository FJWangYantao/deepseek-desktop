import { ipcMain, dialog, app } from 'electron'
import { join } from 'path'
import { copyFileSync, existsSync, readFileSync } from 'fs'

const avatarPath = join(app.getPath('userData'), 'avatar.png')

function toBase64(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? 'png'
  const mime = ext === 'jpg' ? 'jpeg' : ext
  const data = readFileSync(path).toString('base64')
  return `data:image/${mime};base64,${data}`
}

export function registerAvatarHandlers() {
  ipcMain.handle('avatar:select', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const src = result.filePaths[0]
    copyFileSync(src, avatarPath)
    return toBase64(avatarPath)
  })

  ipcMain.handle('avatar:get', () => {
    if (existsSync(avatarPath)) return toBase64(avatarPath)
    return null
  })
}
