const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  deleteStore: (key) => ipcRenderer.invoke('store:delete', key),
  webSearch: (query) => ipcRenderer.invoke('search:web', query),
  fetchUrl: (url) => ipcRenderer.invoke('fetch:url', url),
  selectAvatar: () => ipcRenderer.invoke('avatar:select'),
  getAvatar: () => ipcRenderer.invoke('avatar:get'),
  selectFiles: () => ipcRenderer.invoke('file:select'),
  parseFiles: (paths) => ipcRenderer.invoke('file:parse', paths),
  getFilePath: (file) => webUtils.getPathForFile(file),
  exportSession: (session, format) => ipcRenderer.invoke('export:session', session, format),
})
