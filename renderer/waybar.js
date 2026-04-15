const STORAGE_KEYS = {
  SCAN_DIRS: 'hypreditor_wallpaper_scan_dirs',
  CURRENT_WALLPAPER: 'hypreditor_current_wallpaper',
  WAYBAR_CSS_PATH: 'hypreditor_waybar_css_path',
  WAYBAR_CONFIG_PATH: 'hypreditor_waybar_config_path',
};

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { }
}
function storageGetJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function storageSetJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}

let _sharedWallpaperDataUrl = null;

export function setSharedWallpaperDataUrl(url) {
  _sharedWallpaperDataUrl = url;
  waybarState.wallpaperDataUrl = url;
  _renderPreview();
}

const waybarState = {
  cssPath: null,
  cssContent: '',
  originalContent: '',
  wallpaperDataUrl: null,
  isDirty: false,
  watchActive: false,
  previewDebounce: null,
  fileChangedRegistered: false,
};

export async function initWaybarSection() {
  const savedCssPath = storageGet(STORAGE_KEYS.WAYBAR_CSS_PATH);

  let found = null;
  if (savedCssPath) {
    const res = await window.hypr.readFile(savedCssPath);
    if (res.ok) found = savedCssPath;
  }
  if (!found) {
    found = await window.hypr.findWaybarCss();
    if (found) storageSet(STORAGE_KEYS.WAYBAR_CSS_PATH, found);
  }

  waybarState.cssPath = found || null;

  if (found) {
    const res = await window.hypr.readFile(found);
    if (res.ok) {
      waybarState.cssContent = res.content;
      waybarState.originalContent = res.content;
    }
  }

  await _autoLoadWallpaperForPreview();

  if (waybarState.cssPath && !waybarState.watchActive) {
    await window.hypr.watchFile(waybarState.cssPath);
    waybarState.watchActive = true;
  }

  if (!waybarState.fileChangedRegistered) {
    waybarState.fileChangedRegistered = true;
    window.hypr.onFileChanged(({ filePath, content }) => {
      if (filePath !== waybarState.cssPath) return;
      waybarState.cssContent = content;
      waybarState.isDirty = content !== waybarState.originalContent;
      const editor = document.getElementById('waybar-css-editor');
      if (editor) editor.value = content;
      _schedulePreview();
      _waybarStatus('↻ Updated from disk', 'info');
    });
  }
}

async function _autoLoadWallpaperForPreview() {
  if (_sharedWallpaperDataUrl) {
    waybarState.wallpaperDataUrl = _sharedWallpaperDataUrl;
    return;
  }

  let wpPath = await window.hypr.getCurrentWallpaper();

  if (!wpPath) {
    wpPath = storageGet(STORAGE_KEYS.CURRENT_WALLPAPER);
  }

  if (wpPath) {
    const du = await window.hypr.getFileAsDataUrl(wpPath);
    if (du.ok) {
      waybarState.wallpaperDataUrl = du.dataUrl;
      _sharedWallpaperDataUrl = du.dataUrl;
      storageSet(STORAGE_KEYS.CURRENT_WALLPAPER, wpPath);
    }
  }
}

export function renderWaybarSection(container) {
  const pathDisplay = waybarState.cssPath
    ? waybarState.cssPath.replace(window.__homedir || '', '~')
    : '~/.config/waybar/style.css  (not found)';

  container.innerHTML = `
    <div class="waybar-section">

      <div class="waybar-path-bar">
        <svg class="waybar-path-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <code class="waybar-path-value" id="waybar-css-path">${pathDisplay}</code>
        <div class="waybar-path-actions">
          <button class="tb-action" id="waybar-reload-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Reload
          </button>
          <button class="tb-action" id="waybar-pick-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Browse
          </button>
          <button class="tb-action save ${waybarState.isDirty ? 'dirty' : ''}" id="waybar-save-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Apply to disk
          </button>
          <span class="waybar-status-badge" id="waybar-status"></span>
        </div>
      </div>

      <div class="waybar-body">

        <div class="waybar-editor-pane">
          <div class="waybar-pane-header">
            <span>style.css</span>
            <span class="waybar-hint">Edit here or save from VSCode</span>
          </div>
          <textarea
            id="waybar-css-editor"
            class="waybar-css-editor"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            placeholder="/* Your waybar CSS will appear here once a file is found.\n   You can also paste CSS directly to preview it. */"
          >${_escapeHtml(waybarState.cssContent)}</textarea>
        </div>

        <div class="waybar-preview-pane">
          <div class="waybar-pane-header">
            <span>Live Preview</span>
            <button class="waybar-wp-btn" id="waybar-wp-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              Set preview wallpaper
            </button>
          </div>
          <div class="waybar-preview-wrap">
            <iframe
              id="waybar-preview-frame"
              class="waybar-preview-frame"
              sandbox="allow-same-origin allow-scripts"
              title="Waybar Preview"
            ></iframe>
          </div>
          <p class="waybar-preview-note">
            This is just a visual representation.
          </p>
        </div>

      </div>
    </div>`;

  const editor = document.getElementById('waybar-css-editor');
  const saveBtn = document.getElementById('waybar-save-btn');
  const reloadBtn = document.getElementById('waybar-reload-btn');
  const pickBtn = document.getElementById('waybar-pick-btn');
  const wpBtn = document.getElementById('waybar-wp-btn');

  editor.addEventListener('input', () => {
    waybarState.cssContent = editor.value;
    waybarState.isDirty = editor.value !== waybarState.originalContent;
    saveBtn.classList.toggle('dirty', waybarState.isDirty);
    _schedulePreview();
  });

  reloadBtn.addEventListener('click', async () => {
    if (!waybarState.cssPath) return;
    const res = await window.hypr.readFile(waybarState.cssPath);
    if (res.ok) {
      waybarState.cssContent = res.content;
      waybarState.originalContent = res.content;
      waybarState.isDirty = false;
      editor.value = res.content;
      saveBtn.classList.remove('dirty');
      _renderPreview();
      _waybarStatus('Reloaded', 'success');
    } else {
      _waybarStatus('Read error: ' + res.error, 'error');
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!waybarState.cssPath) {
      _waybarStatus('No file path set — use Browse', 'error'); return;
    }
    const res = await window.hypr.writeFile(waybarState.cssPath, waybarState.cssContent);
    if (res.ok) {
      waybarState.originalContent = waybarState.cssContent;
      waybarState.isDirty = false;
      saveBtn.classList.remove('dirty');
      _waybarStatus('Applied ✓', 'success');
    } else {
      _waybarStatus('Write failed: ' + res.error, 'error');
    }
  });

  pickBtn.addEventListener('click', async () => {
    const p = await window.hypr.pickCssFile();
    if (!p) return;
    if (waybarState.cssPath) await window.hypr.unwatchFile(waybarState.cssPath);
    waybarState.cssPath = p;
    storageSet(STORAGE_KEYS.WAYBAR_CSS_PATH, p);
    document.getElementById('waybar-css-path').textContent = p.replace(window.__homedir || '', '~');
    const res = await window.hypr.readFile(p);
    if (res.ok) {
      waybarState.cssContent = res.content;
      waybarState.originalContent = res.content;
      waybarState.isDirty = false;
      editor.value = res.content;
      saveBtn.classList.remove('dirty');
      _renderPreview();
    }
    await window.hypr.watchFile(p);
  });

  wpBtn.addEventListener('click', async () => {
    const p = await window.hypr.pickImage();
    if (!p) return;
    const du = await window.hypr.getFileAsDataUrl(p);
    if (du.ok) {
      waybarState.wallpaperDataUrl = du.dataUrl;
      _sharedWallpaperDataUrl = du.dataUrl;
      storageSet(STORAGE_KEYS.CURRENT_WALLPAPER, p);
      _renderPreview();
    }
  });

  _renderPreview();
}

function _schedulePreview() {
  clearTimeout(waybarState.previewDebounce);
  waybarState.previewDebounce = setTimeout(_renderPreview, 180);
}

function _renderPreview() {
  const frame = document.getElementById('waybar-preview-frame');
  if (!frame) return;

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const bgDataUrl = waybarState.wallpaperDataUrl || _sharedWallpaperDataUrl;

  const userCss = (waybarState.cssContent || '').replace(/<\/style>/gi, '< /style>');

  const wpScript = bgDataUrl
    ? `<script>document.addEventListener('DOMContentLoaded',function(){
        var el=document.getElementById('__wp_bg');
        if(el) el.style.backgroundImage='url("'+${JSON.stringify(bgDataUrl)}+'")';
      });<\/script>`
    : '';

  frame.srcdoc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden}
#__wp_bg{
  position:fixed;inset:0;
  background:${bgDataUrl ? 'transparent' : 'linear-gradient(160deg,#0d1117 0%,#161b22 40%,#21262d 100%)'};
  background-size:cover;background-position:center;
  z-index:0
}
#waybar{
  display:flex;flex-direction:row;align-items:stretch;
  width:100%;position:relative;z-index:1;
}
.modules-left{display:flex;flex:1;align-items:center;min-width:0;overflow:hidden}
.modules-center{display:flex;align-items:center;justify-content:center}
.modules-right{display:flex;flex:1;align-items:center;justify-content:flex-end;min-width:0;overflow:hidden}
.module{display:flex;align-items:center}
${userCss}
</style>
${wpScript}
</head><body>
<div id="__wp_bg"></div>
<div id="waybar" class="waybar">
  <div class="modules-left">
    <div id="hyprland/workspaces" class="module workspaces">
      <button class="workspace-button active focused persistent">1</button>
      <button class="workspace-button persistent">2</button>
      <button class="workspace-button persistent">3</button>
      <button class="workspace-button persistent">4</button>
      <button class="workspace-button persistent">5</button>
    </div>
    <div id="hyprland/window" class="module window">Firefox — GitHub</div>
  </div>
  <div class="modules-center">
    <div id="clock" class="module">${time}  ${date}</div>
  </div>
  <div class="modules-right">
    <div id="cpu"        class="module"> CPU 12%</div>
    <div id="memory"     class="module"> 4.8G</div>
    <div id="pulseaudio" class="module"> 65%</div>
    <div id="network"    class="module"> WiFi</div>
    <div id="battery"    class="module"> 87%</div>
    <div id="tray"       class="module tray"></div>
  </div>
</div>
</body></html>`;
}

function _waybarStatus(msg, type = 'info') {
  const el = document.getElementById('waybar-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `waybar-status-badge waybar-status-${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3200);
}

const waybarConfigState = {
  configPath: null,
  configContent: '',
  originalContent: '',
  isDirty: false,
  watchActive: false,
  fileChangedRegistered: false,
};

async function _findWaybarConfig() {
  const home = window.__homedir || '';
  const candidates = [
    `${home}/.config/waybar/config`,
    `${home}/.config/waybar/config.jsonc`,
    `${home}/.config/waybar/config.json`,
  ];
  for (const p of candidates) {
    const res = await window.hypr.readFile(p);
    if (res.ok) return p;
  }
  return null;
}

export async function initWaybarConfigSection() {
  const savedConfigPath = storageGet(STORAGE_KEYS.WAYBAR_CONFIG_PATH);

  let found = null;
  if (savedConfigPath) {
    const res = await window.hypr.readFile(savedConfigPath);
    if (res.ok) found = savedConfigPath;
  }
  if (!found) {
    found = await _findWaybarConfig();
    if (found) storageSet(STORAGE_KEYS.WAYBAR_CONFIG_PATH, found);
  }

  waybarConfigState.configPath = found || null;

  if (found) {
    const res = await window.hypr.readFile(found);
    if (res.ok) {
      waybarConfigState.configContent = res.content;
      waybarConfigState.originalContent = res.content;
    }
  }

  if (waybarConfigState.configPath && !waybarConfigState.watchActive) {
    await window.hypr.watchFile(waybarConfigState.configPath);
    waybarConfigState.watchActive = true;
  }

  if (!waybarConfigState.fileChangedRegistered) {
    waybarConfigState.fileChangedRegistered = true;
    window.hypr.onFileChanged(({ filePath, content }) => {
      if (filePath !== waybarConfigState.configPath) return;
      waybarConfigState.configContent = content;
      waybarConfigState.isDirty = content !== waybarConfigState.originalContent;
      const editor = document.getElementById('waybar-config-editor');
      if (editor) editor.value = content;
      _waybarConfigStatus('↻ Updated from disk', 'info');
    });
  }
}

export function renderWaybarConfigSection(container) {
  const pathDisplay = waybarConfigState.configPath
    ? waybarConfigState.configPath.replace(window.__homedir || '', '~')
    : '~/.config/waybar/config  (not found)';

  container.innerHTML = `
    <div class="waybar-section">

      <div class="waybar-path-bar">
        <svg class="waybar-path-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <code class="waybar-path-value" id="waybar-config-path">${pathDisplay}</code>
        <div class="waybar-path-actions">
          <button class="tb-action" id="waybar-config-reload-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Reload
          </button>
          <button class="tb-action" id="waybar-config-pick-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Browse
          </button>
          <button class="tb-action save ${waybarConfigState.isDirty ? 'dirty' : ''}" id="waybar-config-save-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Apply to disk
          </button>
          <span class="waybar-status-badge" id="waybar-config-status"></span>
        </div>
      </div>

      <div class="waybar-body waybar-body--config">
        <div class="waybar-editor-pane waybar-editor-pane--full">
          <div class="waybar-pane-header">
            <span>config</span>
            <span class="waybar-hint">JSONC — edit here or save from VSCode</span>
          </div>
          <textarea
            id="waybar-config-editor"
            class="waybar-css-editor"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            placeholder="// Waybar config will appear here once a file is found."
          >${_escapeHtml(waybarConfigState.configContent)}</textarea>
        </div>
      </div>

    </div>`;

  const editor = document.getElementById('waybar-config-editor');
  const saveBtn = document.getElementById('waybar-config-save-btn');
  const reloadBtn = document.getElementById('waybar-config-reload-btn');
  const pickBtn = document.getElementById('waybar-config-pick-btn');

  editor.addEventListener('input', () => {
    waybarConfigState.configContent = editor.value;
    waybarConfigState.isDirty = editor.value !== waybarConfigState.originalContent;
    saveBtn.classList.toggle('dirty', waybarConfigState.isDirty);
  });

  reloadBtn.addEventListener('click', async () => {
    if (!waybarConfigState.configPath) return;
    const res = await window.hypr.readFile(waybarConfigState.configPath);
    if (res.ok) {
      waybarConfigState.configContent = res.content;
      waybarConfigState.originalContent = res.content;
      waybarConfigState.isDirty = false;
      editor.value = res.content;
      saveBtn.classList.remove('dirty');
      _waybarConfigStatus('Reloaded', 'success');
    } else {
      _waybarConfigStatus('Read error: ' + res.error, 'error');
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!waybarConfigState.configPath) {
      _waybarConfigStatus('No file path set — use Browse', 'error'); return;
    }
    const res = await window.hypr.writeFile(waybarConfigState.configPath, waybarConfigState.configContent);
    if (res.ok) {
      waybarConfigState.originalContent = waybarConfigState.configContent;
      waybarConfigState.isDirty = false;
      saveBtn.classList.remove('dirty');
      _waybarConfigStatus('Applied ✓', 'success');
    } else {
      _waybarConfigStatus('Write failed: ' + res.error, 'error');
    }
  });

  pickBtn.addEventListener('click', async () => {
    const p = await window.hypr.pickFile({ filters: [{ name: 'Config', extensions: ['json', 'jsonc', '*'] }] });
    if (!p) return;
    if (waybarConfigState.configPath) await window.hypr.unwatchFile(waybarConfigState.configPath);
    waybarConfigState.configPath = p;
    storageSet(STORAGE_KEYS.WAYBAR_CONFIG_PATH, p);
    document.getElementById('waybar-config-path').textContent = p.replace(window.__homedir || '', '~');
    const res = await window.hypr.readFile(p);
    if (res.ok) {
      waybarConfigState.configContent = res.content;
      waybarConfigState.originalContent = res.content;
      waybarConfigState.isDirty = false;
      editor.value = res.content;
      saveBtn.classList.remove('dirty');
    }
    await window.hypr.watchFile(p);
  });
}

function _waybarConfigStatus(msg, type = 'info') {
  const el = document.getElementById('waybar-config-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `waybar-status-badge waybar-status-${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3200);
}

const DEFAULT_SCAN_DIRS = ['~/Pictures', '~/Wallpapers', '~/wallpapers', '~/Downloads/Wallpapers', '~/Pictures/Wallpapers'];

const wallpaperState = {
  wallpapers: [],
  current: null,
  scanDirs: storageGetJSON(STORAGE_KEYS.SCAN_DIRS, null) || [...DEFAULT_SCAN_DIRS],
};

export async function initWallpaperSection() {
  let cur = await window.hypr.getCurrentWallpaper();

  if (!cur) {
    cur = storageGet(STORAGE_KEYS.CURRENT_WALLPAPER);
    if (cur) {
      const check = await window.hypr.readFile(cur).catch(() => ({ ok: false }));
      if (!check.ok) cur = null;
    }
  }

  wallpaperState.current = cur || null;

  if (cur) {
    storageSet(STORAGE_KEYS.CURRENT_WALLPAPER, cur);
    if (!_sharedWallpaperDataUrl) {
      const du = await window.hypr.getFileAsDataUrl(cur);
      if (du.ok) {
        _sharedWallpaperDataUrl = du.dataUrl;
        waybarState.wallpaperDataUrl = du.dataUrl;
      }
    }
  }
}

export async function renderWallpaperSection(container) {
  const curSrc = wallpaperState.current ? `file://${wallpaperState.current}` : '';
  const curName = wallpaperState.current
    ? wallpaperState.current.split('/').pop()
    : 'No wallpaper detected';

  container.innerHTML = `
    <div class="wallpaper-section">

      <div class="wallpaper-banner">
        ${curSrc
      ? `<img id="wp-banner-img" class="wallpaper-banner-img" src="${curSrc}" alt="Current wallpaper" draggable="false">`
      : `<div class="wallpaper-banner-placeholder">
               <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
             </div>`
    }
        <div class="wallpaper-banner-info">
          <div class="wallpaper-banner-label">Active Wallpaper</div>
          <div class="wallpaper-banner-name" id="wp-current-name">${curName}</div>
          <div class="wallpaper-banner-path" id="wp-current-path">${wallpaperState.current || '—'}</div>
        </div>
      </div>

      <div class="wallpaper-toolbar">
        <button class="tb-action" id="wp-scan-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Scan Folders
        </button>
        <button class="tb-action" id="wp-pick-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Pick File
        </button>
        <button class="tb-action" id="wp-add-dir-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
          Add Folder
        </button>
        <button class="tb-action tb-action--danger" id="wp-reset-dirs-btn" title="Reset to default scan folders">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.45"/></svg>
          Reset Dirs
        </button>
        <div class="wp-scan-dirs" id="wp-scan-dirs">
          ${wallpaperState.scanDirs.map(d => `
            <span class="wp-dir-chip-wrap">
              <code class="wp-dir-chip" title="${d}">${d}</code>
              <button class="wp-dir-remove" data-dir="${_escapeAttr(d)}" title="Remove">×</button>
            </span>`).join('')}
        </div>
      </div>

      <div class="wallpaper-grid-wrap">
        <div class="wallpaper-grid" id="wallpaper-grid">
          <div class="wallpaper-empty-state">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <p>Click <strong>Scan Folders</strong> to load wallpapers</p>
            <p class="wp-empty-sub">Double-click a thumbnail or hit Apply to set it live</p>
          </div>
        </div>
      </div>

    </div>`;

  document.getElementById('wp-scan-btn').addEventListener('click', _scanWallpapers);
  document.getElementById('wp-pick-btn').addEventListener('click', _pickWallpaperFile);
  document.getElementById('wp-add-dir-btn').addEventListener('click', _addWallpaperDir);

  document.getElementById('wp-reset-dirs-btn').addEventListener('click', () => {
    wallpaperState.scanDirs = [...DEFAULT_SCAN_DIRS];
    storageSetJSON(STORAGE_KEYS.SCAN_DIRS, wallpaperState.scanDirs);
    _refreshDirChips();
  });

  _attachDirRemoveListeners();

  if (wallpaperState.wallpapers.length > 0) {
    _renderWallpaperGrid();
  } else {
    _scanWallpapers();
  }
}

function _refreshDirChips() {
  const dirsEl = document.getElementById('wp-scan-dirs');
  if (!dirsEl) return;
  dirsEl.innerHTML = wallpaperState.scanDirs.map(d => `
    <span class="wp-dir-chip-wrap">
      <code class="wp-dir-chip" title="${d}">${d}</code>
      <button class="wp-dir-remove" data-dir="${_escapeAttr(d)}" title="Remove">×</button>
    </span>`).join('');
  _attachDirRemoveListeners();
}

function _attachDirRemoveListeners() {
  document.querySelectorAll('.wp-dir-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.dir;
      wallpaperState.scanDirs = wallpaperState.scanDirs.filter(d => d !== dir);
      storageSetJSON(STORAGE_KEYS.SCAN_DIRS, wallpaperState.scanDirs);
      _refreshDirChips();
    });
  });
}

async function _scanWallpapers() {
  const btn = document.getElementById('wp-scan-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }

  const results = await window.hypr.getWallpapers(wallpaperState.scanDirs);
  wallpaperState.wallpapers = results;

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Scan Folders`;
  }
  _renderWallpaperGrid();
}

function _renderWallpaperGrid() {
  const grid = document.getElementById('wallpaper-grid');
  if (!grid) return;

  if (!wallpaperState.wallpapers.length) {
    grid.innerHTML = `<div class="wallpaper-empty-state"><p>No images found in those folders</p></div>`;
    return;
  }

  grid.innerHTML = wallpaperState.wallpapers.map(wp => {
    const name = wp.split('/').pop();
    const active = wp === wallpaperState.current ? ' active' : '';
    return `<div class="wallpaper-thumb${active}" data-path="${_escapeAttr(wp)}" title="${_escapeAttr(wp)}">
      <img src="file://${_escapeAttr(wp)}" alt="${_escapeAttr(name)}" loading="lazy" draggable="false">
      <div class="wallpaper-thumb-overlay">
        <span class="wt-name">${_escapeHtml(name)}</span>
        <button class="wt-apply-btn" data-path="${_escapeAttr(wp)}">Apply</button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.wt-apply-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); _applyWallpaper(btn.dataset.path); });
  });
  grid.querySelectorAll('.wallpaper-thumb').forEach(t => {
    t.addEventListener('dblclick', () => _applyWallpaper(t.dataset.path));
  });
}

async function _applyWallpaper(imagePath) {
  const res = await window.hypr.setWallpaper(imagePath);
  if (!res.ok) { console.warn('[Wallpaper]', res.error); return; }

  wallpaperState.current = imagePath;
  storageSet(STORAGE_KEYS.CURRENT_WALLPAPER, imagePath);

  const bannerImg = document.getElementById('wp-banner-img');
  const namEl = document.getElementById('wp-current-name');
  const pathEl = document.getElementById('wp-current-path');
  if (bannerImg) { bannerImg.src = `file://${imagePath}?t=${Date.now()}`; }
  if (namEl) namEl.textContent = imagePath.split('/').pop();
  if (pathEl) pathEl.textContent = imagePath;

  document.querySelectorAll('.wallpaper-thumb').forEach(t => {
    t.classList.toggle('active', t.dataset.path === imagePath);
  });

  const du = await window.hypr.getFileAsDataUrl(imagePath);
  if (du.ok) {
    _sharedWallpaperDataUrl = du.dataUrl;
    waybarState.wallpaperDataUrl = du.dataUrl;
    _renderPreview();
  }
}

async function _pickWallpaperFile() {
  const p = await window.hypr.pickImage();
  if (p) await _applyWallpaper(p);
}

async function _addWallpaperDir() {
  const p = await window.hypr.pickDirectory();
  if (!p || wallpaperState.scanDirs.includes(p)) return;
  wallpaperState.scanDirs.push(p);
  storageSetJSON(STORAGE_KEYS.SCAN_DIRS, wallpaperState.scanDirs);
  _refreshDirChips();
  await _scanWallpapers();
}

function _escapeHtml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _escapeAttr(s = '') {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}