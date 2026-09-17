import { useEffect, useRef, useState } from 'react'
import { useCompositorStore } from '../compositor/store'
import { useShellStore } from '../shell/store'
import { AppIcon } from './AppIcon'
import { searchApps } from './registry'

export function AppGrid() {
  const setMode = useShellStore((s) => s.setMode)
  const openWindow = useCompositorStore((s) => s.openWindow)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const apps = searchApps(query)

  return (
    <div className="app-grid-overlay">
      <input
        ref={ref}
        className="ov-search"
        placeholder="Type to search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="app-grid">
        {apps.map((a) => (
          <AppIcon
            key={a.id}
            app={a}
            size={72}
            onClick={() => {
              openWindow({ appId: a.id, title: a.name, icon: a.name })
              setMode('normal')
            }}
          />
        ))}
        {apps.length === 0 && <div className="ov-empty">No applications found</div>}
      </div>
      <button className="grid-close" onClick={() => setMode('overview')}>
        ✕ Close
      </button>
    </div>
  )
}
