import { registerTool } from './registry'
import { webSearchTool } from './builtins/web-search'
import { webFetchTool } from './builtins/web-fetch'
import { fileReadTool } from './builtins/file-read'
import { fileWriteTool } from './builtins/file-write'
import { listDirTool } from './builtins/list-dir'
import { refreshScheduler } from '../search-local/scheduler'
import { localSearchEngine } from '../search-local/engine'

export { getTool, listTools, getToolsSchema } from './registry'
export { executeTool, executeBatch } from './executor'
export { loadPermissionConfig, savePermissionConfig, checkPermission } from './permissions'

export function registerBuiltinTools() {
  registerTool(webSearchTool)
  registerTool(webFetchTool)
  registerTool(fileReadTool)
  registerTool(fileWriteTool)
  registerTool(listDirTool)

  // 启动本地搜索引擎（懒加载，首次搜索时才抓取数据）
  refreshScheduler.start(localSearchEngine)
}
