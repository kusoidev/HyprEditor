const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class HyprApp {
  constructor() {
    this.mainWindow = null;
    this.watchedFiles = new Map();
    this.IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.avif']);
  }

  CreateWindow() {
    this.mainWindow = new BrowserWindow({
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

    this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    if (process.argv.includes('--dev')) {
      this.mainWindow.webContents.openDevTools();
    }

    this.mainWindow.on('closed', () => { this.mainWindow = null; });
  }

  FindHyprlandConfig() {
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

  RestoreBackupFile(filePath) {
    const backup = filePath + '.hypreditor.bak';
    if (!fs.existsSync(backup)) return { ok: false, error: 'backup file not found', filePath };
    try {
      fs.copyFileSync(backup, filePath);
      return { ok: true, filePath, backup };
    } catch (e) {
      return { ok: false, error: e.message, filePath };
    }
  }

  FindWaybarCss() {
    const candidates = [
      path.join(os.homedir(), '.config', 'waybar', 'style.css'),
      path.join(os.homedir(), '.config', 'waybar', 'styles.css'),
      path.join(os.homedir(), '.waybar', 'style.css'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  GetCurrentWallpaper() {
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
  }

  async SetWallpaper(imagePath) {
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
  }

  async GetWallpapers(dirs) {
    const results = [];
    for (const dir of dirs) {
      try {
        const expanded = dir.startsWith('~') ? path.join(os.homedir(), dir.slice(1)) : dir;
        if (!fs.existsSync(expanded)) continue;
        const files = fs.readdirSync(expanded);
        for (const f of files) {
          if (this.IMAGE_EXTS.has(path.extname(f).toLowerCase())) {
            results.push(path.join(expanded, f));
          }
        }
      } catch { }
    }
    return results;
  }

  GetFileAsDataUrl(filePath) {
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mimes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', tiff: 'image/tiff' };
      const mime = mimes[ext] || 'image/jpeg';
      return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  WatchFile(filePath) {
    if (!filePath || this.watchedFiles.has(filePath)) return;
    const listener = () => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        this.mainWindow?.webContents.send('file-changed', { filePath, content });
      } catch { }
    };
    fs.watchFile(filePath, { interval: 400, persistent: false }, listener);
    this.watchedFiles.set(filePath, listener);
  }

  UnwatchFile(filePath) {
    if (!filePath) return;
    const listener = this.watchedFiles.get(filePath);
    if (listener) {
      fs.unwatchFile(filePath, listener);
      this.watchedFiles.delete(filePath);
    }
  }

  RegisterIpc() {
    ipcMain.handle('restore-backups', (_, filePaths) => {
      try {
        const results = filePaths.map(fp => this.RestoreBackupFile(fp));
        const restored = results.filter(r => r.ok).length;
        const failed = results.filter(r => !r.ok);
        return { ok: failed.length === 0, restored, failed, results };
      } catch (e) {
        return { ok: false, error: e.message, restored: 0, failed: [] };
      }
    });

    ipcMain.handle('find-config', () => this.FindHyprlandConfig());

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
      const result = await dialog.showOpenDialog(this.mainWindow, {
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

    ipcMain.handle('window-minimize', () => this.mainWindow?.minimize());
    ipcMain.handle('window-maximize', () => {
      if (this.mainWindow?.isMaximized()) this.mainWindow.unmaximize();
      else this.mainWindow?.maximize();
    });
    ipcMain.handle('window-close', () => this.mainWindow?.close());
    ipcMain.handle('reload', () => this.mainWindow?.webContents.reload());

    ipcMain.handle('find-waybar-css', () => this.FindWaybarCss());

    ipcMain.handle('pick-css-file', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        title: 'Open Waybar CSS',
        defaultPath: path.join(os.homedir(), '.config', 'waybar'),
        filters: [{ name: 'CSS Files', extensions: ['css'] }, { name: 'All Files', extensions: ['*'] }],
        properties: ['openFile'],
      });
      if (result.canceled) return null;
      return result.filePaths[0];
    });

    ipcMain.handle('watch-file', (_, filePath) => this.WatchFile(filePath));
    ipcMain.handle('unwatch-file', (_, filePath) => this.UnwatchFile(filePath));

    ipcMain.handle('get-wallpapers', async (_, dirs) => this.GetWallpapers(dirs));
    ipcMain.handle('set-wallpaper', async (_, imagePath) => this.SetWallpaper(imagePath));
    ipcMain.handle('get-current-wallpaper', () => this.GetCurrentWallpaper());
    ipcMain.handle('get-file-as-dataurl', (_, filePath) => this.GetFileAsDataUrl(filePath));

    ipcMain.handle('pick-image', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        title: 'Choose Wallpaper',
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] }],
        properties: ['openFile'],
      });
      if (result.canceled) return null;
      return result.filePaths[0];
    });

    ipcMain.handle('pick-directory', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        title: 'Choose Wallpaper Folder',
        properties: ['openDirectory'],
      });
      if (result.canceled) return null;
      return result.filePaths[0];
    });
  }

  Run() {
    app.whenReady().then(() => {
      this.CreateWindow();
      this.RegisterIpc();
    });

    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
    app.on('activate', () => { if (this.mainWindow === null) this.CreateWindow(); });
  }
}

const hyprApp = new HyprApp();
hyprApp.Run();