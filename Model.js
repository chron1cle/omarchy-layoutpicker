.pragma library

// Layout picker core for the Omarchy shell.
//
// Every command built here is a fixed string. The only variable parts are
// the workspace id, which must be a plain positive integer, and the pattern
// id, which must be one of PATTERNS below. Text from Hyprland output, from
// window titles, or from the panel is never pasted into a command.
//
// A pattern works by registering a small Lua layout provider with Hyprland
// (hl.layout.register) and pointing the workspace's layout rule at it
// (hl.workspace_rule with layout = "lua:<name>"). The provider recomputes
// every window's rectangle whenever the workspace changes, so new windows
// keep the pattern. The same Lua is also written to a state file under
// ~/.local/state/omarchy/layoutpicker/, which the user's Hyprland config
// loads at startup, so a pattern survives a Hyprland restart or reload.

var REG_PREFIX = "joshlp_"
var STATE_SUBDIR = "/omarchy/layoutpicker"
var SEP = "@SEP@"

// Each pattern arranges every tiled window on the workspace.
// "cols"/"rows" bound a plain grid: windows fill row by row, and the grid
// widens if there are more windows than rows allows. A "master" pattern
// puts the first window on one side at half width and stacks the rest
// along the other side.
var PATTERNS = [
  { id: "columns", cols: 2, rows: 1, master: false },
  { id: "three-columns", cols: 3, rows: 1, master: false },
  { id: "rows", cols: 1, rows: 2, master: false },
  { id: "three-rows", cols: 1, rows: 3, master: false },
  { id: "master-left", cols: 2, rows: 1, master: true, side: "left" },
  { id: "master-top", cols: 1, rows: 2, master: true, side: "top" },
  { id: "grid", cols: 2, rows: 2, master: false }
]

function patternIds() {
  var ids = []
  for (var i = 0; i < PATTERNS.length; i++) ids.push(PATTERNS[i].id)
  return ids
}

function patternById(id) {
  if (typeof id !== "string") return null
  for (var i = 0; i < PATTERNS.length; i++) {
    if (PATTERNS[i].id === id) return PATTERNS[i]
  }
  return null
}

// Only plain workspace ids, one to four digits. Special workspaces such as
// the scratchpad are rejected.
function validWorkspace(wsId) {
  var s = String(wsId)
  if (!/^[1-9][0-9]{0,3}$/.test(s)) return null
  return s
}

function providerName(patternId) {
  return REG_PREFIX + patternId
}

function layoutValue(patternId) {
  return "lua:" + providerName(patternId)
}

function patternForLayout(layoutName) {
  if (typeof layoutName !== "string") return ""
  for (var i = 0; i < PATTERNS.length; i++) {
    if (layoutName === layoutValue(PATTERNS[i].id)) return PATTERNS[i].id
  }
  return ""
}

function isMasterVertical(p) {
  return p.side === "left" || p.side === "right"
}

// The Lua body that places one window per target. ctx is the layout
// context: ctx.area, ctx.targets (1-based), ctx:grid_cell(i, cols, rows),
// ctx:split(box, side, ratio). All indices are 1-based.
function placementBody(p) {
  var lines = [
    "local ts = ctx.targets",
    "local n = #ts",
    "if n == 0 then return end",
    "if n == 1 then ts[1]:place(ctx.area) return end"
  ]
  if (p.master) {
    var opposite = p.side === "left" ? "right" : p.side === "right" ? "left" : p.side === "top" ? "bottom" : "top"
    lines.push('local master = ctx:split(ctx.area, "' + p.side + '", 0.5)')
    lines.push('local rest = ctx:split(ctx.area, "' + opposite + '", 0.5)')
    lines.push("ts[1]:place(master)")
    lines.push("local stack = n - 1")
    lines.push("for i = 2, n do")
    lines.push("local k = i - 2")
    if (isMasterVertical(p)) {
      lines.push("ts[i]:place({ x = rest.x, y = rest.y + rest.h * k / stack, w = rest.w, h = rest.h / stack })")
    } else {
      lines.push("ts[i]:place({ x = rest.x + rest.w * k / stack, y = rest.y, w = rest.w / stack, h = rest.h })")
    }
    lines.push("end")
  } else {
    lines.push("local cols = " + p.cols)
    lines.push("local rows = " + p.rows)
    lines.push("local groups = math.ceil(n / cols)")
    lines.push("if groups > rows then cols = math.ceil(n / rows) groups = rows end")
    lines.push("for i = 1, n do")
    lines.push("local k = i - 1")
    lines.push("local c = k % cols")
    lines.push("local r = math.floor(k / cols)")
    lines.push("ts[i]:place(ctx:grid_cell(r * cols + c + 1, cols, groups))")
    lines.push("end")
  }
  return lines.join("\n")
}

// Registers the provider once per Lua state. Hyprland refuses a duplicate
// name, and the guard keeps re-applying a pattern quiet. A config reload
// clears both the guard and the providers, so re-registration works there.
function providerLua(p) {
  return "__joshlp = __joshlp or {}\n"
    + 'if not __joshlp["' + p.id + '"] then\n'
    + '  __joshlp["' + p.id + '"] = true\n'
    + '  hl.layout.register("' + providerName(p.id) + '", { recalculate = function(ctx)\n'
    + placementBody(p) + "\n"
    + "end })\n"
    + "end\n"
}

function ruleLua(ws, p) {
  return 'hl.workspace_rule({ workspace = "' + ws + '", layout = "' + layoutValue(p.id) + '" })\n'
}

// The full contents of the per-workspace state file. The user's Hyprland
// config requires every file in the directory at startup.
function stateFileLua(ws, p) {
  return "-- Layout picker: workspace " + ws + " uses the \"" + p.id + "\" pattern.\n"
    + "-- Written by the josh.layoutpicker shell plugin. Delete this file to\n"
    + "-- stop restoring the pattern for this workspace.\n"
    + providerLua(p)
    + ruleLua(ws, p)
}

// Lua that saves the state file. Runs inside Hyprland's Lua state, so the
// directory has to already exist; the shell plugin creates it at startup.
// If the write fails the pattern still applies for this session.
function stateWriterLua(ws, p) {
  var content = stateFileLua(ws, p)
  return "local dir = (os.getenv(\"XDG_STATE_HOME\") or ((os.getenv(\"HOME\") or \"/tmp\") .. \"/.local/state\")) .. \"" + STATE_SUBDIR + "\"\n"
    + "local pf = io.open(dir .. \"/" + ws + ".lua\", \"w\")\n"
    + "if pf then pf:write([==[" + content + "]==]) pf:close() end\n"
}

function stateMkdirCommand() {
  return ["sh", "-c", "mkdir -p \"${XDG_STATE_HOME:-$HOME/.local/state}" + STATE_SUBDIR + "\""]
}

function applyCommand(wsId, patternId) {
  var ws = validWorkspace(wsId)
  var p = patternById(patternId)
  if (!ws || !p) return null
  return ["hyprctl", "eval", providerLua(p) + stateWriterLua(ws, p) + ruleLua(ws, p)]
}

// Returns the workspace to plain dwindle tiling and forgets the saved
// pattern. The provider stays registered; an unused one does no harm.
function clearCommand(wsId) {
  var ws = validWorkspace(wsId)
  if (!ws) return null
  var lua = 'hl.workspace_rule({ workspace = "' + ws + '", layout = "dwindle" })\n'
    + "local dir = (os.getenv(\"XDG_STATE_HOME\") or ((os.getenv(\"HOME\") or \"/tmp\") .. \"/.local/state\")) .. \"" + STATE_SUBDIR + "\"\n"
    + "os.remove(dir .. \"/" + ws + ".lua\")\n"
  return ["hyprctl", "eval", lua]
}

// One fixed shell command that reports the active workspace id, every
// workspace's tiled layout, and the saved state file for the active
// workspace, separated by SEP. Hyprland names lua layouts by their C++
// type, so with several registered it reports the first one's name for all
// of them; the state file is the reliable record of what was picked.
function statusCommand() {
  var script = "a=$(hyprctl activeworkspace -j); printf '%s' \"$a\"; printf '" + SEP + "'; "
    + "hyprctl workspaces -j; printf '" + SEP + "'; "
    + "id=$(printf '%s' \"$a\" | sed -n 's/.*\"id\": *\\([0-9][0-9]*\\).*/\\1/p'); "
    + "cat \"${XDG_STATE_HOME:-$HOME/.local/state}" + STATE_SUBDIR + "/$id.lua\" 2>/dev/null; true"
  return ["sh", "-c", script]
}

// Reads the status output into { workspace, pattern }. pattern is "" when
// the workspace uses a plain layout. Returns null on unparsable output.
function parseCurrent(text) {
  var parts = String(text || "").split(SEP)
  if (parts.length < 2) return null
  var active = null
  var workspaces = null
  try {
    active = JSON.parse(parts[0])
    workspaces = JSON.parse(parts[1])
  } catch (e) {
    return null
  }
  if (!active || typeof active.id !== "number") return null
  var layout = ""
  if (Array.isArray(workspaces)) {
    for (var i = 0; i < workspaces.length; i++) {
      if (workspaces[i] && workspaces[i].id === active.id) {
        layout = workspaces[i].tiledLayout
        break
      }
    }
  }
  var pattern = ""
  if (typeof layout === "string" && layout.indexOf("lua:") === 0) {
    // A lua layout is active but its reported name may belong to another
    // lua layout. Prefer the rule saved in the state file.
    var m = /layout = "lua:([a-z0-9_-]+)"/.exec(String(parts[2] || ""))
    if (m) pattern = patternForLayout("lua:" + m[1])
    if (pattern === "") pattern = patternForLayout(layout)
  }
  return { workspace: String(active.id), pattern: pattern }
}

// Normalized rectangles for the panel preview of a pattern, using a
// representative number of windows. Values are 0..1 fractions of the area.
function previewCells(p) {
  var cells = []
  if (!p) return cells
  if (p.master) {
    var vertical = isMasterVertical(p)
    if (vertical) {
      cells.push({ x: 0, y: 0, w: 0.5, h: 1 })
      cells.push({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
      cells.push({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
    } else {
      cells.push({ x: 0, y: 0, w: 1, h: 0.5 })
      cells.push({ x: 0, y: 0.5, w: 0.5, h: 0.5 })
      cells.push({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
    }
    return cells
  }
  var count = p.cols * p.rows
  for (var i = 0; i < count; i++) {
    var c = i % p.cols
    var r = Math.floor(i / p.cols)
    cells.push({ x: c / p.cols, y: r / p.rows, w: 1 / p.cols, h: 1 / p.rows })
  }
  return cells
}

function clipText(value, max) {
  if (typeof value !== "string") return ""
  var limit = max > 0 ? max : 0
  var out = ""
  for (var i = 0; i < value.length && out.length < limit; i++) {
    var c = value.charCodeAt(i)
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue
    out += value.charAt(i)
  }
  return out
}
