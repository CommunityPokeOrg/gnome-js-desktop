import { WindowState } from '../compositor/types'

/**
 * Placeholder body for a synced foreign window. Pixels live in the source
 * session (a Wayland client can't be re-parented into a DOM node), so the
 * frame is honest: it shows the mirrored metadata rather than fake content.
 */
export function RemoteWindowContent({ win }: { win: WindowState }) {
  const r = win.remote
  return (
    <div className="remote-window-content">
      <div className="remote-icon">{win.icon}</div>
      <div className="remote-meta">
        <strong>{win.title}</strong>
        {r && (
          <dl>
            <dt>foreign id</dt>
            <dd>{r.foreignId}</dd>
            <dt>origin</dt>
            <dd>{r.origin}</dd>
            <dt>mode</dt>
            <dd>{r.mode}</dd>
            <dt>capabilities</dt>
            <dd>{r.capabilities.length ? r.capabilities.join(', ') : 'none'}</dd>
          </dl>
        )}
        <p className="remote-hint">
          The application keeps running in its own session — focus, move and
          close commands are forwarded to the source compositor.
        </p>
      </div>
    </div>
  )
}
