import { useEffect } from 'react'
import { useCompositorStore } from '../compositor/store'
import { AppGrid } from '../launcher/AppGrid'
import { Overview } from '../overview/Overview'
import { TopPanel } from '../panel/TopPanel'
import { useSettingsStore } from '../status/settingsStore'
import { useShellStore } from './store'
import { WindowFrame } from '../wm/WindowFrame'
import { Toasts } from './Toasts'

export function Shell() {
  const mode = useShellStore((s) => s.mode)
  const setMode = useShellStore((s) => s.setMode)
  const darkMode = useSettingsStore((s) => s.darkMode)
  const windowsMap = useCompositorStore((s) => s.windows)
  const activeWorkspace = useCompositorStore((s) => s.activeWorkspace)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('normal')
      if (e.ctrlKey && e.key === ' ') {
        e.preventDefault()
        useShellStore.getState().toggleOverview()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMode])

  const visible = Object.values(windowsMap)
    .filter((w) => w.workspace === activeWorkspace && !w.minimized)
    .sort((a, b) => a.z - b.z)

  return (
    <div className={`desktop ${darkMode ? 'dark' : 'light'}`}>
      <TopPanel />
      <div
        className="hot-corner"
        title="Activities"
        onMouseEnter={() => mode === 'normal' && setMode('overview')}
      />
      <div className="window-layer">
        {visible.map((w) => (
          <WindowFrame key={w.id} win={w} />
        ))}
      </div>
      {mode === 'overview' && <Overview />}
      {mode === 'launcher' && <AppGrid />}
      <Toasts />
    </div>
  )
}
