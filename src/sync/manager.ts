import { useCompositorStore } from '../compositor/store'
import {
  Geometry,
  RemoteCapability,
  RemoteMode,
  WindowCommand,
  WindowId,
  WindowState,
} from '../compositor/types'
import {
  CommandResult,
  ForeignWindowSnapshot,
  ProviderCapabilities,
  SyncEvent,
  WindowSyncProvider,
} from './types'
import { useSyncStore } from './syncStore'

export type SyncPolicy = 'adopt' | 'proxy' | 'readonly'
export type NotifyFn = (title: string, body?: string) => void

interface AttachedProvider {
  provider: WindowSyncProvider
  caps: ProviderCapabilities
  mode: RemoteMode
  started: boolean
}

const foreignKey = (providerId: string, foreignId: string) =>
  `${providerId}:${foreignId}`

/**
 * Reconciles foreign-session windows into the compositor and routes local
 * commands back out. Contract:
 *
 *  - attachProvider() fetches capabilities, picks the best management mode
 *    the policy allows, and starts the event stream.
 *  - Inbound events upsert/remove windows tagged `source: 'remote'`.
 *  - Outbound commands (user focuses/moves/closes a remote frame) are
 *    forwarded through the installed remoteCommandHandler — the application
 *    keeps running untouched in the foreign session.
 *  - On disconnect every remote window degrades to 'readonly' in place.
 */
export class SyncManager {
  private providers = new Map<string, AttachedProvider>()
  private foreignToLocal = new Map<string, WindowId>()
  private notify: NotifyFn
  private policy: SyncPolicy
  private store = useCompositorStore

  constructor(opts: { notify?: NotifyFn; policy?: SyncPolicy } = {}) {
    this.notify = opts.notify ?? (() => {})
    this.policy = opts.policy ?? 'adopt'
    this.store.getState().setRemoteCommandHandler((win, cmd) =>
      this.forwardCommand(win, cmd),
    )
  }

  static modeFor(caps: ProviderCapabilities, policy: SyncPolicy): RemoteMode {
    if (policy === 'adopt' && caps.canAdopt) return 'adopted'
    if (policy !== 'readonly' && caps.canControl) return 'proxied'
    return 'readonly'
  }

  async attachProvider(provider: WindowSyncProvider): Promise<void> {
    const ui = useSyncStore.getState()
    try {
      const caps = await provider.capabilities()
      if (!caps.canList) {
        ui.upsert({
          id: provider.id,
          origin: provider.origin,
          platform: caps.platform,
          status: 'unsupported',
          mode: 'readonly',
          remoteWindows: 0,
          error: caps.reason ?? 'window enumeration unsupported',
        })
        return
      }
      const attached: AttachedProvider = {
        provider,
        caps,
        mode: SyncManager.modeFor(caps, this.policy),
        started: false,
      }
      this.providers.set(provider.id, attached)
      ui.upsert({
        id: provider.id,
        origin: provider.origin,
        platform: caps.platform,
        status: 'connecting',
        mode: attached.mode,
        remoteWindows: 0,
      })
      await provider.start((e) => this.handleEvent(provider.id, e))
      attached.started = true
    } catch (e) {
      this.providers.delete(provider.id)
      useSyncStore.getState().upsert({
        id: provider.id,
        origin: provider.origin,
        platform: 'unknown',
        status: 'disconnected',
        mode: 'readonly',
        remoteWindows: 0,
        error: e instanceof Error ? e.message : 'attach failed',
      })
    }
  }

  handleEvent(providerId: string, event: SyncEvent): void {
    const attached = this.providers.get(providerId)
    if (!attached) return
    switch (event.type) {
      case 'snapshot':
        this.reconcile(attached, event.windows)
        break
      case 'window-opened':
      case 'window-changed':
        this.upsertForeign(attached, event.window)
        break
      case 'window-closed': {
        const localId = this.foreignToLocal.get(foreignKey(providerId, event.foreignId))
        if (localId) {
          this.store.getState().removeWindow(localId)
          this.foreignToLocal.delete(foreignKey(providerId, event.foreignId))
        }
        break
      }
      case 'provider-state':
        this.onProviderState(attached, event.state)
        break
    }
    this.refreshUi(attached)
  }

  private reconcile(p: AttachedProvider, windows: ForeignWindowSnapshot[]): void {
    const seen = new Set<string>()
    for (const w of windows) {
      seen.add(foreignKey(p.provider.id, w.foreignId))
      this.upsertForeign(p, w)
    }
    // Anything tracked from this provider but absent in the snapshot is gone.
    for (const [key, localId] of this.foreignToLocal) {
      if (key.startsWith(`${p.provider.id}:`) && !seen.has(key)) {
        this.store.getState().removeWindow(localId)
        this.foreignToLocal.delete(key)
      }
    }
  }

  private upsertForeign(p: AttachedProvider, w: ForeignWindowSnapshot): void {
    const store = this.store.getState()
    const key = foreignKey(p.provider.id, w.foreignId)
    const existingId = this.foreignToLocal.get(key)
    const patch: Partial<WindowState> = {}
    if (w.title !== undefined) patch.title = w.title
    if (w.geometry !== undefined) patch.geometry = w.geometry as Geometry
    if (w.minimized !== undefined) patch.minimized = w.minimized
    if (w.workspace !== undefined && w.workspace !== null) {
      patch.workspace = w.workspace
    }
    if (w.output !== undefined) patch.output = w.output

    if (existingId) {
      store.applyRemotePatch(existingId, patch)
      return
    }
    const id = store.openWindow({
      appId: w.appId ?? w.wmClass ?? 'external',
      title: w.title,
      icon: w.icon ?? '🗔',
      geometry: w.geometry,
      workspace: w.workspace ?? undefined,
      focus: false,
      remote: {
        providerId: p.provider.id,
        foreignId: w.foreignId,
        mode: p.mode,
        capabilities: p.caps.actions,
        origin: p.provider.origin,
      },
    })
    // Mirroring minimized state is inbound-only — forwarding a real
    // 'minimize' would hide the window in the foreign session.
    if (w.minimized) store.applyRemotePatch(id, { minimized: true })
    this.foreignToLocal.set(key, id)
    this.notify(`Synced “${w.title}”`, `${p.provider.origin} — ${p.mode}`)
  }

  private onProviderState(p: AttachedProvider, state: string): void {
    if (state === 'disconnected') {
      // Windows may still exist remotely; degrade rather than delete.
      for (const [key, localId] of this.foreignToLocal) {
        if (!key.startsWith(`${p.provider.id}:`)) continue
        this.store.getState().applyRemotePatch(localId, {
          remote: {
            providerId: p.provider.id,
            foreignId: key.slice(p.provider.id.length + 1),
            mode: 'readonly',
            capabilities: [],
            origin: `${p.provider.origin} (disconnected)`,
          },
        })
      }
    }
  }

  /** remoteCommandHandler installed on the compositor. */
  private forwardCommand(win: WindowState, cmd: WindowCommand): boolean {
    const remote = win.remote
    if (!remote || remote.mode === 'readonly') return false
    const attached = this.providers.get(remote.providerId)
    if (!attached || !attached.started) return false

    const { action, ...rest } = cmd
    // Maximizing our mirror is purely local — the source window keeps its
    // real geometry.
    if (action === 'toggle-maximize') return true
    // 'restore' is the inverse of 'minimize'; forward it when the provider
    // can minimize.
    const requiredCap = action === 'restore' ? 'minimize' : action
    if (!remote.capabilities.includes(requiredCap as RemoteCapability)) {
      return false
    }
    void attached.provider
      .command(remote.foreignId, action, rest)
      .then((res: CommandResult) => {
        if (!res.ok) {
          this.notify(`Sync command failed`, `${remote.origin}: ${res.error}`)
        }
      })
    return true
  }

  private refreshUi(p: AttachedProvider): void {
    const count = [...this.foreignToLocal.keys()].filter((k) =>
      k.startsWith(`${p.provider.id}:`),
    ).length
    useSyncStore.getState().patch(p.provider.id, {
      remoteWindows: count,
      status: 'online',
      mode: p.mode,
      origin: p.provider.origin,
      platform: p.caps.platform,
    })
  }

  detachProvider(id: string): void {
    const attached = this.providers.get(id)
    if (!attached) return
    attached.provider.stop()
    for (const [key, localId] of this.foreignToLocal) {
      if (key.startsWith(`${id}:`)) {
        this.store.getState().removeWindow(localId)
        this.foreignToLocal.delete(key)
      }
    }
    this.providers.delete(id)
    useSyncStore.getState().remove(id)
  }

  detachAll(): void {
    for (const id of [...this.providers.keys()]) this.detachProvider(id)
  }

  providerCount(): number {
    return this.providers.size
  }
}
