import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AppGrid } from './AppGrid'
import { resetCompositorStore, useCompositorStore } from '../compositor/store'
import { resetShellStore, useShellStore } from '../shell/store'

beforeEach(() => {
  resetCompositorStore()
  resetShellStore()
  useShellStore.getState().setMode('launcher')
})

describe('AppGrid', () => {
  it('renders every registered app', () => {
    render(<AppGrid />)
    for (const name of ['Terminal', 'Files', 'Text Editor', 'Web', 'Calculator', 'Settings']) {
      expect(screen.getByTitle(name)).toBeInTheDocument()
    }
  })

  it('filters by search query', () => {
    render(<AppGrid />)
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'calc' },
    })
    expect(screen.getByTitle('Calculator')).toBeInTheDocument()
    expect(screen.queryByTitle('Terminal')).not.toBeInTheDocument()
  })

  it('opens a compositor window and exits launcher mode on launch', () => {
    render(<AppGrid />)
    fireEvent.click(screen.getByTitle('Terminal'))
    const wins = Object.values(useCompositorStore.getState().windows)
    expect(wins).toHaveLength(1)
    expect(wins[0].appId).toBe('terminal')
    expect(useShellStore.getState().mode).toBe('normal')
  })
})
