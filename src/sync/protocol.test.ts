import { describe, expect, it } from 'vitest'
import {
  parseCapabilities,
  parseSnapshot,
  parseSyncEvent,
  ProtocolError,
} from './protocol'

const caps = {
  protocol: 'gnomejs-kwin-sync/1',
  platform: 'kwin-wayland',
  canList: true,
  canControl: true,
  canAdopt: false,
  actions: ['focus', 'close'],
}

describe('protocol', () => {
  it('parses valid capabilities', () => {
    expect(parseCapabilities(caps)).toEqual(caps)
  })

  it('rejects unknown actions and missing fields', () => {
    expect(() =>
      parseCapabilities({ ...caps, actions: ['exec-arbitrary'] }),
    ).toThrow(ProtocolError)
    expect(() => parseCapabilities({ platform: 'x' })).toThrow(ProtocolError)
    expect(() => parseCapabilities(null)).toThrow(ProtocolError)
  })

  it('parses snapshots with optional fields', () => {
    const out = parseSnapshot({
      windows: [
        { foreignId: 'a', title: 'T' },
        {
          foreignId: 'b',
          title: 'U',
          geometry: { x: 1, y: 2, width: 3, height: 4 },
          workspace: null,
          minimized: true,
          pid: 12,
        },
      ],
    })
    expect(out).toHaveLength(2)
    expect(out[0].geometry).toBeUndefined()
    expect(out[1].workspace).toBeNull()
    expect(out[1].minimized).toBe(true)
  })

  it('parses each event variant', () => {
    expect(
      parseSyncEvent({ type: 'window-opened', window: { foreignId: 'x', title: 't' } }),
    ).toEqual({ type: 'window-opened', window: { foreignId: 'x', title: 't' } })
    expect(parseSyncEvent({ type: 'window-closed', foreignId: 'x' })).toEqual({
      type: 'window-closed',
      foreignId: 'x',
    })
    expect(parseSyncEvent({ type: 'provider-state', state: 'disconnected' })).toEqual({
      type: 'provider-state',
      state: 'disconnected',
    })
    expect(
      parseSyncEvent({ type: 'snapshot', windows: [{ foreignId: 'y', title: 'u' }] }),
    ).toEqual({
      type: 'snapshot',
      windows: [{ foreignId: 'y', title: 'u' }],
    })
  })

  it('rejects malformed events', () => {
    expect(() => parseSyncEvent({ type: 'nope' })).toThrow(ProtocolError)
    expect(() => parseSyncEvent({ type: 'window-closed' })).toThrow(ProtocolError)
    expect(() =>
      parseSyncEvent({ type: 'provider-state', state: 'sideways' }),
    ).toThrow(ProtocolError)
  })
})
