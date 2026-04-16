import {
  parseConfig,
  getValue,
  getList,
  applyChange,
  serializeConfig,
  getAllSources,
  findAllMatches,
  getDuplicateSections,
  mergeDuplicateSections,
  removeDuplicateKeys,
  normalizeConfig,
} from './parser.js';
import { initWaybarSection, renderWaybarSection, initWaybarConfigSection, renderWaybarConfigSection, initWallpaperSection, renderWallpaperSection } from './waybar.js';
import { SECTIONS } from './schema.js';

let state = {
  configPath: null,
  rawLines: [],
  root: null,
  includedFiles: [],
  fileSegments: [],
  activeSection: null,
  activeSubsection: null,
  dirty: false,
  searchQuery: '',
  searchResults: [],
  searchOpen: false,
  notification: null,

  previewSetting: null,
  previewValue: null,
  confirmOpen: false,
};

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

async function init() {
  buildSidebar();
  setupTitleBar();
  setupSearch();

  const found = await window.hypr.findConfig();
  if (found) {
    await loadConfig(found);
    await initWaybarSection();
    await initWaybarConfigSection();
    await initWallpaperSection();
  } else {
    showWelcome();
  }

  if (SECTIONS.length) {
    activateSection(SECTIONS[0], SECTIONS[0].subsections[0]);
  }
}

async function loadConfig(filePath) {
  const res = await window.hypr.readFile(filePath);
  if (!res.ok) {
    showNotification(`Failed to read config: ${res.error}`, 'error');
    return;
  }

  let config;
  try {
    config = parseConfig(res.content);
  } catch (err) {
    showNotification(`Parse error: ${err.message}`, 'error');
    return;
  }

  const normalized = normalizeConfig(config);
  const changed = normalized.rawLines.join('\n') !== config.rawLines.join('\n');

  state.configPath = filePath;
  state.rawLines = normalized.rawLines.slice();
  state.root = normalized.root;
  state.dirty = changed;
  updateSaveButton?.();

  if (changed) {
    const ok = confirm(
      'I found duplicate sections or repeated keys in this config. Clean them automatically and keep the final effective values?'
    );

    if (ok) {
      await saveConfig();
      return await loadConfig(filePath);
    }
  }

  //renderSidebar();
  renderActiveSection();
}

async function restoreBackups() {
  if (!state.configPath) return;

  const filePaths = state.fileSegments.map(seg => seg.filePath);

  const ok = await confirmAction({
    title: 'Restore backups?',
    message: `This will overwrite the current config with the last .hypreditor.bak backup for ${filePaths.length} file${filePaths.length > 1 ? 's' : ''}.`,
    confirmText: 'Restore',
    cancelText: 'Cancel',
    danger: true,
  });

  if (!ok) return;

  const res = await window.hypr.restoreBackups(filePaths);

  if (!res.ok && !res.restored) {
    showNotification(res.error || 'Restore failed.', 'error');
    return;
  }

  if (res.failed?.length) {
    const first = res.failed[0];
    showNotification(
      `Restored ${res.restored} file(s), but some failed: ${first.filePath?.split('/').pop() || first.error}`,
      'error'
    );
  } else {
    showNotification(`Restored ${res.restored} backup file${res.restored > 1 ? 's' : ''}.`, 'success');
  }

  await loadConfig(state.configPath);
}

async function saveConfig() {
  if (!state.configPath || !state.dirty) return;

  const segments = Array.isArray(state.fileSegments) ? state.fileSegments : [];

  if (segments.length === 0) {
    const res = await window.hypr.writeFile(state.configPath, state.rawLines.join('\n'));
    if (!res.ok) {
      showNotification(`Save failed: ${res.error}`, 'error');
      return;
    }

    state.fileSegments = [{
      filePath: state.configPath,
      startLine: 0,
      lineCount: state.rawLines.length,
    }];

    state.dirty = false;
    updateSaveButton();
    showNotification('Saved 1 file! (backup created as .hypreditor.bak)', 'success');
    return;
  }

  const lastSeg = segments[segments.length - 1];
  const segEnd = lastSeg ? lastSeg.startLine + lastSeg.lineCount : 0;
  const overflow = state.rawLines.slice(segEnd);

  let savedCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    let fileLines = state.rawLines.slice(seg.startLine, seg.startLine + seg.lineCount);

    if (i === 0 && overflow.length > 0) {
      fileLines = fileLines.concat(overflow);
    }

    const res = await window.hypr.writeFile(seg.filePath, fileLines.join('\n'));
    if (!res.ok) {
      showNotification(`Save failed (${seg.filePath.split('/').pop()}): ${res.error}`, 'error');
      return;
    }

    savedCount++;
  }

  state.dirty = false;
  updateSaveButton();
  showNotification(`Saved ${savedCount} file${savedCount !== 1 ? 's' : ''}! (backups created as .hypreditor.bak)`, 'success');
}

function isRiskySetting(setting, nextValue) {
  const riskyKeys = new Set([
    'no_hardware_cursors',
    'use_cpu_buffer',
    'explicit_sync',
    'explicit_sync_kms',
    'direct_scanout',
    'allow_tearing',
    'disable_autoreload',
    'disable_logs',
    'overlay',
    'xx_color_management_v4',
  ]);

  if (setting?.confirm === true) return true;
  if (setting?.risk === 'high') return true;
  if (riskyKeys.has(setting?.key)) return true;

  if (setting?.type === 'bool' && setting?.confirmOnEnable && (nextValue === true || nextValue === 'true')) {
    return true;
  }

  return false;
}

function confirmAction({
  title = 'Are you sure?',
  message = 'Are you sure you want to do this?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
}) {
  return new Promise(resolve => {
    let modal = document.getElementById('confirm-modal');

    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'confirm-modal';
      modal.className = 'confirm-modal hidden';
      modal.innerHTML = `
        <div class="confirm-backdrop"></div>
        <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div class="confirm-header">
            <h3 id="confirm-title"></h3>
          </div>
          <div class="confirm-body">
            <p id="confirm-message"></p>
          </div>
          <div class="confirm-actions">
            <button type="button" class="btn-secondary" id="confirm-cancel"></button>
            <button type="button" class="btn-primary" id="confirm-ok"></button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    modal.querySelector('#confirm-title').textContent = title;
    modal.querySelector('#confirm-message').textContent = message;
    modal.querySelector('#confirm-cancel').textContent = cancelText;
    modal.querySelector('#confirm-ok').textContent = confirmText;
    modal.querySelector('#confirm-ok').classList.toggle('danger', danger);

    modal.classList.remove('hidden');
    state.confirmOpen = true;

    const close = value => {
      modal.classList.add('hidden');
      state.confirmOpen = false;
      cleanup();
      resolve(value);
    };

    const onCancel = () => close(false);
    const onOk = () => close(true);
    const onKey = e => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };

    const cancelBtn = modal.querySelector('#confirm-cancel');
    const okBtn = modal.querySelector('#confirm-ok');
    const backdrop = modal.querySelector('.confirm-backdrop');

    function cleanup() {
      cancelBtn.removeEventListener('click', onCancel);
      okBtn.removeEventListener('click', onOk);
      backdrop.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    }

    cancelBtn.addEventListener('click', onCancel);
    okBtn.addEventListener('click', onOk);
    backdrop.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);

    okBtn.focus();
  });
}

function ensurePreviewPane(container) {
  let pane = document.getElementById('preview-pane');
  if (pane) return pane;

  pane = document.createElement('aside');
  pane.id = 'preview-pane';
  pane.className = 'preview-pane';
  pane.innerHTML = `
    <div class="preview-pane-inner">
      <div class="preview-header">
        <h3>Live Preview</h3>
        <span class="preview-subtitle">Visual estimate only</span>
      </div>
      <div id="preview-content" class="preview-content"></div>
    </div>
  `;
  container.appendChild(pane);
  return pane;
}

function getPreviewType(setting, sectionPath = []) {
  if (setting.preview?.type) return setting.preview.type;

  const key = setting.key;

  if (['rounding', 'rounding_power'].includes(key)) return 'rounding';
  if (['border_size', 'col.active_border', 'col.inactive_border'].includes(key)) return 'border';
  if (['gaps_in', 'gaps_out', 'float_gaps'].includes(key)) return 'gaps';
  if (['active_opacity', 'inactive_opacity', 'fullscreen_opacity'].includes(key)) return 'opacity';
  if (['dim_strength', 'dim_inactive', 'dim_special', 'dim_around'].includes(key)) return 'dimming';
  if (['enabled', 'range', 'render_power', 'scale', 'color', 'color_inactive'].includes(key) && sectionPath.includes('shadow')) return 'shadow';
  if (['enabled', 'size', 'passes', 'vibrancy', 'noise', 'contrast', 'brightness'].includes(key) && sectionPath.includes('blur')) return 'blur';
  if (['mfact', 'orientation', 'default_split_ratio', 'layout'].includes(key)) return 'layout';
  if (['bezier'].includes(key)) return 'bezier';
  if (['workspace_wraparound'].includes(key)) return 'animation';
  if (setting.type === 'color') return 'color';

  return 'generic';
}

function renderPreviewCard(setting, value, sectionPath = []) {
  const type = getPreviewType(setting, sectionPath);
  const label = setting?.label || setting?.key || 'Setting';
  const desc = setting?.desc || 'No description available.';
  const safeValue = value ?? '(not set)';

  switch (type) {
    case 'rounding':
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="mock-window-wrap">
            <div class="mock-window mock-rounding" style="border-radius:${Number(value || 0)}px">
              <div class="mock-titlebar"></div>
              <div class="mock-body"></div>
            </div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;

    case 'border':
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="mock-window-wrap">
            <div class="mock-window mock-border" style="
              border-width:${Number(value || 1)}px;
              border-color:${setting.type === 'color' ? escapeHtml(String(value || '#a6adc8')) : '#a6adc8'};
            ">
              <div class="mock-titlebar"></div>
              <div class="mock-body"></div>
            </div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;

    case 'gaps':
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="workspace-preview" style="--gap:${Math.max(0, Number(value || 0))}px">
            <div class="tile a"></div>
            <div class="tile b"></div>
            <div class="tile c"></div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;

    case 'opacity':
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="opacity-preview">
            <div class="checker"></div>
            <div class="opacity-sample" style="opacity:${Math.min(1, Math.max(0, Number(value || 1)))}"></div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;

    case 'shadow':
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="mock-window-wrap shadow-stage">
            <div class="mock-window shadow-demo" style="box-shadow: 0 12px ${Math.max(8, Number(value || 24))}px rgba(0,0,0,.35)">
              <div class="mock-titlebar"></div>
              <div class="mock-body"></div>
            </div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;

    case 'blur':
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="blur-stage">
            <div class="blur-bg"></div>
            <div class="blur-sample" style="backdrop-filter: blur(${Math.max(0, Number(value || 8))}px)"></div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;

    case 'layout':
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="layout-stage">
            <div class="layout-master"></div>
            <div class="layout-stack">
              <div></div>
              <div></div>
            </div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;

    case 'color':
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="color-preview">
            <div class="color-swatch" style="background:${escapeHtml(String(value || '#89b4fa'))}"></div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;
    case 'animation':
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="animation-preview">
            <div class="animation-track">
              <div class="animation-dot ${value === true || value === 'true' || value === '1' ? 'enabled' : 'disabled'}"></div>
            </div>
            <div class="animation-windows">
              <div class="anim-window left"></div>
              <div class="anim-window center"></div>
              <div class="anim-window right"></div>
            </div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;
    case 'generic':
    default:
      return `
        <div class="preview-card">
          <div class="preview-meta">
            <div class="preview-title">${escapeHtml(label)}</div>
            <div class="preview-desc">${escapeHtml(desc)}</div>
          </div>
          <div class="preview-generic">
            <div class="preview-line wide"></div>
            <div class="preview-line"></div>
            <div class="preview-line short"></div>
          </div>
          <div class="preview-value">Current: ${escapeHtml(String(safeValue))}</div>
        </div>
      `;
  }
}

function updatePreview(setting, value, sectionPath = []) {
  state.previewSetting = setting;
  state.previewValue = value;

  const content = document.getElementById('preview-content');
  if (!content) return;

  content.innerHTML = renderPreviewCard(setting, value, sectionPath);
}

function subsectionSupportsPreview(sub) {
  if (!sub?.settings?.length) return false;

  return sub.settings.some(setting => {
    if (setting.preview?.type) return true;

    const key = setting.key || '';
    const path = sub.sectionPath || [];

    if ([
      'rounding',
      'rounding_power',
      'border_size',
      'col.active_border',
      'col.inactive_border',
      'gaps_in',
      'gaps_out',
      'float_gaps',
      'gaps_workspaces',
      'active_opacity',
      'inactive_opacity',
      'fullscreen_opacity',
      'dim_strength',
      'dim_inactive',
      'dim_special',
      'dim_around',
      'workspace_wraparound',
      'mfact',
      'orientation',
      'default_split_ratio',
      'layout'
    ].includes(key)) return true;

    if (['enabled', 'range', 'render_power', 'scale', 'color', 'color_inactive'].includes(key) && path.includes('shadow')) return true;
    if (['enabled', 'size', 'passes', 'vibrancy', 'noise', 'contrast', 'brightness'].includes(key) && path.includes('blur')) return true;
    if (setting.type === 'color') return true;

    return false;
  });
}

function installPreviewFallback() {
  const content = document.getElementById('preview-content');
  if (!content) return;
  content.innerHTML = `
    <div class="preview-empty">
      <h4>Select a setting</h4>
      <p>Focus or hover a setting to see a visual preview and description.</p>
    </div>
  `;
}

function buildSidebar() {
  const sidebar = $('sidebar-nav');
  const groups = {};

  for (const section of SECTIONS) {
    if (!groups[section.group]) groups[section.group] = [];
    groups[section.group].push(section);
  }

  let html = '';
  for (const [group, sections] of Object.entries(groups)) {
    html += `<div class="nav-group-label">${group}</div>`;
    for (const sec of sections) {
      html += `
        <button class="nav-item" data-section="${sec.id}" title="${sec.label}">
          <span class="nav-icon">${sec.icon}</span>
          <span class="nav-label">${sec.label}</span>
        </button>`;
    }
  }
  sidebar.innerHTML = html;

  sidebar.addEventListener('click', e => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    const sec = SECTIONS.find(s => s.id === btn.dataset.section);
    if (sec) {
      activateSection(sec, sec.subsections[0]);
    }
  });
}

function activateSection(section, subsection) {
  state.activeSection = section;
  state.activeSubsection = subsection || section.subsections[0];
  state.searchOpen = false;
  $('search-input').value = '';
  state.searchQuery = '';

  $$('.nav-item').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-section="${section.id}"]`);
  if (btn) btn.classList.add('active');

  renderActiveSection();
}

function renderAboutSection() {
  return `
    <div class="about-page terminal-about">
      <section class="terminal-card">
        <div class="terminal-topbar">
          <span class="terminal-dot red"></span>
          <span class="terminal-dot yellow"></span>
          <span class="terminal-dot green"></span>
          <span class="terminal-title">kusoidev@hypreditor:~</span>
        </div>

        <div class="terminal-body">
          <div class="terminal-line">
            <span class="prompt">kusoidev@hypreditor</span><span class="at">:</span><span class="path">~</span>$ ./about
          </div>

          <pre class="ascii-banner">
██╗  ██╗██╗   ██╗██████╗ ██████╗ ███████╗██████╗ ██╗████████╗ ██████╗ ██████╗
██║  ██║╚██╗ ██╔╝██╔══██╗██╔══██╗██╔════╝██╔══██╗██║╚══██╔══╝██╔═══██╗██╔══██╗
███████║ ╚████╔╝ ██████╔╝██████╔╝█████╗  ██║  ██║██║   ██║   ██║   ██║██████╔╝
██╔══██║  ╚██╔╝  ██╔═══╝ ██╔══██╗██╔══╝  ██║  ██║██║   ██║   ██║   ██║██╔══██╗
██║  ██║   ██║   ██║     ██║  ██║███████╗██████╔╝██║   ██║   ╚██████╔╝██║  ██║
╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
          </pre>

          <div class="terminal-line muted">personal Hyprland config editor</div>
          <div class="terminal-line">Built with care by <span class="terminal-accent">kusoidev</span></div>
          <div class="terminal-line">GitHub  : <span class="terminal-value">kusoidev</span></div>
          <div class="terminal-line">Discord : <span class="terminal-value">kyushoo</span></div>
          <div class="terminal-line">Project : <span class="terminal-value">HyprEditor</span></div>
          <div class="terminal-line">
            About   : <span class="terminal-muted">desktop editor for Hyprland configs, rules, previews, and safer saves with backups</span>
          </div>

          <div class="terminal-line">
            <span class="prompt">kusoidev@hypreditor</span><span class="at">:</span><span class="path">~</span>$ <span class="cursor">_</span>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderActiveSection() {
  const main = $('main-content');
  const sec = state.activeSection;
  const sub = state.activeSubsection;

  if (!sec) { main.innerHTML = '<div class="empty-state">Select a section</div>'; return; }

  if (sec.id === 'about') {
    main.innerHTML = renderAboutSection();
    return;
  }

  let html = `<div class="section-header">
    <h2 class="section-title">${sec.label}</h2>
    ${state.configPath ? `<span class="config-file-badge">${state.configPath.split('/').slice(-2).join('/')}</span>` : ''}
  </div>`;

  if (sec.subsections.length > 1) {
    html += `<div class="subsection-tabs">`;
    for (const s of sec.subsections) {
      const active = state.activeSubsection?.id === s.id ? 'active' : '';
      html += `<button class="sub-tab ${active}" data-sub="${s.id}">${s.label}</button>`;
    }
    html += `</div>`;
  }

  const isSpecial = sub?.type === 'waybar-editor'
    || sub?.type === 'waybar-config-editor'
    || sub?.type === 'wallpaper-browser';

  if (isSpecial) {
    html += `<div id="special-section-content" style="flex:1;min-height:0;display:flex;flex-direction:column;"></div>`;
  }

  main.innerHTML = html;

  main.querySelectorAll('.sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const found = sec.subsections.find(s => s.id === tab.dataset.sub);
      if (found) {
        state.activeSubsection = found;
        renderActiveSection();
      }
    });
  });

  if (sub?.type === 'waybar-editor') {
    const container = document.getElementById('special-section-content');
    if (container) renderWaybarSection(container);
    return;
  }

  if (sub?.type === 'waybar-config-editor') {
    const container = document.getElementById('special-section-content');
    if (container) renderWaybarConfigSection(container);
    return;
  }

  if (sub?.type === 'wallpaper-browser') {
    const container = document.getElementById('special-section-content');
    if (container) renderWallpaperSection(container);
    return;
  }

  const activeSub = state.activeSubsection || sec.subsections[0];
  main.insertAdjacentHTML('beforeend', renderSubsection(activeSub));

  if (subsectionSupportsPreview(activeSub)) {
    ensurePreviewPane(main);
    installPreviewFallback();
  }

  attachControlListeners(main, activeSub);
}

function renderSubsection(sub) {
  let html = `<div class="settings-container">`;

  if (!state.root) {
    html += `<div class="no-config-warning">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <p>No config file loaded.<br>Click the folder icon above to open one, or let HyprEditor auto-detect it.</p>
      <button class="btn-primary" id="open-config-btn">Open Config File</button>
    </div>`;
    html += `</div>`;
    return html;
  }

  if (sub.settings && sub.settings.length) {
    html += `<div class="settings-group">`;
    for (const setting of sub.settings) {
      const node = getValueFromPath(sub.sectionPath, setting.key);
      const currentValue = node ? node.value : '';
      const lineRef = node?.lineIdx ?? node?.line ?? null;
      html += renderControl(setting, currentValue, sub.sectionPath, lineRef);
    }
    html += `</div>`;
  }

  if (sub.lists && sub.lists.length) {
    for (const listDef of sub.lists) {
      const entries = getListFromPath(sub.sectionPath, listDef.key);
      html += renderListSection(listDef, entries, sub.sectionPath);
    }
  }

  html += `</div>`;
  return html;
}

function getValueFromPath(sectionPath, key) {
  if (!state.root) return null;

  let node = state.root;
  for (const seg of (sectionPath || []).map(s => String(s).toLowerCase())) {
    node = node?._children?.[seg];
    if (!node || node._type !== 'section') return null;
  }

  const child = node?._children?.[String(key).toLowerCase()];
  if (!child) return null;

  if (child._type === 'value' || child._type === 'variable') {
    return child;
  }

  return null;
}

function getListFromPath(sectionPath, key) {
  if (!state.root) return [];

  let node = state.root;
  for (const seg of (sectionPath || []).map(s => String(s).toLowerCase())) {
    node = node?._children?.[seg];
    if (!node || node._type !== 'section') return [];
  }

  return node?._lists?.[String(key).toLowerCase()] || [];
}

function renderControl(setting, value, sectionPath, lineIdx) {
  const id = `ctrl-${sectionPath.join('--')}-${setting.key.replace(/\./g, '-')}`;
  const pathStr = JSON.stringify(sectionPath);
  const hasValue = value !== '' && value !== undefined && value !== null;
  const notSet = lineIdx === undefined || lineIdx === null;
  const notFoundClass = notSet ? 'not-found' : '';

  const defaultVal = setting.default ?? (
    setting.type === 'bool' ? 'false' :
      setting.type === 'range' ? String(setting.min ?? 0) :
        setting.type === 'select' ? (setting.options?.[0] ?? '') :
          setting.type === 'color' ? 'rgba(cdd6f4aa)' : ''
  );

  let controlHtml;

  if (notSet) {
    controlHtml = `
      <div class="autoset-row">
        <span class="not-set-value">—</span>
        <button class="btn-autoset"
          data-key="${setting.key}"
          data-path='${pathStr}'
          data-default="${escapeHtml(String(defaultVal))}"
          data-type="${setting.type}"
          title="Write this key into your config with its default value so you can edit it">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Auto-set
        </button>
      </div>`;
  } else {
    switch (setting.type) {
      case 'range': {
        const numVal = parseFloat(value) || setting.min || 0;
        controlHtml = `<div class="slider-row">
          <input type="range" id="${id}" class="slider"
            min="${setting.min}" max="${setting.max}" step="${setting.step}" value="${numVal}"
            data-key="${setting.key}" data-path='${pathStr}' data-line="${lineIdx ?? -1}" data-type="range">
          <span class="slider-value" id="${id}-val">${numVal}${setting.unit}</span>
        </div>`;
        break;
      }
      case 'bool': {
        const isTrue = value === 1 || value === 'true' || value === 'yes';
        controlHtml = `<label class="toggle-label">
          <input type="checkbox" id="${id}" class="toggle-input" ${isTrue ? 'checked' : ''}
            data-key="${setting.key}" data-path='${pathStr}' data-line="${lineIdx ?? -1}" data-type="bool">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>`;
        break;
      }
      case 'select':
        controlHtml = `<select id="${id}" class="select-ctrl"
          data-key="${setting.key}" data-path='${pathStr}' data-line="${lineIdx ?? -1}" data-type="select">
          ${setting.options.map(o => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}
        </select>`;
        break;
      case 'color': {
        const hexColor = hyprColorToHex(value);
        controlHtml = `<div class="color-row">
          <input type="color" id="${id}" class="color-input" value="#${hexColor}"
            data-key="${setting.key}" data-path='${pathStr}' data-line="${lineIdx ?? -1}"
            data-type="color" data-original="${value}">
          <span class="color-value">${value || 'not set'}</span>
        </div>`;
        break;
      }
      case 'text':
      default:
        controlHtml = `<input type="text" id="${id}" class="text-input"
          value="${escapeHtml(value)}" placeholder="${!hasValue ? 'not set' : ''}"
          data-key="${setting.key}" data-path='${pathStr}' data-line="${lineIdx ?? -1}" data-type="text">`;
        break;
    }
  }

  return `
    <div
      class="setting-row ${notFoundClass}"
      data-key="${setting.key}"
      data-label="${escapeHtml(setting.label)}"
      data-desc="${escapeHtml(setting.desc || '')}"
      data-type="${escapeHtml(setting.type)}"
      data-section-path="${escapeHtml(JSON.stringify(sectionPath))}"
    >
      <div class="setting-info">
        <label class="setting-label" for="${id}">${setting.label}</label>
        <span class="setting-desc">${setting.desc}</span>
      </div>
      <div class="setting-control">${controlHtml}</div>
    </div>
  `;
}

function renderListSection(listDef, entries, sectionPath) {
  const pathStr = JSON.stringify(sectionPath);
  let html = `
    <div class="list-section">
      <div class="list-header">
        <h3 class="list-title">${listDef.label}</h3>
        <span class="list-count">${entries.length} entries</span>
        <button class="btn-add-entry" data-listkey="${listDef.key}" data-path='${pathStr}'>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add
        </button>
      </div>
      <p class="list-desc">${listDef.desc || ''}</p>
      <div class="list-entries">`;

  if (entries.length === 0) {
    html += `<div class="list-empty">No entries. Click Add to create one.</div>`;
  } else {
    entries.forEach((entry, idx) => {
      html += `
        <div class="list-entry" data-index="${idx}">
          <span class="list-entry-key">${listDef.key}</span>
          <input type="text" class="list-entry-input" value="${escapeHtml(entry.value)}"
            data-listkey="${listDef.key}" data-path='${pathStr}' data-line="${entry.line}" data-idx="${idx}">
          <button class="btn-delete-entry" data-listkey="${listDef.key}" data-line="${entry.line}" data-idx="${idx}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`;
    });
  }

  html += `</div></div>`;
  return html;
}

function attachControlListeners(container, sub) {
  const openBtn = container.querySelector('#open-config-btn');
  if (openBtn) {
    openBtn.addEventListener('click', async () => {
      const p = await window.hypr.pickFile();
      if (p) await loadConfig(p);
    });
  }

  container.querySelectorAll('.slider').forEach(input => {
    const valSpan = document.getElementById(input.id + '-val');
    input.addEventListener('input', () => {
      if (valSpan) valSpan.textContent = input.value;
      onControlChange(input);
    });
  });

  container.querySelectorAll('.toggle-input').forEach(input => {
    input.addEventListener('change', () => onControlChange(input));
  });

  container.querySelectorAll('.select-ctrl').forEach(input => {
    input.addEventListener('change', () => onControlChange(input));
  });

  container.querySelectorAll('.color-input').forEach(input => {
    input.addEventListener('input', () => {
      const colorVal = input.closest('.color-row')?.querySelector('.color-value');
      if (colorVal) colorVal.textContent = input.value;
      onControlChange(input);
    });
  });

  container.querySelectorAll('.text-input').forEach(input => {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => onControlChange(input), 600);
    });
  });

  container.querySelectorAll('.list-entry-input').forEach(input => {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => onListEntryChange(input), 600);
    });
  });

  container.querySelectorAll('.btn-add-entry').forEach(btn => {
    btn.addEventListener('click', () => {
      const listKey = btn.dataset.listkey;
      const sectionPath = JSON.parse(btn.dataset.path);
      addListEntry(listKey, sectionPath, sub);
    });
  });

  container.querySelectorAll('.btn-delete-entry').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmAction({
        title: 'Delete this entry?',
        message: 'Are you sure you want to delete this list entry? This will comment it out in the config until you save.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true,
      });
      if (!ok) return;

      const line = parseInt(btn.dataset.line, 10);
      deleteListEntry(line, sub);
    });
  });

  container.querySelectorAll('.btn-autoset').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      const sectionPath = JSON.parse(btn.dataset.path);
      const defaultVal = btn.dataset.default;
      const type = btn.dataset.type;

      const ok = await confirmAction({
        title: 'Add this setting?',
        message: `Are you sure you want to insert "${key}" into your config with default value "${defaultVal}"?`,
        confirmText: 'Insert',
        cancelText: 'Cancel',
        danger: false,
      });
      if (!ok) return;

      autoSetSetting(key, sectionPath, defaultVal, type);
    });
  });

  container.querySelectorAll('.setting-row').forEach(row => {
    const key = row.dataset.key;
    const setting = sub.settings?.find(s => s.key === key);
    if (!setting) return;

    const previewHandler = () => {
      let currentValue = null;
      const input =
        row.querySelector('.slider') ||
        row.querySelector('.toggle-input') ||
        row.querySelector('.select-ctrl') ||
        row.querySelector('.color-input') ||
        row.querySelector('.text-input');

      if (input) {
        if (input.classList.contains('toggle-input')) currentValue = input.checked;
        else currentValue = input.value;
      }

      updatePreview(setting, currentValue, sub.sectionPath);
    };

    row.addEventListener('mouseenter', previewHandler);
    row.addEventListener('focusin', previewHandler);
  });

  if (sub?.settings?.length) {
    const firstSetting = sub.settings[0];
    const firstRow = container.querySelector(`.setting-row[data-key="${firstSetting.key}"]`);
    if (firstRow) {
      let input =
        firstRow.querySelector('.slider') ||
        firstRow.querySelector('.toggle-input') ||
        firstRow.querySelector('.select-ctrl') ||
        firstRow.querySelector('.color-input') ||
        firstRow.querySelector('.text-input');

      let currentValue = null;
      if (input) currentValue = input.classList.contains('toggle-input') ? input.checked : input.value;

      updatePreview(firstSetting, currentValue, sub.sectionPath);
    }
  }
}

async function onControlChange(input) {
  const type = input.dataset.type;
  const key = input.dataset.key;
  const sectionPath = JSON.parse(input.dataset.path || '[]');
  const sub = state.activeSubsection;
  const setting = sub?.settings?.find(s => s.key === key);

  let newValue;
  switch (type) {
    case 'bool':
      newValue = input.checked ? 'true' : 'false';
      break;
    case 'color':
      newValue = hexToHyprColor(input.value, input.dataset.original);
      break;
    default:
      newValue = input.value;
      break;
  }

  updatePreview(setting || { key, label: key, desc: '' }, newValue, sectionPath);

  if (isRiskySetting(setting, newValue)) {
    const ok = await confirmAction({
      title: 'Apply risky setting?',
      message: `Are you sure you want to change "${setting?.label || key}"? This setting can affect session behavior or rendering.`,
      confirmText: 'Apply',
      cancelText: 'Cancel',
      danger: true,
    });

    if (!ok) {
      if (type === 'bool') input.checked = !input.checked;
      return;
    }
  }

  applyChange(
    { root: state.root, rawLines: state.rawLines },
    sectionPath,
    key,
    newValue
  );

  let reparsed = parseConfig(state.rawLines.join('\n'));
  reparsed = normalizeConfig(reparsed);

  state.root = reparsed.root;
  state.rawLines = reparsed.rawLines;
  state.dirty = true;
  updateSaveButton();
  renderActiveSection();
}

function onListEntryChange(input) {
  const line = parseInt(input.dataset.line, 10);
  const listKey = input.dataset.listkey;

  if (Number.isNaN(line) || line < 0) return;

  state.rawLines[line] = `${listKey} = ${input.value}`;

  const reparsed = parseConfig(state.rawLines.join('\n'));
  state.root = reparsed.root;
  state.rawLines = reparsed.rawLines;

  state.dirty = true;
  updateSaveButton();
}

function autoSetSetting(key, sectionPath, defaultVal, type) {
  if (!state.root) return;

  const existing = getValueFromPath(sectionPath, key);
  if (existing) return;

  let insertIdx = null;
  let node = state.root;

  for (const seg of (sectionPath || []).map(s => String(s).toLowerCase())) {
    node = node?._children?.[seg];
  }

  if (node && node._type === 'section') {
    const allLines = Object.values(node._children ?? {})
      .filter(n => n && (n._type === 'value' || n._type === 'variable'))
      .map(n => n.lineIdx ?? n.line)
      .filter(l => l !== undefined && l !== null && l >= 0);

    const listLines = Object.values(node._lists ?? {})
      .flat()
      .map(n => n.lineIdx ?? n.line)
      .filter(l => l !== undefined && l !== null && l >= 0);

    const merged = [...allLines, ...listLines];
    if (merged.length) {
      insertIdx = Math.max(...merged) + 1;
    }
  }

  const indent = '    '.repeat(sectionPath.length);
  const newLine = `${indent}${key} = ${defaultVal}`;

  if (insertIdx !== null) {
    state.rawLines.splice(insertIdx, 0, newLine);
  } else {
    const openLines = sectionPath.map((seg, i) => '    '.repeat(i) + seg + ' {');
    const closeLines = [...sectionPath].reverse().map((_, i) => '    '.repeat(sectionPath.length - 1 - i) + '}');
    state.rawLines.push('', ...openLines, newLine, ...closeLines);
  }

  const parsed = parseConfig(state.rawLines.join('\n'));
  state.root = parsed.root ?? parsed;
  state.rawLines = parsed.rawLines ?? state.rawLines;

  state.dirty = true;
  updateSaveButton();
  renderActiveSection();
  showNotification(`Auto-set "${key}" → ${defaultVal}. Adjust and save.`, 'info');
}

function addListEntry(listKey, sectionPath, sub) {
  if (!state.root) return;
  const newLine = `${listKey} = `;
  state.rawLines.push(newLine);
  const lineIdx = state.rawLines.length - 1;

  let node = state.root;
  for (const seg of sectionPath) {
    node = node._children[seg];
    if (!node) return;
  }
  if (!node._lists[listKey]) node._lists[listKey] = [];
  node._lists[listKey].push({ value: '', line: lineIdx });

  state.dirty = true;
  updateSaveButton();
  renderActiveSection();
  showNotification('New entry added — edit the value and save.', 'info');
}

function deleteListEntry(lineIdx, sub) {
  if (lineIdx < 0 || lineIdx >= state.rawLines.length) return;
  state.rawLines[lineIdx] = '# ' + state.rawLines[lineIdx] + ' # (deleted by HyprEditor)';

  const { root } = parseConfig(state.rawLines.join('\n'));
  state.root = root;

  state.dirty = true;
  updateSaveButton();
  renderActiveSection();
  showNotification('Entry removed (commented out). Save to persist.', 'info');
}

function setupSearch() {
  const input = $('search-input');
  const dropdown = $('search-dropdown');

  input.addEventListener('input', () => {
    state.searchQuery = input.value.trim();
    if (state.searchQuery.length < 2) {
      dropdown.classList.add('hidden');
      return;
    }
    if (!state.root) return;

    const results = findAllMatches(state.root, state.searchQuery).slice(0, 12);
    state.searchResults = results;
    renderSearchResults(results);
    dropdown.classList.remove('hidden');
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      input.value = '';
      dropdown.classList.add('hidden');
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrapper')) {
      dropdown.classList.add('hidden');
    }
  });
}

function renderSearchResults(results) {
  const dropdown = $('search-dropdown');
  if (!results.length) {
    dropdown.innerHTML = `<div class="search-empty">No results for "${state.searchQuery}"</div>`;
    return;
  }

  dropdown.innerHTML = results.map(r => `
    <div class="search-result" data-path='${JSON.stringify(r.path)}' data-key="${r.key}">
      <span class="search-result-key">${r.key}</span>
      <span class="search-result-path">${[...r.path, r.key].join('.')}</span>
      <span class="search-result-value">${r.value === '[section]' ? '<em>section</em>' : escapeHtml(r.value)}</span>
    </div>`).join('');

  dropdown.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      const path = JSON.parse(el.dataset.path);
      const key = el.dataset.key;
      navigateToKey(path, key);
      $('search-dropdown').classList.add('hidden');
      $('search-input').value = '';
    });
  });
}

function navigateToKey(sectionPath, key) {
  for (const sec of SECTIONS) {
    for (const sub of sec.subsections) {
      const matches = sub.sectionPath?.join('.') === sectionPath.join('.');
      const hasKey = sub.settings?.some(s => s.key === key) || sub.lists?.some(l => l.key === key);
      if (matches && hasKey) {
        activateSection(sec, sub);
        setTimeout(() => {
          const el = document.querySelector(`[data-key="${key}"]`);
          if (el) { el.classList.add('highlight'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
          setTimeout(() => el?.classList.remove('highlight'), 2000);
        }, 100);
        return;
      }
    }
  }
}

function setupTitleBar() {
  $('btn-min').addEventListener('click', () => window.hypr.minimize());
  $('btn-max').addEventListener('click', () => window.hypr.maximize());
  $('btn-close').addEventListener('click', () => window.hypr.close());

  $('btn-open').addEventListener('click', async () => {
    const p = await window.hypr.pickFile();
    if (p) await loadConfig(p);
  });

  $('btn-save').addEventListener('click', saveConfig);
  $('btn-restore').addEventListener('click', restoreBackups);
  $('btn-reload').addEventListener('click', async () => {
    if (state.configPath) await loadConfig(state.configPath);
  });
}

function updatePathDisplay() {
  const el = $('config-path');
  if (el && state.configPath) {
    const extra = state.fileSegments.length > 1 ? ` (+${state.fileSegments.length - 1} files)` : '';
    el.textContent = state.configPath + extra;
    el.title = state.fileSegments.map(s => s.filePath).join('\n');
  }
}

function updateSaveButton() {
  const btn = $('btn-save');
  if (!btn) return;
  btn.classList.toggle('dirty', state.dirty);
  btn.textContent = state.dirty ? 'Save*' : 'Save';
}

function showWelcome() {
  const main = $('main-content');
  main.innerHTML = `
    <div class="welcome-screen">
      <div class="welcome-logo">
        <svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64">
          <rect width="60" height="60" rx="16" fill="#0d3030"/>
          <path d="M15 20h30M15 30h20M15 40h25" stroke="#2dd4bf" stroke-width="3" stroke-linecap="round"/>
          <circle cx="44" cy="30" r="8" fill="#1a5050" stroke="#2dd4bf" stroke-width="2"/>
          <path d="M41 30l2 2 4-4" stroke="#2dd4bf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h1>HyprEditor</h1>
      </div>
      <p>No hyprland.conf found at the default location.<br>Open your config file to get started.</p>
      <button class="btn-primary large" id="welcome-open">Open Config File</button>
      <div class="welcome-hint">Typical location: <code>~/.config/hypr/hyprland.conf</code></div>
    </div>`;

  document.getElementById('welcome-open').addEventListener('click', async () => {
    const p = await window.hypr.pickFile();
    if (p) await loadConfig(p);
  });
}

function showNotification(msg, type = 'info') {
  const el = $('notification');
  el.textContent = msg;
  el.className = `notification ${type} show`;
  clearTimeout(state.notifTimer);
  state.notifTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

function hyprColorToHex(color) {
  if (!color) return '000000';
  const rgbaMatch = color.match(/rgba?\(([0-9a-fA-F]+)\)/);
  if (rgbaMatch) return rgbaMatch[1].slice(0, 6);
  const hexMatch = color.match(/0x([0-9a-fA-F]{8})/i);
  if (hexMatch) return hexMatch[1].slice(2, 8);
  if (color.startsWith('#')) return color.slice(1, 7);
  return '000000';
}

function hexToHyprColor(hex, original) {
  if (!original) return `rgba(${hex.slice(1)}ee)`;
  if (original.startsWith('rgba(')) return `rgba(${hex.slice(1)}${original.slice(-3)}`;
  if (original.startsWith('rgb(')) return `rgb(${hex.slice(1)})`;
  if (original.match(/0x[0-9a-fA-F]{8}/i)) return `0xff${hex.slice(1)}`;
  return hex;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', init);