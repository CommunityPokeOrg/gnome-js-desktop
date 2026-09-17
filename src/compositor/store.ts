import { create } from 'zustand'
import {
  Geometry,
  OpenWindowRequest,
  WindowCommand,
  WindowId,
  WindowState,
  WORKSPACE_COUNT,
} from './types'

/**
 * Returns true when the command may proceed (locally and/or forwarded).
 * Remote windows delegate to the installed handler; `readonly` remote windows
 * reject every mutating command — the safe fallback when a session can be
 * enumerated but not controlled.
 */
export type RemoteCommandHandler = (win: WindowState, cmd: WindowCommand) => boolean

export interface CompositorState {
  windows: Record<WindowId, WindowState>
  /** Most-recently-focused first. */
  focusStack: WindowId[]
  activeWorkspace: number
  activeOutput: number
  nextZ: number
  nextLocalId: number
  remoteCommandHandler: RemoteCommandHandler | null

  openWindow: (req: OpenWindowRequest) => WindowId
  /** User-initiated close — forwarded to the provider for remote windows. */
  closeWindow: (id: WindowId) => void
  /** Inbound close from the sync layer — never forwards. */
  removeWindow: (id: WindowId) => void
  focusWindow: (id: WindowId) => void
  moveWindow: (id: WindowId, x: number, y: number) => void
  resizeWindow: (id: WindowId, width: number, height: number) => void
  setWindowWorkspace: (id: WindowId, workspace: number) => void
  minimizeWindow: (id: WindowId) => void
  restoreWindow: (id: WindowId) => void
  toggleMaximize: (id: WindowId) => void
  setActiveWorkspace: (index: number) => void
  setRemoteCommandHandler: (handler: RemoteCommandHandler | null) => void
  /** Upsert fields — inbound path used by the sync layer. */
  applyRemotePatch: (id: WindowId, patch: Partial<WindowState>) => void
}

const MIN_W = 240
const MIN_H = 160

const initialState = {
  windows: {} as Record<WindowId, WindowState>,
  focusStack: [] as WindowId[],
  activeWorkspace: 0,
  activeOutput: 0,
  nextZ: 10,
  nextLocalId: 1,
  remoteCommandHandler: null as RemoteCommandHandler | null,
}

function defaultGeometry(index: number): Geometry {
  const w = Math.min(760, Math.max(320, globalThis.innerWidth - 320))
  const h = Math.min(520, Math.max(240, globalThis.innerHeight - 240))
  const offset = 40 + (index % 8) * 28
  return { x: offset + 60, y: offset + 24, width: w, height: h }
}

function clampWorkspace(i: number): number {
  return Math.max(0, Math.min(WORKSPACE_COUNT - 1, Math.round(i)))
}

export const useCompositorStore = create<CompositorState>()((set, get) => {
  const dispatchRemote = (win: WindowState, cmd: WindowCommand): boolean => {
    if (win.source !== 'remote') return true
    if (!win.remote || win.remote.mode === 'readonly') return false
    const handler = get().remoteCommandHandler
    if (!handler) return false
    return handler(win, cmd)
  }

  const remove = (id: WindowId) =>
    set((s) => {
      const windows = { ...s.windows }
      delete windows[id]
      return { windows, focusStack: s.focusStack.filter((w) => w !== id) }
    })

  return {
    ...initialState,

    openWindow: (req) => {
      const id: WindowId = req.remote
        ? `remote:${req.remote.providerId}:${req.remote.foreignId}`
        : `win-${get().nextLocalId}`
      set((s) => {
        if (s.windows[id]) {
          // Inbound re-sync of a window we already track — patch, don't dup.
          return {}
        }
        const geometry: Geometry = {
          ...defaultGeometry(s.nextLocalId),
          ...req.geometry,
        }
        const win: WindowState = {
          id,
          appId: req.appId,
          title: req.title,
          icon: req.icon,
          geometry,
          workspace: clampWorkspace(req.workspace ?? s.activeWorkspace),
          output: s.activeOutput,
          z: s.nextZ,
          focused: false,
          minimized: false,
          maximized: false,
          source: req.remote ? 'remote' : 'local',
          remote: req.remote,
        }
        return {
          windows: { ...s.windows, [id]: win },
          nextZ: s.nextZ + 1,
          nextLocalId: s.nextLocalId + 1,
        }
      })
      if (req.focus !== false) get().focusWindow(id)
      return id
    },

    closeWindow: (id) => {
      const win = get().windows[id]
      if (!win) return
      if (!dispatchRemote(win, { action: 'close' })) return
      remove(id)
    },

    removeWindow: (id) => {
      remove(id)
    },

    focusWindow: (id) => {
      const win = get().windows[id]
      if (!win) return
      if (!dispatchRemote(win, { action: 'focus' })) return
      set((s) => ({
        nextZ: s.nextZ + 1,
        focusStack: [id, ...s.focusStack.filter((w) => w !== id)],
        windows: {
          ...s.windows,
          [id]: { ...win, focused: true, minimized: false, z: s.nextZ },
        },
      }))
      // Clear the flag on everything else without extra renders.
      set((s) => {
        const touched: Record<WindowId, WindowState> = {}
        let dirty = false
        for (const [wid, w] of Object.entries(s.windows)) {
          if (wid !== id && w.focused) {
            touched[wid] = { ...w, focused: false }
            dirty = true
          }
        }
        return dirty ? { windows: { ...s.windows, ...touched } } : {}
      })
    },

    moveWindow: (id, x, y) => {
      const win = get().windows[id]
      if (!win || win.maximized) return
      if (!dispatchRemote(win, { action: 'move', x, y })) return
      set((s) => ({
        windows: {
          ...s.windows,
          [id]: { ...win, geometry: { ...win.geometry, x, y } },
        },
      }))
    },

    resizeWindow: (id, width, height) => {
      const win = get().windows[id]
      if (!win || win.maximized) return
      const w = Math.max(MIN_W, width)
      const h = Math.max(MIN_H, height)
      if (!dispatchRemote(win, { action: 'resize', width: w, height: h })) return
      set((s) => ({
        windows: {
          ...s.windows,
          [id]: { ...win, geometry: { ...win.geometry, width: w, height: h } },
        },
      }))
    },

    setWindowWorkspace: (id, workspace) => {
      const win = get().windows[id]
      if (!win) return
      const ws = clampWorkspace(workspace)
      if (!dispatchRemote(win, { action: 'set-workspace', workspace: ws })) return
      set((s) => ({
        windows: { ...s.windows, [id]: { ...win, workspace: ws } },
      }))
    },

    minimizeWindow: (id) => {
      const win = get().windows[id]
      if (!win) return
      if (!dispatchRemote(win, { action: 'minimize' })) return
      set((s) => ({
        windows: { ...s.windows, [id]: { ...win, minimized: true, focused: false } },
        focusStack: s.focusStack.filter((w) => w !== id),
      }))
    },

    restoreWindow: (id) => {
      const win = get().windows[id]
      if (!win) return
      if (!dispatchRemote(win, { action: 'restore' })) return
      set((s) => ({
        windows: { ...s.windows, [id]: { ...win, minimized: false } },
      }))
      get().focusWindow(id)
    },

    toggleMaximize: (id) => {
      const win = get().windows[id]
      if (!win) return
      if (!dispatchRemote(win, { action: 'toggle-maximize' })) return
      set((s) => {
        const w = s.windows[id]
        const maximized = !w.maximized
        return {
          windows: {
            ...s.windows,
            [id]: {
              ...w,
              maximized,
              restoreGeometry: maximized ? w.geometry : w.restoreGeometry,
              geometry: maximized && w.restoreGeometry ? w.restoreGeometry : w.geometry,
            },
          },
        }
      })
    },

    setActiveWorkspace: (index) => {
      set({ activeWorkspace: clampWorkspace(index) })
    },

    setRemoteCommandHandler: (handler) => {
      set({ remoteCommandHandler: handler })
    },

    applyRemotePatch: (id, patch) => {
      set((s) => {
        const win = s.windows[id]
        if (!win) return {}
        const merged = { ...win, ...patch }
        if (patch.workspace !== undefined) {
          merged.workspace = clampWorkspace(patch.workspace)
        }
        return { windows: { ...s.windows, [id]: merged } }
      })
    },
  }
})

/** Test/development helper — restore a pristine compositor. */
export function resetCompositorStore(): void {
  useCompositorStore.setState(initialState, false)
}

/** Convenience selectors. */
export function visibleWindows(s: CompositorState): WindowState[] {
  return Object.values(s.windows)
    .filter((w) => w.workspace === s.activeWorkspace && !w.minimized)
    .sort((a, b) => a.z - b.z)
}

export function workspaceWindows(s: CompositorState, ws: number): WindowState[] {
  return Object.values(s.windows)
    .filter((w) => w.workspace === ws)
    .sort((a, b) => a.z - b.z)
}

export function focusedWindow(s: CompositorState): WindowState | undefined {
  for (const id of s.focusStack) {
    const w = s.windows[id]
    if (w && !w.minimized && w.workspace === s.activeWorkspace) return w
  }
  return undefined
}
