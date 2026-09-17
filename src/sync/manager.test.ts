import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetCompositorStore,
  useCompositorStore,
} from '../compositor/store'
import { SyncManager } from './manager'
import { MockKwinProvider } from './mockKwinProvider'

const s = () => useCompositorStore.getState()
const allWindows = () => Object.values(s().windows)

beforeEach(() => resetCompositorStore())

async function attach(
  mgr: SyncManager,
  opts: ConstructorParameters<typeof MockKwinProvider>[0] = {},
) {
  const p = new MockKwinProvider({ tickMs: 0, ...opts })
  await mgr.attachProvider(p)
  return p
}

describe('SyncManager', () => {
  it('adopts/proxies seeded foreign windows on attach', async () => {
    const mgr = new SyncManager()
    await attach(mgr)
    const remotes = allWindows().filter((w) => w.source === 'remote')
    expect(remotes).toHaveLength(3)
    expect(remotes[0].remote?.mode).toBe('proxied')
    // Inbound discovery must not steal focus.
    expect(remotes.every((w) => !w.focused)).toBe(true)
    // Minimized foreign state is mirrored, not forwarded.
    const ff = remotes.find((w) => w.appId === 'firefox')
    expect(ff?.minimized).toBe(true)
  })

  it('picks "adopted" when policy and provider agree', async () => {
    const mgr = new SyncManager({ policy: 'adopt' })
    await attach(mgr, { canAdopt: true })
    expect(allWindows()[0].remote?.mode).toBe('adopted')
  })

  it('falls back to readonly mirrors when control is unavailable', async () => {
    const mgr = new SyncManager()
    const p = await attach(mgr, { canControl: false })
    const win = allWindows().find((w) => w.source === 'remote')!
    expect(win.remote?.mode).toBe('readonly')
    s().closeWindow(win.id)
    expect(s().windows[win.id]).toBeDefined()
    expect(p.commands).toHaveLength(0)
  })

  it('forwards focus/move/close commands to the provider', async () => {
    const mgr = new SyncManager()
    const p = await attach(mgr)
    const win = allWindows().find((w) => w.source === 'remote')!
    s().focusWindow(win.id)
    s().moveWindow(win.id, 40, 50)
    s().closeWindow(win.id)
    expect(p.commands.map((c) => c.action)).toEqual(['focus', 'move', 'close'])
    expect(s().windows[win.id]).toBeUndefined()
  })

  it('applies inbound window-opened/changed/closed events', async () => {
    const mgr = new SyncManager()
    await attach(mgr)
    mgr.handleEvent('mock-kwin', {
      type: 'window-opened',
      window: { foreignId: 'new-1', title: 'New App' },
    })
    const added = allWindows().find((w) => w.remote?.foreignId === 'new-1')
    expect(added?.title).toBe('New App')
    mgr.handleEvent('mock-kwin', {
      type: 'window-changed',
      window: { foreignId: 'new-1', title: 'Renamed' },
    })
    expect(s().windows[added!.id].title).toBe('Renamed')
    mgr.handleEvent('mock-kwin', { type: 'window-closed', foreignId: 'new-1' })
    expect(s().windows[added!.id]).toBeUndefined()
  })

  it('reconciles snapshots — removes windows absent in the foreign session', async () => {
    const mgr = new SyncManager()
    await attach(mgr)
    mgr.handleEvent('mock-kwin', {
      type: 'snapshot',
      windows: [{ foreignId: 'kwin-uuid-001', title: 'Konsole' }],
    })
    const remotes = allWindows().filter((w) => w.source === 'remote')
    expect(remotes).toHaveLength(1)
    expect(remotes[0].remote?.foreignId).toBe('kwin-uuid-001')
  })

  it('demotes windows to readonly when the provider disconnects', async () => {
    const mgr = new SyncManager()
    await attach(mgr)
    mgr.handleEvent('mock-kwin', { type: 'provider-state', state: 'disconnected' })
    const win = allWindows().find((w) => w.source === 'remote')!
    expect(win.remote?.mode).toBe('readonly')
    s().closeWindow(win.id)
    expect(s().windows[win.id]).toBeDefined() // command blocked
  })

  it('marks providers unsupported when listing is impossible', async () => {
    const mgr = new SyncManager()
    const p = new MockKwinProvider({ tickMs: 0 })
    vi.spyOn(p, 'capabilities').mockResolvedValue({
      protocol: 'gnomejs-kwin-sync/1',
      platform: 'unavailable',
      canList: false,
      canControl: false,
      canAdopt: false,
      actions: [],
      reason: 'no session bus',
    })
    await mgr.attachProvider(p)
    expect(allWindows().filter((w) => w.source === 'remote')).toHaveLength(0)
    expect(mgr.providerCount()).toBe(0)
  })
})
