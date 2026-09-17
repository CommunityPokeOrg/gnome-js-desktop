import { useSettingsStore } from '../status/settingsStore'

export default function SettingsApp() {
  const s = useSettingsStore()
  return (
    <div className="app-settings">
      <h3>Quick settings</h3>
      <label>
        <input type="checkbox" checked={s.wifi} onChange={s.toggleWifi} /> Wi-Fi
      </label>
      <label>
        <input type="checkbox" checked={s.bluetooth} onChange={s.toggleBluetooth} />{' '}
        Bluetooth
      </label>
      <label>
        <input type="checkbox" checked={s.doNotDisturb} onChange={s.toggleDnd} /> Do
        not disturb
      </label>
      <label>
        <input type="checkbox" checked={s.darkMode} onChange={s.toggleDarkMode} />{' '}
        Dark mode
      </label>
      <label>
        Volume
        <input
          type="range"
          min={0}
          max={100}
          value={s.volume}
          onChange={(e) => s.setVolume(Number(e.target.value))}
        />
      </label>
      <p className="settings-hint">Mirrors the panel’s Quick Settings menu.</p>
    </div>
  )
}
