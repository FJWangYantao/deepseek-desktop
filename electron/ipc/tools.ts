import { ipcMain } from 'electron'
import type { ToolCallRequest, ToolCallResult, ToolPermissionConfig } from '../../src/types/tools'
import { listTools, executeTool, loadPermissionConfig, savePermissionConfig, checkPermission } from '../tools'

function blockedResult(request: ToolCallRequest, reason: string): ToolCallResult {
  return {
    callId: request.callId,
    name: request.name,
    success: false,
    data: reason,
    truncated: false,
    totalSize: 0,
    displayedSize: 0,
    offset: 0,
  }
}

function approvalResult(request: ToolCallRequest, reason: string): ToolCallResult {
  return {
    ...blockedResult(request, reason),
    needsApproval: true,
    approvalReason: reason,
  }
}

export function registerToolHandlers() {
  ipcMain.handle('tools:list', () => {
    return { tools: listTools() }
  })

  ipcMain.handle('tools:call', async (_event, request: ToolCallRequest): Promise<ToolCallResult> => {
    const config = loadPermissionConfig()
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(request.arguments) } catch { /* ignore */ }

    const decision = checkPermission(request.name, args, config)
    if (decision.status === 'block') return blockedResult(request, decision.reason)
    if (decision.status === 'confirm') return approvalResult(request, decision.reason)

    return executeTool(request)
  })

  // 用户批准后仍重新检查硬拦截，确保 blocked/危险写入不能被绕过
  ipcMain.handle('tools:call-approved', async (_event, request: ToolCallRequest): Promise<ToolCallResult> => {
    const config = loadPermissionConfig()
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(request.arguments) } catch { /* ignore */ }

    const decision = checkPermission(request.name, args, config)
    if (decision.status === 'block') return blockedResult(request, decision.reason)

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
