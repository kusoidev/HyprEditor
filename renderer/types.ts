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

export interface HyprIPC {
  findConfig(): Promise<string | null>;
  readFile(path: string): Promise<FileResult>;
  writeFile(path: string, content: string): Promise<WriteResult>;
  pickFile(opts?: { filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  pickCssFile(): Promise<string | null>;
  pickImage(): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
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
  getHomeDir?(): Promise<string>;
  getIncludedFiles(configPath: string, sources: string[]): Promise<IncludedFile[]>;
  restoreBackups(filePaths: string[]): Promise<RestoreResult>;
}

declare global {
  interface Window {
    hypr: HyprIPC;
    __homedir?: string;
  }
}