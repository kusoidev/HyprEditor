class WaybarManager {
  constructor() {
    this.STORAGE_KEYS = {
      SCAN_DIRS: 'hypreditor_wallpaper_scan_dirs',
      CURRENT_WALLPAPER: 'hypreditor_current_wallpaper',
      WAYBAR_CSS_PATH: 'hypreditor_waybar_css_path',
      WAYBAR_CONFIG_PATH: 'hypreditor_waybar_config_path',
    };

    this.sharedWallpaperDataUrl = null;

    this.waybarState = {
      cssPath: null,
      cssContent: '',
      originalContent: '',
      wallpaperDataUrl: null,
      isDirty: false,
      watchActive: false,
      previewDebounce: null,
      fileChangedRegistered: false,
    };

    this.waybarConfigState = {
      configPath: null,
      configContent: '',
      originalContent: '',
      isDirty: false,
      watchActive: false,
      fileChangedRegistered: false,
    };

    this.DEFAULT_SCAN_DIRS = [
      '~/Pictures',
      '~/Wallpapers',
      '~/wallpapers',
      '~/Downloads/Wallpapers',
      '~/Pictures/Wallpapers',
    ];

    this.wallpaperState = {
      wallpapers: [],
      current: null,
      scanDirs: this.StorageGetJSON(this.STORAGE_KEYS.SCAN_DIRS, null) || [...this.DEFAULT_SCAN_DIRS],
    };

    this.sys = {
      bat: 100,
      charging: false,
      cpu: 10,
      temp: 40,
      up: 1.0,
      down: 2.0,
      vol: 50
    };

    if (typeof navigator !== 'undefined' && navigator.getBattery) {
      navigator.getBattery().then(b => {
        this.sys.bat = Math.round(b.level * 100);
        this.sys.charging = b.charging;
        b.addEventListener('levelchange', () => {
          this.sys.bat = Math.round(b.level * 100);
          this.RenderPreview();
        });
        b.addEventListener('chargingchange', () => {
          this.sys.charging = b.charging;
          this.RenderPreview();
        });
      });
    }
  }

  StorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  StorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch { }
  }

  StorageGetJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  StorageSetJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { }
  }

  setSharedWallpaperDataUrl(url) {
    this.sharedWallpaperDataUrl = url;
    this.waybarState.wallpaperDataUrl = url;
    this.RenderPreview();
  }

  EscapeHtml(s = '') {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  EscapeAttr(s = '') {
    return String(s)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async initWaybarSection() {
    const savedCssPath = this.StorageGet(this.STORAGE_KEYS.WAYBAR_CSS_PATH);
    let found = null;

    if (savedCssPath) {
      const res = await window.hypr.readFile(savedCssPath);
      if (res.ok) found = savedCssPath;
    }

    if (!found) {
      found = await window.hypr.findWaybarCss();
      if (found) this.StorageSet(this.STORAGE_KEYS.WAYBAR_CSS_PATH, found);
    }

    this.waybarState.cssPath = found || null;

    if (found) {
      const res = await window.hypr.readFile(found);
      if (res.ok) {
        this.waybarState.cssContent = res.content;
        this.waybarState.originalContent = res.content;
      }
    }

    await this.AutoLoadWallpaperForPreview();

    if (this.waybarState.cssPath && !this.waybarState.watchActive) {
      await window.hypr.watchFile(this.waybarState.cssPath);
      this.waybarState.watchActive = true;
    }

    if (!this.waybarState.fileChangedRegistered) {
      this.waybarState.fileChangedRegistered = true;
      window.hypr.onFileChanged(({ filePath, content }) => {
        if (filePath !== this.waybarState.cssPath) return;
        this.waybarState.cssContent = content;
        this.waybarState.isDirty = content !== this.waybarState.originalContent;
        const editor = document.getElementById('waybar-css-editor');
        if (editor) editor.value = content;
        this.SchedulePreview();
        this.WaybarStatus('↻ Updated from disk', 'info');
      });
    }
  }

  async AutoLoadWallpaperForPreview() {
    if (this.sharedWallpaperDataUrl) {
      this.waybarState.wallpaperDataUrl = this.sharedWallpaperDataUrl;
      return;
    }

    let wpPath = await window.hypr.getCurrentWallpaper();
    if (!wpPath) wpPath = this.StorageGet(this.STORAGE_KEYS.CURRENT_WALLPAPER);

    if (wpPath) {
      const du = await window.hypr.getFileAsDataUrl(wpPath);
      if (du.ok) {
        this.waybarState.wallpaperDataUrl = du.dataUrl;
        this.sharedWallpaperDataUrl = du.dataUrl;
        this.StorageSet(this.STORAGE_KEYS.CURRENT_WALLPAPER, wpPath);
      }
    }
  }

  renderWaybarSection(container) {
    const pathDisplay = this.waybarState.cssPath
      ? this.waybarState.cssPath.replace(window.__homedir || '', '~')
      : '~/.config/waybar/style.css  (not found)';

    container.innerHTML = `
      <div class="waybar-section">
        ${this.BuildPathBar({
      pathId: 'waybar-css-path',
      pathDisplay,
      reloadId: 'waybar-reload-btn',
      pickId: 'waybar-pick-btn',
      saveId: 'waybar-save-btn',
      statusId: 'waybar-status',
      isDirty: this.waybarState.isDirty,
    })}

        <div class="waybar-body" style="display:flex;gap:10px;height:calc(100vh - 220px);min-height:560px;">
          <div class="waybar-editor-pane" style="flex:1;display:flex;flex-direction:column;min-width:0;">
            ${this.BuildPaneHeader('style.css', 'Edit here or save from VSCode')}
            <textarea
              id="waybar-css-editor"
              class="waybar-css-editor"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              style="flex:1;resize:none;min-height:0;"
              placeholder="Your waybar CSS will appear here once a file is found."
            >${this.EscapeHtml(this.waybarState.cssContent)}</textarea>
          </div>

          <div class="waybar-preview-pane" style="flex:1;display:flex;flex-direction:column;min-width:0;">
            ${this.BuildPreviewHeader('waybar-wp-btn')}
            <div class="waybar-preview-wrap" style="flex:1;min-height:0;position:relative;overflow-x:auto;">
            <iframe
              id="waybar-preview-frame"
              class="waybar-preview-frame"
              sandbox="allow-same-origin" 
              title="Waybar Preview"
              style="width:100%;height:100%;border:none;display:block;"
            ></iframe>
            </div>
            <p class="waybar-preview-note" style="margin-top:6px;font-size:11px;opacity:.5;">
              Rendered from your config + CSS. Changes update live.
            </p>
          </div>
        </div>
      </div>`;

    this.BindWaybarCssEvents();
    this.RenderPreview();
  }

  BindWaybarCssEvents() {
    const editor = document.getElementById('waybar-css-editor');
    const saveBtn = document.getElementById('waybar-save-btn');
    const reloadBtn = document.getElementById('waybar-reload-btn');
    const pickBtn = document.getElementById('waybar-pick-btn');
    const wpBtn = document.getElementById('waybar-wp-btn');

    editor.addEventListener('input', () => {
      this.waybarState.cssContent = editor.value;
      this.waybarState.isDirty = editor.value !== this.waybarState.originalContent;
      saveBtn.classList.toggle('dirty', this.waybarState.isDirty);
      this.SchedulePreview();
    });

    reloadBtn.addEventListener('click', async () => {
      if (!this.waybarState.cssPath) return;
      const res = await window.hypr.readFile(this.waybarState.cssPath);
      if (res.ok) {
        this.waybarState.cssContent = res.content;
        this.waybarState.originalContent = res.content;
        this.waybarState.isDirty = false;
        editor.value = res.content;
        saveBtn.classList.remove('dirty');
        this.RenderPreview();
        this.WaybarStatus('Reloaded', 'success');
      } else {
        this.WaybarStatus('Read error: ' + res.error, 'error');
      }
    });

    saveBtn.addEventListener('click', async () => {
      if (!this.waybarState.cssPath) {
        this.WaybarStatus('No file path set — use Browse', 'error');
        return;
      }
      const res = await window.hypr.writeFile(this.waybarState.cssPath, this.waybarState.cssContent);
      if (res.ok) {
        this.waybarState.originalContent = this.waybarState.cssContent;
        this.waybarState.isDirty = false;
        saveBtn.classList.remove('dirty');
        this.WaybarStatus('Applied ✓', 'success');
      } else {
        this.WaybarStatus('Write failed: ' + res.error, 'error');
      }
    });

    pickBtn.addEventListener('click', async () => {
      const p = await window.hypr.pickCssFile();
      if (!p) return;
      if (this.waybarState.cssPath) await window.hypr.unwatchFile(this.waybarState.cssPath);
      this.waybarState.cssPath = p;
      this.StorageSet(this.STORAGE_KEYS.WAYBAR_CSS_PATH, p);
      document.getElementById('waybar-css-path').textContent = p.replace(window.__homedir || '', '~');
      const res = await window.hypr.readFile(p);
      if (res.ok) {
        this.waybarState.cssContent = res.content;
        this.waybarState.originalContent = res.content;
        this.waybarState.isDirty = false;
        editor.value = res.content;
        saveBtn.classList.remove('dirty');
        this.RenderPreview();
      }
      await window.hypr.watchFile(p);
    });

    wpBtn.addEventListener('click', async () => {
      const p = await window.hypr.pickImage();
      if (!p) return;
      const du = await window.hypr.getFileAsDataUrl(p);
      if (du.ok) {
        this.waybarState.wallpaperDataUrl = du.dataUrl;
        this.sharedWallpaperDataUrl = du.dataUrl;
        this.StorageSet(this.STORAGE_KEYS.CURRENT_WALLPAPER, p);
        this.RenderPreview();
      }
    });
  }

  WaybarStatus(msg, type = 'info') {
    const el = document.getElementById('waybar-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `waybar-status-badge waybar-status-${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      if (el.textContent === msg) el.textContent = '';
    }, 3200);
  }

  async FindWaybarConfig() {
    let home = window.__homedir || '';

    if (!home && this.waybarState.cssPath) {
      const m = this.waybarState.cssPath.match(/^(\/(?:home|root)\/[^/]*)/);
      if (m) home = m[1];
    }

    if (!home && typeof window.hypr.getHomeDir === 'function') {
      home = await window.hypr.getHomeDir() || '';
    }

    const candidates = [
      `${home}/.config/waybar/config`,
      `${home}/.config/waybar/config.jsonc`,
      `${home}/.config/waybar/config.json`,
    ];

    for (const p of candidates) {
      if (!home || p.startsWith('/.')) continue;
      const res = await window.hypr.readFile(p);
      if (res.ok) return p;
    }

    return null;
  }

  async initWaybarConfigSection() {
    const savedConfigPath = this.StorageGet(this.STORAGE_KEYS.WAYBAR_CONFIG_PATH);
    let found = null;

    if (savedConfigPath && !savedConfigPath.startsWith('/.')) {
      const res = await window.hypr.readFile(savedConfigPath);
      if (res.ok) found = savedConfigPath;
      else this.StorageSet(this.STORAGE_KEYS.WAYBAR_CONFIG_PATH, '');
    }

    if (!found) {
      found = await this.FindWaybarConfig();
      if (found) this.StorageSet(this.STORAGE_KEYS.WAYBAR_CONFIG_PATH, found);
    }

    this.waybarConfigState.configPath = found || null;

    if (found) {
      const res = await window.hypr.readFile(found);
      if (res.ok) {
        this.waybarConfigState.configContent = res.content;
        this.waybarConfigState.originalContent = res.content;
      }
    }

    if (this.waybarConfigState.configPath && !this.waybarConfigState.watchActive) {
      await window.hypr.watchFile(this.waybarConfigState.configPath);
      this.waybarConfigState.watchActive = true;
    }

    if (!this.waybarConfigState.fileChangedRegistered) {
      this.waybarConfigState.fileChangedRegistered = true;
      window.hypr.onFileChanged(({ filePath, content }) => {
        if (filePath !== this.waybarConfigState.configPath) return;
        this.waybarConfigState.configContent = content;
        this.waybarConfigState.isDirty = content !== this.waybarConfigState.originalContent;
        const editor = document.getElementById('waybar-config-editor');
        if (editor) editor.value = content;
        this.SchedulePreview();
        this.WaybarConfigStatus('Updated from disk', 'info');
      });
    }
  }

  renderWaybarConfigSection(container) {
    const pathDisplay = this.waybarConfigState.configPath
      ? this.waybarConfigState.configPath.replace(window.__homedir || '', '~')
      : '~/.config/waybar/config  (not found)';

    container.innerHTML = `
      <div class="waybar-section">
        ${this.BuildPathBar({
      pathId: 'waybar-config-path',
      pathDisplay,
      reloadId: 'waybar-config-reload-btn',
      pickId: 'waybar-config-pick-btn',
      saveId: 'waybar-config-save-btn',
      statusId: 'waybar-config-status',
      isDirty: this.waybarConfigState.isDirty,
    })}

        <div class="waybar-body" style="display:flex;gap:10px;height:calc(100vh - 220px);min-height:560px;">
          <div class="waybar-editor-pane" style="flex:1;display:flex;flex-direction:column;min-width:0;">
            ${this.BuildPaneHeader('config', 'JSONC — edit here or save from VSCode')}
            <textarea
              id="waybar-config-editor"
              class="waybar-css-editor"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              style="flex:1;resize:none;min-height:0;"
              placeholder="Waybar config will appear here once a file is found."
            >${this.EscapeHtml(this.waybarConfigState.configContent)}</textarea>
          </div>

          <div class="waybar-preview-pane" style="flex:1;display:flex;flex-direction:column;min-width:0;">
            ${this.BuildPreviewHeader('waybar-config-wp-btn')}
            <div class="waybar-preview-wrap" style="flex:1;min-height:0;position:relative;overflow-x:auto;">
            <iframe
              id="waybar-preview-frame"
              class="waybar-preview-frame"
              sandbox="allow-same-origin" 
              title="Waybar Preview"
              style="width:100%;height:100%;border:none;display:block;"
            ></iframe>
            </div>
            <p class="waybar-preview-note" style="margin-top:6px;font-size:11px;opacity:.5;">
              Rendered from your config + CSS. Changes update live.
            </p>
          </div>
        </div>
      </div>`;

    this.BindWaybarConfigEvents();
    this.RenderPreview();
  }

  BindWaybarConfigEvents() {
    const editor = document.getElementById('waybar-config-editor');
    const saveBtn = document.getElementById('waybar-config-save-btn');
    const reloadBtn = document.getElementById('waybar-config-reload-btn');
    const pickBtn = document.getElementById('waybar-config-pick-btn');
    const wpBtn = document.getElementById('waybar-config-wp-btn');

    editor.addEventListener('input', () => {
      this.waybarConfigState.configContent = editor.value;
      this.waybarConfigState.isDirty = editor.value !== this.waybarConfigState.originalContent;
      saveBtn.classList.toggle('dirty', this.waybarConfigState.isDirty);
      this.SchedulePreview();
    });

    reloadBtn.addEventListener('click', async () => {
      if (!this.waybarConfigState.configPath) return;
      const res = await window.hypr.readFile(this.waybarConfigState.configPath);
      if (res.ok) {
        this.waybarConfigState.configContent = res.content;
        this.waybarConfigState.originalContent = res.content;
        this.waybarConfigState.isDirty = false;
        editor.value = res.content;
        saveBtn.classList.remove('dirty');
        this.RenderPreview();
        this.WaybarConfigStatus('Reloaded', 'success');
      } else {
        this.WaybarConfigStatus('Read error: ' + res.error, 'error');
      }
    });

    saveBtn.addEventListener('click', async () => {
      if (!this.waybarConfigState.configPath) {
        this.WaybarConfigStatus('No file path set — use Browse', 'error');
        return;
      }
      const res = await window.hypr.writeFile(this.waybarConfigState.configPath, this.waybarConfigState.configContent);
      if (res.ok) {
        this.waybarConfigState.originalContent = this.waybarConfigState.configContent;
        this.waybarConfigState.isDirty = false;
        saveBtn.classList.remove('dirty');
        this.WaybarConfigStatus('Applied ✓', 'success');
      } else {
        this.WaybarConfigStatus('Write failed: ' + res.error, 'error');
      }
    });

    pickBtn.addEventListener('click', async () => {
      const p = await window.hypr.pickFile({ filters: [{ name: 'Config', extensions: ['json', 'jsonc', '*'] }] });
      if (!p) return;
      if (this.waybarConfigState.configPath) await window.hypr.unwatchFile(this.waybarConfigState.configPath);
      this.waybarConfigState.configPath = p;
      this.StorageSet(this.STORAGE_KEYS.WAYBAR_CONFIG_PATH, p);
      document.getElementById('waybar-config-path').textContent = p.replace(window.__homedir || '', '~');
      const res = await window.hypr.readFile(p);
      if (res.ok) {
        this.waybarConfigState.configContent = res.content;
        this.waybarConfigState.originalContent = res.content;
        this.waybarConfigState.isDirty = false;
        editor.value = res.content;
        saveBtn.classList.remove('dirty');
        this.RenderPreview();
      }
      await window.hypr.watchFile(p);
    });

    wpBtn.addEventListener('click', async () => {
      const p = await window.hypr.pickImage();
      if (!p) return;
      const du = await window.hypr.getFileAsDataUrl(p);
      if (du.ok) {
        this.waybarState.wallpaperDataUrl = du.dataUrl;
        this.sharedWallpaperDataUrl = du.dataUrl;
        this.StorageSet(this.STORAGE_KEYS.CURRENT_WALLPAPER, p);
        this.RenderPreview();
      }
    });
  }

  WaybarConfigStatus(msg, type = 'info') {
    const el = document.getElementById('waybar-config-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `waybar-status-badge waybar-status-${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      if (el.textContent === msg) el.textContent = '';
    }, 3200);
  }

  BuildPathBar({ pathId, pathDisplay, reloadId, pickId, saveId, statusId, isDirty }) {
    return `
      <div class="waybar-path-bar">
        <svg class="waybar-path-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <code class="waybar-path-value" id="${pathId}">${pathDisplay}</code>
        <div class="waybar-path-actions">
          <button class="tb-action" id="${reloadId}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Reload
          </button>
          <button class="tb-action" id="${pickId}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            Browse
          </button>
          <button class="tb-action save ${isDirty ? 'dirty' : ''}" id="${saveId}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            Apply to disk
          </button>
          <span class="waybar-status-badge" id="${statusId}"></span>
        </div>
      </div>`;
  }

  BuildPaneHeader(title, hint) {
    return `
      <div class="waybar-pane-header">
        <span>${title}</span>
        <span class="waybar-hint">${hint}</span>
      </div>`;
  }

  BuildPreviewHeader(wpBtnId) {
    return `
      <div class="waybar-pane-header">
        <span>Live Preview</span>
        <button class="waybar-wp-btn" id="${wpBtnId}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          Set preview wallpaper
        </button>
      </div>`;
  }

  SchedulePreview() {
    clearTimeout(this.waybarState.previewDebounce);
    this.sys.cpu = Math.floor(Math.random() * 20) + 5;
    this.sys.temp = Math.floor(Math.random() * 15) + 35;
    this.sys.up = (Math.random() * 5).toFixed(1);
    this.sys.down = (Math.random() * 10).toFixed(1);
    this.waybarState.previewDebounce = setTimeout(() => this.RenderPreview(), 180);
  }

  ParseJsonc(src) {
    const stripped = src
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
  }

  GetIconByPercent(icons, percent) {
    if (!Array.isArray(icons) || !icons.length) return '';
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    const idx = Math.min(icons.length - 1, Math.floor((p / 100) * icons.length));
    return icons[idx] ?? icons[icons.length - 1] ?? '';
  }

  GetBatteryIcon(cfg, capacity = 96, charging = false, plugged = false) {
    if (charging && cfg?.['format-charging']) return '';
    if (plugged && cfg?.['format-plugged']) return '';
    if (capacity >= 95 && cfg?.['format-full']) return '';

    const icons = cfg?.['format-icons'];
    if (Array.isArray(icons) && icons.length) {
      const idx = Math.max(0, Math.min(icons.length - 1, Math.floor((capacity / 100) * icons.length)));
      return icons[idx] || icons[icons.length - 1] || '';
    }

    if (icons && typeof icons === 'object') {
      if (capacity <= (cfg?.states?.critical ?? 15) && icons.critical) return icons.critical;
      if (capacity <= (cfg?.states?.warning ?? 30) && icons.warning) return icons.warning;
      if (capacity >= (cfg?.states?.good ?? 85) && icons.good) return icons.good;
      if (icons.default) return Array.isArray(icons.default) ? (icons.default[0] || '') : icons.default;
    }

    return '';
  }

  GetVolumeIcon(cfg, volume = 40, muted = false) {
    if (muted) return '󰖁';

    const icons = cfg?.['format-icons'];
    if (!icons) return '󰕾';

    if (Array.isArray(icons)) {
      const idx = volume <= 33 ? 0 : volume <= 66 ? 1 : 2;
      return icons[Math.min(idx, icons.length - 1)] || icons[icons.length - 1] || '󰕾';
    }

    if (typeof icons === 'object') {
      if (icons.headphone) return icons.headphone;
      if (icons.headset) return icons.headset;
      const d = icons.default;
      if (Array.isArray(d)) {
        const idx = volume <= 33 ? 0 : volume <= 66 ? 1 : 2;
        return d[Math.min(idx, d.length - 1)] || d[d.length - 1] || '󰕾';
      }
      if (d) return d;
    }

    return '󰕾';
  }

  RenderModule(name, cfg, now) {
    const cssId = name.replace(/[^a-zA-Z0-9_-]/g, '-');
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (name === 'hyprland/workspaces') {
      const fmt = cfg?.format || '{name}';
      const workspaces = [1, 2, 6, 7, 8];
      const btns = workspaces.map(i => {
        const active = i === 8 ? ' active focused' : '';
        return `<button class="workspace-button${active}">${fmt.replace('{name}', i).replace('{id}', i)}</button>`;
      }).join('');
      return `<div id="${cssId}" class="module workspaces">${btns}</div>`;
    }

    if (name === 'clock') {
      const fmt = cfg?.format || '{:%a %d/%m/%Y ~ %H:%M}';
      return `<div id="${cssId}" class="module clock">${fmt
        .replace('{:%a %d/%m/%Y ~ %H:%M}', `${now.toLocaleDateString([], { weekday: 'short' })} ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ~ ${time}`)
        .replace(/\{[^}]+\}/g, '')}</div>`;
    }

    if (name === 'custom/power') {
      return `<div id="${cssId}" class="module custom-power">${cfg?.format || '⭘'}</div>`;
    }

    if (name === 'cpu') {
      const fmt = (cfg?.format || ' {usage}%').replace('{usage}', String(this.sys.cpu)).replace(/\{[^}]+\}/g, '');
      return `<div id="${cssId}" class="module cpu">${fmt}</div>`;
    }

    if (name === 'temperature') {
      const temp = this.sys.temp;
      const sourceFmt = temp >= (cfg?.['critical-threshold'] ?? 80)
        ? (cfg?.['format-critical'] || cfg?.format || ' {temperatureC}°C')
        : (cfg?.format || ' {temperatureC}°C');
      const fmt = sourceFmt.replace('{temperatureC}', String(temp)).replace(/\{[^}]+\}/g, '');
      return `<div id="${cssId}" class="module temperature">${fmt}</div>`;
    }

    if (name === 'custom/cava') {
      return `<div id="${cssId}" class="module custom-cava">▁▂▃▄▅▆▇▄▂</div>`;
    }

    if (name === 'tray') {
      return `<div id="${cssId}" class="module tray"><span class="tray-item">󰂯</span><span class="tray-item">󰊴</span></div>`;
    }

    if (name === 'bluetooth') {
      return `<div id="${cssId}" class="module bluetooth">${cfg?.['format-connected'] || cfg?.format || ' 󰂱 '}</div>`;
    }

    if (name === 'network') {
      const sourceFmt = cfg?.['format-wifi'] || cfg?.['format-ethernet'] || '  {essid}  {bandwidthUpBytes}  {bandwidthDownBytes}';
      const fmt = sourceFmt
        .replace('{essid}', 'Wi-Fi')
        .replace('{ifname}', 'wlan0')
        .replace(/\{[^}]+\}/g, '');
      return `<div id="${cssId}" class="module network">${fmt}</div>`;
    }

    if (name === 'battery') {
      const capacity = this.sys.bat;
      const charging = this.sys.charging;
      const plugged = this.sys.charging;
      const iconList = cfg?.['format-icons'];

      let icon = '';
      if (Array.isArray(iconList) && iconList.length) {
        const idx = Math.min(iconList.length - 1, Math.floor((capacity / 100) * iconList.length));
        icon = iconList[idx] || iconList[iconList.length - 1] || icon;
      } else if (iconList && typeof iconList === 'object') {
        if (capacity <= (cfg?.states?.critical ?? 15) && iconList.critical) icon = iconList.critical;
        else if (capacity <= (cfg?.states?.warning ?? 30) && iconList.warning) icon = iconList.warning;
        else if (capacity >= (cfg?.states?.good ?? 85) && iconList.good) icon = iconList.good;
        else if (Array.isArray(iconList.default)) icon = iconList.default[2] || iconList.default[0] || icon;
        else if (iconList.default) icon = iconList.default;
      }

      if (charging) icon = '';
      else if (plugged) icon = '';

      const fmtSource = charging
        ? (cfg?.['format-charging'] || cfg?.format || '{icon} {capacity}%')
        : plugged
          ? (cfg?.['format-plugged'] || cfg?.format || '{icon} {capacity}%')
          : capacity >= 100
            ? (cfg?.['format-full'] || cfg?.format || '{icon} {capacity}%')
            : (cfg?.format || '{icon} {capacity}%');

      const fmt = fmtSource
        .replace('{icon}', icon)
        .replace('{capacity}', String(capacity))
        .replace('{time}', '2:41')
        .replace(/\{[^}]+\}/g, '');

      return `<div id="${cssId}" class="module battery">${fmt}</div>`;
    }

    if (name === 'pulseaudio' || name === 'wireplumber') {
      const volume = this.sys.vol;
      const muted = false;
      const bluetooth = false;
      const icons = cfg?.['format-icons'];

      let icon = muted ? '󰖁' : '󰕾';
      if (Array.isArray(icons)) {
        const idx = volume <= 33 ? 0 : volume <= 66 ? 1 : 2;
        icon = icons[Math.min(idx, icons.length - 1)] || icons[icons.length - 1] || icon;
      } else if (icons && typeof icons === 'object') {
        if (bluetooth && icons.bluetooth) icon = icons.bluetooth;
        else if (icons.headphone) icon = icons.headphone;
        else if (icons.headset) icon = icons.headset;
        else if (Array.isArray(icons.default)) {
          const idx = volume <= 33 ? 0 : volume <= 66 ? 1 : 2;
          icon = icons.default[Math.min(idx, icons.default.length - 1)] || icons.default[icons.default.length - 1] || icon;
        } else if (icons.default) {
          icon = icons.default;
        }
      }

      const fmtSource = muted
        ? (cfg?.['format-muted'] || cfg?.format || '{icon} {volume}%')
        : bluetooth
          ? (cfg?.['format-bluetooth'] || cfg?.format || '{icon} {volume}%')
          : (cfg?.format || '{icon} {volume}%');

      const fmt = fmtSource
        .replace('{icon}', icon)
        .replace('{volume}', String(volume))
        .replace('{desc}', 'Speakers')
        .replace(/\{[^}]+\}/g, '');

      return `<div id="${cssId}" class="module pulseaudio">${fmt}</div>`;
    }

    return `<div id="${cssId}" class="module">${name.split('/').pop()}</div>`;
  }

  RenderPreview() {
    const frame = document.getElementById('waybar-preview-frame');
    if (!frame) return;

    const now = new Date();
    const bgDataUrl = this.waybarState.wallpaperDataUrl || this.sharedWallpaperDataUrl || '';
    const userCss = (this.waybarState.cssContent || '').replace(/<\/style>/gi, '<\\/style>');

    let cfg = null;
    try {
      if (this.waybarConfigState.configContent) cfg = this.ParseJsonc(this.waybarConfigState.configContent);
    } catch { }

    const leftModules = cfg?.['modules-left'] || ['hyprland/workspaces', 'cpu', 'temperature'];
    const centerModules = cfg?.['modules-center'] || ['clock'];
    const rightModules = cfg?.['modules-right'] || ['tray', 'bluetooth', 'network', 'battery', 'pulseaudio'];

    const renderSection = mods => mods.map(m => this.RenderModule(m, cfg?.[m] || {}, now)).join('');
    const wallpaperCss = bgDataUrl
      ? `background-image:url("${bgDataUrl}");`
      : `background:linear-gradient(160deg,#0d1117 0%,#161b22 40%,#21262d 100%);`;

    frame.srcdoc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; img-src 'self' data: file: blob:; font-src 'self' data: file:;">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow-x:auto;overflow-y:hidden;}
body{
  zoom: 0.8;
  font-family:"JetBrainsMono Nerd Font","JetBrains Mono","Symbols Nerd Font","Noto Sans Symbols 2","Noto Sans Symbols","Font Awesome 6 Free","Material Design Icons Desktop",monospace;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
}
#__wp_bg{
  position:fixed;
  inset:0;
  ${wallpaperCss}
  background-size:cover;
  background-position:center;
  filter:saturate(.95) brightness(.9);
  z-index:0;
}
#waybar{
  position:relative;
  z-index:1;
  display:grid;
  grid-template-columns: 1fr auto 1fr;
  align-items:center;
  width:100%;
  min-height:34px;
  padding:6px 10px 0;
  gap:12px;
}
.modules-left,.modules-center,.modules-right{
  display:flex;
  align-items:center;
  min-width:0;
  gap:10px;
}
.modules-left{justify-content:flex-start}
.modules-center{justify-content:center}
.modules-right{justify-content:flex-end}
.module{
  display:flex;
  align-items:center;
  justify-content:center;
  white-space:nowrap;
}
.tray{gap:10px}
.tray-item{display:inline-flex;align-items:center;justify-content:center;opacity:.95}
.workspaces{gap:8px}
.workspace-button{
  appearance:none;
  border:none;
  background:transparent;
  color:inherit;
}
${userCss}
</style>
</head>
<body>
<div id="__wp_bg"></div>
<div id="waybar" class="waybar">
  <div class="modules-left">${renderSection(leftModules)}</div>
  <div class="modules-center">${renderSection(centerModules)}</div>
  <div class="modules-right">${renderSection(rightModules)}</div>
</div>
</body>
</html>`;
  }

  async initWallpaperSection() {
    let cur = await window.hypr.getCurrentWallpaper();

    if (!cur) {
      cur = this.StorageGet(this.STORAGE_KEYS.CURRENT_WALLPAPER);
      if (cur) {
        const check = await window.hypr.readFile(cur).catch(() => ({ ok: false }));
        if (!check.ok) cur = null;
      }
    }

    this.wallpaperState.current = cur || null;

    if (cur) {
      this.StorageSet(this.STORAGE_KEYS.CURRENT_WALLPAPER, cur);
      if (!this.sharedWallpaperDataUrl) {
        const du = await window.hypr.getFileAsDataUrl(cur);
        if (du.ok) {
          this.sharedWallpaperDataUrl = du.dataUrl;
          this.waybarState.wallpaperDataUrl = du.dataUrl;
        }
      }
    }
  }

  async renderWallpaperSection(container) {
    const curSrc = this.wallpaperState.current ? `file://${this.wallpaperState.current}` : '';
    const curName = this.wallpaperState.current
      ? this.wallpaperState.current.split('/').pop()
      : 'No wallpaper detected';

    container.innerHTML = `
      <div class="wallpaper-section">
        <div class="wallpaper-banner">
          ${curSrc
        ? `<img id="wp-banner-img" class="wallpaper-banner-img" src="${curSrc}" alt="Current wallpaper" draggable="false">`
        : `<div class="wallpaper-banner-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>`
      }
          <div class="wallpaper-banner-info">
            <div class="wallpaper-banner-label">Active Wallpaper</div>
            <div class="wallpaper-banner-name" id="wp-current-name">${curName}</div>
            <div class="wallpaper-banner-path" id="wp-current-path">${this.wallpaperState.current || '—'}</div>
          </div>
        </div>

        <div class="wallpaper-toolbar">
          <button class="tb-action" id="wp-scan-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Scan Folders
          </button>
          <button class="tb-action" id="wp-pick-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            Pick File
          </button>
          <button class="tb-action" id="wp-add-dir-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            Add Folder
          </button>
          <button class="tb-action tb-action--danger" id="wp-reset-dirs-btn" title="Reset to default scan folders">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 .49-3.45"/>
            </svg>
            Reset Dirs
          </button>
          <div class="wp-scan-dirs" id="wp-scan-dirs">
            ${this.BuildDirChips(this.wallpaperState.scanDirs)}
          </div>
        </div>

        <div class="wallpaper-grid-wrap">
          <div class="wallpaper-grid" id="wallpaper-grid">
            <div class="wallpaper-empty-state">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <p>Click <strong>Scan Folders</strong> to load wallpapers</p>
              <p class="wp-empty-sub">Double-click a thumbnail or hit Apply to set it live</p>
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById('wp-scan-btn').addEventListener('click', () => this.ScanWallpapers());
    document.getElementById('wp-pick-btn').addEventListener('click', () => this.PickWallpaperFile());
    document.getElementById('wp-add-dir-btn').addEventListener('click', () => this.AddWallpaperDir());
    document.getElementById('wp-reset-dirs-btn').addEventListener('click', () => {
      this.wallpaperState.scanDirs = [...this.DEFAULT_SCAN_DIRS];
      this.StorageSetJSON(this.STORAGE_KEYS.SCAN_DIRS, this.wallpaperState.scanDirs);
      this.RefreshDirChips();
    });

    this.AttachDirRemoveListeners();

    if (this.wallpaperState.wallpapers.length > 0) {
      this.RenderWallpaperGrid();
    } else {
      this.ScanWallpapers();
    }
  }

  BuildDirChips(dirs) {
    return dirs.map(d => `
      <span class="wp-dir-chip-wrap">
        <code class="wp-dir-chip" title="${d}">${d}</code>
        <button class="wp-dir-remove" data-dir="${this.EscapeAttr(d)}" title="Remove">×</button>
      </span>`).join('');
  }

  RefreshDirChips() {
    const dirsEl = document.getElementById('wp-scan-dirs');
    if (!dirsEl) return;
    dirsEl.innerHTML = this.BuildDirChips(this.wallpaperState.scanDirs);
    this.AttachDirRemoveListeners();
  }

  AttachDirRemoveListeners() {
    document.querySelectorAll('.wp-dir-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir;
        this.wallpaperState.scanDirs = this.wallpaperState.scanDirs.filter(d => d !== dir);
        this.StorageSetJSON(this.STORAGE_KEYS.SCAN_DIRS, this.wallpaperState.scanDirs);
        this.RefreshDirChips();
      });
    });
  }

  async ScanWallpapers() {
    const btn = document.getElementById('wp-scan-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Scanning…';
    }

    const results = await window.hypr.getWallpapers(this.wallpaperState.scanDirs);
    this.wallpaperState.wallpapers = results;

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg> Scan Folders`;
    }

    this.RenderWallpaperGrid();
  }

  RenderWallpaperGrid() {
    const grid = document.getElementById('wallpaper-grid');
    if (!grid) return;

    if (!this.wallpaperState.wallpapers.length) {
      grid.innerHTML = `<div class="wallpaper-empty-state"><p>No images found in those folders</p></div>`;
      return;
    }

    grid.innerHTML = this.wallpaperState.wallpapers.map(wp => {
      const name = wp.split('/').pop();
      const active = wp === this.wallpaperState.current ? ' active' : '';
      return `<div class="wallpaper-thumb${active}" data-path="${this.EscapeAttr(wp)}" title="${this.EscapeAttr(wp)}">
        <img src="file://${this.EscapeAttr(wp)}" alt="${this.EscapeAttr(name)}" loading="lazy" draggable="false">
        <div class="wallpaper-thumb-overlay">
          <span class="wt-name">${this.EscapeHtml(name)}</span>
          <button class="wt-apply-btn" data-path="${this.EscapeAttr(wp)}">Apply</button>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.wt-apply-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.ApplyWallpaper(btn.dataset.path);
      });
    });

    grid.querySelectorAll('.wallpaper-thumb').forEach(t => {
      t.addEventListener('dblclick', () => this.ApplyWallpaper(t.dataset.path));
    });
  }

  async ApplyWallpaper(imagePath) {
    const res = await window.hypr.setWallpaper(imagePath);
    if (!res.ok) return;

    this.wallpaperState.current = imagePath;
    this.StorageSet(this.STORAGE_KEYS.CURRENT_WALLPAPER, imagePath);

    const bannerImg = document.getElementById('wp-banner-img');
    const namEl = document.getElementById('wp-current-name');
    const pathEl = document.getElementById('wp-current-path');

    if (bannerImg) bannerImg.src = `file://${imagePath}?t=${Date.now()}`;
    if (namEl) namEl.textContent = imagePath.split('/').pop();
    if (pathEl) pathEl.textContent = imagePath;

    document.querySelectorAll('.wallpaper-thumb').forEach(t => {
      t.classList.toggle('active', t.dataset.path === imagePath);
    });

    const du = await window.hypr.getFileAsDataUrl(imagePath);
    if (du.ok) {
      this.sharedWallpaperDataUrl = du.dataUrl;
      this.waybarState.wallpaperDataUrl = du.dataUrl;
      this.RenderPreview();
    }
  }

  async PickWallpaperFile() {
    const p = await window.hypr.pickImage();
    if (p) await this.ApplyWallpaper(p);
  }

  async AddWallpaperDir() {
    const p = await window.hypr.pickDirectory();
    if (!p || this.wallpaperState.scanDirs.includes(p)) return;
    this.wallpaperState.scanDirs.push(p);
    this.StorageSetJSON(this.STORAGE_KEYS.SCAN_DIRS, this.wallpaperState.scanDirs);
    this.RefreshDirChips();
    await this.ScanWallpapers();
  }
}

const waybarManager = new WaybarManager();

export function setSharedWallpaperDataUrl(url) {
  return waybarManager.setSharedWallpaperDataUrl(url);
}

export async function initWaybarSection() {
  return waybarManager.initWaybarSection();
}

export function renderWaybarSection(container) {
  return waybarManager.renderWaybarSection(container);
}

export async function initWaybarConfigSection() {
  return waybarManager.initWaybarConfigSection();
}

export function renderWaybarConfigSection(container) {
  return waybarManager.renderWaybarConfigSection(container);
}

export async function initWallpaperSection() {
  return waybarManager.initWallpaperSection();
}

export function renderWallpaperSection(container) {
  return waybarManager.renderWallpaperSection(container);
}