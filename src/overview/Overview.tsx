import { useEffect, useRef, useState } from 'react'
import {
  useCompositorStore,
  workspaceWindows,
} from '../compositor/store'
import { WindowState, WORKSPACE_COUNT } from '../compositor/types'
import { appById, appMonogram, APPS, searchApps } from '../launcher/registry'
import { AppIcon } from '../launcher/AppIcon'
import { useShellStore } from '../shell/store'

function WindowThumb({ win, onPick }: { win: WindowState; onPick: () => void }) {
  const app = appById(win.appId)
  return (
    <button
      className={`ov-thumb ${win.minimized ? 'minimized' : ''} ${win.source === 'remote' ? 'remote' : ''}`}
      onClick={onPick}
      title={win.title}
    >
      <div className="ov-thumb-titlebar">
        <span>{win.title}</span>
        {win.source === 'remote' && <span className="remote-badge">⇄</span>}
      </div>
      <div
        className="ov-thumb-body"
        style={{ background: app?.color ?? '#2a2e38' }}
      >
        <span className="ov-thumb-mono">{appMonogram(app?.name ?? win.title)}</span>
      </div>
    </button>
  )
}

export function Overview() {
  const setMode = useShellStore((s) => s.setMode)
  const openWindow = useCompositorStore((s) => s.openWindow)
  const restoreWindow = useCompositorStore((s) => s.restoreWindow)
  const focusWindow = useCompositorStore((s) => s.focusWindow)
  const activeWorkspace = useCompositorStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useCompositorStore((s) => s.setActiveWorkspace)
  const state = useCompositorStore()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => searchRef.current?.focus(), [])

  const q = query.trim().toLowerCase()
  const wins = workspaceWindows(state, activeWorkspace).filter(
    (w) =>
      !q ||
      w.title.toLowerCase().includes(q) ||
      w.appId.toLowerCase().includes(q),
  )
  const runningIds = new Set(Object.values(state.windows).map((w) => w.appId))
  const dashApps = APPS.filter((a) => a.favorite || runningIds.has(a.id))
  const appResults = q ? searchApps(q).slice(0, 8) : []

  const pick = (w: WindowState) => {
    if (w.minimized) restoreWindow(w.id)
    else focusWindow(w.id)
    setMode('normal')
  }

  const launch = (id: string) => {
    const app = appById(id)
    if (!app) return
    openWindow({ appId: app.id, title: app.name, icon: app.name })
    setMode('normal')
  }

  return (
    <div className="overview">
      <input
        ref={searchRef}
        className="ov-search"
        placeholder="Type to search windows and apps…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ov-middle">
        <div className="ov-spread">
          {wins.length === 0 && (
            <div className="ov-empty">
              {q ? 'No matching windows' : 'No windows on this workspace'}
            </div>
          )}
          {wins.map((w) => (
            <WindowThumb key={w.id} win={w} onPick={() => pick(w)} />
          ))}
        </div>
        {appResults.length > 0 && (
          <div className="ov-apps">
            {appResults.map((a) => (
              <AppIcon key={a.id} app={a} size={56} onClick={() => launch(a.id)} />
            ))}
          </div>
        )}
        <div className="ov-workspaces">
          {Array.from({ length: WORKSPACE_COUNT }, (_, i) => (
            <button
              key={i}
              className={`ov-ws ${i === activeWorkspace ? 'active' : ''}`}
              onClick={() => setActiveWorkspace(i)}
              title={`Workspace ${i + 1}`}
            >
              <span className="ov-ws-num">{i + 1}</span>
              <span className="ov-ws-dots">
                {workspaceWindows(state, i).map((w) => (
                  <span key={w.id} className="ov-ws-dot" />
                ))}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="ov-dash">
        {dashApps.map((a) => (
          <button
            key={a.id}
            className={`dash-icon ${runningIds.has(a.id) ? 'running' : ''}`}
            style={{ background: a.color }}
            title={a.name}
            onClick={() => launch(a.id)}
          >
            {appMonogram(a.name)}
          </button>
        ))}
        <button
          className="dash-icon grid-toggle"
          title="Show applications"
          onClick={() => setMode('launcher')}
        >
          ⠿
        </button>
      </div>
    </div>
  )
}
