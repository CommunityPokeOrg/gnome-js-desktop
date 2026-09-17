import { create } from 'zustand'

export type ShellMode = 'normal' | 'overview' | 'launcher'

export interface ShellNotification {
  id: number
  title: string
  body?: string
  timestamp: number
}

interface ShellState {
  mode: ShellMode
  notifications: ShellNotification[]
  nextNotificationId: number
  setMode: (mode: ShellMode) => void
  toggleOverview: () => void
  notify: (title: string, body?: string) => number
  dismissNotification: (id: number) => void
  clearNotifications: () => void
}

export const useShellStore = create<ShellState>()((set, get) => ({
  mode: 'normal',
  notifications: [],
  nextNotificationId: 1,
  setMode: (mode) => set({ mode }),
  toggleOverview: () =>
    set((s) => ({ mode: s.mode === 'overview' ? 'normal' : 'overview' })),
  notify: (title, body) => {
    const id = get().nextNotificationId
    set((s) => ({
      nextNotificationId: id + 1,
      notifications: [...s.notifications, { id, title, body, timestamp: Date.now() }],
    }))
    return id
  },
  dismissNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
  clearNotifications: () => set({ notifications: [] }),
}))

export function resetShellStore(): void {
  useShellStore.setState({
    mode: 'normal',
    notifications: [],
    nextNotificationId: 1,
  })
}
