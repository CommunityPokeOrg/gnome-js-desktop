"""Unit tests for kwin_sync_bridge — no real KWin/D-Bus/X11 required."""

import json
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import kwin_sync_bridge as b  # noqa: E402


# ---------------------------------------------------------------- validation

def test_validate_command_accepts_known_actions():
    ok, err, args = b.validate_command('0x1', 'move', {'x': 10, 'y': 20})
    assert ok and args == {'x': 10.0, 'y': 20.0}
    ok, _, _ = b.validate_command('w', 'set-workspace', {'workspace': -3})
    assert ok  # clamped, not rejected


def test_validate_command_rejects_unknown_and_bad_args():
    ok, err, _ = b.validate_command('w', 'exec', {})
    assert not ok and 'unsupported' in err
    ok, err, _ = b.validate_command('w', 'move', {'x': 'left', 'y': 0})
    assert not ok and 'numeric' in err
    ok, err, _ = b.validate_command('w', 'resize', {'width': 0, 'height': 0})
    assert not ok
    ok, err, _ = b.validate_command('', 'focus', {})
    assert not ok


# ---------------------------------------------------------------- wmctrl parse

LG_OUTPUT = """\
0x03a00007  0  100  60   800  500  myhost  Konsole — fish
0x03e0000b  -1 0    0    0    0     myhost  Minimized Thing
0x02200003  1  50   50   640  480   myhost  Settings
"""

LX_OUTPUT = """\
0x03a00007  0  konsole.Konsole       myhost  Konsole — fish
0x03e0000b  0  telegram.Telegram     myhost  Minimized Thing
0x02200003  1  gnome-control-center  myhost  Settings
"""


def test_parse_wmctrl_lg_geometry_and_desktop():
    wins = b.EwmhX11Source.parse_wmctrl_lg(LG_OUTPUT)
    assert wins['0x03a00007']['geometry'] == {
        'x': 100, 'y': 60, 'width': 800, 'height': 500}
    assert wins['0x03a00007']['workspace'] == 0
    assert wins['0x02200003']['title'] == 'Settings'
    assert wins['0x03e0000b']['workspace'] == -1  # sticky/all-desktops


def test_parse_wmctrl_lx_classes():
    cls = b.EwmhX11Source.parse_wmctrl_lx(LX_OUTPUT)
    assert cls['0x03a00007'] == 'konsole.Konsole'


def test_ewmh_fetch_merges_class_and_marks_minimized():
    def runner(cmd):
        out = LG_OUTPUT if '-lG' in cmd else LX_OUTPUT
        return subprocess.CompletedProcess(cmd, 0, stdout=out, stderr='')

    src = b.EwmhX11Source(runner)
    wins = src._fetch()
    assert wins['0x03a00007']['appId'] == 'konsole'
    assert wins['0x03e0000b']['minimized'] is True
    assert wins['0x02200003']['minimized'] is False


def test_ewmh_commands_use_wmctrl_and_xdotool():
    calls = []

    def runner(cmd):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout='', stderr='')

    src = b.EwmhX11Source(runner)
    src._known = {'0x1': {'geometry': {'x': 0, 'y': 0, 'width': 100, 'height': 100}}}
    assert src.command('0x1', 'focus', {}) == (True, '')
    assert ['wmctrl', '-i', '-a', '0x1'] in calls
    assert src.command('0x1', 'move', {'x': 5.0, 'y': 7.0}) == (True, '')
    assert ['wmctrl', '-i', '-r', '0x1', '-e', '0,5,7,100,100'] in calls
    assert src.command('0x1', 'set-workspace', {'workspace': 2.0}) == (True, '')
    assert ['wmctrl', '-i', '-r', '0x1', '-t', '2'] in calls


def test_ewmh_command_surfaces_failures():
    def runner(cmd):
        return subprocess.CompletedProcess(cmd, 1, stdout='', stderr='no such window')

    src = b.EwmhX11Source(runner)
    ok, err = src.command('0xdead', 'focus', {})
    assert not ok and 'no such window' in err


# ---------------------------------------------------------------- mock source

def test_mock_source_full_lifecycle():
    bus = b.EventBus()
    src = b.MockSource()
    src.attach(bus)
    q = bus.subscribe()
    src.start()
    evt = q.get(timeout=1)
    assert evt['type'] == 'snapshot' and len(evt['windows']) == 3

    ok, _ = src.command('mock-1', 'move', {'x': 1, 'y': 2})
    assert ok and q.get(timeout=1)['type'] == 'window-changed'
    ok, _ = src.command('mock-1', 'close', {})
    assert ok and q.get(timeout=1)['type'] == 'window-closed'
    ok, err = src.command('mock-1', 'focus', {})
    assert not ok and 'unknown window' in err


# ---------------------------------------------------------------- detection

def test_detect_source_falls_back_to_null(monkeypatch):
    monkeypatch.setattr(b.shutil, 'which', lambda _: None)
    src = b.detect_source('auto', env={'DISPLAY': '', 'DBUS_SESSION_BUS_ADDRESS': ''})
    assert src.name == 'null'
    assert 'no usable' in src.reason or 'kwin-script' in src.reason


def test_detect_source_prefers_x11_when_display_and_wmctrl(monkeypatch):
    monkeypatch.setattr(b.shutil, 'which', lambda name: '/usr/bin/wmctrl')
    src = b.detect_source('x11', env={'DISPLAY': ':0'})
    assert src.name == 'x11-ewmh'


def test_detect_source_mock():
    assert b.detect_source('mock').name == 'mock'


# ---------------------------------------------------------------- http api

@pytest.fixture()
def server():
    src = b.MockSource()
    bus = b.EventBus()
    src.attach(bus)
    src.start()
    srv = b.ThreadingHTTPServer(('127.0.0.1', 0), b.make_handler(src, bus))
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f'http://127.0.0.1:{srv.server_address[1]}'
    srv.shutdown()
    srv.server_close()


def _get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.loads(r.read())


def test_http_endpoints(server):
    caps = _get(f'{server}/api/v1/capabilities')
    assert caps['protocol'] == b.PROTOCOL
    assert caps['canList'] and caps['canControl']
    assert 'focus' in caps['actions']

    wins = _get(f'{server}/api/v1/windows')['windows']
    assert len(wins) == 3
    assert wins[0]['foreignId'] == 'mock-1'

    req = urllib.request.Request(
        f'{server}/api/v1/command', method='POST',
        data=json.dumps({'foreignId': 'mock-1', 'action': 'minimize'}).encode(),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=5) as r:
        assert json.loads(r.read())['ok'] is True

    wins = _get(f'{server}/api/v1/windows')['windows']
    assert next(w for w in wins if w['foreignId'] == 'mock-1')['minimized'] is True


def test_http_rejects_bad_commands(server):
    req = urllib.request.Request(
        f'{server}/api/v1/command', method='POST',
        data=json.dumps({'foreignId': 'x', 'action': 'rm -rf /'}).encode(),
        headers={'Content-Type': 'application/json'})
    with pytest.raises(Exception) as ei:
        urllib.request.urlopen(req, timeout=5)
    assert '400' in str(ei.value)


def test_http_sse_stream(server):
    # One event is guaranteed: MockSource publishes on command.
    req = urllib.request.Request(
        f'{server}/api/v1/events', headers={'Accept': 'text/event-stream'})
    resp = urllib.request.urlopen(req, timeout=5)
    cmd = urllib.request.Request(
        f'{server}/api/v1/command', method='POST',
        data=json.dumps({'foreignId': 'mock-2', 'action': 'minimize'}).encode(),
        headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(cmd, timeout=5)
    deadline = time.time() + 5
    buf = b''
    try:
        while time.time() < deadline and b'window-changed' not in buf:
            line = resp.readline()
            if not line:
                break
            buf += line
    except TimeoutError:
        pass
    assert b'window-changed' in buf
    resp.close()
