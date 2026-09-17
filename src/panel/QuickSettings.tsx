import { useSettingsStore } from '../status/settingsStore'
import { useSyncStore } from '../sync/syncStore'

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: () => void
}) {
  return (
    <button className={`qs-toggle ${value ? 'on' : ''}`} onClick={onChange}>
      <span className="qs-dot" />
      {label}
    </button>
  )
}

export function QuickSettings() {
  const s = useSettingsStore()
  const providers = Object.values(useSyncStore((st) => st.providers))

  return (
    <div className="popover quick-settings">
      <div className="qs-grid">
        <Toggle label="Wi-Fi" value={s.wifi} onChange={s.toggleWifi} />
        <Toggle label="Bluetooth" value={s.bluetooth} onChange={s.toggleBluetooth} />
        <Toggle label="Do Not Disturb" value={s.doNotDisturb} onChange={s.toggleDnd} />
        <Toggle label="Dark Mode" value={s.darkMode} onChange={s.toggleDarkMode} />
      </div>
      <label className="qs-slider">
        Volume
        <input
          type="range"
          min={0}
          max={100}
          value={s.volume}
          onChange={(e) => s.setVolume(Number(e.target.value))}
        />
      </label>

      {providers.length > 0 && (
        <div className="qs-sync">
          <div className="qs-sync-title">Synced sessions</div>
          {providers.map((p) => (
            <div key={p.id} className="qs-provider">
              <span className={`qs-status-dot ${p.status}`} />
              <div className="qs-provider-meta">
                <div className="qs-provider-name">{p.origin}</div>
                <div className="qs-provider-sub">
                  {p.platform} · {p.status} · {p.mode}
                  {p.remoteWindows > 0 && ` · ${p.remoteWindows} window${p.remoteWindows === 1 ? '' : 's'}`}
                </div>
                {p.error && <div className="qs-provider-err">{p.error}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
