import type { BluetoothDevice, BluetoothStatusResult, WifiNetwork, WifiStatusResult } from "./types.ts";

interface SystemState {
  btStatus: BluetoothStatusResult;
  btDevices: BluetoothDevice[];
  btScanning: boolean;
  wifiStatus: WifiStatusResult;
  wifiNetworks: WifiNetwork[];
  wifiConnecting: string | null;
  wifiBusy: boolean;
  btBusy: boolean;
}

class SystemManager {
  private state: SystemState = {
    btStatus: { ok: false, powered: false, discovering: false, name: "Bluetooth" },
    btDevices: [],
    btScanning: false,
    wifiStatus: { ok: false, enabled: false, device: null, connection: null },
    wifiNetworks: [],
    wifiConnecting: null,
    wifiBusy: false,
    btBusy: false,
  };

  private btContainer: HTMLElement | null = null;
  private wifiContainer: HTMLElement | null = null;
  private pwdModal: HTMLElement | null = null;

  async init(): Promise<void> {
    const [btStatus, btDevices, wifiStatus] = await Promise.all([
      window.hypr.getBluetoothStatus().catch(() => this.state.btStatus),
      window.hypr.getBluetoothDevices().catch(() => ({ ok: false, devices: [] as BluetoothDevice[] })),
      window.hypr.getWifiStatus().catch(() => this.state.wifiStatus),
    ]);

    this.state.btStatus = btStatus;
    this.state.btDevices = btDevices.devices;
    this.state.wifiStatus = wifiStatus;

    if (wifiStatus.enabled) {
      const nets = await window.hypr.getWifiNetworks().catch(() => ({ ok: false, networks: [] as WifiNetwork[] }));
      this.state.wifiNetworks = nets.networks;
    }
  }

  private EscapeHtml(s: unknown): string {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private SignalBars(signal: number): string {
    const pct = Math.max(0, Math.min(100, signal));
    const bars = pct >= 80 ? 4 : pct >= 55 ? 3 : pct >= 30 ? 2 : 1;
    const color = pct >= 55 ? "var(--accent, #2dd4bf)" : pct >= 30 ? "#f59e0b" : "#ef4444";
    return `<span class="sys-signal-bars" title="${pct}%">
      ${[1, 2, 3, 4].map(b => `<span class="bar${b <= bars ? " on" : ""}" style="${b <= bars ? `background:${color}` : ""}"></span>`).join("")}
    </span>`;
  }

  private LockIcon(security: string): string {
    if (!security || security === "--" || security.toLowerCase() === "none") return "";
    return `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity:.6"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  }

  private BtIcon(device: BluetoothDevice): string {
    const icon = device.icon || "";
    if (icon.includes("headset") || icon.includes("headphone") || device.name.toLowerCase().includes("airpod") || device.name.toLowerCase().includes("headphone") || device.name.toLowerCase().includes("earphone")) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`;
    }
    if (icon.includes("keyboard") || device.name.toLowerCase().includes("keyboard")) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/></svg>`;
    }
    if (icon.includes("mouse") || device.name.toLowerCase().includes("mouse")) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 2v8"/></svg>`;
    }
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="6.5 6.5 17.5 17.5"/><polyline points="17.5 6.5 6.5 17.5"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/></svg>`;
  }

  private BuildPasswordModal(): string {
    return `
      <div id="sys-pwd-modal" class="sys-pwd-modal hidden">
        <div class="sys-pwd-backdrop"></div>
        <div class="sys-pwd-dialog">
          <h3 id="sys-pwd-title">Connect to Network</h3>
          <p id="sys-pwd-ssid" class="sys-pwd-ssid"></p>
          <input type="password" id="sys-pwd-input" class="sys-pwd-input" placeholder="Password" autocomplete="off" />
          <div class="sys-pwd-actions">
            <button class="tb-action" id="sys-pwd-cancel">Cancel</button>
            <button class="tb-action save" id="sys-pwd-ok">Connect</button>
          </div>
        </div>
      </div>`;
  }

  renderBluetoothSection(container: HTMLElement): void {
    this.btContainer = container;
    const { btStatus, btDevices, btScanning, btBusy } = this.state;

    const powered = btStatus.powered;
    const connectedDevices = btDevices.filter(d => d.connected);
    const pairedDevices = btDevices.filter(d => !d.connected);

    container.innerHTML = `
      <div class="sys-section">
        <div class="sys-panel">
          <div class="sys-panel-header">
            <div class="sys-panel-title-row">
              <div class="sys-panel-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <polyline points="6.5 6.5 17.5 17.5"/><polyline points="17.5 6.5 6.5 17.5"/>
                  <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                </svg>
              </div>
              <div>
                <div class="sys-panel-name">Bluetooth</div>
                <div class="sys-panel-sub ${powered ? "status-on" : "status-off"}">${!btStatus.ok ? "Not available" : powered ? (btScanning ? "Scanning…" : "On") : "Off"
      }</div>
              </div>
            </div>
            ${btStatus.ok ? `
              <label class="toggle-label">
                <input type="checkbox" id="bt-power-toggle" class="toggle-input" ${powered ? "checked" : ""} ${btBusy ? "disabled" : ""}>
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>` : `<span class="sys-unavail">Install bluez</span>`
      }
          </div>

          ${powered ? `
            <div class="sys-panel-body">
              <div class="sys-devices-toolbar">
                <button class="tb-action${btScanning ? " scanning" : ""}" id="bt-scan-btn" ${btBusy ? "disabled" : ""}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  ${btScanning ? "Scanning…" : "Scan for devices"}
                </button>
              </div>

              ${connectedDevices.length > 0 ? `
                <div class="sys-device-group-label">Connected</div>
                ${connectedDevices.map(d => this.BuildDeviceCard(d)).join("")}
              ` : ""}

              ${pairedDevices.length > 0 ? `
                <div class="sys-device-group-label">Paired</div>
                ${pairedDevices.map(d => this.BuildDeviceCard(d)).join("")}
              ` : ""}

              ${btDevices.length === 0 ? `
                <div class="sys-empty">No paired devices. Click Scan to discover nearby devices.</div>
              ` : ""}
            </div>
          ` : ""}
        </div>
      </div>`;

    this.BindBluetoothEvents();
  }

  private BuildDeviceCard(d: BluetoothDevice): string {
    return `
    <div class="sys-device-card ${d.connected ? "connected" : ""}">
      <div class="sys-device-icon">${this.BtIcon(d)}</div>
      <div class="sys-device-info">
        <div class="sys-device-name-row">
          <span class="sys-device-name">${this.EscapeHtml(d.name)}</span>
          <span class="sys-device-status-badge ${d.connected ? "badge-connected" : "badge-paired"}">
            ${d.connected ? "Connected" : "Paired"}
          </span>
        </div>
        <span class="sys-device-mac">${d.mac}</span>
      </div>
      <div class="sys-device-actions">
        ${d.connected
        ? `<button class="tb-action" data-bt-disconnect="${this.EscapeHtml(d.mac)}">Disconnect</button>`
        : `<button class="tb-action" data-bt-connect="${this.EscapeHtml(d.mac)}">Connect</button>`
      }
        <button class="tb-action tb-action--danger" data-bt-remove="${this.EscapeHtml(d.mac)}" title="Remove device">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>`;
  }

  private BindBluetoothEvents(): void {
    const container = this.btContainer;
    if (!container) return;

    container.querySelector<HTMLInputElement>("#bt-power-toggle")?.addEventListener("change", async (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.state.btBusy = true;
      this.renderBluetoothSection(container);
      const res = await window.hypr.setBluetoothPower(on);
      if (res.ok) {
        this.state.btStatus.powered = on;
        if (!on) this.state.btDevices = [];
        else {
          const devs = await window.hypr.getBluetoothDevices().catch(() => ({ ok: false, devices: [] as BluetoothDevice[] }));
          this.state.btDevices = devs.devices;
        }
      }
      this.state.btBusy = false;
      this.renderBluetoothSection(container);
    });

    container.querySelector<HTMLButtonElement>("#bt-scan-btn")?.addEventListener("click", async () => {
      this.state.btScanning = true;
      this.renderBluetoothSection(container);

      const res = await window.hypr.bluetoothScan().catch(() => ({ ok: false, devices: [] as BluetoothDevice[] }));

      if (res.ok && res.devices.length > 0) {
        // Filter out nameless/MAC-only BLE advertisers
        const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
        const named = res.devices.filter(d =>
          d.name &&
          d.name.trim() !== "" &&
          !MAC_RE.test(d.name.trim())
        );

        const paired = await window.hypr.getBluetoothDevices().catch(() => ({ ok: false, devices: [] as BluetoothDevice[] }));

        const pairedMacs = new Set(paired.devices.map(d => d.mac.toUpperCase()));

        const newDiscovered = named.filter(d => !pairedMacs.has(d.mac.toUpperCase()));
        const sanitized = newDiscovered.map(d => ({ ...d, connected: false }));

        this.state.btDevices = [...paired.devices, ...sanitized];
      }

      this.state.btScanning = false;
      this.renderBluetoothSection(container);
    });

    container.querySelectorAll<HTMLButtonElement>("[data-bt-connect]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const mac = btn.dataset.btConnect!;
        btn.textContent = "Connecting…";
        btn.disabled = true;
        await window.hypr.bluetoothConnect(mac).catch(() => { });
        const devs = await window.hypr.getBluetoothDevices().catch(() => ({ ok: false, devices: [] as BluetoothDevice[] }));
        this.state.btDevices = devs.devices;
        this.renderBluetoothSection(container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>("[data-bt-disconnect]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const mac = btn.dataset.btDisconnect!;
        btn.textContent = "Disconnecting…";
        btn.disabled = true;
        await window.hypr.bluetoothDisconnect(mac).catch(() => { });
        const devs = await window.hypr.getBluetoothDevices().catch(() => ({ ok: false, devices: [] as BluetoothDevice[] }));
        this.state.btDevices = devs.devices;
        this.renderBluetoothSection(container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>("[data-bt-remove]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const mac = btn.dataset.btRemove!;
        await window.hypr.bluetoothRemove(mac).catch(() => { });
        this.state.btDevices = this.state.btDevices.filter(d => d.mac !== mac);
        this.renderBluetoothSection(container);
      });
    });
  }

  renderWifiSection(container: HTMLElement): void {
    this.wifiContainer = container;
    const { wifiStatus, wifiNetworks, wifiConnecting, wifiBusy } = this.state;

    container.innerHTML = `
      <div class="sys-section">
        <div class="sys-panel">
          <div class="sys-panel-header">
            <div class="sys-panel-title-row">
              <div class="sys-panel-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/>
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>
                </svg>
              </div>
              <div>
                <div class="sys-panel-name">Wi-Fi</div>
                <div class="sys-panel-sub ${wifiStatus.enabled ? "status-on" : "status-off"}">${!wifiStatus.ok ? "Not available" :
        !wifiStatus.enabled ? "Off" :
          wifiStatus.connection ? wifiStatus.connection : "On — not connected"
      }</div>
              </div>
            </div>
          ${wifiStatus.ok ? `
            <div style="display:flex;align-items:center;gap:8px;">
              <label class="toggle-label">
                <input type="checkbox" id="wifi-power-toggle" class="toggle-input"
                  ${wifiStatus.enabled ? "checked" : ""}
                  ${wifiBusy ? "disabled" : ""}>
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
              ${wifiStatus.enabled ? `
                <button class="tb-action" id="wifi-rescan-btn" ${wifiBusy ? "disabled" : ""}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  Refresh
                </button>
                ${wifiStatus.connection ? `
                  <button class="tb-action tb-action--danger" id="wifi-disconnect-btn">Disconnect</button>
                ` : ""}
              ` : ""}
            </div>` : `<span class="sys-unavail">Install NetworkManager</span>`
          }
          </div>

          ${wifiStatus.ok && wifiStatus.enabled ? `
            <div class="sys-panel-body">
              ${wifiNetworks.length === 0 ? `
                <div class="sys-empty">No networks found. Click Refresh to scan.</div>
              ` : wifiNetworks.map(n => this.BuildNetworkRow(n, wifiConnecting)).join("")}
            </div>
          ` : ""}
        </div>
        ${this.BuildPasswordModal()}
      </div>`;

    this.BindWifiEvents();
  }

  private BuildNetworkRow(n: WifiNetwork, connecting: string | null): string {
    const isConnecting = connecting === n.ssid;
    return `
      <div class="sys-network-row ${n.active ? "active" : ""}">
        <div class="sys-network-info">
          ${this.SignalBars(n.signal)}
          <span class="sys-network-ssid">${this.EscapeHtml(n.ssid)}</span>
          ${this.LockIcon(n.security)}
          ${n.active ? `<span class="sys-network-badge">Connected</span>` : ""}
        </div>
        <div class="sys-network-actions">
          ${isConnecting ? `<span class="sys-connecting-label">Connecting…</span>` :
        n.active ? `<button class="tb-action tb-action--danger" data-wifi-forget="${this.EscapeHtml(n.ssid)}">Forget</button>` :
          `<button class="tb-action" data-wifi-connect="${this.EscapeHtml(n.ssid)}" data-wifi-secure="${n.security !== "--" && n.security !== "" ? "1" : "0"}">Connect</button>`
      }
        </div>
      </div>`;
  }

  private BindWifiEvents(): void {
    const container = this.wifiContainer;
    if (!container) return;

    container.querySelector<HTMLInputElement>("#wifi-power-toggle")?.addEventListener("change", async (e) => {
      const on = (e.target as HTMLInputElement).checked;

      this.state.wifiBusy = true;
      this.renderWifiSection(container);

      const res = await (window.hypr.setWifiPower as (on: boolean) => Promise<{ ok: boolean }>)(on)
        .catch(() => ({ ok: false }));

      if (res.ok) {
        this.state.wifiStatus.enabled = on;
        if (on) {
          const nets = await window.hypr.getWifiNetworks().catch(() => ({ ok: false, networks: [] as WifiNetwork[] }));
          this.state.wifiNetworks = nets.networks;
        } else {
          this.state.wifiNetworks = [];
          this.state.wifiStatus.connection = null;
        }
      } else {
        // Revert the toggle visually if the call failed
        (e.target as HTMLInputElement).checked = !on;
      }

      this.state.wifiBusy = false;
      this.renderWifiSection(container);
    });

    container.querySelector<HTMLButtonElement>("#wifi-rescan-btn")?.addEventListener("click", async () => {
      this.state.wifiBusy = true;
      this.renderWifiSection(container);
      const [statusRes, netsRes] = await Promise.all([
        window.hypr.getWifiStatus().catch(() => this.state.wifiStatus),
        window.hypr.getWifiNetworks().catch(() => ({ ok: false, networks: [] as WifiNetwork[] })),
      ]);
      this.state.wifiStatus = statusRes;
      this.state.wifiNetworks = netsRes.networks;
      this.state.wifiBusy = false;
      this.renderWifiSection(container);
    });

    container.querySelector<HTMLButtonElement>("#wifi-disconnect-btn")?.addEventListener("click", async () => {
      await window.hypr.wifiDisconnect().catch(() => { });
      this.state.wifiStatus.connection = null;
      const nets = await window.hypr.getWifiNetworks().catch(() => ({ ok: false, networks: [] as WifiNetwork[] }));
      this.state.wifiNetworks = nets.networks;
      this.renderWifiSection(container);
    });

    container.querySelectorAll<HTMLButtonElement>("[data-wifi-connect]").forEach(btn => {
      btn.addEventListener("click", () => {
        const ssid = btn.dataset.wifiConnect!;
        const secure = btn.dataset.wifiSecure === "1";
        if (secure) {
          this.ShowPasswordPrompt(ssid, container);
        } else {
          this.DoWifiConnect(ssid, undefined, container);
        }
      });
    });

    container.querySelectorAll<HTMLButtonElement>("[data-wifi-forget]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ssid = btn.dataset.wifiForget!;
        await window.hypr.wifiForget(ssid).catch(() => { });
        this.state.wifiStatus.connection = null;
        const nets = await window.hypr.getWifiNetworks().catch(() => ({ ok: false, networks: [] as WifiNetwork[] }));
        this.state.wifiNetworks = nets.networks;
        this.renderWifiSection(container);
      });
    });
  }

  private ShowPasswordPrompt(ssid: string, container: HTMLElement): void {
    const modal = container.querySelector<HTMLElement>("#sys-pwd-modal");
    const title = container.querySelector<HTMLElement>("#sys-pwd-ssid");
    const input = container.querySelector<HTMLInputElement>("#sys-pwd-input");
    const cancelBtn = container.querySelector<HTMLButtonElement>("#sys-pwd-cancel");
    const okBtn = container.querySelector<HTMLButtonElement>("#sys-pwd-ok");
    const backdrop = container.querySelector<HTMLElement>(".sys-pwd-backdrop");

    if (!modal || !input || !cancelBtn || !okBtn) return;

    if (title) title.textContent = ssid;
    input.value = "";
    modal.classList.remove("hidden");
    input.focus();

    const close = (): void => { modal.classList.add("hidden"); };

    const onOk = (): void => {
      const pwd = input.value;
      close();
      this.DoWifiConnect(ssid, pwd || undefined, container);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter") onOk();
      if (e.key === "Escape") close();
    };

    okBtn.onclick = onOk;
    cancelBtn.onclick = close;
    if (backdrop) backdrop.onclick = close;
    input.addEventListener("keydown", onKey, { once: true });
  }

  private async DoWifiConnect(ssid: string, password: string | undefined, container: HTMLElement): Promise<void> {
    this.state.wifiConnecting = ssid;
    this.renderWifiSection(container);

    const res = await window.hypr.wifiConnect(ssid, password).catch(() => ({ ok: false, error: "Connection failed" }));

    this.state.wifiConnecting = null;

    if (res.ok) {
      const [statusRes, netsRes] = await Promise.all([
        window.hypr.getWifiStatus().catch(() => this.state.wifiStatus),
        window.hypr.getWifiNetworks().catch(() => ({ ok: false, networks: [] as WifiNetwork[] })),
      ]);
      this.state.wifiStatus = statusRes;
      this.state.wifiNetworks = netsRes.networks;
    }

    this.renderWifiSection(container);
  }
}

const systemManager = new SystemManager();

export async function initSystemSection(): Promise<void> {
  return systemManager.init();
}

export function renderBluetoothSection(container: HTMLElement): void {
  return systemManager.renderBluetoothSection(container);
}

export function renderWifiSection(container: HTMLElement): void {
  return systemManager.renderWifiSection(container);
}