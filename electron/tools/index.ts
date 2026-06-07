import { registerTool } from './registry'
import { webSearchTool } from './builtins/web-search'
import { webFetchTool } from './builtins/web-fetch'
import { fileReadTool } from './builtins/file-read'
import { fileWriteTool } from './builtins/file-write'

export { getTool, listTools, getToolsSchema } from './registry'
export { executeTool, executeBatch } from './executor'
export { loadPermissionConfig, savePermissionConfig, checkPermission } from './permissions'

export function registerBuiltinTools() {
  registerTool(webSearchTool)
  registerTool(webFetchTool)
  registerTool(fileReadTool)
  registerTool(fileWriteTool)
}
