import { ComponentType } from 'react'
import BrowserApp from '../apps/BrowserApp'
import CalculatorApp from '../apps/CalculatorApp'
import FilesApp from '../apps/FilesApp'
import SettingsApp from '../apps/SettingsApp'
import TerminalApp from '../apps/TerminalApp'
import TextEditorApp from '../apps/TextEditorApp'

export interface AppDefinition {
  id: string
  name: string
  genericName: string
  /** Tile background color for the monogram icon. */
  color: string
  keywords: string[]
  favorite: boolean
  component: ComponentType<{ windowId: string }>
}

export const APPS: AppDefinition[] = [
  {
    id: 'terminal',
    name: 'Terminal',
    genericName: 'Command line',
    color: '#241f31',
    keywords: ['console', 'shell', 'bash'],
    favorite: true,
    component: TerminalApp,
  },
  {
    id: 'files',
    name: 'Files',
    genericName: 'File manager',
    color: '#2f6fb3',
    keywords: ['nautilus', 'folder', 'documents'],
    favorite: true,
    component: FilesApp,
  },
  {
    id: 'editor',
    name: 'Text Editor',
    genericName: 'Notes and code',
    color: '#865e3c',
    keywords: ['gedit', 'write', 'notes'],
    favorite: false,
    component: TextEditorApp,
  },
  {
    id: 'browser',
    name: 'Web',
    genericName: 'Browser',
    color: '#3584e4',
    keywords: ['firefox', 'epiphany', 'internet'],
    favorite: true,
    component: BrowserApp,
  },
  {
    id: 'calculator',
    name: 'Calculator',
    genericName: 'Arithmetic',
    color: '#613583',
    keywords: ['math', 'calc'],
    favorite: false,
    component: CalculatorApp,
  },
  {
    id: 'settings',
    name: 'Settings',
    genericName: 'System preferences',
    color: '#3d3846',
    keywords: ['preferences', 'control', 'panel'],
    favorite: true,
    component: SettingsApp,
  },
]

export function appById(id: string): AppDefinition | undefined {
  return APPS.find((a) => a.id === id)
}

export function searchApps(query: string): AppDefinition[] {
  const q = query.trim().toLowerCase()
  if (!q) return APPS
  return APPS.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.genericName.toLowerCase().includes(q) ||
      a.keywords.some((k) => k.toLowerCase().includes(q)),
  )
}

/** Monogram letters for a name, e.g. "Text Editor" → "TE". */
export function appMonogram(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
