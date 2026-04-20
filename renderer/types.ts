export interface FileResult {
  ok: boolean;
  content: string;
  error?: string;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

export interface DataUrlResult {
  ok: boolean;
  dataUrl: string;
  error?: string;
}

export interface WallpaperResult {
  ok: boolean;
  method?: string;
  error?: string;
}

export interface IncludedFile {
  path: string;
  content: string;
  source: string;
}

export interface RestoreFileResult {
  ok: boolean;
  filePath: string;
  backup?: string;
  error?: string;
}

export interface RestoreResult {
  ok: boolean;
  restored: number;
  failed: Array<{ filePath?: string; error?: string }>;
  results?: RestoreFileResult[];
  error?: string;
}

export interface BluetoothDevice {
  mac: string;
  name: string;
  connected: boolean;
  paired: boolean;
  icon?: string;
}

export interface BluetoothStatusResult {
  ok: boolean;
  powered: boolean;
  discovering: boolean;
  name: string;
  error?: string;
}

export interface BluetoothDevicesResult {
  ok: boolean;
  devices: BluetoothDevice[];
  error?: string;
}

export interface BluetoothActionResult {
  ok: boolean;
  error?: string;
}

export interface WifiNetwork {
  active: boolean;
  ssid: string;
  bssid: string;
  signal: number;
  security: string;
}

export interface WifiStatusResult {
  ok: boolean;
  enabled: boolean;
  device: string | null;
  connection: string | null;
  error?: string;
}

export interface WifiNetworksResult {
  ok: boolean;
  networks: WifiNetwork[];
  error?: string;
}

export interface WifiActionResult {
  ok: boolean;
  error?: string;
}

export interface HyprIPC {
  findConfig(): Promise<string | null>;
  readFile(path: string): Promise<FileResult>;
  writeFile(path: string, content: string): Promise<WriteResult>;
  pickFile(opts?: { filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  pickCssFile(): Promise<string | null>;
  pickImage(): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
  getIncludedFiles(configPath: string, sources: string[]): Promise<IncludedFile[]>;
  restoreBackups(filePaths: string[]): Promise<RestoreResult>;

  minimize(): void;
  maximize(): void;
  close(): void;
  reload(): void;

  findWaybarCss(): Promise<string | null>;
  watchFile(path: string): Promise<void>;
  unwatchFile(path: string): Promise<void>;
  onFileChanged(cb: (data: { filePath: string; content: string }) => void): void;

  getWallpapers(dirs: string[]): Promise<string[]>;
  setWallpaper(path: string): Promise<WallpaperResult>;
  getCurrentWallpaper(): Promise<string | null>;
  getFileAsDataUrl(path: string): Promise<DataUrlResult>;

  getBluetoothStatus(): Promise<BluetoothStatusResult>;
  getBluetoothDevices(): Promise<BluetoothDevicesResult>;
  setBluetoothPower(on: boolean): Promise<BluetoothActionResult>;
  bluetoothScan(): Promise<BluetoothDevicesResult>;
  bluetoothConnect(mac: string): Promise<BluetoothActionResult>;
  bluetoothDisconnect(mac: string): Promise<BluetoothActionResult>;
  bluetoothRemove(mac: string): Promise<BluetoothActionResult>;

  getWifiStatus(): Promise<WifiStatusResult>;
  getWifiNetworks(): Promise<WifiNetworksResult>;
  wifiConnect(ssid: string, password?: string): Promise<WifiActionResult>;
  wifiDisconnect(): Promise<WifiActionResult>;
  wifiForget(ssid: string): Promise<WifiActionResult>;
}

declare global {
  interface Window {
    hypr: HyprIPC;
    __homedir?: string;
  }
}

interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
  addEventListener(type: 'chargingchange' | 'levelchange', listener: EventListenerOrEventListenerObject): void;
}