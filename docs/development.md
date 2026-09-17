# Development

## Prerequisites

- Node.js ≥ 20 and npm ≥ 10 (shell prototype)
- Python ≥ 3.9 (optional — the KWin sync bridge)
- Optional bridge deps: `dbus-next` (KWin scripting), `wmctrl`/`xdotool` (X11 EWMH)

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

The demo always attaches the built-in mock KWin provider, so you see synced
"remote" windows out of the box. URL flags:

- `?mock=off` — disable the mock provider
- `?bridge=off` — don't try to reach the local bridge daemon
- `?bridge=http://host:port` — custom bridge URL

## Scripts

| Command             | Purpose                              |
|---------------------|--------------------------------------|
| `npm run dev`       | Vite dev server                      |
| `npm run build`     | typecheck + production build         |
| `npm run preview`   | serve the production build           |
| `npm test`          | vitest unit/component tests          |
| `npm run typecheck` | `tsc --noEmit`                       |
| `npm run lint`      | eslint                               |
| `npm run bridge`    | run `bridge/kwin_sync_bridge.py`     |

## KWin sync bridge

```bash
pip install -r bridge/requirements.txt   # dbus-next (KWin path only)
python3 bridge/kwin_sync_bridge.py       # autodetect backend
python3 bridge/kwin_sync_bridge.py --mock       # no DE needed
python3 bridge/kwin_sync_bridge.py --source=x11 # force EWMH
pytest bridge/tests                      # bridge unit tests
```

See [cross-kwin-sync.md](./cross-kwin-sync.md) for backends and limitations.

## Layout

```
src/compositor   window state machine (zustand) + types
src/shell        shell mode store, notifications
src/panel        top panel, clock popover, status area, quick settings
src/overview     Activities overview (spread, workspaces, dash, search)
src/launcher     app registry + full-screen app grid
src/wm           window frames (drag/resize/maximize)
src/status       quick-settings state
src/sync         providers, protocol, SyncManager
src/apps         bundled demo applications
bridge/          Python D-Bus/EWMH → HTTP+SSE bridge daemon + tests
docs/            architecture and sync design
```
