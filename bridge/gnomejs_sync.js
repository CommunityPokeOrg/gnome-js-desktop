/**
 * gnomejs_sync.js — injected into a running KWin session via
 * org.kde.kwin.Scripting (loadScript + start). Functions declared in the
 * global scope become callable over D-Bus at
 *   org.kde.kwin.Scripting /Scripting/Script<N> <function>
 * which the bridge discovers by introspection.
 *
 * Compatible with Plasma 5 (clientList/screen) and Plasma 6
 * (windowList/output). Everything is feature-detected; whatever is missing
 * degrades gracefully instead of throwing inside the compositor.
 */

var SYNC_BUS = 'org.gnomejs.KwinSync'
var SYNC_PATH = '/org/gnomejs/KwinSync'
var SYNC_IFACE = 'org.gnomejs.KwinSync'

function _windows() {
  if (typeof workspace.windowList === 'function') return workspace.windowList()
  if (typeof workspace.clientList === 'function') return workspace.clientList()
  return []
}

function _desktopOf(w) {
  try {
    if (w.onAllDesktops) return -1
    if (w.desktops && w.desktops.length > 0 && w.desktops[0].x11DesktopNumber !== undefined)
      return w.desktops[0].x11DesktopNumber - 1
    if (w.desktop !== undefined) return w.desktop - 1
  } catch (e) { }
  return 0
}

function _outputOf(w) {
  try {
    if (w.output && w.output.name !== undefined) return String(w.output.name)
    if (w.screen !== undefined) return w.screen
  } catch (e) { }
  return 0
}

function _toJson(w) {
  var g = { x: 0, y: 0, width: 640, height: 480 }
  try {
    if (w.frameGeometry) {
      g = {
        x: w.frameGeometry.x, y: w.frameGeometry.y,
        width: w.frameGeometry.width, height: w.frameGeometry.height,
      }
    } else if (w.geometry) {
      g = { x: w.geometry.x, y: w.geometry.y, width: w.geometry.width, height: w.geometry.height }
    }
  } catch (e) { }
  var id = ''
  try { id = String(w.internalId) } catch (e) { id = String(w.windowId) }
  var cls = ''
  try { cls = String(w.resourceClass || w.wmClass || '') } catch (e) { }
  return {
    foreignId: id,
    title: String(w.caption || w.title || ''),
    wmClass: cls,
    appId: cls,
    pid: w.pid || 0,
    geometry: g,
    workspace: _desktopOf(w),
    output: _outputOf(w),
    minimized: !!w.minimized,
  }
}

function _find(uuid) {
  var ws = _windows()
  for (var i = 0; i < ws.length; i++) {
    var w = ws[i]
    var id = ''
    try { id = String(w.internalId) } catch (e) { try { id = String(w.windowId) } catch (e2) { } }
    if (id === uuid) return w
  }
  return null
}

/** D-Bus callable: returns a JSON snapshot of every toplevel window. */
function listWindows() {
  var ws = _windows()
  var out = []
  for (var i = 0; i < ws.length; i++) {
    var w = ws[i]
    try {
      if (w.skipTaskbar || w.specialWindow) continue
    } catch (e) { }
    out.push(_toJson(w))
  }
  return JSON.stringify(out)
}

/** D-Bus callable: command(uuid, action, argsJson) -> 'ok' or error string. */
function command(uuid, action, argsJson) {
  var w = _find(uuid)
  if (!w) return 'unknown window ' + uuid
  var args = {}
  try { args = JSON.parse(argsJson || '{}') } catch (e) { }
  try {
    switch (action) {
      case 'focus':
        workspace.activeWindow = w
        break
      case 'move':
        var g = w.frameGeometry
        w.frameGeometry = { x: args.x || 0, y: args.y || 0, width: g.width, height: g.height }
        break
      case 'resize':
        var g2 = w.frameGeometry
        w.frameGeometry = { x: g2.x, y: g2.y, width: args.width || g2.width, height: args.height || g2.height }
        break
      case 'set-workspace':
        if (w.desktops !== undefined && workspace.desktops !== undefined) {
          var idx = (args.workspace || 0) + 1
          for (var d = 0; d < workspace.desktops.length; d++) {
            if (workspace.desktops[d].x11DesktopNumber === idx) {
              w.desktops = [workspace.desktops[d]]
              break
            }
          }
        } else if (w.desktop !== undefined) {
          w.desktop = (args.workspace || 0) + 1
        }
        break
      case 'minimize':
        w.minimized = true
        break
      case 'restore':
        w.minimized = false
        break
      case 'close':
        w.closeWindow()
        break
      default:
        return 'unsupported action ' + action
    }
    return 'ok'
  } catch (e) {
    return 'command failed: ' + e
  }
}

function pushEvent(type, obj) {
  try {
    callDBus(SYNC_BUS, SYNC_PATH, SYNC_IFACE, 'pushEvent', type, JSON.stringify(obj))
  } catch (e) { }
}

function _watch(w) {
  var fire = function () { pushEvent('window-changed', _toJson(w)) }
  try { w.frameGeometryChanged.connect(fire) } catch (e) { }
  try { w.clientGeometryChanged.connect(fire) } catch (e) { }
  try { w.captionChanged ? w.captionChanged.connect(fire) : w.titleChanged.connect(fire) } catch (e) { }
  try { w.minimizedChanged.connect(fire) } catch (e) { }
  try { w.desktopChanged.connect(fire) } catch (e) { }
}

try {
  workspace.windowAdded.connect(function (w) {
    _watch(w)
    pushEvent('window-opened', _toJson(w))
  })
  workspace.windowRemoved.connect(function (w) {
    var id = ''
    try { id = String(w.internalId) } catch (e) { }
    pushEvent('window-closed', { foreignId: id })
  })
  var existing = _windows()
  for (var i = 0; i < existing.length; i++) _watch(existing[i])
  print('[gnomejs-sync] loaded')
} catch (e) {
  print('[gnomejs-sync] failed to hook signals: ' + e)
}
