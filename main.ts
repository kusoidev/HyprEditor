import { app, BrowserWindow, ipcMain, dialog, IpcMainInvokeEvent } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface WatchListener { (curr: fs.Stats, prev: fs.Stats): void; }
interface FileReadResult { ok: boolean; content: string; error?: string; }
interface FileWriteResult { ok: boolean; error?: string; }
interface DataUrlResult { ok: boolean; dataUrl?: string; error?: string; }
interface WallpaperResult { ok: boolean; method?: string; error?: string; }
interface RestoreFileResult { ok: boolean; filePath: string; backup?: string; error?: string; }
interface RestoreResult { ok: boolean; restored: number; failed: RestoreFileResult[]; results?: RestoreFileResult[]; error?: string; }

interface BluetoothDevice { mac: string; name: string; connected: boolean; paired: boolean; icon?: string; }
interface BluetoothStatusResult { ok: boolean; powered: boolean; discovering: boolean; name: string; error?: string; }
interface BluetoothDevicesResult { ok: boolean; devices: BluetoothDevice[]; error?: string; }
interface BluetoothActionResult { ok: boolean; error?: string; }

interface WifiNetwork { active: boolean; ssid: string; bssid: string; signal: number; security: string; }
interface WifiStatusResult { ok: boolean; enabled: boolean; device: string | null; connection: string | null; error?: string; }
interface WifiNetworksResult { ok: boolean; networks: WifiNetwork[]; error?: string; }
interface WifiActionResult { ok: boolean; error?: string; }
interface IncludedFile { path: string; content: string; source: string; }

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
    if (process.argv.includes("--dev")) this.mainWindow.webContents.openDevTools();
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
        for (const m of fs.readdirSync(swwwCache)) {
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
    try { await execAsync(`swww img ${quoted} --transition-type grow --transition-pos center`); return { ok: true, method: "swww" }; } catch { }
    try { await execAsync(`hyprctl hyprpaper preload ${quoted}`); await execAsync(`hyprctl hyprpaper wallpaper ",${imagePath}"`); return { ok: true, method: "hyprpaper" }; } catch { }
    try { await execAsync(`pkill swaybg; swaybg -i ${quoted} -m fill &`); return { ok: true, method: "swaybg" }; } catch { }
    try { await execAsync(`feh --bg-fill ${quoted}`); return { ok: true, method: "feh" }; } catch { }
    return { ok: false, error: "No supported wallpaper setter found (swww, hyprpaper, swaybg, feh)" };
  }

  private async GetWallpapers(dirs: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const dir of dirs) {
      try {
        const expanded = dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir;
        if (!fs.existsSync(expanded)) continue;
        for (const f of fs.readdirSync(expanded)) {
          if (this.IMAGE_EXTS.has(path.extname(f).toLowerCase())) results.push(path.join(expanded, f));
        }
      } catch { }
    }
    return results;
  }

  private GetFileAsDataUrl(filePath: string): DataUrlResult {
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mimes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif", tiff: "image/tiff" };
      return { ok: true, dataUrl: `data:${mimes[ext] || "image/jpeg"};base64,${buffer.toString("base64")}` };
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
    if (listener) { fs.unwatchFile(filePath, listener); this.watchedFiles.delete(filePath); }
  }

  private GetIncludedFiles(configPath: string, sources: string[]): IncludedFile[] {
    const dir = path.dirname(configPath);
    const found: IncludedFile[] = [];

    for (const src of sources) {
      const expanded = src.startsWith("~") ? path.join(os.homedir(), src.slice(1)) : src;
      const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(dir, expanded);

      if (resolved.includes("*") || resolved.includes("?")) {
        try {
          const globDir = path.dirname(resolved);
          const pattern = path.basename(resolved);
          const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
          if (fs.existsSync(globDir)) {
            const matches = fs.readdirSync(globDir)
              .filter(f => regex.test(f) && fs.statSync(path.join(globDir, f)).isFile())
              .sort();
            for (const f of matches) {
              const fullPath = path.join(globDir, f);
              try { found.push({ path: fullPath, content: fs.readFileSync(fullPath, "utf8"), source: src }); } catch { }
            }
          }
        } catch { }
      } else if (fs.existsSync(resolved)) {
        try { found.push({ path: resolved, content: fs.readFileSync(resolved, "utf8"), source: src }); } catch { }
      }
    }

    return found;
  }

  private async GetBluetoothStatus(): Promise<BluetoothStatusResult> {
    try {
      const { stdout } = await execAsync("bluetoothctl show 2>/dev/null");
      return {
        ok: true,
        powered: /Powered:\s+yes/i.test(stdout),
        discovering: /Discovering:\s+yes/i.test(stdout),
        name: stdout.match(/Name:\s+(.+)/)?.[1]?.trim() || "Bluetooth Adapter",
      };
    } catch {
      return { ok: false, powered: false, discovering: false, name: "Unavailable", error: "bluetoothctl not found" };
    }
  }

  private async GetBluetoothDevices(): Promise<BluetoothDevicesResult> {
    try {
      const [{ stdout: allOut }, { stdout: connOut }] = await Promise.all([
        execAsync("bluetoothctl devices 2>/dev/null"),
        execAsync("bluetoothctl devices Connected 2>/dev/null"),
      ]);

      const connected = new Set<string>();
      for (const line of connOut.split("\n")) {
        const m = line.match(/Device ([0-9A-F:]{17})/i);
        if (m) connected.add(m[1].toUpperCase());
      }

      const devices: BluetoothDevice[] = [];
      for (const line of allOut.split("\n")) {
        const m = line.match(/Device ([0-9A-F:]{17})\s+(.+)/i);
        if (m) {
          const mac = m[1].toUpperCase();
          devices.push({ mac, name: m[2].trim(), connected: connected.has(mac), paired: true });
        }
      }

      return { ok: true, devices };
    } catch {
      return { ok: false, devices: [], error: "bluetoothctl not found" };
    }
  }

  private async SetBluetoothPower(on: boolean): Promise<BluetoothActionResult> {
    try {
      await execAsync(`bluetoothctl power ${on ? "on" : "off"} 2>/dev/null`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async BluetoothScan(): Promise<BluetoothDevicesResult> {
    try {
      await execAsync("bluetoothctl --timeout 8 scan on 2>/dev/null").catch(() => { });
      const { stdout } = await execAsync("bluetoothctl devices 2>/dev/null");
      const { stdout: connOut } = await execAsync("bluetoothctl devices Connected 2>/dev/null");

      const connected = new Set<string>();
      for (const line of connOut.split("\n")) {
        const m = line.match(/Device ([0-9A-F:]{17})/i);
        if (m) connected.add(m[1].toUpperCase());
      }

      const devices: BluetoothDevice[] = [];
      for (const line of stdout.split("\n")) {
        const m = line.match(/Device ([0-9A-F:]{17})\s+(.+)/i);
        if (m) {
          const mac = m[1].toUpperCase();
          devices.push({ mac, name: m[2].trim(), connected: connected.has(mac), paired: true });
        }
      }

      return { ok: true, devices };
    } catch {
      return { ok: false, devices: [], error: "Scan failed" };
    }
  }

  private async BluetoothConnect(mac: string): Promise<BluetoothActionResult> {
    try {
      await execAsync(`bluetoothctl connect ${mac} 2>/dev/null`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async BluetoothDisconnect(mac: string): Promise<BluetoothActionResult> {
    try {
      await execAsync(`bluetoothctl disconnect ${mac} 2>/dev/null`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async BluetoothRemove(mac: string): Promise<BluetoothActionResult> {
    try {
      await execAsync(`bluetoothctl remove ${mac} 2>/dev/null`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async GetWifiDevice(): Promise<string | null> {
    try {
      const { stdout } = await execAsync("nmcli -t -f DEVICE,TYPE device status 2>/dev/null");
      for (const line of stdout.split("\n")) {
        const parts = line.split(":");
        if (parts[1] === "wifi") return parts[0];
      }
    } catch { }
    return null;
  }

  private async GetWifiStatus(): Promise<WifiStatusResult> {
    try {
      const device = await this.GetWifiDevice();
      if (!device) return { ok: true, enabled: false, device: null, connection: null };

      const { stdout } = await execAsync(`nmcli -t -f DEVICE,STATE,CONNECTION device status 2>/dev/null`);
      for (const line of stdout.split("\n")) {
        const parts = line.split(":");
        if (parts[0] === device) {
          const enabled = parts[1] !== "unavailable" && parts[1] !== "unmanaged";
          const connection = parts[2] && parts[2] !== "--" ? parts[2] : null;
          return { ok: true, enabled, device, connection };
        }
      }

      return { ok: true, enabled: false, device, connection: null };
    } catch {
      return { ok: false, enabled: false, device: null, connection: null, error: "nmcli not found" };
    }
  }

  private async GetWifiNetworks(): Promise<WifiNetworksResult> {
    try {
      const { stdout } = await execAsync(
        "nmcli --escape no -m multiline -f ACTIVE,SSID,BSSID,SIGNAL,SECURITY device wifi list 2>/dev/null"
      );

      const networks: WifiNetwork[] = [];
      const blocks = stdout.trim().split(/\n\n+/);

      for (const block of blocks) {
        const lines: Record<string, string> = {};
        for (const line of block.split("\n")) {
          const idx = line.indexOf(":");
          if (idx === -1) continue;
          const key = line.slice(0, idx).replace(/\[\d+\]$/, "").trim();
          lines[key] = line.slice(idx + 1).trim();
        }

        const ssid = lines["SSID"] || "";
        if (!ssid || ssid === "--") continue;

        networks.push({
          active: lines["ACTIVE"] === "yes",
          ssid,
          bssid: lines["BSSID"] || "",
          signal: parseInt(lines["SIGNAL"] || "0", 10) || 0,
          security: lines["SECURITY"] || "--",
        });
      }

      const seen = new Set<string>();
      const deduped = networks.filter(n => {
        if (seen.has(n.ssid)) return false;
        seen.add(n.ssid);
        return true;
      });

      deduped.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.signal - a.signal);
      return { ok: true, networks: deduped };
    } catch {
      return { ok: false, networks: [], error: "nmcli not found" };
    }
  }

  private async WifiConnect(ssid: string, password?: string): Promise<WifiActionResult> {
    try {
      const cmd = password
        ? `nmcli device wifi connect ${JSON.stringify(ssid)} password ${JSON.stringify(password)} 2>/dev/null`
        : `nmcli device wifi connect ${JSON.stringify(ssid)} 2>/dev/null`;
      await execAsync(cmd);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async WifiDisconnect(): Promise<WifiActionResult> {
    try {
      const device = await this.GetWifiDevice();
      if (!device) return { ok: false, error: "No wifi device found" };
      await execAsync(`nmcli device disconnect ${device} 2>/dev/null`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async WifiForget(ssid: string): Promise<WifiActionResult> {
    try {
      await execAsync(`nmcli connection delete ${JSON.stringify(ssid)} 2>/dev/null`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  RegisterIpc(): void {
    ipcMain.handle("restore-backups", (_: IpcMainInvokeEvent, filePaths: string[]): RestoreResult => {
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

    ipcMain.handle("read-file", (_: IpcMainInvokeEvent, filePath: string): FileReadResult => {
      try { return { ok: true, content: fs.readFileSync(filePath, "utf8") }; }
      catch (e) { return { ok: false, content: "", error: (e as Error).message }; }
    });

    ipcMain.handle("write-file", (_: IpcMainInvokeEvent, filePath: string, content: string): FileWriteResult => {
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
      return result.canceled ? null : result.filePaths[0];
    });

    ipcMain.handle("get-included-files", (_: IpcMainInvokeEvent, configPath: string, sources: string[]): IncludedFile[] => {
      return this.GetIncludedFiles(configPath, sources);
    });
    ipcMain.handle("set-wifi-power", async (_, on: boolean) => {
      const cmd = on ? "nmcli radio wifi on" : "nmcli radio wifi off";
      return new Promise(resolve =>
        exec(cmd, err => resolve({ ok: !err }))
      );
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
      return result.canceled ? null : result.filePaths[0];
    });

    ipcMain.handle("watch-file", (_: IpcMainInvokeEvent, filePath: string) => this.WatchFile(filePath));
    ipcMain.handle("unwatch-file", (_: IpcMainInvokeEvent, filePath: string) => this.UnwatchFile(filePath));
    ipcMain.handle("get-wallpapers", async (_: IpcMainInvokeEvent, dirs: string[]): Promise<string[]> => this.GetWallpapers(dirs));
    ipcMain.handle("set-wallpaper", async (_: IpcMainInvokeEvent, imagePath: string): Promise<WallpaperResult> => this.SetWallpaper(imagePath));
    ipcMain.handle("get-current-wallpaper", (): string | null => this.GetCurrentWallpaper());
    ipcMain.handle("get-file-as-dataurl", (_: IpcMainInvokeEvent, filePath: string): DataUrlResult => this.GetFileAsDataUrl(filePath));

    ipcMain.handle("pick-image", async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        title: "Choose Wallpaper",
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"] }],
        properties: ["openFile"],
      });
      return result.canceled ? null : result.filePaths[0];
    });

    ipcMain.handle("pick-directory", async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        title: "Choose Wallpaper Folder",
        properties: ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    });

    ipcMain.handle("get-bluetooth-status", async (): Promise<BluetoothStatusResult> => this.GetBluetoothStatus());
    ipcMain.handle("get-bluetooth-devices", async (): Promise<BluetoothDevicesResult> => this.GetBluetoothDevices());
    ipcMain.handle("set-bluetooth-power", async (_: IpcMainInvokeEvent, on: boolean): Promise<BluetoothActionResult> => this.SetBluetoothPower(on));
    ipcMain.handle("bluetooth-scan", async (): Promise<BluetoothDevicesResult> => this.BluetoothScan());
    ipcMain.handle("bluetooth-connect", async (_: IpcMainInvokeEvent, mac: string): Promise<BluetoothActionResult> => this.BluetoothConnect(mac));
    ipcMain.handle("bluetooth-disconnect", async (_: IpcMainInvokeEvent, mac: string): Promise<BluetoothActionResult> => this.BluetoothDisconnect(mac));
    ipcMain.handle("bluetooth-remove", async (_: IpcMainInvokeEvent, mac: string): Promise<BluetoothActionResult> => this.BluetoothRemove(mac));

    ipcMain.handle("get-wifi-status", async (): Promise<WifiStatusResult> => this.GetWifiStatus());
    ipcMain.handle("get-wifi-networks", async (): Promise<WifiNetworksResult> => this.GetWifiNetworks());
    ipcMain.handle("wifi-connect", async (_: IpcMainInvokeEvent, ssid: string, password?: string): Promise<WifiActionResult> => this.WifiConnect(ssid, password));
    ipcMain.handle("wifi-disconnect", async (): Promise<WifiActionResult> => this.WifiDisconnect());
    ipcMain.handle("wifi-forget", async (_: IpcMainInvokeEvent, ssid: string): Promise<WifiActionResult> => this.WifiForget(ssid));
  }

  Run(): void {
    app.whenReady().then(() => { this.CreateWindow(); this.RegisterIpc(); });
    app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
    app.on("activate", () => { if (this.mainWindow === null) this.CreateWindow(); });
  }
}

const hyprApp = new HyprApp();
hyprApp.Run();