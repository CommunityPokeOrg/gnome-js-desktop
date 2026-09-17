export type WindowId = string

export interface Geometry {
  x: number
  y: number
  width: number
  height: number
}

export const WORKSPACE_COUNT = 4
export const OUTPUT_COUNT = 1

/** Actions the source compositor reports it can perform on a synced window. */
export type RemoteCapability =
  | 'focus'
  | 'move'
  | 'resize'
  | 'set-workspace'
  | 'set-output'
  | 'minimize'
  | 'close'

export type RemoteMode =
  /** Provider claims full management; we forward every command. */
  | 'adopted'
  /** Window stays owned by the source compositor; commands are forwarded
      and authoritative state streams back over events. */
  | 'proxied'
  /** Safe fallback: state is mirrored but no commands may be sent. */
  | 'readonly'

export interface RemoteInfo {
  providerId: string
  /** Identifier in the source compositor — KWin window UUID or X11 window id. */
  foreignId: string
  mode: RemoteMode
  capabilities: RemoteCapability[]
  /** Human-readable origin, e.g. "KWin on :0 (wayland)". */
  origin: string
}

export interface WindowState {
  id: WindowId
  appId: string
  title: string
  icon: string
  geometry: Geometry
  workspace: number
  output: number
  z: number
  focused: boolean
  minimized: boolean
  maximized: boolean
  /** Geometry to restore when un-maximizing. */
  restoreGeometry?: Geometry
  source: 'local' | 'remote'
  remote?: RemoteInfo
}

export interface OpenWindowRequest {
  appId: string
  title: string
  icon: string
  geometry?: Partial<Geometry>
  workspace?: number
  remote?: RemoteInfo
  /** Focus the new window (default true). Inbound sync passes false —
      discovering a foreign window must not activate it in its session. */
  focus?: boolean
}

export type WindowCommand =
  | { action: 'focus' }
  | { action: 'move'; x: number; y: number }
  | { action: 'resize'; width: number; height: number }
  | { action: 'set-workspace'; workspace: number }
  | { action: 'set-output'; output: number }
  | { action: 'minimize' }
  | { action: 'restore' }
  | { action: 'toggle-maximize' }
  | { action: 'close' }
