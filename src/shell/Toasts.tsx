import { useEffect } from 'react'
import { useSettingsStore } from '../status/settingsStore'
import { ShellNotification, useShellStore } from './store'

function Toast({ n }: { n: ShellNotification }) {
  const dismiss = useShellStore((s) => s.dismissNotification)
  const dnd = useSettingsStore((s) => s.doNotDisturb)
  useEffect(() => {
    const t = setTimeout(() => dismiss(n.id), 5000)
    return () => clearTimeout(t)
  }, [n.id, dismiss])
  if (dnd) return null
  return (
    <div className="toast" onClick={() => dismiss(n.id)}>
      <strong>{n.title}</strong>
      {n.body && <div className="toast-body">{n.body}</div>}
    </div>
  )
}

export function Toasts() {
  const notifications = useShellStore((s) => s.notifications)
  return (
    <div className="toast-area">
      {notifications.slice(-3).map((n) => (
        <Toast key={n.id} n={n} />
      ))}
    </div>
  )
}
