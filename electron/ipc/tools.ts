import { ipcMain } from 'electron'
import type { ToolCallRequest, ToolCallResult, ToolPermissionConfig } from '../../src/types/tools'
import { listTools, executeTool, loadPermissionConfig, savePermissionConfig, checkPermission } from '../tools'

export function registerToolHandlers() {
  ipcMain.handle('tools:list', () => {
    return { tools: listTools() }
  })

  ipcMain.handle('tools:call', async (_event, request: ToolCallRequest): Promise<ToolCallResult> => {
    const config = loadPermissionConfig()
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(request.arguments) } catch { /* ignore */ }

    const reason = checkPermission(request.name, args, config)
    if (reason) {
      return {
        callId: request.callId,
        name: request.name,
        success: false,
        data: reason,
        truncated: false,
        totalSize: 0,
        displayedSize: 0,
        offset: 0,
        needsApproval: true,
        approvalReason: reason,
      }
    }

    return executeTool(request)
  })

  // 用户批准后直接执行，跳过权限检查
  ipcMain.handle('tools:call-approved', async (_event, request: ToolCallRequest): Promise<ToolCallResult> => {
    return executeTool(request)
  })

  ipcMain.handle('tools:getPermissionConfig', (): ToolPermissionConfig => {
    return loadPermissionConfig()
  })

  ipcMain.handle('tools:setPermissionConfig', (_event, config: ToolPermissionConfig): boolean => {
    savePermissionConfig(config)
    return true
  })
}
