import { useRef } from 'react'
import { useCompositorStore } from '../compositor/store'
import { WindowState } from '../compositor/types'
import { appById } from '../launcher/registry'
import { RemoteWindowContent } from './RemoteWindowContent'

interface DragState {
  pointerId: number
  kind: 'move' | 'resize'
  dx: number
  dy: number
}

export function WindowFrame({ win }: { win: WindowState }) {
  const focusWindow = useCompositorStore((s) => s.focusWindow)
  const moveWindow = useCompositorStore((s) => s.moveWindow)
  const resizeWindow = useCompositorStore((s) => s.resizeWindow)
  const minimizeWindow = useCompositorStore((s) => s.minimizeWindow)
  const toggleMaximize = useCompositorStore((s) => s.toggleMaximize)
  const closeWindow = useCompositorStore((s) => s.closeWindow)
  const drag = useRef<DragState | null>(null)

  const remote = win.remote
  const readonly = remote?.mode === 'readonly'
  const app = appById(win.appId)
  const Content = app?.component

  const onPointerDown = (e: React.PointerEvent, kind: DragState['kind']) => {
    if (win.maximized && kind === 'move') return
    focusWindow(win.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      pointerId: e.pointerId,
      kind,
      dx: e.clientX - (kind === 'move' ? win.geometry.x : win.geometry.width),
      dy: e.clientY - (kind === 'move' ? win.geometry.y : win.geometry.height),
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (d.kind === 'move') {
      moveWindow(win.id, Math.max(0, e.clientX - d.dx), Math.max(30, e.clientY - d.dy))
    } else {
      resizeWindow(win.id, e.clientX - d.dx, e.clientY - d.dy)
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.pointerId === e.pointerId) {
      drag.current = null
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const style: React.CSSProperties = win.maximized
    ? { left: 0, top: 32, width: '100%', height: 'calc(100% - 32px)', zIndex: win.z }
    : {
        left: win.geometry.x,
        top: win.geometry.y,
        width: win.geometry.width,
        height: win.geometry.height,
        zIndex: win.z,
      }

  return (
    <section
      className={`window-frame ${win.focused ? 'focused' : ''} ${remote ? 'remote' : ''} ${readonly ? 'readonly' : ''}`}
      style={style}
      onPointerDown={() => focusWindow(win.id)}
      aria-label={win.title}
    >
      <header
        className="window-titlebar"
        onPointerDown={(e) => onPointerDown(e, 'move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => !readonly && toggleMaximize(win.id)}
      >
        <span className="window-title">
          {remote && (
            <span
              className={`remote-badge mode-${remote.mode}`}
              title={`${remote.origin} — ${remote.mode}`}
            >
              ⇄ {remote.mode === 'readonly' ? 'view only' : remote.mode}
            </span>
          )}
          {win.title}
        </span>
        <span className="window-controls" onPointerDown={(e) => e.stopPropagation()}>
          {!readonly && (
            <>
              <button
                className="wc"
                title="Minimize"
                onClick={() => minimizeWindow(win.id)}
              >
                —
              </button>
              <button
                className="wc"
                title="Maximize"
                onClick={() => toggleMaximize(win.id)}
              >
                □
              </button>
            </>
          )}
          {(!remote || remote.capabilities.includes('close')) && (
            <button className="wc close" title="Close" onClick={() => closeWindow(win.id)}>
              ✕
            </button>
          )}
        </span>
      </header>
      <div className="window-body">
        {Content ? <Content windowId={win.id} /> : <RemoteWindowContent win={win} />}
      </div>
      {!win.maximized && !readonly && (
        <div
          className="window-resize-handle"
          onPointerDown={(e) => onPointerDown(e, 'resize')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
    </section>
  )
}
