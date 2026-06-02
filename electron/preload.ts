import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  setStore: (key: string, value: string) => ipcRenderer.invoke('store:set', key, value),
  getStore: (key: string) => ipcRenderer.invoke('store:get', key),
  deleteStore: (key: string) => ipcRenderer.invoke('store:delete', key),
  webSearch: (query: string) => ipcRenderer.invoke('search:web', query),
  fetchUrl: (url: string) => ipcRenderer.invoke('fetch:url', url),
  selectAvatar: () => ipcRenderer.invoke('avatar:select'),
  getAvatar: () => ipcRenderer.invoke('avatar:get'),
  selectFiles: () => ipcRenderer.invoke('file:select'),
  parseFiles: (paths: string[]) => ipcRenderer.invoke('file:parse', paths),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
})
