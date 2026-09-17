# gnome-js-desktop

A GNOME-style desktop environment prototype in the browser — top panel,
Activities overview, application launcher, workspaces and quick settings — on
top of a real window-management core, plus **cross-KWin synchronization** that
lets the shell discover and manage windows already open in another KWin/X11
session *without reopening applications*.

- **[docs/architecture.md](docs/architecture.md)** — component design: shell,
  compositor, panel, overview, launcher, status area
- **[docs/cross-kwin-sync.md](docs/cross-kwin-sync.md)** — how live foreign
  windows are adopted/proxied via KWin D-Bus scripting and EWMH, platform
  limits, security/session boundaries, fallback behavior
- **[docs/development.md](docs/development.md)** — setup, scripts, repo layout

## Quick start

```bash
npm install
npm run dev          # → http://localhost:5173
```

Tests, lint, build:

```bash
npm test && npm run lint && npm run typecheck && npm run build
```

Run the real sync bridge against a live KWin/X11 session (optional):

```bash
pip install -r bridge/requirements.txt
python3 bridge/kwin_sync_bridge.py        # or: --mock / --source=x11
```

## Highlights

- **Simulated compositor** with focus/stacking, drag+resize, maximize,
  workspaces — the seam where a real Mutter-class compositor would integrate.
- **Synced windows are first-class**: focusing a proxied KWin window activates
  the real window; moving it to another workspace maps to a virtual-desktop
  move; closing it closes the real window.
- **Graceful degradation**: when the foreign session can't be controlled, its
  windows degrade to read-only mirrors instead of failing or disappearing.
- Bundled demo apps (Terminal, Files, Editor, Settings, Browser, Calculator).

MIT licensed — see [LICENSE](LICENSE).
