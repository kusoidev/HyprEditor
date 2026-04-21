interface PowerMenuState {
  layoutPath: string | null;
  layoutContent: string;
  originalLayout: string;
  isDirtyLayout: boolean;
  stylePath: string | null;
  styleContent: string;
  originalStyle: string;
  isDirtyStyle: boolean;
  activeTab: "layout" | "style";
  watchActive: boolean;
  fileChangedRegistered: boolean;
}

class PowerMenuManager {
  private state: PowerMenuState = {
    layoutPath: null,
    layoutContent: "",
    originalLayout: "",
    isDirtyLayout: false,
    stylePath: null,
    styleContent: "",
    originalStyle: "",
    isDirtyStyle: false,
    activeTab: "layout",
    watchActive: false,
    fileChangedRegistered: false,
  };

  private container: HTMLElement | null = null;

  private EscapeHtml(s: unknown): string {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private ShowStatus(msg: string, type: string): void {
    const el = document.getElementById("pm-status") as (HTMLElement & { _t?: ReturnType<typeof setTimeout> }) | null;
    if (!el) return;
    el.textContent = msg;
    el.className = `waybar-status-badge waybar-status-${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3200);
  }

  async init(): Promise<void> {
    const home = window.__homedir || "";
    const pairs: Array<[string, "layout" | "style"]> = [
      [`${home}/.config/wlogout/layout`, "layout"],
      [`${home}/.config/wlogout/style.css`, "style"],
    ];

    for (const [p, kind] of pairs) {
      const res = await window.hypr.readFile(p);
      if (!res.ok) continue;
      if (kind === "layout") {
        this.state.layoutPath = p;
        this.state.layoutContent = res.content;
        this.state.originalLayout = res.content;
      } else {
        this.state.stylePath = p;
        this.state.styleContent = res.content;
        this.state.originalStyle = res.content;
      }
    }

    if (!this.state.fileChangedRegistered) {
      this.state.fileChangedRegistered = true;
      window.hypr.onFileChanged(({ filePath, content }: { filePath: string; content: string }) => {
        if (filePath === this.state.layoutPath) {
          this.state.layoutContent = content;
          this.state.isDirtyLayout = content !== this.state.originalLayout;
          const ed = document.getElementById("pm-layout-editor") as HTMLTextAreaElement | null;
          if (ed) ed.value = content;
          this.ShowStatus("Updated from disk", "info");
        }
        if (filePath === this.state.stylePath) {
          this.state.styleContent = content;
          this.state.isDirtyStyle = content !== this.state.originalStyle;
          const ed = document.getElementById("pm-style-editor") as HTMLTextAreaElement | null;
          if (ed) ed.value = content;
          this.ShowStatus("Updated from disk", "info");
        }
      });
    }
  }

  renderSection(container: HTMLElement): void {
    this.container = container;
    const { activeTab, layoutPath, stylePath, isDirtyLayout, isDirtyStyle } = this.state;

    const layoutDisplay = layoutPath
      ? layoutPath.replace(window.__homedir || "", "~")
      : "~/.config/wlogout/layout (not found)";
    const styleDisplay = stylePath
      ? stylePath.replace(window.__homedir || "", "~")
      : "~/.config/wlogout/style.css (not found)";

    container.innerHTML = `
      <div class="waybar-section">
        <div class="subsection-tabs" style="margin-bottom:12px;">
          <button class="sub-tab ${activeTab === "layout" ? "active" : ""}" id="pm-tab-layout">Layout</button>
          <button class="sub-tab ${activeTab === "style" ? "active" : ""}" id="pm-tab-style">Style</button>
        </div>

        <div class="waybar-path-bar">
          <svg class="waybar-path-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <code class="waybar-path-value">${activeTab === "layout" ? layoutDisplay : styleDisplay}</code>
          <div class="waybar-path-actions">
            <button class="tb-action" id="pm-reload-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Reload
            </button>
            <button class="tb-action" id="pm-pick-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Browse
            </button>
            <button class="tb-action save ${activeTab === "layout" ? (isDirtyLayout ? "dirty" : "") : (isDirtyStyle ? "dirty" : "")}" id="pm-save-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Apply to disk
            </button>
            <span class="waybar-status-badge" id="pm-status"></span>
          </div>
        </div>

        <div style="flex:1;display:flex;gap:10px;height:calc(100vh - 270px);min-height:400px;margin-top:10px;">
          ${activeTab === "layout" ? `
            <div class="waybar-editor-pane" style="flex:1;display:flex;flex-direction:column;min-width:0;">
              <div class="waybar-pane-header">
                <span>layout</span>
                <span class="waybar-hint">JSON — each object is a power menu button (label, action, text, keybind)</span>
              </div>
              <textarea id="pm-layout-editor" class="waybar-css-editor" spellcheck="false" autocomplete="off" style="flex:1;resize:none;min-height:0;" placeholder="wlogout layout file will appear here.">${this.EscapeHtml(this.state.layoutContent)}</textarea>
            </div>
          ` : `
            <div class="waybar-editor-pane" style="flex:1;display:flex;flex-direction:column;min-width:0;">
              <div class="waybar-pane-header">
                <span>style.css</span>
                <span class="waybar-hint">CSS — button icons, background, hover effects, layout</span>
              </div>
              <textarea id="pm-style-editor" class="waybar-css-editor" spellcheck="false" autocomplete="off" style="flex:1;resize:none;min-height:0;" placeholder="wlogout style.css will appear here.">${this.EscapeHtml(this.state.styleContent)}</textarea>
            </div>
          `}
        </div>
      </div>`;

    this.BindEvents();
  }

  private BindEvents(): void {
    document.getElementById("pm-tab-layout")?.addEventListener("click", () => {
      this.state.activeTab = "layout";
      if (this.container) this.renderSection(this.container);
    });

    document.getElementById("pm-tab-style")?.addEventListener("click", () => {
      this.state.activeTab = "style";
      if (this.container) this.renderSection(this.container);
    });

    const saveBtn = document.getElementById("pm-save-btn") as HTMLButtonElement;
    const isLayout = this.state.activeTab === "layout";
    const editorId = isLayout ? "pm-layout-editor" : "pm-style-editor";
    const editor = document.getElementById(editorId) as HTMLTextAreaElement;

    editor?.addEventListener("input", () => {
      if (isLayout) {
        this.state.layoutContent = editor.value;
        this.state.isDirtyLayout = editor.value !== this.state.originalLayout;
        saveBtn?.classList.toggle("dirty", this.state.isDirtyLayout);
      } else {
        this.state.styleContent = editor.value;
        this.state.isDirtyStyle = editor.value !== this.state.originalStyle;
        saveBtn?.classList.toggle("dirty", this.state.isDirtyStyle);
      }
    });

    document.getElementById("pm-reload-btn")?.addEventListener("click", async () => {
      const p = isLayout ? this.state.layoutPath : this.state.stylePath;
      if (!p) return;
      const res = await window.hypr.readFile(p);
      if (res.ok) {
        if (isLayout) {
          this.state.layoutContent = res.content;
          this.state.originalLayout = res.content;
          this.state.isDirtyLayout = false;
        } else {
          this.state.styleContent = res.content;
          this.state.originalStyle = res.content;
          this.state.isDirtyStyle = false;
        }
        if (editor) editor.value = res.content;
        saveBtn?.classList.remove("dirty");
        this.ShowStatus("Reloaded", "success");
      } else {
        this.ShowStatus("Read error: " + res.error, "error");
      }
    });

    saveBtn?.addEventListener("click", async () => {
      const p = isLayout ? this.state.layoutPath : this.state.stylePath;
      const content = isLayout ? this.state.layoutContent : this.state.styleContent;
      if (!p) { this.ShowStatus("No file — use Browse", "error"); return; }
      const res = await window.hypr.writeFile(p, content);
      if (res.ok) {
        if (isLayout) { this.state.originalLayout = content; this.state.isDirtyLayout = false; }
        else { this.state.originalStyle = content; this.state.isDirtyStyle = false; }
        saveBtn.classList.remove("dirty");
        this.ShowStatus("Applied ✓", "success");
      } else {
        this.ShowStatus("Write failed: " + res.error, "error");
      }
    });

    document.getElementById("pm-pick-btn")?.addEventListener("click", async () => {
      const p = await window.hypr.pickFile();
      if (!p) return;
      const res = await window.hypr.readFile(p);
      if (!res.ok) return;
      if (isLayout) {
        this.state.layoutPath = p;
        this.state.layoutContent = res.content;
        this.state.originalLayout = res.content;
        this.state.isDirtyLayout = false;
      } else {
        this.state.stylePath = p;
        this.state.styleContent = res.content;
        this.state.originalStyle = res.content;
        this.state.isDirtyStyle = false;
      }
      if (editor) editor.value = res.content;
      saveBtn?.classList.remove("dirty");
      this.ShowStatus("Loaded", "success");
    });
  }
}

const powerMenuManager = new PowerMenuManager();
export async function initPowerMenuSection(): Promise<void> { return powerMenuManager.init(); }
export function renderPowerMenuSection(container: HTMLElement): void { return powerMenuManager.renderSection(container); }