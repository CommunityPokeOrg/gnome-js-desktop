import { Geometry, RemoteCapability } from '../compositor/types'

/** A window as reported by a foreign session (KWin, EWMH X11, mock). */
export interface ForeignWindowSnapshot {
  /** Stable id in the source session — KWin internal UUID or X11 window id. */
  foreignId: string
  title: string
  appId?: string
  wmClass?: string
  icon?: string
  pid?: number
  geometry?: Geometry
  /** Virtual desktop index; null means "on all desktops". */
  workspace?: number | null
  output?: number
  minimized?: boolean
}

export interface ProviderCapabilities {
  /** Protocol identifier, e.g. "gnomejs-kwin-sync/1". */
  protocol: string
  /** e.g. "kwin-wayland" | "kwin-x11" | "x11-ewmh" | "mock" | "unavailable". */
  platform: string
  canList: boolean
  canControl: boolean
  canAdopt: boolean
  /** Remote actions the backend honors. */
  actions: RemoteCapability[]
  /** Why listing/controlling is unavailable, when applicable. */
  reason?: string
}

export type ProviderStatus =
  | 'connecting'
  | 'online'
  | 'disconnected'
  | 'unsupported'

export type SyncEvent =
  | { type: 'snapshot'; windows: ForeignWindowSnapshot[] }
  | { type: 'window-opened'; window: ForeignWindowSnapshot }
  | { type: 'window-closed'; foreignId: string }
  | { type: 'window-changed'; window: ForeignWindowSnapshot }
  | { type: 'provider-state'; state: ProviderStatus }

export type CommandResult = { ok: true } | { ok: false; error: string }

/**
 * A connection to a foreign windowing session. Implementations: HttpBridgeProvider
 * (real KWin/X11 via the Python bridge) and MockKwinProvider (demo/tests).
 */
export interface WindowSyncProvider {
  readonly id: string
  /** Human-readable origin, e.g. "KWin on :0 (wayland)". */
  readonly origin: string
  capabilities(): Promise<ProviderCapabilities>
  /** Start streaming events; also delivers an initial 'snapshot'. */
  start(emit: (event: SyncEvent) => void): Promise<void>
  stop(): void
  command(
    foreignId: string,
    action: string,
    args?: Record<string, unknown>,
  ): Promise<CommandResult>
}
