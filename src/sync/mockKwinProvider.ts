import {
  CommandResult,
  ForeignWindowSnapshot,
  ProviderCapabilities,
  SyncEvent,
  WindowSyncProvider,
} from './types'

export interface MockOptions {
  platform?: string
  canControl?: boolean
  canAdopt?: boolean
  seed?: ForeignWindowSnapshot[]
  /** ms between simulated foreign-session events; 0 disables the ticker. */
  tickMs?: number
}

const DEFAULT_SEED: ForeignWindowSnapshot[] = [
  {
    foreignId: 'kwin-uuid-001',
    title: 'Konsole — make -C kernel',
    appId: 'org.kde.konsole',
    wmClass: 'konsole',
    pid: 4210,
    geometry: { x: 120, y: 90, width: 700, height: 440 },
    workspace: 0,
    output: 0,
  },
  {
    foreignId: 'kwin-uuid-002',
    title: 'Dolphin — ~/projects',
    appId: 'org.kde.dolphin',
    wmClass: 'dolphin',
    pid: 4301,
    geometry: { x: 880, y: 120, width: 620, height: 480 },
    workspace: 0,
    output: 0,
  },
  {
    foreignId: 'kwin-uuid-003',
    title: 'Firefox — KDE Community Wiki',
    appId: 'firefox',
    wmClass: 'firefox',
    pid: 4550,
    geometry: { x: 220, y: 560, width: 840, height: 460 },
    workspace: 1,
    output: 0,
    minimized: true,
  },
]

/**
 * Simulates a live KWin session: seeds existing windows, applies forwarded
 * commands to its internal model, and emits periodic change events — lets the
 * whole sync pipeline run in a plain browser or CI with no real compositor.
 */
export class MockKwinProvider implements WindowSyncProvider {
  readonly id = 'mock-kwin'
  readonly origin: string

  private opts: Required<Omit<MockOptions, 'seed'>> & { seed: ForeignWindowSnapshot[] }
  private windows = new Map<string, ForeignWindowSnapshot>()
  private emit: ((e: SyncEvent) => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private tickCount = 0

  /** Every forwarded command, in order — handy in tests and demos. */
  readonly commands: { foreignId: string; action: string; args: Record<string, unknown> }[] = []

  constructor(opts: MockOptions = {}) {
    this.opts = {
      platform: opts.platform ?? 'kwin-wayland',
      canControl: opts.canControl ?? true,
      canAdopt: opts.canAdopt ?? false,
      tickMs: opts.tickMs ?? 12_000,
      seed: opts.seed ?? DEFAULT_SEED,
    }
    this.origin = `Mock KWin session :0 (${this.opts.platform})`
    for (const w of this.opts.seed) this.windows.set(w.foreignId, { ...w })
  }

  capabilities(): Promise<ProviderCapabilities> {
    const control = this.opts.canControl
    return Promise.resolve({
      protocol: 'gnomejs-kwin-sync/1',
      platform: this.opts.platform,
      canList: true,
      canControl: control,
      canAdopt: this.opts.canAdopt,
      actions: control
        ? ['focus', 'move', 'resize', 'set-workspace', 'set-output', 'minimize', 'close']
        : [],
    })
  }

  start(emit: (e: SyncEvent) => void): Promise<void> {
    this.emit = emit
    emit({ type: 'provider-state', state: 'online' })
    emit({ type: 'snapshot', windows: [...this.windows.values()] })
    if (this.opts.tickMs > 0) {
      this.timer = setInterval(() => this.simulateActivity(), this.opts.tickMs)
    }
    return Promise.resolve()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.emit = null
  }

  async command(
    foreignId: string,
    action: string,
    args: Record<string, unknown> = {},
  ): Promise<CommandResult> {
    this.commands.push({ foreignId, action, args })
    if (!this.opts.canControl) {
      return { ok: false, error: 'session is read-only' }
    }
    const w = this.windows.get(foreignId)
    if (!w) return { ok: false, error: `unknown window ${foreignId}` }

    switch (action) {
      case 'focus':
        this.emit?.({ type: 'window-changed', window: { ...w, minimized: false } })
        break
      case 'move': {
        w.geometry = {
          ...(w.geometry ?? { width: 640, height: 480 }),
          x: Number(args.x ?? 0),
          y: Number(args.y ?? 0),
        }
        break
      }
      case 'resize': {
        w.geometry = {
          ...(w.geometry ?? { x: 0, y: 0 }),
          width: Number(args.width ?? 640),
          height: Number(args.height ?? 480),
        }
        break
      }
      case 'set-workspace':
        w.workspace = Number(args.workspace ?? 0)
        break
      case 'set-output':
        w.output = Number(args.output ?? 0)
        break
      case 'minimize':
        w.minimized = true
        break
      case 'restore':
        w.minimized = false
        break
      case 'close':
        this.windows.delete(foreignId)
        this.emit?.({ type: 'window-closed', foreignId })
        return { ok: true }
      default:
        return { ok: false, error: `unsupported action ${action}` }
    }
    this.emit?.({ type: 'window-changed', window: { ...w } })
    return { ok: true }
  }

  /** Rotate a plausible event so the demo feels alive. */
  private simulateActivity(): void {
    this.tickCount += 1
    const konsole = this.windows.get('kwin-uuid-001')
    if (konsole && this.tickCount % 2 === 0) {
      konsole.title = `Konsole — make -C kernel (${this.tickCount / 2} jobs done)`
      this.emit?.({ type: 'window-changed', window: { ...konsole } })
    }
    if (this.tickCount === 3) {
      const chat: ForeignWindowSnapshot = {
        foreignId: 'kwin-uuid-004',
        title: 'Telegram — #kde-devel',
        appId: 'org.telegram.desktop',
        wmClass: 'telegram',
        pid: 4711,
        geometry: { x: 420, y: 200, width: 560, height: 420 },
        workspace: 0,
        output: 0,
      }
      this.windows.set(chat.foreignId, chat)
      this.emit?.({ type: 'window-opened', window: chat })
    }
    if (this.tickCount === 5) {
      this.windows.delete('kwin-uuid-004')
      this.emit?.({ type: 'window-closed', foreignId: 'kwin-uuid-004' })
    }
  }
}
