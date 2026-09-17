import { create } from 'zustand'
import { ProviderStatus } from './types'

export interface ProviderUiState {
  id: string
  origin: string
  platform: string
  status: ProviderStatus
  /** 'adopted' | 'proxied' | 'readonly' — the negotiated management mode. */
  mode: string
  remoteWindows: number
  error?: string
}

interface SyncUiState {
  providers: Record<string, ProviderUiState>
  upsert: (p: ProviderUiState) => void
  patch: (id: string, p: Partial<ProviderUiState>) => void
  remove: (id: string) => void
}

/** What the panel/quick-settings render — mirrors SyncManager's bookkeeping. */
export const useSyncStore = create<SyncUiState>()((set) => ({
  providers: {},
  upsert: (p) => set((s) => ({ providers: { ...s.providers, [p.id]: p } })),
  patch: (id, p) =>
    set((s) => {
      const cur = s.providers[id]
      if (!cur) return {}
      return { providers: { ...s.providers, [id]: { ...cur, ...p } } }
    }),
  remove: (id) =>
    set((s) => {
      const providers = { ...s.providers }
      delete providers[id]
      return { providers }
    }),
}))
