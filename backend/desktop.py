"""How the launcher opens the dashboard: a browser tab, its own app window, or nothing.

An app window is the same dashboard in a window with no tabs or address bar,
using Microsoft Edge or Google Chrome's --app mode. Nothing extra is installed.
The launcher window still runs the server; closing an app window does not stop it.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import webbrowser

import storage

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, 'desktop.json')
MODES = ('browser', 'window', 'none')


def _windows_candidates():
    roots = [os.environ.get(k) for k in ('PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA')]
    # Edge first: Windows 10 and 11 include it, so the option works without a download.
    for name, rel in (('Microsoft Edge', r'Microsoft\Edge\Application\msedge.exe'),
                      ('Google Chrome', r'Google\Chrome\Application\chrome.exe')):
        for root in filter(None, roots):
            yield name, os.path.join(root, rel)


def _mac_candidates():
    for name in ('Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser'):
        for apps in ('/Applications', os.path.expanduser('~/Applications')):
            yield name, f'{apps}/{name}.app/Contents/MacOS/{name}'


def _linux_candidates():
    for name, command in (('Google Chrome', 'google-chrome'), ('Google Chrome', 'google-chrome-stable'),
                          ('Chromium', 'chromium'), ('Chromium', 'chromium-browser'),
                          ('Microsoft Edge', 'microsoft-edge'), ('Brave', 'brave-browser')):
        found = shutil.which(command)
        if found:
            yield name, found


def app_browser(platform=None):
    """(name, path) of a browser that can open an app window, or None."""
    platform = platform or ('windows' if os.name == 'nt' else 'mac' if sys.platform == 'darwin' else 'linux')
    candidates = {'windows': _windows_candidates, 'mac': _mac_candidates, 'linux': _linux_candidates}[platform]()
    for name, path in candidates:
        if Path(path).is_file():
            return name, path
    return None


def settings():
    saved = storage.load_json(_PATH, {})
    found = app_browser()
    return {'open_as': saved.get('open_as') if saved.get('open_as') in MODES else 'browser',
            'window_browser': found[0] if found else None}


def save_settings(body):
    if body.get('open_as') not in MODES:
        raise ValueError('Choose browser tab, app window or nothing')
    storage.save_json(_PATH, {'open_as': body['open_as']})
    return settings()


def launch_mode():
    """DEJAVU_WINDOW (browser/window/none) or DEJAVU_NO_BROWSER=1 override the saved choice."""
    if os.environ.get('DEJAVU_NO_BROWSER') == '1':
        return 'none'
    chosen = os.environ.get('DEJAVU_WINDOW', '').strip().lower()
    return chosen if chosen in MODES else settings()['open_as']


def open_dashboard(url, mode=None):
    """Returns what was opened: 'window', 'browser' or 'none'."""
    mode = mode or launch_mode()
    if mode == 'none':
        return 'none'
    found = app_browser() if mode == 'window' else None
    if found:
        try:
            subprocess.Popen([found[1], f'--app={url}'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=os.name != 'nt')
            return 'window'
        except OSError:
            pass  # fall back to an ordinary tab rather than opening nothing
    webbrowser.open(url)
    return 'browser'
