interface LockscreenState {
  configPath: string | null;
  configContent: string;
  originalContent: string;
  isDirty: boolean;
  watchActive: boolean;
  fileChangedRegistered: boolean;
  wallpaperPath: string | null;
}

class LockscreenManager {
  private state: LockscreenState = {
    configPath: null,
    configContent: "",
    originalContent: "",
    isDirty: false,
    watchActive: false,
    fileChangedRegistered: false,
    wallpaperPath: null,
  };

  private EscapeHtml(s: unknown): string {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private StorageGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  private StorageSet(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { }
  }

  private StorageRemove(key: string): void {
    try { localStorage.removeItem(key); } catch { }
  }

  private async FindConfig(): Promise<string | null> {
    const home = window.__homedir || "";
    const candidates = [
      `${home}/.config/hypr/hyprlock.conf`,
      `${home}/.config/hyprlock/hyprlock.conf`,
      `${home}/.config/hyprlock.conf`,
    ];
    for (const p of candidates) {
      const res = await window.hypr.readFile(p);
      if (res.ok) return p;
    }
    return null;
  }

  private ExtractWallpaperPath(content: string): string | null {
    const m = content.match(/^\s*path\s*=\s*(.+)$/m);
    return m ? m[1].trim() : null;
  }

  private UpdateWallpaperInConfig(imagePath: string): void {
    if (!this.state.configContent && !this.state.configPath) return;
    const hasPath = /^\s*path\s*=\s*.+$/m.test(this.state.configContent);
    const updated = hasPath
      ? this.state.configContent.replace(/^(\s*path\s*=\s*)(.+)$/m, `$1${imagePath}`)
      : this.state.configContent + `\nbackground {\n    path = ${imagePath}\n    blur_passes = 2\n    blur_size = 7\n}`;
    this.state.configContent = updated;
    this.state.isDirty = true;
    const editor = document.getElementById("lock-config-editor") as HTMLTextAreaElement | null;
    if (editor) editor.value = updated;
    const saveBtn = document.getElementById("lock-save-btn") as HTMLButtonElement | null;
    saveBtn?.classList.add("dirty");
    this.ShowStatus("Wallpaper updated — save to apply", "info");
  }

  private ShowStatus(msg: string, type: string): void {
    const el = document.getElementById("lock-status") as (HTMLElement & { _t?: ReturnType<typeof setTimeout> }) | null;
    if (!el) return;
    el.textContent = msg;
    el.className = `waybar-status-badge waybar-status-${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3200);
  }

  async init(): Promise<void> {
    const savedConfigPath = this.StorageGet("hypreditor:lockscreen:configPath");
    let found: string | null = null;

    if (savedConfigPath) {
      const res = await window.hypr.readFile(savedConfigPath);
      if (res.ok) found = savedConfigPath;
      else this.StorageRemove("hypreditor:lockscreen:configPath");
    }

    if (!found) {
      found = await this.FindConfig();
      if (found) this.StorageSet("hypreditor:lockscreen:configPath", found);
    }

    this.state.configPath = found;

    if (found) {
      const res = await window.hypr.readFile(found);
      if (res.ok) {
        this.state.configContent = res.content;
        this.state.originalContent = res.content;
        this.state.wallpaperPath = this.ExtractWallpaperPath(res.content) ?? this.StorageGet("hypreditor:lockscreen:wallpaperPath");
      }
    } else {
      this.state.wallpaperPath = this.StorageGet("hypreditor:lockscreen:wallpaperPath");
    }

    if (this.state.wallpaperPath) {
      this.StorageSet("hypreditor:lockscreen:wallpaperPath", this.state.wallpaperPath);
    }

    if (this.state.configPath && !this.state.watchActive) {
      await window.hypr.watchFile(this.state.configPath);
      this.state.watchActive = true;
    }

    if (!this.state.fileChangedRegistered) {
      this.state.fileChangedRegistered = true;
      window.hypr.onFileChanged(({ filePath, content }: { filePath: string; content: string }) => {
        if (filePath !== this.state.configPath) return;
        this.state.configContent = content;
        this.state.isDirty = content !== this.state.originalContent;
        const editor = document.getElementById("lock-config-editor") as HTMLTextAreaElement | null;
        if (editor) editor.value = content;
        this.ShowStatus("Updated from disk", "info");
      });
    }
  }

  renderSection(container: HTMLElement): void {
    const pathDisplay = this.state.configPath
      ? this.state.configPath.replace(window.__homedir || "", "~")
      : "~/.config/hypr/hyprlock.conf (not found)";

    const wpSrc = this.state.wallpaperPath ? `file://${this.state.wallpaperPath}` : "";
    const wpName = this.state.wallpaperPath ? this.state.wallpaperPath.split("/").pop()! : "No wallpaper set in config";

    container.innerHTML = `
      <div class="waybar-section">
        <div class="waybar-path-bar">
          <svg class="waybar-path-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <code class="waybar-path-value" id="lock-config-path">${pathDisplay}</code>
          <div class="waybar-path-actions">
            <button class="tb-action" id="lock-reload-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Reload
            </button>
            <button class="tb-action" id="lock-pick-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Browse
            </button>
            <button class="tb-action save ${this.state.isDirty ? "dirty" : ""}" id="lock-save-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Apply to disk
            </button>
            <span class="waybar-status-badge" id="lock-status"></span>
          </div>
        </div>

        <div class="wallpaper-banner" style="margin-bottom:12px;">
          ${wpSrc
        ? `<img id="lock-wp-img" class="wallpaper-banner-img" src="${wpSrc}" alt="Lockscreen wallpaper" draggable="false">`
        : `<div class="wallpaper-banner-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`
      }
          <div class="wallpaper-banner-info">
            <div class="wallpaper-banner-label">Lockscreen Wallpaper</div>
            <div class="wallpaper-banner-name" id="lock-wp-name">${this.EscapeHtml(wpName)}</div>
            <div class="wallpaper-banner-path" id="lock-wp-path">${this.EscapeHtml(this.state.wallpaperPath || "—")}</div>
          </div>
          <button class="tb-action" id="lock-wp-pick-btn" style="margin-left:auto;flex-shrink:0;align-self:center;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Change Wallpaper
          </button>
        </div>

        <div style="flex:1;display:flex;gap:10px;height:calc(100vh - 300px);min-height:360px;margin-top:10px;">
          <div class="waybar-editor-pane" style="flex:1;display:flex;flex-direction:column;min-width:0;">
            <div class="waybar-pane-header">
              <span>hyprlock.conf</span>
              <span class="waybar-hint">background, clock, input-field, label, image blocks</span>
            </div>
            <textarea id="lock-config-editor" class="waybar-css-editor" spellcheck="false" autocomplete="off" autocorrect="off" style="flex:1;resize:none;min-height:0;" placeholder="hyprlock.conf will appear here once a file is found.">${this.EscapeHtml(this.state.configContent)}</textarea>
          </div>
        </div>
      </div>`;

    this.BindEvents();
  }

  private BindEvents(): void {
    const editor = document.getElementById("lock-config-editor") as HTMLTextAreaElement;
    const saveBtn = document.getElementById("lock-save-btn") as HTMLButtonElement;

    editor?.addEventListener("input", () => {
      this.state.configContent = editor.value;
      this.state.isDirty = editor.value !== this.state.originalContent;
      saveBtn?.classList.toggle("dirty", this.state.isDirty);
    });

    document.getElementById("lock-reload-btn")?.addEventListener("click", async () => {
      if (!this.state.configPath) return;
      const res = await window.hypr.readFile(this.state.configPath);
      if (res.ok) {
        this.state.configContent = res.content;
        this.state.originalContent = res.content;
        this.state.isDirty = false;
        if (editor) editor.value = res.content;
        saveBtn?.classList.remove("dirty");
        this.ShowStatus("Reloaded", "success");
      } else {
        this.ShowStatus("Read error: " + res.error, "error");
      }
    });

    saveBtn?.addEventListener("click", async () => {
      if (!this.state.configPath) { this.ShowStatus("No file — use Browse", "error"); return; }
      const res = await window.hypr.writeFile(this.state.configPath, this.state.configContent);
      if (res.ok) {
        this.state.originalContent = this.state.configContent;
        this.state.isDirty = false;
        saveBtn.classList.remove("dirty");
        this.ShowStatus("Applied ✓", "success");
      } else {
        this.ShowStatus("Write failed: " + res.error, "error");
      }
    });

    document.getElementById("lock-pick-btn")?.addEventListener("click", async () => {
      const p = await window.hypr.pickFile();
      if (!p) return;
      if (this.state.configPath) await window.hypr.unwatchFile(this.state.configPath);
      this.state.configPath = p;
      this.StorageSet("hypreditor:lockscreen:configPath", p);
      const pathEl = document.getElementById("lock-config-path");
      if (pathEl) pathEl.textContent = p.replace(window.__homedir || "", "~");
      const res = await window.hypr.readFile(p);
      if (res.ok) {
        this.state.configContent = res.content;
        this.state.originalContent = res.content;
        this.state.isDirty = false;
        if (editor) editor.value = res.content;
        saveBtn?.classList.remove("dirty");
        const extracted = this.ExtractWallpaperPath(res.content);
        if (extracted) {
          this.state.wallpaperPath = extracted;
          this.StorageSet("hypreditor:lockscreen:wallpaperPath", extracted);
        }
      }
      await window.hypr.watchFile(p);
    });

    document.getElementById("lock-wp-pick-btn")?.addEventListener("click", async () => {
      const p = await window.hypr.pickImage();
      if (!p) return;
      this.state.wallpaperPath = p;
      this.StorageSet("hypreditor:lockscreen:wallpaperPath", p);
      const nameEl = document.getElementById("lock-wp-name");
      const pathEl = document.getElementById("lock-wp-path");
      if (nameEl) nameEl.textContent = p.split("/").pop()!;
      if (pathEl) pathEl.textContent = p;
      const wpImg = document.getElementById("lock-wp-img") as HTMLImageElement | null;
      if (wpImg) {
        wpImg.src = `file://${p}`;
      } else {
        const placeholder = document.querySelector(".wallpaper-banner-placeholder");
        if (placeholder) placeholder.outerHTML = `<img id="lock-wp-img" class="wallpaper-banner-img" src="file://${p}" alt="Lockscreen wallpaper" draggable="false">`;
      }
      this.UpdateWallpaperInConfig(p);
    });
  }
}

const lockscreenManager = new LockscreenManager();
export async function initLockscreenSection(): Promise<void> { return lockscreenManager.init(); }
export function renderLockscreenSection(container: HTMLElement): void { return lockscreenManager.renderSection(container); }