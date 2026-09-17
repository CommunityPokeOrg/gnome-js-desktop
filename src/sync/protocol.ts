import { Geometry, RemoteCapability } from '../compositor/types'
import {
  ForeignWindowSnapshot,
  ProviderCapabilities,
  ProviderStatus,
  SyncEvent,
} from './types'

export const PROTOCOL_VERSION = 'gnomejs-kwin-sync/1'
export const API_BASE = '/api/v1'
export const DEFAULT_BRIDGE_PORT = 8899
export const DEFAULT_BRIDGE_URL = `http://127.0.0.1:${DEFAULT_BRIDGE_PORT}`

export class ProtocolError extends Error {
  constructor(message: string) {
    super(`gnomejs-kwin-sync protocol: ${message}`)
    this.name = 'ProtocolError'
  }
}

const VALID_ACTIONS = new Set<RemoteCapability>([
  'focus',
  'move',
  'resize',
  'set-workspace',
  'set-output',
  'minimize',
  'close',
])

const PROVIDER_STATES = new Set<ProviderStatus>([
  'connecting',
  'online',
  'disconnected',
  'unsupported',
])

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function reqString(o: Obj, key: string): string {
  const v = o[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new ProtocolError(`field "${key}" must be a non-empty string`)
  }
  return v
}

function optNumber(o: Obj, key: string): number | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ProtocolError(`field "${key}" must be a finite number`)
  }
  return v
}

function parseGeometry(raw: unknown): Geometry | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isObj(raw)) throw new ProtocolError('"geometry" must be an object')
  const x = optNumber(raw, 'x')
  const y = optNumber(raw, 'y')
  const width = optNumber(raw, 'width')
  const height = optNumber(raw, 'height')
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    throw new ProtocolError('"geometry" requires x, y, width, height')
  }
  return { x, y, width, height }
}

export function parseWindow(raw: unknown): ForeignWindowSnapshot {
  if (!isObj(raw)) throw new ProtocolError('window entry must be an object')
  const snap: ForeignWindowSnapshot = {
    foreignId: reqString(raw, 'foreignId'),
    title: reqString(raw, 'title'),
  }
  if (typeof raw.appId === 'string') snap.appId = raw.appId
  if (typeof raw.wmClass === 'string') snap.wmClass = raw.wmClass
  if (typeof raw.icon === 'string') snap.icon = raw.icon
  const pid = optNumber(raw, 'pid')
  if (pid !== undefined) snap.pid = pid
  const geometry = parseGeometry(raw.geometry)
  if (geometry) snap.geometry = geometry
  if (raw.workspace === null) {
    snap.workspace = null
  } else {
    const ws = optNumber(raw, 'workspace')
    if (ws !== undefined) snap.workspace = ws
  }
  const output = optNumber(raw, 'output')
  if (output !== undefined) snap.output = output
  if (typeof raw.minimized === 'boolean') snap.minimized = raw.minimized
  return snap
}

export function parseCapabilities(raw: unknown): ProviderCapabilities {
  if (!isObj(raw)) throw new ProtocolError('capabilities must be an object')
  const protocol = reqString(raw, 'protocol')
  const platform = reqString(raw, 'platform')
  for (const flag of ['canList', 'canControl', 'canAdopt'] as const) {
    if (typeof raw[flag] !== 'boolean') {
      throw new ProtocolError(`field "${flag}" must be boolean`)
    }
  }
  const rawActions = raw.actions
  if (!Array.isArray(rawActions)) {
    throw new ProtocolError('field "actions" must be an array')
  }
  const actions: RemoteCapability[] = []
  for (const a of rawActions) {
    if (typeof a !== 'string' || !VALID_ACTIONS.has(a as RemoteCapability)) {
      throw new ProtocolError(`unknown action ${JSON.stringify(a)}`)
    }
    actions.push(a as RemoteCapability)
  }
  const caps: ProviderCapabilities = {
    protocol,
    platform,
    canList: raw.canList as boolean,
    canControl: raw.canControl as boolean,
    canAdopt: raw.canAdopt as boolean,
    actions,
  }
  if (typeof raw.reason === 'string') caps.reason = raw.reason
  return caps
}

export function parseSnapshot(raw: unknown): ForeignWindowSnapshot[] {
  if (!isObj(raw) || !Array.isArray(raw.windows)) {
    throw new ProtocolError('snapshot must be {windows: [...]}')
  }
  return (raw.windows as unknown[]).map(parseWindow)
}

/** Parse one SSE `data:` line from the bridge into a SyncEvent. */
export function parseSyncEvent(raw: unknown): SyncEvent {
  if (!isObj(raw)) throw new ProtocolError('event must be an object')
  switch (raw.type) {
    case 'snapshot':
      return { type: 'snapshot', windows: parseSnapshot(raw) }
    case 'window-opened':
    case 'window-changed':
      return { type: raw.type, window: parseWindow(raw.window) }
    case 'window-closed': {
      if (!isObj(raw)) break
      const id = raw.foreignId
      if (typeof id !== 'string') throw new ProtocolError('window-closed needs foreignId')
      return { type: 'window-closed', foreignId: id }
    }
    case 'provider-state': {
      const state = raw.state
      if (typeof state !== 'string' || !PROVIDER_STATES.has(state as ProviderStatus)) {
        throw new ProtocolError(`bad provider-state ${JSON.stringify(state)}`)
      }
      return { type: 'provider-state', state: state as ProviderStatus }
    }
    default:
      throw new ProtocolError(`unknown event type ${JSON.stringify(raw.type)}`)
  }
  throw new ProtocolError('malformed event')
}

export interface CommandResponse {
  ok: boolean
  error?: string
}

export function parseCommandResponse(raw: unknown): CommandResponse {
  if (!isObj(raw) || typeof raw.ok !== 'boolean') {
    throw new ProtocolError('command response must be {ok: boolean}')
  }
  const res: CommandResponse = { ok: raw.ok }
  if (typeof raw.error === 'string') res.error = raw.error
  return res
}
