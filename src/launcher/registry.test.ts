import { describe, expect, it } from 'vitest'
import { appById, appMonogram, APPS, searchApps } from './registry'

describe('launcher registry', () => {
  it('returns all apps for empty queries', () => {
    expect(searchApps('')).toHaveLength(APPS.length)
    expect(searchApps('   ')).toHaveLength(APPS.length)
  })

  it('matches name, generic name, and keywords case-insensitively', () => {
    expect(searchApps('term')[0].id).toBe('terminal')
    expect(searchApps('FILE MANAGER')[0].id).toBe('files')
    expect(searchApps('nautilus')[0].id).toBe('files')
    expect(searchApps('gedit')[0].id).toBe('editor')
  })

  it('returns [] for unmatched queries', () => {
    expect(searchApps('zzzzz')).toHaveLength(0)
  })

  it('looks apps up by id', () => {
    expect(appById('calculator')?.name).toBe('Calculator')
    expect(appById('nope')).toBeUndefined()
  })

  it('builds monograms', () => {
    expect(appMonogram('Text Editor')).toBe('TE')
    expect(appMonogram('Terminal')).toBe('TE')
    expect(appMonogram('Web')).toBe('WE')
  })
})
