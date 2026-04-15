# HyprEditor

A visual, desktop GUI editor for [Hyprland](https://hyprland.org/) configuration — built with Electron for CachyOS / Arch Linux.

## Features

- **Auto-detects** `~/.config/hypr/hyprland.conf`
- **Sliders** for numeric values (blur size, gaps, rounding, opacity…)
- **Toggles** for boolean settings
- **Dropdowns** for enum options (layout, accel profile, orientation…)
- **Color pickers** for border and shadow colors
- **List editors** for bindings, exec-once, window rules, env vars, and more
- **Live search** across all config keys and values
- **In-place editing** — comments and formatting are preserved
- **Auto backup** — saves a `.hypreditor.bak` before every write

## Install

```bash
git clone https://github.com/kusoidev/HyprEditor HyprEditor
cd HyprEditor
chmod +x install.sh
./install.sh
```

Then run:
```bash
hypreditor
```

## Manual Run (dev)

```bash
npm install
npm start
# or with devtools:
npm run dev
```

## Sections

| Category | Settings |
|---|---|
| Appearance | General, Decoration, Blur, Shadow |
| Animations | Animation rules, Bezier curves |
| Layouts | Dwindle, Master |
| Input | Keyboard, Mouse, Touchpad, Gestures |
| Monitor | Monitor rules |
| Env Variables | Environment variables |
| Miscellaneous | Misc, Cursor |
| Window Rules | windowrule, windowrulev2 |
| Layer Rules | layerrule |
| Keybindings | bind, binde, bindm, bindl, bindr + bind settings |
| AutoStart | exec-once, exec |
| Permissions | permission rules |
| Includes | source directives |

## Config Editing

- **Sliders / Toggles / Selects**: Change updates in-memory immediately. Click **Save** to write to disk.
- **Text fields**: Debounced — auto-updates after 600ms of no typing.
- **List entries**: Click **Add** to append a new entry, edit inline, click **✕** to remove (line is commented out, not deleted).
- **"not set"** badge: The key wasn't found in your config. Editing it will append to the file.

## Backup & Safety

Every time you save, the original is copied to `<config>.hypreditor.bak`. You can restore it with:
```bash
cp ~/.config/hypr/hyprland.conf.hypreditor.bak ~/.config/hypr/hyprland.conf
```

## Requirements

- Node.js 18+
- npm
- Electron (installed automatically by `npm install`)
