# Architecture — gnome-js-desktop

A GNOME-style desktop environment prototype that runs entirely in the browser
(TypeScript + React + Vite), with a simulated compositor and a cross-KWin window
synchronization layer. The goal is a faithful *interaction* model — top panel,
Activities overview, app launcher, status area, workspaces — on top of a real
window-management abstraction that can also adopt/proxy windows from a live KWin
or generic X11 session.

## Bird's-eye view

```
┌────────────────────────────── TopPanel ──────────────────────────────┐
│ Activities │ focused-app menu │      clock/calendar      │ tray ▾   │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│                          Window layer                                │
│   ┌─────────┐   ┌──────────────┐        ┌────────────┐               │
│   │ local   │   │ local        │        │ ⇄ remote   │  (KWin sync)  │
│   │ window  │   │ window       │        │ window     │               │
│   └─────────┘   └──────────────┘        └────────────┘               │
└──────────────────────────────────────────────────────────────────────┘
        ▲                    ▲                       ▲
        │                    │                       │
   compositor/store ◄── SyncManager ◄── WindowSyncProvider
   (z-order, focus,   (reconcile,      (HttpBridge → bridge daemon,
    workspaces)        command routing)  MockProvider for demo)
```

## Components

### 1. Desktop shell — `src/shell/`

`Shell.tsx` composes the whole UI and owns global keyboard handling (`Esc`
leaves the overview/launcher). Shell *mode* lives in `shell/store.ts`:

| Mode       | What it shows                                        |
|------------|------------------------------------------------------|
| `normal`   | panel + window layer                                 |
| `overview` | Activities overview (window spread, workspaces, search, dash) |
| `launcher` | full-screen application grid                         |

Mode transitions never destroy state — the overview and launcher are overlays.
The shell store also owns the **notification queue** (`notify`/`dismiss`),
rendered as toasts under the panel and listed in the clock popover.

### 2. Compositor / window-management integration — `src/compositor/`

`types.ts` defines the contract; `store.ts` is `SimCompositor`, the reference
implementation backed by a single zustand store.

```ts
interface WindowState {
  id, appId, title, icon, geometry, workspace, output,
  z, focused, minimized, maximized,
  source: 'local' | 'remote', remote?: RemoteInfo
}
```

Responsibilities:

- **Window lifecycle**: `openWindow`/`closeWindow`/`removeWindow` (the latter is
  the inbound-only path used by the sync layer; it never forwards commands).
- **Focus & stacking**: `focusWindow` raises the window and pushes it to the
  front of `focusStack` (MRU order — used by the panel app-menu and overview).
- **Geometry**: `move`/`resize`/`toggleMaximize` (with restore geometry).
- **Workspaces & outputs**: every window carries `workspace` and `output`
  indices; `activeWorkspace`/`activeOutput` select the visible set.
- **Remote delegation**: any mutating command on a `source: 'remote'` window is
  routed through `remoteCommandHandler` (installed by `SyncManager`) *and*
  applied optimistically; `readonly` remote windows reject commands silently.

This is the seam where a real compositor (Mutter-style) would plug in: the UI
only talks to the store API, never to implementation internals.

### 3. Top panel — `src/panel/`

- **Left**: `Activities` button → toggles the overview; focused-app button shows
  the title of the MRU window on the current workspace.
- **Center**: live clock; click opens a popover with the date and the
  notification list.
- **Right**: status icons (network, volume, battery) + a **sync indicator**
  (`⇄ n`) showing how many windows are mirrored from foreign sessions; click
  opens `QuickSettings`.

Popovers are rendered above the window layer with a transparent backdrop for
click-outside dismissal.

### 4. Activities overview — `src/overview/`

Replicates GNOME's overview:

- **Search field** (auto-focused) filters both open windows and launchable apps.
- **Window spread**: scaled thumbnails of the active workspace's windows;
  clicking one focuses it and exits the overview.
- **Workspace strip** on the right: one thumbnail per workspace with dots for
  its windows; click to switch; windows can be moved between workspaces via
  the compositor (`set-workspace`).
- **Dash** at the bottom: favorite/running apps plus the app-grid toggle which
  enters `launcher` mode.
- **Hot corner**: hovering the top-left screen corner opens the overview.

### 5. Application launcher — `src/launcher/`

`registry.ts` is the `AppDefinition` catalog (id, name, icon, keywords, React
component). `AppGrid` renders the full-screen, searchable icon grid. Launching
an app calls `openWindow` with a cascaded default geometry.

Bundled demo apps (`src/apps/`): Terminal, Files, Text Editor, Settings,
Browser, Calculator — all self-contained stubs that exercise the window APIs.

### 6. System status / tray — `src/status/` + `src/panel/StatusArea.tsx`

`settingsStore` holds quick-settings state (Wi-Fi, Bluetooth, DND, dark/light
theme, volume). `QuickSettings` is the GNOME-style dropdown: toggles + sliders +
per-provider sync status readout. Notifications from any subsystem (including
sync events) flow through the shell store into toasts and the clock popover.

### 7. Cross-KWin window synchronization — `src/sync/`

See [cross-kwin-sync.md](./cross-kwin-sync.md) for the full design. Summary:

- `WindowSyncProvider` interface — discovers and controls windows in a *foreign*
  session (KWin Wayland, KWin X11, or generic EWMH X11).
- `HttpBridgeProvider` talks to `bridge/kwin_sync_bridge.py` (HTTP + SSE).
- `MockKwinProvider` simulates a KWin session so the demo works anywhere.
- `SyncManager` reconciles foreign windows into the compositor as
  `adopted` / `proxied` / `readonly` windows and forwards local commands back
  to the source compositor — no reopening applications, no rerunning commands.

## Data flow

```
user input ──► Shell/Panel/WindowFrame ──► compositor store ──► React re-render
                    │                            ▲
                    │ remote cmd                 │ applyRemotePatch
                    ▼                            │
              SyncManager ──► WindowSyncProvider ──► (SSE/poll events)
                                            │
                            bridge daemon ──► KWin D-Bus / EWMH
```

## Testing strategy

- **Unit (vitest)**: compositor actions & focus/stacking invariants, sync
  reconcile/mode-selection/fallback logic, protocol parsing, launcher search.
- **Component (@testing-library/react + jsdom)**: launcher grid rendering and
  search filtering.
- **Bridge (pytest)**: command validation, `wmctrl -lG` output parsing, source
  fallback ordering — all runnable without a real KWin session.
- **CI** (`.github/workflows/ci.yml`): typecheck → lint → unit tests → build →
  bridge tests.
