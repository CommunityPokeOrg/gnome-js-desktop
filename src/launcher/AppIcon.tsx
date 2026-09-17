import { AppDefinition, appMonogram } from './registry'

export function AppIcon({
  app,
  size = 64,
  onClick,
}: {
  app: AppDefinition
  size?: number
  onClick?: () => void
}) {
  return (
    <button
      className="app-icon"
      onClick={onClick}
      title={app.name}
      style={{ width: size + 24 }}
    >
      <span
        className="app-icon-tile"
        style={{
          width: size,
          height: size,
          background: app.color,
          fontSize: size * 0.34,
        }}
      >
        {appMonogram(app.name)}
      </span>
      <span className="app-icon-label">{app.name}</span>
    </button>
  )
}
