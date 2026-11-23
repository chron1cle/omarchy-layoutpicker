// Unit tests for Model.js.
//
// Run directly:  node tests/model_test.js
//
// Model.js opens with `.pragma library`, which Node cannot parse. The pragma
// is stripped and the rest evaluated so the functions match the QML import.

var fs = require("fs")
var path = require("path")
var vm = require("vm")

var SRC = fs.readFileSync(path.join(__dirname, "..", "Model.js"), "utf8")
  .replace(/^\.pragma\s+library\s*$/m, "")
var ctx = {}
vm.createContext(ctx)
vm.runInContext(SRC, ctx, { filename: "Model.js" })

var failures = []
var checks = 0

function ok(cond, msg) {
  checks++
  if (!cond) failures.push(msg)
}

function eq(actual, expected, msg) {
  checks++
  if (actual !== expected) {
    failures.push(msg + "\n      expected: " + JSON.stringify(expected)
      + "\n      actual:   " + JSON.stringify(actual))
  }
}

// --- patterns ---------------------------------------------------------------

var ids = ctx.patternIds()
eq(ids.length, ctx.PATTERNS.length, "patternIds covers every pattern")
eq(new Set(ids).size, ids.length, "pattern ids are unique")
ctx.PATTERNS.forEach(function (p) {
  ok(typeof p.id === "string" && /^[a-z][a-z-]*$/.test(p.id), "id shape: " + p.id)
  ok(Number.isInteger(p.cols) && p.cols >= 1 && p.cols <= 3, "cols bounded: " + p.id)
  ok(Number.isInteger(p.rows) && p.rows >= 1 && p.rows <= 3, "rows bounded: " + p.id)
  if (p.master) ok(["left", "right", "top", "bottom"].indexOf(p.side) >= 0, "master side: " + p.id)
  eq(ctx.patternById(p.id), p, "patternById round trip: " + p.id)
})
eq(ctx.patternById("nope"), null, "patternById rejects unknown ids")
eq(ctx.patternById("__proto__"), null, "patternById rejects prototype keys")

// --- workspace validation ---------------------------------------------------

eq(ctx.validWorkspace("12"), "12", "plain id accepted")
eq(ctx.validWorkspace(2), "2", "number id accepted")
eq(ctx.validWorkspace("9999"), "9999", "four digits accepted")
eq(ctx.validWorkspace("0"), null, "zero rejected")
eq(ctx.validWorkspace("-3"), null, "negative rejected")
eq(ctx.validWorkspace("1.5"), null, "decimal rejected")
eq(ctx.validWorkspace("1e2"), null, "exponent rejected")
eq(ctx.validWorkspace("12; rm -rf /"), null, "shell text rejected")
eq(ctx.validWorkspace("special:scratch"), null, "special workspace rejected")
eq(ctx.validWorkspace(""), null, "empty rejected")

// --- commands ---------------------------------------------------------------

var cmd = ctx.applyCommand("12", "columns")
ok(Array.isArray(cmd), "applyCommand returns an argv array")
eq(cmd[0], "hyprctl", "apply runs hyprctl")
eq(cmd[1], "eval", "apply uses eval")
var lua = cmd[2]
ok(lua.indexOf('hl.layout.register("joshlp_columns"') >= 0, "apply registers the provider")
ok(lua.indexOf('__joshlp["columns"]') >= 0, "apply guards duplicate registration")
ok(lua.indexOf('workspace = "12"') >= 0, "apply names the workspace")
ok(lua.indexOf('layout = "lua:joshlp_columns"') >= 0, "apply points the rule at the provider")
ok(lua.indexOf("io.open") >= 0, "apply saves the state file")
ok(lua.indexOf("grid_cell") >= 0, "grid placement uses grid_cell")
eq(ctx.applyCommand("12", "nope"), null, "apply rejects unknown patterns")
eq(ctx.applyCommand("12; rm -rf /", "columns"), null, "apply rejects bad workspaces")

var master = ctx.applyCommand("3", "master-left")[2]
ok(master.indexOf('ctx:split(ctx.area, "left", 0.5)') >= 0, "master-left splits left")
ok(master.indexOf('ctx:split(ctx.area, "right", 0.5)') >= 0, "master-left keeps the rest")
var mtop = ctx.applyCommand("3", "master-top")[2]
ok(mtop.indexOf('ctx:split(ctx.area, "top", 0.5)') >= 0, "master-top splits top")
ok(mtop.indexOf('ctx:split(ctx.area, "bottom", 0.5)') >= 0, "master-top keeps the rest")

var clr = ctx.clearCommand("12")
eq(clr[0], "hyprctl", "clear runs hyprctl")
ok(clr[2].indexOf('layout = "dwindle"') >= 0, "clear restores dwindle")
ok(clr[2].indexOf("os.remove") >= 0, "clear deletes the state file")
eq(ctx.clearCommand("bad"), null, "clear rejects bad workspaces")

var st = ctx.statusCommand()
eq(st[0], "sh", "status is a fixed shell command")
ok(st[2].indexOf("activeworkspace") >= 0 && st[2].indexOf("workspaces") >= 0, "status reads both")
ok(st[2].indexOf("cat ") >= 0, "status reads the state file")
ok(st[2].indexOf(ctx.SEP) >= 0, "status separates the reports")

// --- state file -------------------------------------------------------------

var state = ctx.stateFileLua("12", ctx.patternById("grid"))
ok(state.indexOf('hl.layout.register("joshlp_grid"') >= 0, "state file registers")
ok(state.indexOf('workspace = "12"') >= 0, "state file names the workspace")
ok(state.indexOf("]==]") < 0 || state.indexOf("]==]") > state.indexOf("if pf then"), "state content closes its long bracket last")

// --- status parsing ---------------------------------------------------------

var stateRule = 'hl.workspace_rule({ workspace = "12", layout = "lua:joshlp_master-top" })'
var sample = '{"id": 12, "name": "12"}' + ctx.SEP
  + '[{"id": 2, "tiledLayout": "dwindle"}, {"id": 12, "tiledLayout": "lua:joshlp_three-columns"}]'
  + ctx.SEP + stateRule
var cur = ctx.parseCurrent(sample)
ok(cur !== null, "parseCurrent reads the sample")
eq(cur.workspace, "12", "parseCurrent finds the active workspace")
eq(cur.pattern, "master-top", "parseCurrent trusts the state file over the reported name")

var noState = ctx.parseCurrent('{"id": 12}' + ctx.SEP
  + '[{"id": 12, "tiledLayout": "lua:joshlp_grid"}]' + ctx.SEP + "")
eq(noState.pattern, "grid", "parseCurrent falls back to the reported layout")

var plain = ctx.parseCurrent('{"id": 2}' + ctx.SEP
  + '[{"id": 2, "tiledLayout": "dwindle"}]' + ctx.SEP + stateRule)
eq(plain.pattern, "", "a plain layout wins over a stale state file")

var plain2 = ctx.parseCurrent('{"id": 2}' + ctx.SEP + '[{"id": 2, "tiledLayout": "dwindle"}]' + ctx.SEP)
eq(plain2.pattern, "", "plain layouts report no pattern")
eq(ctx.parseCurrent("garbage"), null, "parseCurrent rejects garbage")
eq(ctx.parseCurrent(""), null, "parseCurrent rejects empty input")
eq(ctx.parseCurrent("{" + ctx.SEP + "[]"), null, "parseCurrent rejects broken json")

eq(ctx.patternForLayout("lua:joshlp_grid"), "grid", "patternForLayout maps known layouts")
eq(ctx.patternForLayout("dwindle"), "", "patternForLayout ignores plain layouts")
eq(ctx.patternForLayout("lua:evil"), "", "patternForLayout ignores foreign layouts")

// --- previews ---------------------------------------------------------------

ctx.PATTERNS.forEach(function (p) {
  var cells = ctx.previewCells(p)
  ok(cells.length >= 2, "preview has cells: " + p.id)
  var area = 0
  cells.forEach(function (c) {
    ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1.0000001 && c.y + c.h <= 1.0000001,
      "preview cell inside the area: " + p.id)
    area += c.w * c.h
  })
  ok(Math.abs(area - 1) < 1e-9, "preview tiles the whole area: " + p.id)
})
eq(ctx.previewCells(null).length, 0, "preview of nothing is empty")

// --- clipping ---------------------------------------------------------------

eq(ctx.clipText("ab<cd", 3), "ab<", "clipText truncates")
eq(ctx.clipText("a\tb\nc", 10), "a\tb\nc", "clipText keeps safe control chars")
eq(ctx.clipText("a\u0000b", 10), "ab", "clipText drops other control chars")
eq(ctx.clipText(42, 10), "", "clipText rejects non-strings")

// --- report -----------------------------------------------------------------

if (failures.length > 0) {
  console.log(failures.length + " of " + checks + " checks failed:")
  failures.forEach(function (f) { console.log("  - " + f) })
  process.exit(1)
}
console.log("all " + checks + " checks passed")
