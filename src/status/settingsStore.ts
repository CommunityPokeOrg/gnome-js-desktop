import { create } from 'zustand'

interface SettingsState {
  wifi: boolean
  bluetooth: boolean
  doNotDisturb: boolean
  darkMode: boolean
  volume: number
  toggleWifi: () => void
  toggleBluetooth: () => void
  toggleDnd: () => void
  toggleDarkMode: () => void
  setVolume: (v: number) => void
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  wifi: true,
  bluetooth: false,
  doNotDisturb: false,
  darkMode: true,
  volume: 60,
  toggleWifi: () => set((s) => ({ wifi: !s.wifi })),
  toggleBluetooth: () => set((s) => ({ bluetooth: !s.bluetooth })),
  toggleDnd: () => set((s) => ({ doNotDisturb: !s.doNotDisturb })),
  toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
  setVolume: (v) => set({ volume: Math.max(0, Math.min(100, v)) }),
}))
