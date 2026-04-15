const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

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
  if (!fs.existsSync(backup)) return { ok: false, error: 'backup file not found', filePath };
  try {
    fs.copyFileSync(backup, filePath);
    return { ok: true, filePath, backup };
  } catch (e) {
    return { ok: false, error: e.message, filePath };
  }
}

ipcMain.handle('restore-backups', (_, filePaths) => {
  try {
    const results = filePaths.map(restoreBackupFile);
    const restored = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);
    return { ok: failed.length === 0, restored, failed, results };
  } catch (e) {
    return { ok: false, error: e.message, restored: 0, failed: [] };
  }
});

ipcMain.handle('find-config', () => findHyprlandConfig());

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
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backup);
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
    const expanded = src.startsWith('~') ? path.join(os.homedir(), src.slice(1)) : src;
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

ipcMain.handle('find-waybar-css', () => {
  const candidates = [
    path.join(os.homedir(), '.config', 'waybar', 'style.css'),
    path.join(os.homedir(), '.config', 'waybar', 'styles.css'),
    path.join(os.homedir(), '.waybar', 'style.css'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
});

ipcMain.handle('pick-css-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Waybar CSS',
    defaultPath: path.join(os.homedir(), '.config', 'waybar'),
    filters: [{ name: 'CSS Files', extensions: ['css'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

const watchedFiles = new Map();

ipcMain.handle('watch-file', (_, filePath) => {
  if (!filePath || watchedFiles.has(filePath)) return;
  const listener = () => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      mainWindow?.webContents.send('file-changed', { filePath, content });
    } catch { }
  };
  fs.watchFile(filePath, { interval: 400, persistent: false }, listener);
  watchedFiles.set(filePath, listener);
});

ipcMain.handle('unwatch-file', (_, filePath) => {
  if (!filePath) return;
  const listener = watchedFiles.get(filePath);
  if (listener) {
    fs.unwatchFile(filePath, listener);
    watchedFiles.delete(filePath);
  }
});

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.avif']);

ipcMain.handle('get-wallpapers', async (_, dirs) => {
  const results = [];
  for (const dir of dirs) {
    try {
      const expanded = dir.startsWith('~') ? path.join(os.homedir(), dir.slice(1)) : dir;
      if (!fs.existsSync(expanded)) continue;
      const files = fs.readdirSync(expanded);
      for (const f of files) {
        if (IMAGE_EXTS.has(path.extname(f).toLowerCase())) {
          results.push(path.join(expanded, f));
        }
      }
    } catch { }
  }
  return results;
});

ipcMain.handle('set-wallpaper', async (_, imagePath) => {
  const quoted = `"${imagePath}"`;
  try {
    await execAsync(`swww img ${quoted} --transition-type grow --transition-pos center`);
    return { ok: true, method: 'swww' };
  } catch { }
  try {
    await execAsync(`hyprctl hyprpaper preload ${quoted}`);
    await execAsync(`hyprctl hyprpaper wallpaper ",${imagePath}"`);
    return { ok: true, method: 'hyprpaper' };
  } catch { }
  try {
    await execAsync(`pkill swaybg; swaybg -i ${quoted} -m fill &`);
    return { ok: true, method: 'swaybg' };
  } catch { }
  try {
    await execAsync(`feh --bg-fill ${quoted}`);
    return { ok: true, method: 'feh' };
  } catch { }
  return { ok: false, error: 'No supported wallpaper setter found (swww, hyprpaper, swaybg, feh)' };
});

ipcMain.handle('get-current-wallpaper', () => {
  try {
    const swwwCache = path.join(os.homedir(), '.cache', 'swww');
    if (fs.existsSync(swwwCache)) {
      const monitors = fs.readdirSync(swwwCache);
      for (const m of monitors) {
        const f = path.join(swwwCache, m);
        if (fs.statSync(f).isFile()) {
          const content = fs.readFileSync(f, 'utf8').trim().split('\n').pop()?.trim();
          if (content && fs.existsSync(content)) return content;
        }
      }
    }
  } catch { }

  try {
    const hyprpaperConf = path.join(os.homedir(), '.config', 'hypr', 'hyprpaper.conf');
    if (fs.existsSync(hyprpaperConf)) {
      const content = fs.readFileSync(hyprpaperConf, 'utf8');
      const match = content.match(/wallpaper\s*=\s*[^,]+,\s*(.+)/);
      if (match) {
        const wp = match[1].trim().replace(/^~/, os.homedir());
        if (fs.existsSync(wp)) return wp;
      }
    }
  } catch { }

  try {
    const pidFile = path.join(os.homedir(), '.cache', 'wal', 'wal');
    if (fs.existsSync(pidFile)) {
      const p = fs.readFileSync(pidFile, 'utf8').trim();
      if (p && fs.existsSync(p)) return p;
    }
  } catch { }

  return null;
});

ipcMain.handle('get-file-as-dataurl', (_, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', tiff: 'image/tiff' };
    const mime = mimes[ext] || 'image/jpeg';
    return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('pick-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Wallpaper',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] }],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('pick-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Wallpaper Folder',
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});