const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  deleteStore: (key) => ipcRenderer.invoke('store:delete', key),
  webSearch: (query) => ipcRenderer.invoke('search:web', query),
  fetchUrl: (url) => ipcRenderer.invoke('fetch:url', url),
})
