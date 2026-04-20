const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hypr', {
  findConfig: () => ipcRenderer.invoke('find-config'),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),
  pickFile: (opts) => ipcRenderer.invoke('pick-file', opts),
  pickCssFile: () => ipcRenderer.invoke('pick-css-file'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
  getIncludedFiles: (configPath, sources) => ipcRenderer.invoke('get-included-files', configPath, sources),
  restoreBackups: (filePaths) => ipcRenderer.invoke('restore-backups', filePaths),

  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  reload: () => ipcRenderer.invoke('reload'),

  findWaybarCss: () => ipcRenderer.invoke('find-waybar-css'),
  watchFile: (path) => ipcRenderer.invoke('watch-file', path),
  unwatchFile: (path) => ipcRenderer.invoke('unwatch-file', path),
  onFileChanged: (cb) => ipcRenderer.on('file-changed', (_event, data) => cb(data)),

  getWallpapers: (dirs) => ipcRenderer.invoke('get-wallpapers', dirs),
  setWallpaper: (path) => ipcRenderer.invoke('set-wallpaper', path),
  getCurrentWallpaper: () => ipcRenderer.invoke('get-current-wallpaper'),
  getFileAsDataUrl: (path) => ipcRenderer.invoke('get-file-as-dataurl', path),

  getBluetoothStatus: () => ipcRenderer.invoke('get-bluetooth-status'),
  getBluetoothDevices: () => ipcRenderer.invoke('get-bluetooth-devices'),
  setBluetoothPower: (on) => ipcRenderer.invoke('set-bluetooth-power', on),
  bluetoothScan: () => ipcRenderer.invoke('bluetooth-scan'),
  bluetoothConnect: (mac) => ipcRenderer.invoke('bluetooth-connect', mac),
  bluetoothDisconnect: (mac) => ipcRenderer.invoke('bluetooth-disconnect', mac),
  bluetoothRemove: (mac) => ipcRenderer.invoke('bluetooth-remove', mac),

  getWifiStatus: () => ipcRenderer.invoke('get-wifi-status'),
  getWifiNetworks: () => ipcRenderer.invoke('get-wifi-networks'),
  wifiConnect: (ssid, password) => ipcRenderer.invoke('wifi-connect', ssid, password),
  wifiDisconnect: () => ipcRenderer.invoke('wifi-disconnect'),
  wifiForget: (ssid) => ipcRenderer.invoke('wifi-forget', ssid),
  setWifiPower: (on) => ipcRenderer.invoke("set-wifi-power", on),
  bluetoothStartMonitor: () => ipcRenderer.invoke("bluetooth-start-monitor"),

  onBluetoothChange: (cb) => ipcRenderer.on("bluetooth-device-changed", cb),

  offBluetoothChange: (cb) => ipcRenderer.off("bluetooth-device-changed", cb),
});