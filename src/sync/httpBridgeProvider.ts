import {
  API_BASE,
  DEFAULT_BRIDGE_URL,
  parseCapabilities,
  parseCommandResponse,
  parseSnapshot,
  parseSyncEvent,
  ProtocolError,
} from './protocol'
import {
  CommandResult,
  ForeignWindowSnapshot,
  ProviderCapabilities,
  SyncEvent,
  WindowSyncProvider,
} from './types'

/**
 * Client for bridge/kwin_sync_bridge.py — HTTP pull for snapshots/commands,
 * Server-Sent Events for the live window stream. EventSource's built-in
 * auto-reconnect gives us recovery for free; each reconnect re-pulls a full
 * snapshot so dropped deltas can't desync the compositor.
 */
export class HttpBridgeProvider implements WindowSyncProvider {
  readonly id: string
  readonly baseUrl: string
  origin = 'KWin bridge (connecting…)'

  private eventSource: EventSource | null = null
  private abort = new AbortController()
  private caps: ProviderCapabilities | null = null

  constructor(baseUrl = DEFAULT_BRIDGE_URL, id = 'kwin-bridge') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.id = id
  }

  private url(path: string): string {
    return `${this.baseUrl}${API_BASE}${path}`
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const res = await fetch(this.url('/capabilities'), {
      signal: this.abort.signal,
    })
    if (!res.ok) throw new ProtocolError(`capabilities HTTP ${res.status}`)
    const caps = parseCapabilities(await res.json())
    this.caps = caps
    this.origin = `KWin session via ${caps.platform} (${this.baseUrl})`
    return caps
  }

  async start(emit: (e: SyncEvent) => void): Promise<void> {
    if (!this.caps) await this.capabilities()

    emit({ type: 'provider-state', state: 'connecting' })
    const res = await fetch(this.url('/windows'), { signal: this.abort.signal })
    if (!res.ok) throw new ProtocolError(`windows HTTP ${res.status}`)
    const windows: ForeignWindowSnapshot[] = parseSnapshot(await res.json())
    emit({ type: 'snapshot', windows })
    emit({ type: 'provider-state', state: 'online' })

    const es = new EventSource(this.url('/events'))
    this.eventSource = es
    es.onmessage = (msg) => {
      try {
        emit(parseSyncEvent(JSON.parse(msg.data)))
      } catch {
        // Malformed events are dropped — the next snapshot reconciles.
      }
    }
    es.onerror = () => {
      emit({ type: 'provider-state', state: 'disconnected' })
    }
  }

  async command(
    foreignId: string,
    action: string,
    args: Record<string, unknown> = {},
  ): Promise<CommandResult> {
    try {
      const res = await fetch(this.url('/command'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foreignId, action, args }),
        signal: this.abort.signal,
      })
      const parsed = parseCommandResponse(await res.json())
      return parsed.ok ? { ok: true } : { ok: false, error: parsed.error ?? 'rejected' }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'bridge unreachable',
      }
    }
  }

  stop(): void {
    this.eventSource?.close()
    this.eventSource = null
    this.abort.abort()
  }
}
