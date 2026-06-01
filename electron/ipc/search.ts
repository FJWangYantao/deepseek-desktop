import { ipcMain } from 'electron'
import { searchWeb, fetchUrl, SearchResult } from '../search/duckduckgo'

export function registerSearchHandlers() {
  ipcMain.handle('search:web', async (_event, query: string): Promise<SearchResult[]> => {
    console.log('[Main::Search] 收到搜索请求:', query)
    try {
      const results = await searchWeb(query)
      console.log('[Main::Search] 返回结果数:', results.length)
      return results
    } catch (err) {
      console.error('[Main::Search] 搜索出错:', err)
      return []
    }
  })

  ipcMain.handle('fetch:url', async (_event, url: string): Promise<string> => {
    console.log('[Main::Fetch] 收到抓取请求:', url)
    try {
      const content = await fetchUrl(url)
      console.log('[Main::Fetch] 抓取内容长度:', content.length)
      return content
    } catch (err) {
      console.error('[Main::Fetch] 抓取出错:', err)
      return ''
    }
  })
}
