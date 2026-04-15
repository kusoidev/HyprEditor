const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hypr', {
  findConfig: () => ipcRenderer.invoke('find-config'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  writeFile: (p, content) => ipcRenderer.invoke('write-file', p, content),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  getIncludedFiles: (p, srcs) => ipcRenderer.invoke('get-included-files', p, srcs),
  restoreBackups: (paths) => ipcRenderer.invoke('restore-backups', paths),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  reload: () => ipcRenderer.invoke('reload'),
  findWaybarCss: () => ipcRenderer.invoke('find-waybar-css'),
  pickCssFile: () => ipcRenderer.invoke('pick-css-file'),
  watchFile: (p) => ipcRenderer.invoke('watch-file', p),
  unwatchFile: (p) => ipcRenderer.invoke('unwatch-file', p),
  onFileChanged: (cb) => {
    ipcRenderer.on('file-changed', (_event, data) => cb(data));
  },
  offFileChanged: () => ipcRenderer.removeAllListeners('file-changed'),
  getWallpapers: (dirs) => ipcRenderer.invoke('get-wallpapers', dirs),
  setWallpaper: (p) => ipcRenderer.invoke('set-wallpaper', p),
  getCurrentWallpaper: () => ipcRenderer.invoke('get-current-wallpaper'),
  getFileAsDataUrl: (p) => ipcRenderer.invoke('get-file-as-dataurl', p),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
});