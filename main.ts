import { app, BrowserWindow, ipcMain, dialog, IpcMainInvokeEvent } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface WatchListener {
  (curr: fs.Stats, prev: fs.Stats): void;
}

interface FileReadResult {
  ok: boolean;
  content: string;
  error?: string;
}

interface FileWriteResult {
  ok: boolean;
  error?: string;
}

interface DataUrlResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

interface WallpaperResult {
  ok: boolean;
  method?: string;
  error?: string;
}

interface RestoreFileResult {
  ok: boolean;
  filePath: string;
  backup?: string;
  error?: string;
}

interface RestoreResult {
  ok: boolean;
  restored: number;
  failed: RestoreFileResult[];
  results?: RestoreFileResult[];
  error?: string;
}

class HyprApp {
  private mainWindow: BrowserWindow | null = null;
  private watchedFiles: Map<string, WatchListener> = new Map();
  private readonly IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".avif"]);

  CreateWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      frame: false,
      titleBarStyle: "hidden",
      backgroundColor: "#061919",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
      icon: path.join(__dirname, "assets", "icon.png"),
    });

    this.mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

    if (process.argv.includes("--dev")) {
      this.mainWindow.webContents.openDevTools();
    }

    this.mainWindow.on("closed", () => { this.mainWindow = null; });
  }

  private FindHyprlandConfig(): string | null {
    const candidates = [
      path.join(os.homedir(), ".config", "hypr", "hyprland.conf"),
      path.join(os.homedir(), ".config", "hyprland", "hyprland.conf"),
      "/etc/hypr/hyprland.conf",
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private RestoreBackupFile(filePath: string): RestoreFileResult {
    const backup = filePath + ".hypreditor.bak";
    if (!fs.existsSync(backup)) return { ok: false, error: "backup file not found", filePath };
    try {
      fs.copyFileSync(backup, filePath);
      return { ok: true, filePath, backup };
    } catch (e) {
      return { ok: false, error: (e as Error).message, filePath };
    }
  }

  private FindWaybarCss(): string | null {
    const candidates = [
      path.join(os.homedir(), ".config", "waybar", "style.css"),
      path.join(os.homedir(), ".config", "waybar", "styles.css"),
      path.join(os.homedir(), ".waybar", "style.css"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private GetCurrentWallpaper(): string | null {
    try {
      const swwwCache = path.join(os.homedir(), ".cache", "swww");
      if (fs.existsSync(swwwCache)) {
        const monitors = fs.readdirSync(swwwCache);
        for (const m of monitors) {
          const f = path.join(swwwCache, m);
          if (fs.statSync(f).isFile()) {
            const content = fs.readFileSync(f, "utf8").trim().split("\n").pop()?.trim();
            if (content && fs.existsSync(content)) return content;
          }
        }
      }
    } catch { }

    try {
      const hyprpaperConf = path.join(os.homedir(), ".config", "hypr", "hyprpaper.conf");
      if (fs.existsSync(hyprpaperConf)) {
        const content = fs.readFileSync(hyprpaperConf, "utf8");
        const match = content.match(/wallpaper\s*=\s*[^,]+,\s*(.+)/);
        if (match) {
          const wp = match[1].trim().replace(/^~/, os.homedir());
          if (fs.existsSync(wp)) return wp;
        }
      }
    } catch { }

    try {
      const pidFile = path.join(os.homedir(), ".cache", "wal", "wal");
      if (fs.existsSync(pidFile)) {
        const p = fs.readFileSync(pidFile, "utf8").trim();
        if (p && fs.existsSync(p)) return p;
      }
    } catch { }

    return null;
  }

  private async SetWallpaper(imagePath: string): Promise<WallpaperResult> {
    const quoted = `"${imagePath}"`;
    try {
      await execAsync(`swww img ${quoted} --transition-type grow --transition-pos center`);
      return { ok: true, method: "swww" };
    } catch { }
    try {
      await execAsync(`hyprctl hyprpaper preload ${quoted}`);
      await execAsync(`hyprctl hyprpaper wallpaper ",${imagePath}"`);
      return { ok: true, method: "hyprpaper" };
    } catch { }
    try {
      await execAsync(`pkill swaybg; swaybg -i ${quoted} -m fill &`);
      return { ok: true, method: "swaybg" };
    } catch { }
    try {
      await execAsync(`feh --bg-fill ${quoted}`);
      return { ok: true, method: "feh" };
    } catch { }
    return { ok: false, error: "No supported wallpaper setter found (swww, hyprpaper, swaybg, feh)" };
  }

  private async GetWallpapers(dirs: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const dir of dirs) {
      try {
        const expanded = dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir;
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

  private GetFileAsDataUrl(filePath: string): DataUrlResult {
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mimes: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
        avif: "image/avif", tiff: "image/tiff",
      };
      const mime = mimes[ext] || "image/jpeg";
      return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString("base64")}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private WatchFile(filePath: string): void {
    if (!filePath || this.watchedFiles.has(filePath)) return;
    const listener: WatchListener = () => {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        this.mainWindow?.webContents.send("file-changed", { filePath, content });
      } catch { }
    };
    fs.watchFile(filePath, { interval: 400, persistent: false }, listener);
    this.watchedFiles.set(filePath, listener);
  }

  private UnwatchFile(filePath: string): void {
    if (!filePath) return;
    const listener = this.watchedFiles.get(filePath);
    if (listener) {
      fs.unwatchFile(filePath, listener);
      this.watchedFiles.delete(filePath);
    }
  }

  RegisterIpc(): void {
    ipcMain.handle("restore-backups", (_event: IpcMainInvokeEvent, filePaths: string[]): RestoreResult => {
      try {
        const results = filePaths.map(fp => this.RestoreBackupFile(fp));
        const restored = results.filter(r => r.ok).length;
        const failed = results.filter(r => !r.ok);
        return { ok: failed.length === 0, restored, failed, results };
      } catch (e) {
        return { ok: false, error: (e as Error).message, restored: 0, failed: [] };
      }
    });

    ipcMain.handle("find-config", (): string | null => this.FindHyprlandConfig());

    ipcMain.handle("read-file", (_event: IpcMainInvokeEvent, filePath: string): FileReadResult => {
      try {
        return { ok: true, content: fs.readFileSync(filePath, "utf8") };
      } catch (e) {
        return { ok: false, content: "", error: (e as Error).message };
      }
    });

    ipcMain.handle("write-file", (_event: IpcMainInvokeEvent, filePath: string, content: string): FileWriteResult => {
      try {
        const backup = filePath + ".hypreditor.bak";
        if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backup);
        fs.writeFileSync(filePath, content, "utf8");
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    });

    ipcMain.handle("pick-file", async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        title: "Open Hyprland Config",
        defaultPath: path.join(os.homedir(), ".config", "hypr"),
        filters: [{ name: "Config Files", extensions: ["conf", "cfg", "ini", "*"] }],
        properties: ["openFile"],
      });
      if (result.canceled) return null;
      return result.filePaths[0];
    });

    ipcMain.handle("get-included-files", (_event: IpcMainInvokeEvent, configPath: string, sources: string[]) => {
      const dir = path.dirname(configPath);
      const found: Array<{ path: string; content: string; source: string }> = [];
      for (const src of sources) {
        const expanded = src.startsWith("~") ? path.join(os.homedir(), src.slice(1)) : src;
        const resolved = path.resolve(dir, expanded);
        if (fs.existsSync(resolved)) {
          try {
            found.push({ path: resolved, content: fs.readFileSync(resolved, "utf8"), source: src });
          } catch { }
        }
      }
      return found;
    });

    ipcMain.handle("window-minimize", () => this.mainWindow?.minimize());
    ipcMain.handle("window-maximize", () => {
      if (this.mainWindow?.isMaximized()) this.mainWindow.unmaximize();
      else this.mainWindow?.maximize();
    });
    ipcMain.handle("window-close", () => this.mainWindow?.close());
    ipcMain.handle("reload", () => this.mainWindow?.webContents.reload());

    ipcMain.handle("find-waybar-css", (): string | null => this.FindWaybarCss());

    ipcMain.handle("pick-css-file", async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        title: "Open Waybar CSS",
        defaultPath: path.join(os.homedir(), ".config", "waybar"),
        filters: [{ name: "CSS Files", extensions: ["css"] }, { name: "All Files", extensions: ["*"] }],
        properties: ["openFile"],
      });
      if (result.canceled) return null;
      return result.filePaths[0];
    });

    ipcMain.handle("watch-file", (_event: IpcMainInvokeEvent, filePath: string) => this.WatchFile(filePath));
    ipcMain.handle("unwatch-file", (_event: IpcMainInvokeEvent, filePath: string) => this.UnwatchFile(filePath));

    ipcMain.handle("get-wallpapers", async (_event: IpcMainInvokeEvent, dirs: string[]): Promise<string[]> => this.GetWallpapers(dirs));
    ipcMain.handle("set-wallpaper", async (_event: IpcMainInvokeEvent, imagePath: string): Promise<WallpaperResult> => this.SetWallpaper(imagePath));
    ipcMain.handle("get-current-wallpaper", (): string | null => this.GetCurrentWallpaper());
    ipcMain.handle("get-file-as-dataurl", (_event: IpcMainInvokeEvent, filePath: string): DataUrlResult => this.GetFileAsDataUrl(filePath));

    ipcMain.handle("pick-image", async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        title: "Choose Wallpaper",
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"] }],
        properties: ["openFile"],
      });
      if (result.canceled) return null;
      return result.filePaths[0];
    });

    ipcMain.handle("pick-directory", async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        title: "Choose Wallpaper Folder",
        properties: ["openDirectory"],
      });
      if (result.canceled) return null;
      return result.filePaths[0];
    });
  }

  Run(): void {
    app.whenReady().then(() => {
      this.CreateWindow();
      this.RegisterIpc();
    });

    app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
    app.on("activate", () => { if (this.mainWindow === null) this.CreateWindow(); });
  }
}

const hyprApp = new HyprApp();
hyprApp.Run();