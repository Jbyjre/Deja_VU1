"""
readiness.py
============

"Is Deja Vu1 ready and fully working?" answered with real checks, in words.

report() runs inside the server (POST /api/app/ready): the pages and every file
they load are there, demo data answers, each printer you added says its link
state, saved data can be written, and the last update's outcome. The launcher
(start.py) asks for it over HTTP once the server answers, adds what only an
outside view can see (the address answers, the page loads), and prints render()
in its window. Settings shows the same list.

Each check is "ok", "note" (works, with something to know) or "bad" (not
working). Ready means no "bad". Every "bad" names its fix, and `next` says which
paste-in block helps: "start" (Start and check) or "repair" (the update block).

The launcher imports this file, so only light modules are imported at the top.
"""
import json
import os
from pathlib import Path
import re
import shutil
import time

import storage

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / 'frontend'
RESULT_FILE = 'update-result.json'          # written by the launcher after each update attempt
LOW_DISK = 300 * 1024 * 1024                 # an update needs room for the download, the new files and a backup


def _check(cid, label, state, detail, fix=''):
    return {'id': cid, 'label': label, 'state': state, 'detail': detail, 'fix': fix}


# ---- what the launcher leaves for the server ------------------------------

def record_update(data_dir, ok, version, previous, message=''):
    """The launcher's note of an update attempt, read back by last_update()."""
    path = Path(data_dir) / RESULT_FILE
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + '.tmp')
        temp.write_text(json.dumps({'ok': bool(ok), 'version': version, 'previous': previous,
                                    'message': message, 'at': int(time.time())}), encoding='utf-8')
        os.replace(temp, path)
    except OSError:
        pass                         # the note is a courtesy; it never stops the dashboard starting


def last_update(data_dir=None):
    path = Path(data_dir or storage.DATA_DIR) / RESULT_FILE
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return {k: data.get(k) for k in ('ok', 'version', 'previous', 'message', 'at')}


def launcher_version():
    """The version of the launcher window this server runs under ('' without one or from before 0.13.7)."""
    return os.environ.get('DEJAVU_LAUNCHER_VERSION', '') if os.environ.get('DEJAVU_LAUNCHER') == '1' else ''


# ---- the checks -----------------------------------------------------------

_LOCAL = re.compile(r'''(?:src|href)=["']([^"'#?]+)''')


def page_files(page='index.html'):
    """The files a page loads from this copy (scripts, styles, fonts, icons), never other sites."""
    text = (FRONTEND / page).read_text(encoding='utf-8')
    found = []
    for ref in _LOCAL.findall(text):
        if re.match(r'^[a-z]+:', ref, re.I) or ref.startswith('//') or ref in ('.', './', '/'):
            continue
        name = ref.lstrip('./').lstrip('/')
        if name and name not in found and '.' in name.rsplit('/', 1)[-1]:
            found.append(name)
    return found


def _pages():
    missing = []
    count = 0
    for page in ('index.html', 'welcome.html', 'offline.html'):
        if not (FRONTEND / page).is_file():
            missing.append(page)
            continue
        count += 1
        for name in page_files(page):
            count += 1
            path = FRONTEND / name
            if not path.is_file() or path.stat().st_size == 0:
                missing.append(name)
    for name in ('sw.js', 'games.js', 'versions.json'):
        count += 1
        if not (FRONTEND / name).is_file():
            missing.append(name)
    if missing:
        shown = ', '.join(missing[:4]) + (f' and {len(missing) - 4} more' if len(missing) > 4 else '')
        return _check('pages', 'Pages', 'bad', f'Missing or empty in the app folder: {shown}',
                      'Paste the Repair block. It puts the app files back; your settings, printers and files stay')
    return _check('pages', 'Pages', 'ok', f'The dashboard and the {count - 3} files it loads are all there')


def _demo():
    import mock_moonraker
    ids = mock_moonraker.simulated_printer_ids()
    if not ids:
        return _check('demo', 'Demo data', 'bad', 'No demo printer is set up', 'Paste the Repair block')
    with mock_moonraker.use_printer(ids[0]):
        state = mock_moonraker.get_printer_state()
    if not isinstance(state, dict) or not state.get('state'):
        return _check('demo', 'Demo data', 'bad', 'The demo printer gave no reading', 'Paste the Repair block')
    return _check('demo', 'Demo data', 'ok', f"Demo printer 1 answers ({state.get('state')})")


def _printers():
    import fleet
    import modules
    rows = fleet.registry()['printers']
    if not rows:
        return [_check('printers', 'Printers', 'ok', 'None added yet. Add yours under Printers > Add printer')]
    if not modules.is_enabled('printer_link'):
        return [_check('printers', 'Printers', 'note', f'{len(rows)} added, but the printer link is switched off',
                       'Turn on Settings > Modules > Printer link to connect them')]
    out = []
    for row in rows:
        name = str(row.get('name') or 'Printer')[:40]
        if row.get('connected'):
            out.append(_check('printer', name, 'ok', 'Connected'))
        else:
            words = str(row.get('link') or 'Not connected').strip()
            out.append(_check('printer', name, 'note', words,
                              'Check the printer is switched on and on the same network as this computer. '
                              'Printers > Test connection says what it hears'))
    return out


def _saved_data():
    folder = Path(storage.DATA_DIR)
    probe = folder / f'.ready-check-{os.getpid()}'
    try:
        folder.mkdir(parents=True, exist_ok=True)
        probe.write_text('ok', encoding='utf-8')
        probe.unlink()
    except OSError as exc:
        return _check('data', 'Saved data', 'bad', f"Settings can't be saved: {exc.strerror or exc}",
                      'Check the disk has free space and the Deja Vu1 folder is not read-only')
    try:
        free = shutil.disk_usage(str(folder)).free
    except OSError:
        free = None
    if free is not None and free < LOW_DISK:
        return _check('data', 'Saved data', 'note', f'Only {free // (1024 * 1024)} MB free on this disk',
                      'Free some space: updates need about 300 MB while they install')
    return _check('data', 'Saved data', 'ok', 'Settings and files can be saved')


def _program(port):
    import app_updates
    version = app_updates.version()
    if os.environ.get('DEJAVU_LAUNCHER') != '1':
        return _check('program', 'Program', 'note', f'Version {version}, started without the launcher, so it '
                      "can't restart itself or install updates",
                      'Start it with the double-click launcher or the Start and check block')
    if not launcher_version():
        # Launchers from before 0.13.7 stop for good when applying an update goes wrong.
        return _check('program', 'Program', 'note', f'Version {version}. The launcher window is from an older '
                      'version, without the newest update safety net',
                      'Close the Deja Vu1 window and start it again once, to use the newest launcher')
    return _check('program', 'Program', 'ok', f'Version {version}, running with its launcher on port {port}')


def _keeps_running():
    """Whether Deja Vu1 runs without a window and comes back by itself (sign-in, wake, a stop)."""
    import autostart
    import storage
    out = []
    if os.environ.get('DEJAVU_LAUNCHER') == '1' and os.environ.get('DEJAVU_BACKGROUND') != '1':
        out.append(_check('window', 'Window', 'note', 'Deja Vu1 runs inside a window here, so closing that window '
                          'stops it', 'Start it once with the double-click launcher or the Start block: from 0.15.0 '
                          'it then runs without a window'))
    try:
        a = autostart.status()
    except Exception as exc:
        return out + [_check('autostart', 'Starts itself', 'note', f"Couldn't read it: {exc}")]
    if not a.get('supported'):
        return out
    if a.get('on') and a.get('how') == 'task':
        out.append(_check('autostart', 'Starts itself', 'ok', 'At sign-in and after waking, and checked every '
                          '5 minutes (Windows Task Scheduler)'))
    elif a.get('on'):
        out.append(_check('autostart', 'Starts itself', 'ok', 'At sign-in' + (
            ', and again if it stops with an error' if a.get('keeps_running') else '')))
    elif autostart.chosen_off(storage.DATA_DIR):
        out.append(_check('autostart', 'Starts itself', 'note', 'Off, as you chose', 'Settings > Desktop app'))
    else:
        out.append(_check('autostart', 'Starts itself', 'note', 'Off: after a restart Deja Vu1 waits to be '
                          'started', 'Settings > Desktop app > Start Deja Vu1 when this computer starts'))
    return out


def _updates():
    import app_updates
    job = app_updates.job()
    if job.get('state') == 'failed':
        return _check('updates', 'Updates', 'note', f"The last install didn't finish: {job.get('message')}",
                      'Nothing was changed. Press Install again, or paste the update block')
    if job.get('state') in ('working', 'restarting'):
        return _check('updates', 'Updates', 'ok', f"Installing now: {job.get('words')}")
    if (ROOT / '.dejavu-update').exists():
        return _check('updates', 'Updates', 'note', 'An unfinished update folder (.dejavu-update) is waiting',
                      'Close the Deja Vu1 window and start it again: the launcher finishes or undoes it')
    last = last_update()
    if last and last.get('ok') is False:
        return _check('updates', 'Updates', 'note',
                      f"The update to {last.get('version')} didn't start, so {last.get('previous')} was put back. "
                      f"{last.get('message') or ''}".strip(),
                      'Your settings and files are safe. Try Install again later, or paste the update block')
    if last and last.get('ok'):
        when = time.strftime('%d %b %H:%M', time.localtime(last.get('at') or 0))
        return _check('updates', 'Updates', 'ok', f"Updated to {last.get('version')} on {when}")
    return _check('updates', 'Updates', 'ok', 'Nothing waiting')


def report(port):
    """Every check, the overall answer and which block helps next."""
    checks = []
    for fn in (lambda: [_program(port)], _keeps_running, lambda: [_pages()], lambda: [_demo()], _printers,
               lambda: [_saved_data()], lambda: [_updates()]):
        try:
            checks.extend(fn())
        except Exception as exc:          # a check that crashes is a failure in words, never a 500
            checks.append(_check('error', 'Check', 'bad', f'{type(exc).__name__}: {exc}',
                                 'Paste the Repair block'))
    return summarise(checks, port)


def summarise(checks, port):
    bad = [c for c in checks if c['state'] == 'bad']
    notes = [c for c in checks if c['state'] == 'note']
    ready = not bad
    if ready:
        headline = 'Deja Vu1 is ready and fully working'
    else:
        headline = f"Deja Vu1 isn't working yet: {bad[0]['label'].lower()} needs fixing"
    nxt = None
    if bad:
        nxt = 'start' if any(c['id'] in ('address', 'program') for c in bad) else 'repair'
    return {'ready': ready, 'headline': headline, 'checks': checks, 'notes': len(notes),
            'next': nxt, 'url': f'http://localhost:{port}', 'checked_at': int(time.time())}


# ---- the window display ---------------------------------------------------

def _can_draw(stream):
    encoding = getattr(stream, 'encoding', None) or 'ascii'
    try:
        '✓✗!╭─╮│╰╯'.encode(encoding)
        return True
    except (UnicodeError, LookupError):
        return False


def render(rep, stream=None, windows=None, width=62):
    """The display for the launcher window or a terminal: a box with the answer, one line per check, then what to do."""
    import paste_blocks
    import sys
    import textwrap
    stream = stream or sys.stdout
    fancy = _can_draw(stream)
    mark = {'ok': '✓', 'note': '!', 'bad': '✗'} if fancy else {'ok': 'OK', 'note': '!!', 'bad': 'XX'}
    tl, tr, bl, br, h, v = ('╭', '╮', '╰', '╯', '─', '│') if fancy else ('+', '+', '+', '+', '-', '|')
    head = f" {mark['ok'] if rep['ready'] else mark['bad']}  {rep['headline']}"
    inner = max(width, len(head) + 2)
    lines = ['', f'  {tl}{h * inner}{tr}', f'  {v}{head.ljust(inner)}{v}', f'  {bl}{h * inner}{br}']
    label_w = min(15, max([len(c['label']) for c in rep['checks']] + [8]) + 2)
    for c in rep['checks']:
        first = f"   {mark[c['state']]:<2} {c['label'][:label_w - 1]:<{label_w}}"
        wrapped = textwrap.wrap(c['detail'], width=max(30, inner + 4 - len(first))) or ['']
        lines.append(first + wrapped[0])
        lines.extend(' ' * len(first) + more for more in wrapped[1:])
        if c['state'] != 'ok' and c.get('fix'):
            for i, more in enumerate(textwrap.wrap(c['fix'], width=max(30, inner - 8 - len(first)))):
                lines.append(' ' * len(first) + ('What to do: ' if i == 0 else '            ') + more)
    lines.append('')
    if rep['ready']:
        lines.append(f"  Open {rep['url']} in your browser.")
        if os.environ.get('DEJAVU_BACKGROUND_PARENT') or os.environ.get('DEJAVU_BACKGROUND'):
            lines.append('  It keeps running after you close this window.')
        else:
            lines.append('  Leave this window open: closing it stops Deja Vu1. (The Start block in')
            lines.append('  Settings starts it in the background instead, so no window is needed.)')
    elif rep.get('next'):
        windows = os.name == 'nt' if windows is None else windows
        shell = 'PowerShell' if windows else 'Terminal'
        if rep['next'] == 'start':
            lines.append(f'  Next: paste this into {shell} to start Deja Vu1 and check it again:')
        else:
            lines.append(f'  Next: paste this into {shell}. It downloads fresh app files and starts')
            lines.append('  Deja Vu1 again. Your settings, printers and files stay:')
        lines.append('')
        lines.extend('    ' + line for line in paste_blocks.for_this_computer(rep['next'], windows).splitlines())
    lines.append('')
    return '\n'.join(lines)


# ---- a report to send for help ---------------------------------------------

_SECRET = re.compile(r'(?i)((?:api[_-]?key|token|password|passwd|secret|authorization)["\'=: ]+)([^\s"\',&]+)')
LOG_LINES = 120


def _tail(path, lines=LOG_LINES):
    try:
        with open(path, 'rb') as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 64 * 1024))
            text = f.read().decode('utf-8', 'replace')
    except OSError:
        return None
    return '\n'.join(text.splitlines()[-lines:])


def help_report(port):
    """
    What someone helping needs, as plain text to paste: version, system, how
    Deja Vu1 was started and starts by itself, the readiness check, each real
    printer's connection report and the last lines of each log. Keys, tokens and
    passwords are blanked; only this computer may ask for it (it shows folders).
    """
    import platform
    import sys
    import autostart
    import launch_link
    import mock_moonraker
    import storage
    data = storage.DATA_DIR
    out = [f"Deja Vu1 help report, {time.strftime('%Y-%m-%d %H:%M:%S %z')}"]
    try:
        import app_updates
        out.append(f"Version {app_updates.version()} | Python {sys.version.split()[0]} ({sys.executable}) | "
                   f"{platform.platform()} | port {port}")
    except Exception as exc:
        out.append(f"Version unknown: {exc!r}")
    how = ", ".join(f"{k}={os.environ.get(k)}" for k in ('DEJAVU_LAUNCHER', 'DEJAVU_LAUNCHER_VERSION',
                                                         'DEJAVU_BACKGROUND') if os.environ.get(k))
    out.append("Started: " + (how or "without the launcher"))
    for name, fn in (("Starts by itself", autostart.status), ("Start link", launch_link.status)):
        try:
            out.append(f"{name}: {json.dumps(fn())}")
        except Exception as exc:
            out.append(f"{name}: couldn't read ({exc!r})")
    out.append(f"Stopped on purpose: {autostart.stopped_on_purpose(data)}")
    rep = report(port)
    out.append("")
    out.append("Check: " + rep['headline'])
    out += [f"  [{c['state']}] {c['label']}: {c['detail']}" + (f" -> {c['fix']}" if c.get('fix') and c['state'] != 'ok'
                                                                else '') for c in rep['checks']]
    for pid in mock_moonraker.printer_ids():
        if not mock_moonraker.is_real(pid):
            continue
        diag = mock_moonraker.diagnostics(pid) or {}
        out.append("")
        out.append(f"Printer {diag.get('name') or pid}: connected={diag.get('connected')} door={diag.get('door')} "
                   f"klippy={diag.get('klippy_state')} last_error={diag.get('last_error')!r} "
                   f"key_set={diag.get('api_key_set')}")
        for entry in (diag.get('log') or [])[:25]:
            out.append("  " + json.dumps(entry, default=str)[:300])
    for name in ('launcher.log', 'background.log', 'launcher-output.log', 'server.log', 'background-start.log'):
        text = _tail(os.path.join(data, 'logs', name))
        if text:
            out += ["", f"--- {name} (last lines) ---", text]
    last = last_update(data)
    if last:
        out += ["", f"Last update: {json.dumps(last)}"]
    return _SECRET.sub(lambda m: m.group(1) + '[hidden]', '\n'.join(out))
