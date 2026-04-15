const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#061919',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow === null) createWindow(); });

function findHyprlandConfig() {
  const candidates = [
    path.join(os.homedir(), '.config', 'hypr', 'hyprland.conf'),
    path.join(os.homedir(), '.config', 'hyprland', 'hyprland.conf'),
    '/etc/hypr/hyprland.conf',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function restoreBackupFile(filePath) {
  const backup = filePath + '.hypreditor.bak';

  if (!fs.existsSync(backup)) {
    return { ok: false, error: 'backup file not found', filePath };
  }

  try {
    fs.copyFileSync(backup, filePath);
    return { ok: true, filePath, backup };
  } catch (e) {
    return { ok: false, error: e.message, filePath };
  }
}

ipcMain.handle('restore-backups', (_, filePaths) => {
  try {
    const results = [];

    for (const filePath of filePaths) {
      results.push(restoreBackupFile(filePath));
    }

    const restored = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);

    return {
      ok: failed.length === 0,
      restored,
      failed,
      results,
    };
  } catch (e) {
    return { ok: false, error: e.message, restored: 0, failed: [] };
  }
});

ipcMain.handle('find-config', () => {
  return findHyprlandConfig();
});

ipcMain.handle('read-file', (_, filePath) => {
  try {
    return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('write-file', (_, filePath, content) => {
  try {
    const backup = filePath + '.hypreditor.bak';
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backup);
    }
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('pick-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Hyprland Config',
    defaultPath: path.join(os.homedir(), '.config', 'hypr'),
    filters: [{ name: 'Config Files', extensions: ['conf', 'cfg', 'ini', '*'] }],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-included-files', (_, configPath, sources) => {
  const dir = path.dirname(configPath);
  const found = [];
  for (const src of sources) {
    const expanded = src.startsWith('~')
      ? path.join(os.homedir(), src.slice(1))
      : src;
    const resolved = path.resolve(dir, expanded);
    if (fs.existsSync(resolved)) {
      try {
        found.push({ path: resolved, content: fs.readFileSync(resolved, 'utf8'), source: src });
      } catch { }
    }
  }
  return found;
});

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => mainWindow?.close());
ipcMain.handle('reload', () => mainWindow?.webContents.reload());