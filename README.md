# HyprEditor

A visual desktop editor for Hyprland configuration files.

HyprEditor is a personal free-time project built as an alternative to manually editing `hyprland.conf` in a terminal or text editor. It is still early, still being polished, and not every part of Hyprland is covered perfectly yet — but the goal is to make common configuration changes easier, safer, and more approachable. [file:36][file:39]

## Status

HyprEditor is currently **early-stage** and under active development in my spare time. Expect rough edges, incomplete previews, and parts of the UI that will improve over time. [file:36][file:39]

If you prefer editing your config by hand, that workflow is still valid. HyprEditor is meant to be an alternative for people who want sliders, toggles, pickers, and searchable sections instead of constantly jumping between config files and documentation. [file:39]

## What it does

- Auto-detects `~/.config/hypr/hyprland.conf` when possible. [file:36]
- Loads sourced / included config files alongside the main config. [file:36]
- Provides sliders for numeric settings such as gaps, rounding, blur, opacity, cursor values, and more. [file:39][file:36]
- Provides toggles for boolean settings and dropdowns for select-style options. [file:39][file:36]
- Includes color pickers for things like borders, shadows, glow, splash colors, and other color-backed settings. [file:39][file:36]
- Supports list-style entries like binds, exec rules, env vars, source directives, monitor rules, permissions, and more. [file:39][file:36]
- Includes live search across config keys and values. [file:36]
- Preserves the config as editable lines in memory instead of regenerating the entire file from scratch. [file:36]
- Creates a `.hypreditor.bak` backup when saving. [file:36]

## Current scope

HyprEditor currently includes editable sections for:

- Appearance: General, Decoration, Blur, Shadow, Glow. [file:39]
- Animations: Animation settings, bezier curves, animation rules. [file:39]
- Layouts: Layout core, Dwindle, Master, Groups. [file:39]
- Input: Keyboard, Mouse, Touchpad, Gestures, device-related blocks, virtual keyboard. [file:39]
- System / Devices: Monitor rules, XWayland, environment variables. [file:39]
- Misc / Behavior: Misc, Cursor, Render, OpenGL, Ecosystem, Experimental, Debug. [file:39]
- Rules: Window rules and layer rules. [file:39]
- Keybindings: bind settings and multiple bind entry types. [file:39]
- Startup / Permissions / Includes: `exec`, `exec-once`, permission rules, and `source` directives. [file:39]

## Install

```bash
git clone https://github.com/kusoidev/HyprEditor.git
cd HyprEditor
chmod +x install.sh
./install.sh
```

Then run:

```bash
hypreditor
```

## Development

```bash
npm install
npm start
```

With devtools:

```bash
npm run dev
```

## Editing behavior

- Slider, toggle, select, and color changes update the in-memory representation immediately.
- Text input updates are debounced briefly before being applied.
- Missing settings can be inserted with **Auto-set** before editing them.
- List entries can be added inline and removed by commenting them out until save.
- Some settings may ask for confirmation before applying riskier changes.

## Backup & safety

Each save creates a backup of the original config as:

```bash
~/.config/hypr/hyprland.conf.hypreditor.bak
```

You can restore it with:

```bash
cp ~/.config/hypr/hyprland.conf.hypreditor.bak ~/.config/hypr/hyprland.conf
```

## Limitations

- This project is still incomplete and being polished.
- Some advanced Hyprland rules are still edited as raw list entries instead of richer structured editors.
- Live preview is currently partial and mainly intended as a visual estimate, not a perfect representation.
- Hyprland changes quickly, so schema coverage and wording may lag behind upstream changes until updated.

## Why this exists

I made this because manually editing Hyprland configs in the terminal gets repetitive, especially for settings that are easier to understand as sliders, toggles, grouped sections, and searchable controls. [file:39] HyprEditor is my attempt to make that workflow easier without taking away the ability to still work with normal Hyprland config files. [file:36][file:39]

## Contributing

Issues, suggestions, and pull requests are welcome.

If something is inaccurate, outdated, or missing from the schema, feel free to open an issue. Hyprland evolves fast, and keeping editors like this up to date takes ongoing work. [file:39]

## Requirements

- Linux
- Node.js 18+
- npm
- Electron (installed automatically through `npm install`)