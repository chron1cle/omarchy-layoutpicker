# omarchy-layoutpicker

A bar widget for the [Omarchy](https://omarchy.org) shell that applies tiling
layout patterns to the current Hyprland workspace. Click the grid icon in the
bar and pick a pattern:

- Two columns / Three columns
- Two rows / Three rows
- Master left / Master top (first window takes half the screen, the rest stack along the other half)
- Grid (2x2)

The active pattern is highlighted, new windows keep joining the pattern, and
**Normal tiling** returns the workspace to plain dwindle.

Keyboard: arrow keys move, Enter applies, Esc closes, Tab switches panels.

## How it works

Picking a pattern registers a small Lua layout provider with Hyprland
(`hl.layout.register`) and points the workspace's layout rule at it
(`hl.workspace_rule` with `layout = "lua:..."`). The provider recomputes every
window's rectangle whenever the workspace changes, so the pattern holds as
windows come and go. The choice is saved per workspace under
`~/.local/state/omarchy/layoutpicker/` and restored when Hyprland reloads.

Requirements: Hyprland 0.56 or newer (the Lua layout provider API) and the
Omarchy shell.

## Install

Clone this folder into the Omarchy user plugins directory. The folder name
must be `josh.layoutpicker`:

```sh
git clone https://github.com/chron1cle/omarchy-layoutpicker \
  ~/.config/omarchy/plugins/josh.layoutpicker
```

Then add the state-file loader so saved patterns survive a Hyprland restart.
Create `~/.config/hypr/layoutpicker.lua`:

```lua
-- Restore layout patterns saved by the josh.layoutpicker shell plugin.
local paths = require("default.hypr.paths")
local require_all = require("default.hypr.require_all")

local layouts_dir = paths.state_home .. "/omarchy/layoutpicker"
package.path = paths.state_home .. "/?.lua;" .. package.path
require_all.files(layouts_dir, "omarchy.layoutpicker", { reload = true })
```

and require it from `~/.config/hypr/hyprland.lua`, after the other `require`
lines:

```lua
require("hypr.layoutpicker")
```

Finally enable the widget: add `{"id": "josh.layoutpicker"}` to a section of
`bar.layout` in `~/.config/omarchy/shell.json` (the shell hot-reloads on
save), or add it from the shell settings panel.

## Notes

- Hyprland reports the first registered Lua layout's name for all Lua
  layouts in `hyprctl workspaces`, so the widget detects the current pattern
  from the saved state file rather than that name.
- All commands the widget runs are fixed strings; only a validated workspace
  id and a pattern id from the built-in list ever reach `hyprctl`.
- Patterns are per workspace and independent of Omarchy's own SUPER+L
  workspace-mode cycler. If both set a layout for the same workspace, the
  layout-picker pattern wins because its state file loads last.

## Tests

The logic lives in `Model.js` (pure functions, no QML):

```sh
node tests/model_test.js
```

## Layout

| File | Purpose |
| --- | --- |
| `manifest.json` | Plugin manifest (`bar-widget` kind) |
| `Panel.qml` | Bar icon, pattern grid, keyboard handling |
| `Model.js` | Pattern definitions, command builders, status parsing |
| `i18n/en.json` | Display strings |
| `tests/model_test.js` | Unit tests for `Model.js` |
