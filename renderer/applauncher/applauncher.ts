interface LauncherFile {
  path: string;
  content: string;
  original: string;
  isDirty: boolean;
  name: string;
}

interface AppLauncherState {
  files: LauncherFile[];
  activeIdx: number;
  fileChangedRegistered: boolean;
}

const AL_STORAGE_KEY = "hypreditor_applauncher_paths";

class AppLauncherManager {
  private state: AppLauncherState = {
    files: [],
    activeIdx: 0,
    fileChangedRegistered: false,
  };

  private container: HTMLElement | null = null;

  private StorageGetPaths(): string[] {
    try {
      const raw = localStorage.getItem(AL_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  }

  private StorageSavePaths(): void {
    try {
      localStorage.setItem(AL_STORAGE_KEY, JSON.stringify(this.state.files.map(f => f.path)));
    } catch { }
  }

  private EscapeHtml(s: unknown): string {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private ShowStatus(msg: string, type: string): void {
    const el = document.getElementById("al-status") as (HTMLElement & { _t?: ReturnType<typeof setTimeout> }) | null;
    if (!el) return;
    el.textContent = msg;
    el.className = `waybar-status-badge waybar-status-${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3200);
  }

  private GetHint(name: string): string {
    if (name.endsWith(".sh")) return "Shell script — launcher entry point";
    if (name.endsWith(".rasi")) return "Rofi theme — layout, colors, widgets";
    if (name.endsWith(".css") || name.endsWith(".scss")) return "CSS — visual styling";
    if (name.endsWith(".toml") || name.endsWith(".ini")) return "Config — launcher options";
    if (name === "config" || name.endsWith(".json") || name.endsWith(".jsonc")) return "Launcher config — options and appearance";
    return "Launcher config file";
  }

  private GetFileIcon(name: string): string {
    if (name.endsWith(".sh")) return "⚡";
    if (name.endsWith(".rasi") || name.endsWith(".css") || name.endsWith(".scss")) return "🎨";
    if (name.endsWith(".toml") || name.endsWith(".ini") || name === "config") return "⚙️";
    return "📄";
  }

  private async TryLoad(path: string): Promise<LauncherFile | null> {
    const res = await window.hypr.readFile(path);
    if (!res.ok) return null;
    return { path, content: res.content, original: res.content, isDirty: false, name: path.split("/").pop() || path };
  }

  private async AddFile(path: string): Promise<void> {
    const existing = this.state.files.find(f => f.path === path);
    if (existing) {
      this.state.activeIdx = this.state.files.indexOf(existing);
      if (this.container) this.renderSection(this.container);
      return;
    }
    const f = await this.TryLoad(path);
    if (!f) { this.ShowStatus("Could not read file", "error"); return; }
    this.state.files.push(f);
    this.state.activeIdx = this.state.files.length - 1;
    this.StorageSavePaths();
    if (this.container) this.renderSection(this.container);
  }

  private async AddFolder(dirPath: string): Promise<void> {
    const candidates = [
      `${dirPath}/app_launcher.sh`,
      `${dirPath}/launcher.sh`,
      `${dirPath}/config`,
      `${dirPath}/config.rasi`,
      `${dirPath}/config.json`,
      `${dirPath}/config.jsonc`,
      `${dirPath}/style.css`,
      `${dirPath}/style.scss`,
      `${dirPath}/theme.rasi`,
      `${dirPath}/colors.rasi`,
    ];

    let added = 0;
    for (const p of candidates) {
      const f = await this.TryLoad(p);
      if (!f) continue;
      if (!this.state.files.find(x => x.path === p)) {
        this.state.files.push(f);
        added++;
      }
    }

    if (added > 0) {
      this.state.activeIdx = this.state.files.length - added;
      this.StorageSavePaths();
      if (this.container) this.renderSection(this.container);
      this.ShowStatus(`Loaded ${added} file${added !== 1 ? "s" : ""} from folder`, "success");
    } else {
      this.ShowStatus("No known config files found in that folder — try Add File instead", "info");
    }
  }

  async init(): Promise<void> {
    const saved = this.StorageGetPaths();
    const loaded: LauncherFile[] = [];
    for (const p of saved) {
      const f = await this.TryLoad(p);
      if (f) loaded.push(f);
    }
    this.state.files = loaded;
    this.state.activeIdx = 0;

    if (!this.state.fileChangedRegistered) {
      this.state.fileChangedRegistered = true;
      window.hypr.onFileChanged(({ filePath, content }: { filePath: string; content: string }) => {
        const f = this.state.files.find(x => x.path === filePath);
        if (!f) return;
        f.content = content;
        f.isDirty = content !== f.original;
        const ed = document.getElementById("al-editor") as HTMLTextAreaElement | null;
        const active = this.state.files[this.state.activeIdx];
        if (ed && active?.path === filePath) ed.value = content;
        this.ShowStatus("Updated from disk", "info");
      });
    }
  }

  renderSection(container: HTMLElement): void {
    this.container = container;
    const { files, activeIdx } = this.state;
    const active = files[activeIdx] ?? null;
    const hasFiles = files.length > 0;

    container.innerHTML = `
      <div class="waybar-section">
        ${files.length > 1 ? `
          <div class="qs-file-tabs">
            ${files.map((f, i) => `
              <button class="qs-file-tab ${i === activeIdx ? "active" : ""}" data-al-tab="${i}" title="${this.EscapeHtml(f.path)}">
                ${f.isDirty ? `<span class="qs-dirty-dot"></span>` : ""}
                <span class="qs-tab-ext">${this.GetFileIcon(f.name)}</span>
                ${this.EscapeHtml(f.name)}
                <span class="al-tab-remove" data-al-remove="${i}" title="Remove from editor">×</span>
              </button>`).join("")}
          </div>
        ` : ""}

        <div class="waybar-path-bar" style="${files.length > 1 ? "margin-top:8px;" : ""}">
          <svg class="waybar-path-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <code class="waybar-path-value" id="al-path">
            ${active ? active.path.replace(window.__homedir || "", "~") : "No files added yet"}
          </code>
          <div class="waybar-path-actions">
            <button class="tb-action" id="al-reload-btn" ${!active ? "disabled" : ""}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Reload
            </button>
            <button class="tb-action" id="al-pick-file-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Add File
            </button>
            <button class="tb-action" id="al-pick-dir-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Add Folder
            </button>
            <button class="tb-action save ${active?.isDirty ? "dirty" : ""}" id="al-save-btn" ${!active ? "disabled" : ""}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Apply to disk
            </button>
            <span class="waybar-status-badge" id="al-status"></span>
          </div>
        </div>

        ${!hasFiles ? `
          <div class="al-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <h3>No launcher files added</h3>
            <p>Pick your launcher script or its config folder to start editing.</p>
            <div class="al-empty-actions">
              <button class="btn-primary" id="al-empty-pick-file">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Pick a File
              </button>
              <button class="btn-primary" id="al-empty-pick-dir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Pick a Folder
              </button>
            </div>
            <p class="al-empty-hint">Your selection is remembered — it reopens automatically next time.</p>
          </div>
        ` : `
          <div style="flex:1;display:flex;gap:10px;height:calc(100vh - ${files.length > 1 ? "305px" : "265px"});min-height:400px;margin-top:10px;">
            <div class="waybar-editor-pane" style="flex:1;display:flex;flex-direction:column;min-width:0;">
              <div class="waybar-pane-header">
                <span>${active ? this.EscapeHtml(active.name) : ""}</span>
                <span class="waybar-hint">${active ? this.GetHint(active.name) : ""}</span>
              </div>
              <textarea id="al-editor" class="waybar-css-editor" spellcheck="false" autocomplete="off" style="flex:1;resize:none;min-height:0;" placeholder="File will appear here.">${active ? this.EscapeHtml(active.content) : ""}</textarea>
            </div>
          </div>
        `}
      </div>`;

    this.BindEvents();
  }

  private BindEvents(): void {
    const editor = document.getElementById("al-editor") as HTMLTextAreaElement;
    const saveBtn = document.getElementById("al-save-btn") as HTMLButtonElement;

    document.querySelectorAll<HTMLElement>("[data-al-tab]").forEach(btn => {
      btn.addEventListener("click", e => {
        if ((e.target as Element).closest("[data-al-remove]")) return;
        this.state.activeIdx = parseInt((btn as HTMLElement).dataset.alTab!, 10);
        if (this.container) this.renderSection(this.container);
      });
    });

    document.querySelectorAll<HTMLElement>("[data-al-remove]").forEach(span => {
      span.addEventListener("click", e => {
        e.stopPropagation();
        const idx = parseInt((span as HTMLElement).dataset.alRemove!, 10);
        this.state.files.splice(idx, 1);
        this.state.activeIdx = Math.min(this.state.activeIdx, Math.max(0, this.state.files.length - 1));
        this.StorageSavePaths();
        if (this.container) this.renderSection(this.container);
      });
    });

    editor?.addEventListener("input", () => {
      const active = this.state.files[this.state.activeIdx];
      if (!active) return;
      active.content = editor.value;
      active.isDirty = editor.value !== active.original;
      saveBtn?.classList.toggle("dirty", active.isDirty);
    });

    document.getElementById("al-reload-btn")?.addEventListener("click", async () => {
      const active = this.state.files[this.state.activeIdx];
      if (!active) return;
      const res = await window.hypr.readFile(active.path);
      if (res.ok) {
        active.content = res.content;
        active.original = res.content;
        active.isDirty = false;
        if (editor) editor.value = res.content;
        saveBtn?.classList.remove("dirty");
        this.ShowStatus("Reloaded", "success");
      } else {
        this.ShowStatus("Read error: " + res.error, "error");
      }
    });

    saveBtn?.addEventListener("click", async () => {
      const active = this.state.files[this.state.activeIdx];
      if (!active) { this.ShowStatus("No file selected", "error"); return; }
      const res = await window.hypr.writeFile(active.path, active.content);
      if (res.ok) {
        active.original = active.content;
        active.isDirty = false;
        saveBtn.classList.remove("dirty");
        this.ShowStatus("Applied ✓", "success");
      } else {
        this.ShowStatus("Write failed: " + res.error, "error");
      }
    });

    const onPickFile = async (): Promise<void> => {
      const p = await window.hypr.pickFile();
      if (p) await this.AddFile(p);
    };

    const onPickDir = async (): Promise<void> => {
      const p = await window.hypr.pickDirectory();
      if (p) await this.AddFolder(p);
    };

    document.getElementById("al-pick-file-btn")?.addEventListener("click", onPickFile);
    document.getElementById("al-pick-dir-btn")?.addEventListener("click", onPickDir);
    document.getElementById("al-empty-pick-file")?.addEventListener("click", onPickFile);
    document.getElementById("al-empty-pick-dir")?.addEventListener("click", onPickDir);
  }
}

const appLauncherManager = new AppLauncherManager();
export async function initAppLauncherSection(): Promise<void> { return appLauncherManager.init(); }
export function renderAppLauncherSection(container: HTMLElement): void { return appLauncherManager.renderSection(container); }