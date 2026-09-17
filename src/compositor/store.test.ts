import { beforeEach, describe, expect, it } from 'vitest'
import {
  focusedWindow,
  resetCompositorStore,
  useCompositorStore,
  visibleWindows,
  workspaceWindows,
} from './store'
import { WindowState } from './types'

const s = () => useCompositorStore.getState()

function openRemote(mode: 'proxied' | 'readonly'): string {
  return s().openWindow({
    appId: 'external',
    title: 'Remote win',
    icon: 'i',
    focus: false,
    remote: {
      providerId: 'p1',
      foreignId: 'f1',
      mode,
      capabilities: ['focus', 'move', 'close'],
      origin: 'test',
    },
  })
}

beforeEach(() => resetCompositorStore())

describe('compositor', () => {
  it('opens, focuses, and stacks windows in MRU order', () => {
    const a = s().openWindow({ appId: 'x', title: 'A', icon: 'a' })
    const b = s().openWindow({ appId: 'x', title: 'B', icon: 'b' })
    expect(focusedWindow(s())?.id).toBe(b)
    expect(s().windows[b].z).toBeGreaterThan(s().windows[a].z)
    s().focusWindow(a)
    expect(focusedWindow(s())?.id).toBe(a)
    expect(s().focusStack[0]).toBe(a)
  })

  it('closes windows and removes them from the focus stack', () => {
    const a = s().openWindow({ appId: 'x', title: 'A', icon: 'a' })
    s().closeWindow(a)
    expect(s().windows[a]).toBeUndefined()
    expect(s().focusStack).not.toContain(a)
  })

  it('moves, resizes with minimums, and restores maximize geometry', () => {
    const id = s().openWindow({ appId: 'x', title: 'A', icon: 'a' })
    s().moveWindow(id, 100, 120)
    s().resizeWindow(id, 10, 10)
    expect(s().windows[id].geometry).toEqual({
      x: 100, y: 120, width: 240, height: 160,
    })
    const before = s().windows[id].geometry
    s().toggleMaximize(id)
    expect(s().windows[id].maximized).toBe(true)
    expect(s().windows[id].restoreGeometry).toEqual(before)
    s().toggleMaximize(id)
    expect(s().windows[id].geometry).toEqual(before)
    expect(s().windows[id].maximized).toBe(false)
  })

  it('assigns and switches workspaces', () => {
    const id = s().openWindow({ appId: 'x', title: 'A', icon: 'a' })
    s().setWindowWorkspace(id, 2)
    expect(s().windows[id].workspace).toBe(2)
    expect(visibleWindows(s()).map((w) => w.id)).not.toContain(id)
    s().setActiveWorkspace(2)
    expect(workspaceWindows(s(), 2).map((w) => w.id)).toContain(id)
    s().setActiveWorkspace(99)
    expect(s().activeWorkspace).toBe(3) // clamped
  })

  it('minimizes and restores via focus stack', () => {
    const id = s().openWindow({ appId: 'x', title: 'A', icon: 'a' })
    s().minimizeWindow(id)
    expect(s().windows[id].minimized).toBe(true)
    expect(visibleWindows(s())).toHaveLength(0)
    s().restoreWindow(id)
    expect(s().windows[id].minimized).toBe(false)
    expect(focusedWindow(s())?.id).toBe(id)
  })

  it('ignores mutating commands on readonly remote windows', () => {
    const id = openRemote('readonly')
    s().focusWindow(id)
    expect(s().focusStack).not.toContain(id)
    s().moveWindow(id, 5, 5)
    expect(s().windows[id].geometry.x).not.toBe(5)
    s().closeWindow(id)
    expect(s().windows[id]).toBeDefined()
  })

  it('routes commands on proxied remote windows through the handler', () => {
    const calls: string[] = []
    const id = openRemote('proxied')
    s().setRemoteCommandHandler((_w: WindowState, cmd) => {
      calls.push(cmd.action)
      return true
    })
    s().focusWindow(id)
    s().moveWindow(id, 50, 60)
    s().closeWindow(id)
    expect(calls).toEqual(['focus', 'move', 'close'])
    expect(s().windows[id]).toBeUndefined()
  })

  it('applyRemotePatch updates inbound state without command dispatch', () => {
    const id = openRemote('proxied')
    const spy: string[] = []
    s().setRemoteCommandHandler((_w, cmd) => {
      spy.push(cmd.action)
      return true
    })
    s().applyRemotePatch(id, { title: 'new title', minimized: true })
    expect(s().windows[id].title).toBe('new title')
    expect(s().windows[id].minimized).toBe(true)
    expect(spy).toHaveLength(0)
  })
})
