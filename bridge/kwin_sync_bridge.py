#!/usr/bin/env python3
"""kwin_sync_bridge — expose an existing KWin/X11 session's windows over HTTP+SSE.

The gnome-js-desktop shell attaches to this daemon to *manage* windows that
are already running in another session — no reopening applications, no
rerunning commands. See docs/cross-kwin-sync.md for the full design.

Backends (fallback ladder):
  kwin-script  — KWin Wayland/X11 via the org.kde.kwin.Scripting D-Bus API
                 plus an injected script (gnomejs_sync.js). Requires dbus-next.
  x11-ewmh     — any EWMH-compliant X11 WM via wmctrl/xdotool.
  mock         — simulated session for demos and CI (--mock).
  null         — nothing usable; serves canList:false so the shell degrades
                 to "unsupported" instead of failing.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional

PROTOCOL = 'gnomejs-kwin-sync/1'
API_BASE = '/api/v1'
DEFAULT_PORT = 8899
SYNC_BUS_NAME = 'org.gnomejs.KwinSync'
SYNC_OBJ_PATH = '/org/gnomejs/KwinSync'
SCRIPT_PATH = Path(__file__).with_name('gnomejs_sync.js')

ALLOWED_ACTIONS = {
    'focus', 'move', 'resize', 'set-workspace', 'set-output',
    'minimize', 'restore', 'close',
}

Runner = Callable[[list[str]], subprocess.CompletedProcess]


def default_runner(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=10)


# ---------------------------------------------------------------- commands

def validate_command(foreign_id: str, action: str, args: Any) -> tuple[bool, str, dict]:
    """Allowlist + shape-check commands before they reach a window manager."""
    if not isinstance(foreign_id, str) or not foreign_id:
        return False, 'foreignId must be a non-empty string', {}
    if action not in ALLOWED_ACTIONS:
        return False, f'unsupported action {action!r}', {}
    args = args or {}
    if not isinstance(args, dict):
        return False, 'args must be an object', {}
    out: dict[str, float] = {}
    numeric = {
        'move': ('x', 'y'),
        'resize': ('width', 'height'),
        'set-workspace': ('workspace',),
        'set-output': ('output',),
    }.get(action, ())
    for key in numeric:
        v = args.get(key)
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            return False, f'args.{key} must be numeric', {}
        out[key] = max(0, float(v))
    if action == 'resize' and (out['width'] < 1 or out['height'] < 1):
        return False, 'resize dimensions must be >= 1', {}
    return True, '', out


# ---------------------------------------------------------------- event bus

class EventBus:
    """Fan-out: sources publish dicts; each SSE client drains its own queue."""

    def __init__(self) -> None:
        self._subs: list[queue.Queue] = []
        self._lock = threading.Lock()

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=500)
        with self._lock:
            self._subs.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)

    def publish(self, event: dict) -> None:
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                pass  # slow consumer — next snapshot reconciles


# ---------------------------------------------------------------- sources

class Source:
    name = 'null'
    platform = 'unavailable'
    can_list = False
    can_control = False
    can_adopt = False
    reason = 'no backend'

    def __init__(self) -> None:
        self.bus: Optional[EventBus] = None

    def attach(self, bus: EventBus) -> None:
        self.bus = bus

    def available(self, env: dict) -> bool:
        return False

    def start(self) -> None:  # pragma: no cover - overridden
        pass

    def stop(self) -> None:  # pragma: no cover - overridden
        pass

    def list_windows(self) -> list[dict]:
        return []

    def command(self, foreign_id: str, action: str, args: dict) -> tuple[bool, str]:
        return False, f'{self.name} backend cannot control windows'

    def publish(self, event: dict) -> None:
        if self.bus:
            self.bus.publish(event)


class NullSource(Source):
    def __init__(self, reason: str = 'no usable backend detected') -> None:
        super().__init__()
        self.name = 'null'
        self.reason = reason

    def available(self, env: dict) -> bool:
        return True  # always the last resort


class MockSource(Source):
    """Deterministic fake KWin session for demos and CI."""

    name = 'mock'
    platform = 'mock'
    can_list = True
    can_control = True

    def __init__(self) -> None:
        super().__init__()
        self._windows = {
            w['foreignId']: dict(w)
            for w in [
                {'foreignId': 'mock-1', 'title': 'Konsole — htop', 'wmClass': 'konsole',
                 'pid': 101, 'geometry': {'x': 80, 'y': 60, 'width': 720, 'height': 440},
                 'workspace': 0, 'output': 0, 'minimized': False},
                {'foreignId': 'mock-2', 'title': 'Dolphin — ~/src', 'wmClass': 'dolphin',
                 'pid': 102, 'geometry': {'x': 840, 'y': 90, 'width': 600, 'height': 500},
                 'workspace': 0, 'output': 0, 'minimized': False},
                {'foreignId': 'mock-3', 'title': 'Firefox — kde.org', 'wmClass': 'firefox',
                 'pid': 103, 'geometry': {'x': 200, 'y': 300, 'width': 900, 'height': 560},
                 'workspace': 1, 'output': 0, 'minimized': True},
            ]
        }

    def available(self, env: dict) -> bool:
        return True

    def start(self) -> None:
        self.publish({'type': 'snapshot', 'windows': self.list_windows()})

    def list_windows(self) -> list[dict]:
        return [dict(w) for w in self._windows.values()]

    def command(self, foreign_id: str, action: str, args: dict) -> tuple[bool, str]:
        w = self._windows.get(foreign_id)
        if not w:
            return False, f'unknown window {foreign_id}'
        if action == 'focus':
            w['minimized'] = False
        elif action == 'move':
            w['geometry'].update(x=args['x'], y=args['y'])
        elif action == 'resize':
            w['geometry'].update(width=args['width'], height=args['height'])
        elif action == 'set-workspace':
            w['workspace'] = int(args['workspace'])
        elif action == 'set-output':
            w['output'] = int(args['output'])
        elif action == 'minimize':
            w['minimized'] = True
        elif action == 'restore':
            w['minimized'] = False
        elif action == 'close':
            del self._windows[foreign_id]
            self.publish({'type': 'window-closed', 'foreignId': foreign_id})
            return True, ''
        self.publish({'type': 'window-changed', 'window': dict(w)})
        return True, ''


class EwmhX11Source(Source):
    """Generic EWMH backend: works for KWin X11 *and* i3/Openbox/etc."""

    name = 'x11-ewmh'
    platform = 'x11-ewmh'
    can_list = True
    can_control = True
    poll_interval = 1.5

    def __init__(self, runner: Runner = default_runner) -> None:
        super().__init__()
        self.runner = runner
        self._known: dict[str, dict] = {}
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def available(self, env: dict) -> bool:
        return bool(env.get('DISPLAY')) and shutil.which('wmctrl') is not None

    # ---- parsing (pure functions, unit-tested)

    @staticmethod
    def parse_wmctrl_lg(text: str) -> dict[str, dict]:
        """wmctrl -lG:  wid desk x y w h host title..."""
        out: dict[str, dict] = {}
        for line in text.splitlines():
            parts = line.split(None, 7)
            if len(parts) < 8:
                continue
            wid, desk, x, y, w, h, _host, title = parts
            try:
                out[wid] = {
                    'foreignId': wid,
                    'title': title,
                    'workspace': int(desk),
                    'geometry': {'x': int(x), 'y': int(y),
                                 'width': int(w), 'height': int(h)},
                }
            except ValueError:
                continue
        return out

    @staticmethod
    def parse_wmctrl_lx(text: str) -> dict[str, str]:
        """wmctrl -lx:  wid desk WM_CLASS host title..."""
        out: dict[str, str] = {}
        for line in text.splitlines():
            parts = line.split(None, 4)
            if len(parts) < 5:
                continue
            wid, _desk, wm_class, _host, _title = parts
            out[wid] = wm_class
        return out

    def _fetch(self) -> dict[str, dict]:
        geo = self.runner(['wmctrl', '-lG']).stdout
        cls = self.runner(['wmctrl', '-lx']).stdout
        classes = self.parse_wmctrl_lx(cls)
        windows = self.parse_wmctrl_lg(geo)
        for wid, w in windows.items():
            wm_class = classes.get(wid, '')
            w['wmClass'] = wm_class
            w['appId'] = wm_class.split('.')[-1].lower() if wm_class else ''
            w['minimized'] = w['geometry']['width'] == 0 or w['workspace'] == -1
        return windows

    # ---- lifecycle

    def start(self) -> None:
        self._known = self._fetch()
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self.publish({'type': 'snapshot', 'windows': list(self._known.values())})

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self.poll_interval):
            try:
                current = self._fetch()
            except Exception:
                continue
            for wid, w in current.items():
                if wid not in self._known:
                    self.publish({'type': 'window-opened', 'window': w})
                elif self._known[wid] != w:
                    self.publish({'type': 'window-changed', 'window': w})
            for wid in self._known:
                if wid not in current:
                    self.publish({'type': 'window-closed', 'foreignId': wid})
            self._known = current

    # ---- commands

    def command(self, foreign_id: str, action: str, args: dict) -> tuple[bool, str]:
        def run(cmd: list[str]) -> tuple[bool, str]:
            r = self.runner(cmd)
            return (True, '') if r.returncode == 0 else (False, r.stderr.strip() or 'wmctrl failed')

        if action == 'focus':
            ok, err = run(['wmctrl', '-i', '-a', foreign_id])
            if not ok and shutil.which('xdotool'):
                ok, err = run(['xdotool', 'windowactivate', foreign_id])
            return ok, err
        if action in ('move', 'resize'):
            w = self._known.get(foreign_id, {})
            g = w.get('geometry', {'x': 0, 'y': 0, 'width': 640, 'height': 480})
            x = int(args.get('x', g['x']))
            y = int(args.get('y', g['y']))
            width = int(args.get('width', g['width']))
            height = int(args.get('height', g['height']))
            return run(['wmctrl', '-i', '-r', foreign_id, '-e', f'0,{x},{y},{width},{height}'])
        if action == 'set-workspace':
            return run(['wmctrl', '-i', '-r', foreign_id, '-t', str(int(args['workspace']))])
        if action == 'close':
            return run(['wmctrl', '-i', '-c', foreign_id])
        if action == 'minimize':
            if shutil.which('xdotool'):
                return run(['xdotool', 'windowminimize', foreign_id])
            return False, 'minimize needs xdotool'
        if action == 'restore':
            return run(['wmctrl', '-i', '-a', foreign_id])
        return False, f'unsupported action {action}'


class KWinScriptSource(Source):
    """KWin Wayland/X11 via the loadable org.kde.kwin.Scripting D-Bus API."""

    name = 'kwin-script'
    platform = 'kwin'
    can_list = True
    can_control = True
    can_adopt = False

    def __init__(self) -> None:
        super().__init__()
        self._dbus = None
        self._bus = None
        self._script_path: Optional[str] = None
        self._script_iface: Optional[str] = None
        self._loop = None
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()
        self._error: Optional[str] = None

    def available(self, env: dict) -> bool:
        try:
            import dbus_next  # noqa: F401
        except ImportError:
            self.reason = 'dbus-next not installed (pip install -r requirements.txt)'
            return False
        if not env.get('DBUS_SESSION_BUS_ADDRESS'):
            self.reason = 'no session bus (run inside the target session)'
            return False
        return True

    # All D-Bus work runs on a dedicated asyncio thread.

    async def _setup(self) -> None:
        from dbus_next.aio import MessageBus
        from dbus_next.service import ServiceInterface, method
        from dbus_next import Message, MessageType

        self._dbus = __import__('dbus_next')
        bus = await MessageBus().connect()
        self._bus = bus

        # Name the KWin session owns? org.kde.KWin must be present.
        reply = await bus.call(Message(
            destination='org.freedesktop.DBus', path='/org/freedesktop/DBus',
            interface='org.freedesktop.DBus', member='NameHasOwner',
            signature='s', body=['org.kde.KWin']))
        if not reply or not reply.body or not reply.body[0]:
            raise RuntimeError('org.kde.KWin not owned on this session bus')

        bridge = self

        class SyncIface(ServiceInterface):
            def __init__(self) -> None:
                super().__init__(SYNC_BUS_NAME)

            @method()
            def pushEvent(self, event_type: 's', payload: 's') -> 's':  # type: ignore[valid-type]
                try:
                    obj = json.loads(payload)
                except Exception:
                    obj = {}
                if event_type == 'window-closed':
                    bridge.publish({'type': 'window-closed',
                                    'foreignId': obj.get('foreignId', '')})
                else:
                    bridge.publish({'type': event_type, 'window': obj})
                return 'ok'

        bus.export(SYNC_OBJ_PATH, SyncIface())
        await bus.request_name(SYNC_BUS_NAME)

        # Inject the script.
        reply = await bus.call(Message(
            destination='org.kde.KWin', path='/Scripting',
            interface='org.kde.kwin.Scripting', member='loadScript',
            signature='s', body=[str(SCRIPT_PATH)]))
        if not reply or reply.message_type != MessageType.METHOD_RETURN:
            raise RuntimeError('KWin rejected loadScript')
        script_id = reply.body[0]
        self._script_path = f'/Scripting/Script{script_id}'

        # Discover the interface exposing our functions, then start it.
        intro = await bus.introspect('org.kde.kwin.Scripting', self._script_path)
        for iface in intro.interfaces:
            if any(m.name == 'listWindows' for m in iface.methods):
                self._script_iface = iface.name
                break
        if not self._script_iface:
            self._script_iface = 'org.kde.kwin.Scripting'
        await bus.call(Message(
            destination='org.kde.kwin.Scripting', path=self._script_path,
            interface=self._script_iface, member='start'))

    async def _call_script(self, member: str, *body: Any) -> str:
        from dbus_next import Message
        reply = await self._bus.call(Message(
            destination='org.kde.kwin.Scripting', path=self._script_path,
            interface=self._script_iface, member=member,
            signature='s' * len(body) if body else '',
            body=list(body)))
        if reply and reply.body:
            return reply.body[0]
        return ''

    def _in_loop(self, coro) -> Any:
        import asyncio
        assert self._loop is not None
        fut = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return fut.result(timeout=10)

    def start(self) -> None:
        import asyncio

        def run() -> None:
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            try:
                self._loop.run_until_complete(self._setup())
            except Exception as e:  # surface via status, stay readonly
                self._error = str(e)
                self._ready.set()
                return
            self.platform = self._detect_platform()
            self._ready.set()
            self._loop.run_forever()

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()
        self._ready.wait(timeout=10)
        if self._error:
            self.can_list = False
            self.can_control = False
            self.reason = f'KWin script injection failed: {self._error}'
            return
        self.publish({'type': 'snapshot', 'windows': self.list_windows()})

    def _detect_platform(self) -> str:
        if os.environ.get('WAYLAND_DISPLAY'):
            return 'kwin-wayland'
        return 'kwin-x11'

    def stop(self) -> None:
        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)

    def list_windows(self) -> list[dict]:
        try:
            raw = self._in_loop(self._call_script('listWindows'))
            return json.loads(raw or '[]')
        except Exception:
            return []

    def command(self, foreign_id: str, action: str, args: dict) -> tuple[bool, str]:
        if action == 'set-output':
            return False, 'output migration is best-effort only on X11'
        try:
            res = self._in_loop(
                self._call_script('command', foreign_id, action, json.dumps(args)))
            if res == 'ok':
                return True, ''
            return False, res or 'KWin command failed'
        except Exception as e:
            return False, str(e)


# ---------------------------------------------------------------- detection

SOURCE_ORDER = {
    'auto': ('kwin-script', 'x11-ewmh', 'null'),
    'kwin': ('kwin-script', 'null'),
    'x11': ('x11-ewmh', 'null'),
    'mock': ('mock',),
}


def detect_source(preferred: str = 'auto', env: Optional[dict] = None,
                  runner: Runner = default_runner) -> Source:
    """First available backend on the fallback ladder."""
    env = dict(os.environ if env is None else env)
    env.setdefault('DISPLAY', env.get('DISPLAY', ''))
    candidates = {
        'kwin-script': KWinScriptSource,
        'x11-ewmh': lambda: EwmhX11Source(runner),
        'mock': MockSource,
        'null': NullSource,
    }
    reasons: list[str] = []
    for name in SOURCE_ORDER.get(preferred, SOURCE_ORDER['auto']):
        src = candidates[name]()  # type: ignore[operator]
        if src.available(env):
            return src
        reasons.append(f'{name}: {src.reason}')
    null = NullSource('; '.join(reasons))
    return null


# ---------------------------------------------------------------- http api

def capabilities_payload(source: Source) -> dict:
    return {
        'protocol': PROTOCOL,
        'platform': source.platform,
        'canList': source.can_list,
        'canControl': source.can_control,
        'canAdopt': source.can_adopt,
        'actions': sorted(ALLOWED_ACTIONS) if source.can_control else [],
        'reason': source.reason if not source.can_list else '',
        'source': source.name,
    }


def make_handler(source: Source, bus: EventBus):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, fmt: str, *a: Any) -> None:
            sys.stderr.write(f'[bridge] {fmt % a}\n')

        def _cors(self) -> None:
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')

        def _json(self, obj: Any, code: int = 200) -> None:
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            if self.path == f'{API_BASE}/capabilities':
                return self._json(capabilities_payload(source))
            if self.path == f'{API_BASE}/windows':
                return self._json({'windows': source.list_windows()})
            if self.path == f'{API_BASE}/events':
                return self._sse()
            if self.path == '/health':
                return self._json({'ok': True, 'source': source.name,
                                   'platform': source.platform})
            self._json({'error': 'not found'}, 404)

        def do_POST(self) -> None:  # noqa: N802
            if self.path != f'{API_BASE}/command':
                return self._json({'error': 'not found'}, 404)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                body = json.loads(self.rfile.read(length) or b'{}')
            except Exception:
                return self._json({'ok': False, 'error': 'bad json'}, 400)
            foreign_id = body.get('foreignId', '')
            action = body.get('action', '')
            args = body.get('args') or {}
            ok, err, clean = validate_command(foreign_id, action, args)
            if not ok:
                return self._json({'ok': False, 'error': err}, 400)
            ok2, err2 = source.command(foreign_id, action, clean)
            self._json({'ok': ok2, 'error': err2}, 200 if ok2 else 400)

        def _sse(self) -> None:
            q = bus.subscribe()
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self._cors()
            self.end_headers()
            try:
                while True:
                    try:
                        event = q.get(timeout=15)
                        data = f'data: {json.dumps(event)}\n\n'.encode()
                    except queue.Empty:
                        data = b': heartbeat\n\n'
                    self.wfile.write(data)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                bus.unsubscribe(q)

    return Handler


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--port', type=int, default=DEFAULT_PORT)
    ap.add_argument('--host', default='127.0.0.1',
                    help='bind address — keep this loopback-only')
    ap.add_argument('--source', default='auto',
                    choices=['auto', 'kwin', 'x11', 'mock'],
                    help='backend preference (default: autodetect)')
    ap.add_argument('--mock', action='store_true', help='alias for --source=mock')
    args = ap.parse_args(argv)

    preferred = 'mock' if args.mock else args.source
    source = detect_source(preferred)
    bus = EventBus()
    source.attach(bus)
    source.start()

    caps = capabilities_payload(source)
    print(f'[bridge] backend={source.name} platform={caps["platform"]} '
          f'control={caps["canControl"]} on http://{args.host}:{args.port}',
          file=sys.stderr)
    if not caps['canList']:
        print(f'[bridge] WARNING: {caps["reason"]}', file=sys.stderr)

    server = ThreadingHTTPServer((args.host, args.port), make_handler(source, bus))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        source.stop()
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
