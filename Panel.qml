import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// Bar widget for tiling layout patterns.
//
// The panel lists fixed patterns; picking one runs a fixed hyprctl command
// that registers a small Lua layout with Hyprland and points the current
// workspace at it. Reset returns the workspace to plain dwindle tiling.
// All text from hyprctl is parsed for a workspace id and a layout name and
// is only ever displayed after that.
Panel {
  id: root
  moduleName: "josh.layoutpicker"
  ipcTarget: "josh.layoutpicker"
  manageIpc: false

  Commons.Translations {
    id: strings
    directory: Qt.resolvedUrl("i18n")
  }

  property string workspaceId: ""
  property string currentPattern: ""
  property string noteKey: ""
  property string noteDetail: ""
  property string noteArg: ""
  property int patternIndex: 0
  property string pendingName: ""

  readonly property var patterns: Model.PATTERNS
  readonly property bool busy: applyProc.running || clearProc.running
  readonly property bool verticalBar: bar ? bar.vertical : false
  readonly property string fontFamily: bar && bar.fontFamily ? bar.fontFamily : Style.font.family
  readonly property int lastAction: patterns.length
  readonly property string noteText: {
    if (noteDetail !== "") return noteDetail
    if (noteKey === "note.applied") return strings.t(noteKey).arg(noteArg)
    if (noteKey !== "") return strings.t(noteKey)
    return ""
  }
  readonly property string currentText: currentPattern !== ""
    ? strings.t("current.pattern").arg(strings.t("pattern." + currentPattern))
    : strings.t("current.none")
  readonly property string workspaceText: workspaceId !== ""
    ? strings.t("panel.workspace").arg(workspaceId)
    : ""

  function refresh() {
    if (!statusProc.running) statusProc.running = true
  }

  function ingestStatus(text) {
    var cur = Model.parseCurrent(text)
    if (!cur) return
    workspaceId = cur.workspace
    currentPattern = cur.pattern
  }

  function applyPattern(patternId) {
    if (busy) return
    var cmd = Model.applyCommand(workspaceId, patternId)
    if (!cmd) {
      noteKey = "note.noWorkspace"
      noteDetail = ""
      return
    }
    applyProc.command = cmd
    pendingName = strings.t("pattern." + patternId)
    noteKey = ""
    noteDetail = ""
    applyProc.running = true
  }

  function resetLayout() {
    if (busy) return
    var cmd = Model.clearCommand(workspaceId)
    if (!cmd) {
      noteKey = "note.noWorkspace"
      noteDetail = ""
      return
    }
    clearProc.command = cmd
    noteKey = ""
    noteDetail = ""
    clearProc.running = true
  }

  function activateIndex() {
    if (patternIndex < patterns.length) applyPattern(patterns[patternIndex].id)
    else resetLayout()
  }

  onOpenedChanged: if (opened) {
    patternIndex = 0
    refresh()
    Qt.callLater(function() {
      if (panel.loadedContent) panel.loadedContent.forceActiveFocus()
    })
  }

  Component.onCompleted: {
    mkdirProc.running = true
    refresh()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Timer {
    interval: 1500
    repeat: true
    running: root.opened
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Process {
    id: mkdirProc
    command: Model.stateMkdirCommand()
  }

  Process {
    id: statusProc
    command: Model.statusCommand()
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.ingestStatus(text)
    }
  }

  Process {
    id: applyProc
    property bool settled: true
    command: []
    stderr: StdioCollector {
      id: applyErr
      waitForEnd: true
    }
    onStarted: settled = false
    onExited: function(exitCode) {
      if (settled) return
      settled = true
      if (exitCode !== 0) {
        root.noteKey = "note.failed"
        root.noteDetail = Model.clipText(String(applyErr.text || ""), 240)
      } else {
        root.noteKey = "note.applied"
        root.noteDetail = ""
        root.noteArg = root.pendingName
      }
      root.pendingName = ""
      root.refresh()
    }
  }

  Process {
    id: clearProc
    command: []
    stderr: StdioCollector {
      id: clearErr
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        root.noteKey = "note.failed"
        root.noteDetail = Model.clipText(String(clearErr.text || ""), 240)
      } else {
        root.noteKey = ""
        root.noteDetail = ""
      }
      root.refresh()
    }
  }

  ShellIpc {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function status(): string { return root.currentPattern }
  }

  // A small layout glyph: one pane on the left, two stacked on the right.
  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    slotSize: Style.bar.iconSlot
    dimmed: root.currentPattern === ""
    tooltipText: ""
    iconComponent: Component {
      Item {
        id: glyph
        width: 32
        height: 32
        implicitWidth: 32
        implicitHeight: 32

        readonly property color ink: root.barForeground

        Rectangle {
          anchors.fill: parent
          anchors.margins: 3
          radius: 5
          color: "transparent"
          border.width: 2.6
          border.color: glyph.ink
        }
        Rectangle {
          x: 3 + 26 * 0.45 - 1.3
          y: 3
          width: 2.6
          height: 26
          radius: 1.3
          color: glyph.ink
        }
        Rectangle {
          x: 3 + 26 * 0.45
          y: 3 + 13 - 1.3
          width: 26 * 0.55
          height: 2.6
          radius: 1.3
          color: glyph.ink
        }
      }
    }
    onPressed: function(b) {
      if (b === Qt.LeftButton) root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight)

    content: PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      implicitHeight: column.implicitHeight
      onMoveRequested: function(dx, dy) {
        var step = dx !== 0 ? dx : dy * 2
        if (step === 0) return
        root.patternIndex = Math.max(0, Math.min(root.lastAction, root.patternIndex + step))
      }
      onActivateRequested: root.activateIndex()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        width: parent.width
        spacing: Style.space(14)

        Column {
          width: parent.width
          spacing: Style.space(2)

          Plain {
            width: parent.width
            text: strings.t("panel.title")
            font.pixelSize: Style.font.title
            font.bold: true
          }
          Plain {
            width: parent.width
            visible: root.workspaceText !== ""
            text: root.workspaceText
            font.pixelSize: Style.font.caption
            opacity: 0.62
          }
          Plain {
            width: parent.width
            text: root.currentText
            font.pixelSize: Style.font.caption
            opacity: 0.62
          }
          Plain {
            width: parent.width
            visible: root.noteText !== ""
            text: root.noteText
            font.pixelSize: Style.font.caption
            color: root.bar ? root.bar.urgent : Commons.Color.urgent
          }
        }

        Grid {
          id: grid
          width: parent.width
          columns: 2
          columnSpacing: Style.space(8)
          rowSpacing: Style.space(8)

          Repeater {
            model: root.patterns

            PatternCell {
              required property var modelData
              required property int index

              cellIndex: index
              width: (grid.width - grid.columnSpacing) / 2
              height: 96
              pattern: modelData
              isCurrent: root.currentPattern === modelData.id
              hasCursor: root.patternIndex === index
              disabled: root.busy
              patternId: modelData.id
            }
          }
        }

        Button {
          width: parent.width
          text: strings.t("action.reset")
          fontSize: Style.font.bodySmall
          fontFamily: root.fontFamily
          foreground: root.barForeground
          bordered: true
          opacity: root.busy ? 0.45 : 1
          hasCursor: root.patternIndex === root.lastAction
          onClicked: root.resetLayout()
          onHovered: function(h) { if (h) root.patternIndex = root.lastAction }
        }
      }
    }
  }

  component Plain: Text {
    textFormat: Text.PlainText
    color: root.barForeground
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
    elide: Text.ElideRight
    maximumLineCount: 1
  }

  // One selectable pattern preview: mini window rects over the pattern name.
  component PatternCell: Rectangle {
    id: cell
    property int cellIndex: 0
    property string patternId: ""
    property var pattern: null
    property bool isCurrent: false
    property bool hasCursor: false
    property bool disabled: false

    radius: 10
    color: cell.hasCursor
      ? Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.10)
      : "transparent"
    border.width: cell.isCurrent ? 2 : 1
    border.color: cell.isCurrent
      ? Commons.Color.accent
      : Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, cell.hasCursor ? 0.55 : 0.25)
    opacity: cell.disabled ? 0.45 : 1

    Behavior on color {
      ColorAnimation { duration: Style.duration(150) }
    }
    Behavior on border.color {
      ColorAnimation { duration: Style.duration(150) }
    }

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      enabled: !cell.disabled
      onEntered: root.patternIndex = cell.cellIndex
      onClicked: root.applyPattern(cell.patternId)
    }

    Column {
      anchors.fill: parent
      anchors.margins: 10
      spacing: Style.space(6)

      Item {
        id: preview
        width: parent.width
        height: 52

        Repeater {
          model: cell.pattern ? Model.previewCells(cell.pattern) : []

          Rectangle {
            required property var modelData

            x: preview.width * modelData.x + 1
            y: preview.height * modelData.y + 1
            width: Math.max(1, preview.width * modelData.w - 2)
            height: Math.max(1, preview.height * modelData.h - 2)
            radius: 3
            color: cell.isCurrent
              ? Qt.rgba(Commons.Color.accent.r, Commons.Color.accent.g, Commons.Color.accent.b, 0.85)
              : Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.55)

            Behavior on color {
              ColorAnimation { duration: Style.duration(150) }
            }
          }
        }
      }

      Plain {
        width: parent.width
        horizontalAlignment: Text.AlignHCenter
        text: cell.pattern ? strings.t("pattern." + cell.pattern.id) : ""
        font.pixelSize: Style.font.bodySmall
        font.bold: cell.isCurrent
      }
    }
  }
}
