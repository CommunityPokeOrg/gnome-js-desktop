# Cross-KWin window synchronization

How gnome-js-desktop discovers and manages windows that are **already open** in
another session — a running KWin Wayland desktop, a KWin X11 session, or any
EWMH-compliant X11 environment — without reopening applications or rerunning
commands.

## Goals

- **Discovery**: enumerate existing toplevel windows in the foreign session.
- **State sync**: mirror title, geometry, minimized state, workspace (virtual
  desktop) and output assignment, plus open/close/changed events.
- **Management**: focus, move/resize, workspace/output migration, minimize and
  close on the real window — initiated from the shell.
- **No relaunching**: the application keeps running under the source session;
  the shell adopts or proxies its window handle.

## Non-goal (platform limitation)

You cannot *move* a live Wayland client connection from one compositor to
another — the client is bound to its `wl_display` socket. What we implement is
**management migration**: the remote window keeps running in its session and
becomes a first-class managed object in ours. Any feature that would require
transporting the client connection (pixel-perfect embedding, drag-and-drop
across sessions) is out of scope for a prototype and is documented as such.

## Management modes

Every synced window is stamped with a `RemoteInfo` block:

| Mode       | Meaning                                                              |
|------------|---------------------------------------------------------------------|
| `adopted`  | Provider claims full takeover capability; we manage it like a local window and forward commands. |
| `proxied`  | Default safe mode — window stays owned by the source compositor; commands are forwarded; state is mirrored back over events. |
| `readonly` | Safe fallback when the backend can enumerate but not control (or is disconnected). All mutating commands become no-ops. |

Mode is chosen per provider at attach time from its reported capabilities and
the configured `SyncPolicy` (`adopt` → `proxy` → `readonly`, best available
wins). A provider that later disconnects demotes all of its windows to
`readonly` in place — the windows stay visible but can't be manipulated, which
is the honest state of the world.

## Discovery backends (fallback ladder)

`bridge/kwin_sync_bridge.py` probes sources in order and picks the first that
works:

### 1. `KWinScriptSource` — KWin Wayland *and* KWin X11

KWin exposes no D-Bus "list windows" API, but it has a scripting interface that
is remotely loadable:

1. Bridge calls `org.kde.KWin /Scripting org.kde.kwin.Scripting loadScript(path)`
   + `start` on the loaded script object.
2. `bridge/gnomejs_sync.js` runs inside KWin with full access to the
   `workspace` object: `workspace.windowList()`, per-window `internalId`
   (stable UUID — our `foreignId`), `frameGeometry`, `desktops`, `output`,
   `minimized`, `closeWindow()`, `workspace.activeWindow`, etc.
3. Functions declared in the script's global scope are callable over D-Bus via
   `org.kde.kwin.Scripting /Scripting/Script<N>` — the bridge discovers `N` by
   introspection. `listWindows()` returns a JSON snapshot;
   `command(uuid, action, argsJson)` executes focus/move/resize/desktop/close.
4. For *outbound* events the script hooks `workspace.windowAdded`,
   `windowRemoved` and per-window change signals, calling back into the
   bridge's own well-known name `org.gnomejs.KwinSync` via `callDBus`.

Works on Plasma 5 and Plasma 6 where the scripting API names differ slightly —
the script feature-detects (`windowList` vs `clientList`, `output` vs `screen`)
and the bridge degrades to polling when a signal is unavailable.

**Requirements**: `dbus-next` Python package, access to the *session* bus of
the target session, and KWin scripting not disabled by policy.

### 2. `EwmhX11Source` — generic X11 (KWin X11 fallback, i3, Openbox, …)

EWMH/`_NET_*` properties are readable (and mostly writable) by any client on
the same `$DISPLAY`:

- List: `wmctrl -lG` (+ `-lx` for `WM_CLASS`) — window id, desktop, geometry,
  host, title. Re-polled on a 1.5 s timer; diffs become opened/closed/changed
  events.
- Control: `wmctrl -i -a` (activate), `-e` (move/resize), `-t` (desktop),
  `-c` (close); `xdotool windowminimize` for minimize when available.

### 3. `MockSource` — demo / development

`--mock` seeds a fake KWin session (Konsole, Dolphin, Firefox) so the whole
pipeline is exercisable in CI and in a plain browser. The TypeScript
`MockKwinProvider` does the same entirely client-side.

### 4. `NullSource` — nothing available

Bridge still serves `/capabilities` with `canList: false` and a human-readable
`reason`; the shell marks the provider `unsupported` and simply shows no remote
windows. This is the safe fallback when migration/management is unsupported.

## Wire protocol — `gnomejs-kwin-sync/1`

Plain HTTP + Server-Sent Events on `127.0.0.1:8899` (CORS `*` for the dev
server). All payloads JSON; `src/sync/protocol.ts` validates every inbound
message and raises `ProtocolError` on shape violations.

| Endpoint | Direction | Payload |
|----------|-----------|---------|
| `GET /api/v1/capabilities` | pull | `{protocol, platform, canList, canControl, canAdopt, actions[], reason?}` |
| `GET /api/v1/windows`      | pull | `{windows: ForeignWindowSnapshot[]}` |
| `GET /api/v1/events`       | push (SSE) | `{type: window-opened|window-closed|window-changed|provider-state, …}` |
| `POST /api/v1/command`     | push | `{foreignId, action, args?} → {ok, error?}` |

`action` ∈ `focus | move | resize | set-workspace | set-output | minimize |
close`. Unknown actions are rejected with `400` — no freeform execution.

Reconnection: `EventSource` auto-retries; the provider emits `provider-state:
disconnected` so the shell can demote windows to `readonly` until a fresh
`snapshot` arrives.

## Workspace & output mapping

- Local `workspace` index ↔ KWin *virtual desktop* index (`-1`/all-desktops
  maps to the currently active local workspace). Count mismatches clamp to the
  local range.
- Local `output` index ↔ KWin output ordinal (Plasma 6 `output.name` where
  available, X11 `xinerama` index otherwise). `set-output` is forwarded but
  marked best-effort — EWMH has no per-window output concept.
- Local "switch workspace" does **not** try to change the foreign session's
  current desktop; mapping is per-window only.

## Security & session-boundary constraints

- **Same seat only.** The bridge must run inside the target session with its
  `DBUS_SESSION_BUS_ADDRESS` (and `DISPLAY`/`WAYLAND_DISPLAY` for the X11
  path). It cannot cross user, seat, or `systemd --user` boundaries.
- **Script injection is privileged.** Loading a KWin script executes code with
  compositor privileges; some builds/policies disable external `loadScript`
  calls. If rejected we fall back to EWMH (X11) or `readonly`/`unsupported`.
- **Wayland's security model** intentionally prevents arbitrary foreign window
  manipulation — everything we do on Wayland goes through the KWin scripting
  door the session owner controls. `wlr-foreign-toplevel`/`ext-foreign-toplevel`
  are alternatives for wlroots compositors (listed as future work).
- **Sandboxed clients** (Flatpak/snap confined windows) are still manageable —
  we never touch the client process, only its compositor-side window object.
- **Bridge binds to loopback only** and exposes no auth — it must not be
  exposed on a network interface. Command surface is a fixed allowlist; args
  are schema-validated and numeric-clamped.
- **No credential, cookie or content access**: sync operates on window
  metadata (ids, titles, geometry) — never on application memory or content.

## Failure behavior

| Failure | Result |
|---|---|
| Bridge unreachable | provider `disconnected`; remote windows demoted to `readonly`, still rendered |
| Backend reports `canList:false` | provider `unsupported`; zero remote windows, reason shown in QuickSettings |
| Command rejected (`ok:false`) | toast notification with the backend's error; local optimistic state is corrected by the next inbound event |
| `readonly` mode command attempt | silently ignored at the compositor level (buttons are also hidden in the frame UI) |
