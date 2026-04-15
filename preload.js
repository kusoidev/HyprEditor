const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hypr', {
  findConfig: () => ipcRenderer.invoke('find-config'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  writeFile: (p, c) => ipcRenderer.invoke('write-file', p, c),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  getIncludedFiles: (p, srcs) => ipcRenderer.invoke('get-included-files', p, srcs),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  reload: () => ipcRenderer.invoke('reload'),
});
