interface QsFile {
  path: string;
  content: string;
  original: string;
  isDirty: boolean;
  name: string;
}

interface QuickSettingsState {
  files: QsFile[];
  activeIdx: number;
  fileChangedRegistered: boolean;
}

class QuickSettingsManager {
  private state: QuickSettingsState = {
    files: [],
    activeIdx: 0,
    fileChangedRegistered: false,
  };

  private container: HTMLElement | null = null;

  private EscapeHtml(s: unknown): string {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private ShowStatus(msg: string, type: string): void {
    const el = document.getElementById("qs-status") as (HTMLElement & { _t?: ReturnType<typeof setTimeout> }) | null;
    if (!el) return;
    el.textContent = msg;
    el.className = `waybar-status-badge waybar-status-${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3200);
  }

  private async TryLoad(path: string): Promise<QsFile | null> {
    const res = await window.hypr.readFile(path);
    if (!res.ok) return null;
    return { path, content: res.content, original: res.content, isDirty: false, name: path.split("/").pop() || path };
  }

  async init(): Promise<void> {
    const home = window.__homedir || "";

    const candidates = [
      `${home}/.config/ags/app.ts`,
      `${home}/.config/ags/app.js`,
      `${home}/.config/ags/config.js`,
      `${home}/.config/ags/style.css`,
      `${home}/.config/ags/style.scss`,
      `${home}/.config/ags/variables.scss`,
      `${home}/.config/ags/variables.css`,
      `${home}/.config/ags/widget/QuickSettings.tsx`,
      `${home}/.config/ags/widget/QuickSettings.ts`,
      `${home}/.config/ags/widget/quicksettings.tsx`,
      `${home}/.config/ags/modules/QuickSettings/index.ts`,
      `${home}/.config/ags/modules/quicksettings/index.ts`,
    ];

    const loaded: QsFile[] = [];
    for (const p of candidates) {
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
        const ed = document.getElementById("qs-editor") as HTMLTextAreaElement | null;
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
              <button class="qs-file-tab ${i === activeIdx ? "active" : ""}" data-qs-tab="${i}" title="${this.EscapeHtml(f.path)}">
                ${f.isDirty ? `<span class="qs-dirty-dot"></span>` : ""}
                <span class="qs-tab-ext">${this.GetFileIcon(f.name)}</span>
                ${this.EscapeHtml(f.name)}
              </button>`).join("")}
          </div>
        ` : ""}

        <div class="waybar-path-bar" style="${files.length > 1 ? "margin-top:8px;" : ""}">
          <svg class="waybar-path-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <code class="waybar-path-value" id="qs-path">
            ${active ? active.path.replace(window.__homedir || "", "~") : "No AGS config files found — use Add File to open one"}
          </code>
          <div class="waybar-path-actions">
            <button class="tb-action" id="qs-reload-btn" ${!active ? "disabled" : ""}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Reload
            </button>
            <button class="tb-action" id="qs-pick-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Add File
            </button>
            <button class="tb-action save ${active?.isDirty ? "dirty" : ""}" id="qs-save-btn" ${!active ? "disabled" : ""}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Apply to disk
            </button>
            <span class="waybar-status-badge" id="qs-status"></span>
          </div>
        </div>

        ${!hasFiles ? `
          <div class="sys-empty" style="margin-top:40px;">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <p style="margin-top:12px;">No AGS config files found at <code>~/.config/ags/</code></p>
            <p style="margin-top:6px;font-size:11px;opacity:.6;">Click <strong>Add File</strong> to open any config file manually.</p>
          </div>
        ` : `
          <div style="flex:1;display:flex;gap:10px;height:calc(100vh - ${files.length > 1 ? "300px" : "260px"});min-height:400px;margin-top:10px;">
            <div class="waybar-editor-pane" style="flex:1;display:flex;flex-direction:column;min-width:0;">
              <div class="waybar-pane-header">
                <span>${active ? this.EscapeHtml(active.name) : ""}</span>
                <span class="waybar-hint">${active ? this.GetHint(active.name) : ""}</span>
              </div>
              <textarea id="qs-editor" class="waybar-css-editor" spellcheck="false" autocomplete="off" autocorrect="off" style="flex:1;resize:none;min-height:0;" placeholder="File will appear here.">${active ? this.EscapeHtml(active.content) : ""}</textarea>
            </div>
          </div>
        `}
      </div>`;

    this.BindEvents();
  }

  private GetFileIcon(name: string): string {
    if (name.endsWith(".css") || name.endsWith(".scss")) return "🎨";
    if (name.endsWith(".ts") || name.endsWith(".tsx")) return "📘";
    if (name.endsWith(".js")) return "📜";
    return "📄";
  }

  private GetHint(name: string): string {
    if (name.endsWith(".scss") || name.endsWith(".css")) return "Styles — colors, fonts, spacing, animations";
    if (name.endsWith(".tsx") || name.endsWith(".ts")) return "TypeScript widget — layout and behavior";
    if (name.endsWith(".js")) return "JavaScript — AGS entry point or widget";
    if (name === "variables.scss" || name === "variables.css") return "Design tokens — change colors and sizes here";
    return "AGS config file";
  }

  private BindEvents(): void {
    const editor = document.getElementById("qs-editor") as HTMLTextAreaElement;
    const saveBtn = document.getElementById("qs-save-btn") as HTMLButtonElement;

    document.querySelectorAll<HTMLButtonElement>("[data-qs-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        this.state.activeIdx = parseInt(btn.dataset.qsTab!, 10);
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

    document.getElementById("qs-reload-btn")?.addEventListener("click", async () => {
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

    document.getElementById("qs-pick-btn")?.addEventListener("click", async () => {
      const p = await window.hypr.pickFile();
      if (!p) return;
      const existing = this.state.files.find(f => f.path === p);
      if (existing) {
        this.state.activeIdx = this.state.files.indexOf(existing);
        if (this.container) this.renderSection(this.container);
        return;
      }
      const f = await this.TryLoad(p);
      if (!f) return;
      this.state.files.push(f);
      this.state.activeIdx = this.state.files.length - 1;
      if (this.container) this.renderSection(this.container);
    });
  }
}

const quickSettingsManager = new QuickSettingsManager();
export async function initQuickSettingsSection(): Promise<void> { return quickSettingsManager.init(); }
export function renderQuickSettingsSection(container: HTMLElement): void { return quickSettingsManager.renderSection(container); }