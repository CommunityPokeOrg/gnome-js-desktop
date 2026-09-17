# kwin_sync_bridge

Python daemon that exposes windows already open in a **KWin (Wayland or X11)**
or generic **EWMH X11** session to the gnome-js-desktop shell over HTTP + SSE —
no app relaunching, no command replay.

```
pip install -r requirements.txt        # dbus-next — KWin backend only
python3 kwin_sync_bridge.py            # autodetect: kwin-script → ewmh-x11 → null
python3 kwin_sync_bridge.py --mock     # simulated session for demos/CI
python3 kwin_sync_bridge.py --source=x11 --port 8899
```

## Endpoints (all under `http://127.0.0.1:8899/api/v1`)

| Route | Purpose |
|---|---|
| `GET /capabilities` | platform, control/adopt flags, supported actions, reason |
| `GET /windows` | JSON snapshot of foreign windows |
| `GET /events` | SSE stream: `window-opened` / `window-closed` / `window-changed` |
| `POST /command` | `{foreignId, action, args}` — `focus`, `move`, `resize`, `set-workspace`, `set-output`, `minimize`, `restore`, `close` |
| `GET /health` | liveness + active backend |

## Backends

- **kwin-script**: injects `gnomejs_sync.js` via `org.kde.kwin.Scripting`,
  invokes its `listWindows`/`command` functions over D-Bus, receives change
  events on the bridge-owned name `org.gnomejs.KwinSync`. Needs `dbus-next`
  and access to the session bus *of the session you want to manage* — run it
  inside that session (same `DBUS_SESSION_BUS_ADDRESS`).
- **x11-ewmh**: any EWMH-compliant X11 WM. Lists via `wmctrl -lG` (+ `-lx` for
  class), controls via `wmctrl`/`xdotool`. Needs `DISPLAY` and the binaries.
- **mock**: deterministic fake session (Konsole/Dolphin/Firefox).
- **null**: serves `canList:false` with a reason — the shell then just shows
  no remote windows.

## Security notes

- Binds to `127.0.0.1` only; there is no authentication — do not expose the
  port beyond loopback.
- The KWin backend loads a script with compositor privileges into your
  session; that is precisely the access needed to manage windows, and it only
  works while you control the session bus.
- Cannot cross seat/user/session-bus boundaries; cannot move a live Wayland
  client between compositors — windows are *managed*, not transported. See
  `docs/cross-kwin-sync.md`.
