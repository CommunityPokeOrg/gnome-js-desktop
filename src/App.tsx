import { useEffect } from 'react'
import { Shell } from './shell/Shell'
import { useShellStore } from './shell/store'
import { HttpBridgeProvider } from './sync/httpBridgeProvider'
import { SyncManager } from './sync/manager'
import { MockKwinProvider } from './sync/mockKwinProvider'

export default function App() {
  useEffect(() => {
    const manager = new SyncManager({
      notify: (title, body) => useShellStore.getState().notify(title, body),
    })
    const q = new URLSearchParams(window.location.search)
    if (q.get('mock') !== 'off') {
      void manager.attachProvider(new MockKwinProvider())
    }
    if (q.get('bridge') !== 'off') {
      const url = q.get('bridge')
      void manager.attachProvider(
        new HttpBridgeProvider(url && url !== 'off' ? url : undefined),
      )
    }
    return () => manager.detachAll()
  }, [])

  return <Shell />
}
