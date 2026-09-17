import { useEffect, useState } from 'react'
import { focusedWindow, useCompositorStore } from '../compositor/store'
import { useShellStore } from '../shell/store'
import { QuickSettings } from './QuickSettings'

function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function TopPanel() {
  const mode = useShellStore((s) => s.mode)
  const toggleOverview = useShellStore((s) => s.toggleOverview)
  const notifications = useShellStore((s) => s.notifications)
  const clearNotifications = useShellStore((s) => s.clearNotifications)
  const dismissNotification = useShellStore((s) => s.dismissNotification)
  const focused = useCompositorStore(focusedWindow)
  const remoteCount = useCompositorStore(
    (s) => Object.values(s.windows).filter((w) => w.source === 'remote').length,
  )
  const [popover, setPopover] = useState<null | 'clock' | 'status'>(null)
  const time = useClock()
  const today = new Date().toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const toggle = (p: 'clock' | 'status') =>
    setPopover((cur) => (cur === p ? null : p))

  return (
    <div className="top-panel">
      <div className="panel-left">
        <button
          className={`panel-btn activities ${mode !== 'normal' ? 'active' : ''}`}
          onClick={toggleOverview}
        >
          Activities
        </button>
        {focused && (
          <button className="panel-btn app-menu" title={focused.title}>
            {focused.title}
          </button>
        )}
      </div>
      <div className="panel-center">
        <button className="panel-btn clock" onClick={() => toggle('clock')}>
          {time}
        </button>
      </div>
      <div className="panel-right">
        <button
          className="panel-btn status"
          onClick={() => toggle('status')}
          aria-label="System status"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path fill="currentColor" d="M8 12.5 1.5 6a9 9 0 0 1 13 0L8 12.5z" />
          </svg>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <rect x="1" y="5" width="11" height="6" rx="1" fill="none" stroke="currentColor" />
            <rect x="2.5" y="6.5" width="7" height="3" fill="currentColor" />
            <rect x="13" y="7" width="2" height="2" fill="currentColor" />
          </svg>
          {remoteCount > 0 && <span className="sync-chip">⇄ {remoteCount}</span>}
          <span className="caret">▾</span>
        </button>
      </div>

      {popover !== null && (
        <div className="popover-backdrop" onClick={() => setPopover(null)} />
      )}
      {popover === 'clock' && (
        <div className="popover clock-popover">
          <div className="popover-title">{today}</div>
          <div className="notif-list">
            {notifications.length === 0 && (
              <div className="notif-empty">No notifications</div>
            )}
            {notifications.map((n) => (
              <div key={n.id} className="notif-item">
                <div>
                  <strong>{n.title}</strong>
                  {n.body && <div className="notif-body">{n.body}</div>}
                </div>
                <button onClick={() => dismissNotification(n.id)}>✕</button>
              </div>
            ))}
          </div>
          {notifications.length > 0 && (
            <button className="notif-clear" onClick={clearNotifications}>
              Clear all
            </button>
          )}
        </div>
      )}
      {popover === 'status' && <QuickSettings />}
    </div>
  )
}
