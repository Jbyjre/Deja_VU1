"""Opt-in release checks and validated update staging. No user data is uploaded."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import threading
import time
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
import zipfile

import storage

ROOT = Path(__file__).resolve().parent.parent
_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, 'app-updates.json')
API = 'https://api.github.com/repos/Jbyjre/Deja_VU1/releases/latest'
MAX_BYTES = 128 * 1024 * 1024
MAX_UNPACKED = 512 * 1024 * 1024
_lock = threading.Lock()
_last = None
_busy = False
ROOT_FILES = {'VERSION', 'start.py', 'start-windows.bat', 'start-mac.command',
              'start-linux.sh', 'README.md', 'CHANGELOG.md', 'CLAUDE.md', 'LICENSE'}


def version(root=ROOT):
    try:
        return (Path(root) / 'VERSION').read_text().strip()
    except OSError:
        return '0.1.0-dev'


def version_key(value):
    match = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?', value)
    if not match:
        raise ValueError('The release has an unsupported version number')
    # Stable releases only; local development builds sort before the same stable release.
    return tuple(int(match[n]) for n in (1, 2, 3)) + (not bool(match[4]),)


def settings():
    return {'automatic': False, **storage.load_json(_PATH, {})}


def save_settings(body):
    if not isinstance(body.get('automatic'), bool):
        raise ValueError('Choose whether automatic update checks are on or off')
    with _lock:
        storage.save_json(_PATH, {**settings(), 'automatic': body['automatic']})
    return status()


def install_kind(root=ROOT):
    """'git' for a copy made with git or GitHub Desktop, 'download' for a ZIP or release copy."""
    return 'git' if (Path(root) / '.git').exists() else 'download'


def status():
    kind = install_kind()
    launcher = os.environ.get('DEJAVU_LAUNCHER') == '1'
    git_found = bool(find_git()) if kind == 'git' else None
    return {'version': version(), 'automatic': settings()['automatic'], 'latest': _last,
            'install_kind': kind, 'launcher': launcher, 'git_found': git_found,
            'install_supported': launcher and (git_found if kind == 'git' else True),
            'busy': _busy,
            'note': 'Checks contact GitHub with the app name only. No profile name, printer details or settings are sent.'}


# ---- copies made with git or GitHub Desktop -------------------------------
# A git copy follows its branch on GitHub. Updating is a fast-forward only:
# it refuses when files were changed by hand or the copy has its own commits,
# so nothing local is ever overwritten or merged.

def _desktop_git_key(path):
    match = re.search(r'app-(\d+)\.(\d+)\.(\d+)', str(path))
    return tuple(int(n) for n in match.groups()) if match else (0, 0, 0)


def find_git(windows=None):
    found = shutil.which('git')
    if found:
        return found
    if os.name == 'nt' if windows is None else windows:
        # GitHub Desktop ships its own git and does not add it to PATH.
        base = Path(os.environ.get('LOCALAPPDATA', '')) / 'GitHubDesktop'
        bundled = sorted(base.glob('app-*/resources/app/git/cmd/git.exe'), key=_desktop_git_key, reverse=True)
        if bundled:
            return str(bundled[0])
    return None


def _git(root, *args, timeout=60):
    git = find_git()
    if not git:
        raise ValueError(GIT_MISSING)
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    done = subprocess.run([git, '-C', str(root), *args], capture_output=True, text=True, timeout=timeout,
                          stdin=subprocess.DEVNULL, creationflags=flags,
                          env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'LC_ALL': 'C'})
    if done.returncode:
        raise RuntimeError(done.stderr.strip()[:300])
    return done.stdout.strip()


GIT_MISSING = ('Git was not found on this computer. In GitHub Desktop choose Fetch origin, then Pull origin, '
               'then close and reopen the launcher.')


def git_info(root=ROOT, fetch=True):
    """Compare this copy with its branch on GitHub. Fetching downloads history only; no file changes."""
    root = Path(root)
    branch = _git(root, 'rev-parse', '--abbrev-ref', 'HEAD')
    if branch == 'HEAD':
        raise ValueError('This copy is not on a branch. Open it in GitHub Desktop and choose the main branch')
    try:
        upstream = _git(root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    except RuntimeError:
        raise ValueError(f'The branch "{branch}" is not linked to GitHub. Open GitHub Desktop and publish or switch to main')
    if fetch:
        remote = upstream.split('/', 1)[0]
        _git(root, 'fetch', '--quiet', remote, timeout=120)
    behind = int(_git(root, 'rev-list', '--count', 'HEAD..@{u}'))
    ahead = int(_git(root, 'rev-list', '--count', '@{u}..HEAD'))
    changed = bool(_git(root, 'status', '--porcelain', '--untracked-files=no'))
    try:
        remote_version = _git(root, 'show', '@{u}:VERSION').strip()
    except RuntimeError:
        remote_version = version(root)
    titles = _git(root, 'log', '--format=%s', '-n', '8', 'HEAD..@{u}').splitlines() if behind else []
    return {'branch': branch, 'upstream': upstream, 'behind': behind, 'ahead': ahead, 'changed': changed,
            'remote_version': remote_version, 'titles': titles, 'head': _git(root, 'rev-parse', 'HEAD')}


def git_release_info(info):
    behind, ready = info['behind'], info['behind'] and not info['ahead'] and not info['changed']
    if not behind:
        message = f'You have the latest version on GitHub ({info["branch"]}).'
    elif info['changed']:
        message = (f'{behind} update{"s" if behind != 1 else ""} on GitHub, but files in this folder were changed by hand. '
                   'Nothing is overwritten: review them in GitHub Desktop, then pull there.')
    elif info['ahead']:
        message = 'This copy has its own commits. Update it in GitHub Desktop so nothing is lost.'
    else:
        message = f'{behind} update{"s" if behind != 1 else ""} ready from GitHub.'
    return {'kind': 'git', 'version': info['remote_version'], 'available': bool(behind), 'installable': bool(ready),
            'behind': behind, 'changes': info['titles'], 'branch': info['branch'],
            'checked_at': int(time.time()), 'message': message}


def _git_check():
    global _last
    with _lock:
        try:
            _last = git_release_info(git_info())
        except ValueError as exc:
            _last = {'kind': 'git', 'error': str(exc), 'checked_at': int(time.time())}
        except Exception:
            # No git output in the reply: remote addresses can contain credentials.
            _last = {'kind': 'git', 'error': 'Could not reach GitHub with git. Check your internet connection, '
                     'or update in GitHub Desktop (Fetch origin, then Pull origin).', 'checked_at': int(time.time())}
        return status()


def _git_prepare(root, before_commit):
    global _busy
    with _lock:
        if _busy:
            raise ValueError('An update is already being prepared')
        _busy = True
    try:
        base = root / '.dejavu-update'
        if base.exists():
            raise ValueError('An update or recovery copy already exists. Restart with the launcher first')
        try:
            info = git_info(root)
        except RuntimeError:
            raise ValueError('Could not reach GitHub with git. Nothing was changed')
        result = git_release_info(info)
        if not result['installable']:
            raise ValueError(result['message'])
        if before_commit:
            before_commit()
        # Journal before moving: the launcher returns to this commit if the new version does not start.
        storage.save_json(str(base / 'git-pending.json'), {'version': result['version'], 'from': info['head']})
        try:
            _git(root, 'merge', '--ff-only', '--quiet', '@{u}', timeout=180)
        except Exception:
            shutil.rmtree(base, ignore_errors=True)
            raise ValueError('Git could not update this copy. Nothing was changed; try Pull origin in GitHub Desktop')
        return {'ready': True, 'version': result['version']}
    finally:
        _busy = False


def _trusted_url(url):
    parsed = urlparse(url)
    if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443)
            or parsed.hostname not in {'api.github.com', 'github.com', 'release-assets.githubusercontent.com'}):
        raise ValueError('The release download address is not trusted')
    return url


class _ReleaseRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _trusted_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _read_url(url, limit):
    request = Request(_trusted_url(url), headers={'User-Agent': 'DejaVu1-updater',
                      'Accept': 'application/vnd.github+json'})
    with build_opener(_ReleaseRedirect()).open(request, timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('The release is too large for the built-in updater')
    return data


def release_info(data):
    tag = data.get('tag_name', '')
    if data.get('draft') or data.get('prerelease') or '-' in tag:
        raise ValueError('Only stable published releases can be installed')
    newer = version_key(tag) > version_key(version())
    asset = next((a for a in data.get('assets', []) if a.get('name') == 'deja-vu1-update.zip'), None)
    digest = (asset or {}).get('digest', '') or ''
    verified = bool(re.fullmatch(r'sha256:[0-9a-fA-F]{64}', digest))
    return {'version': tag.lstrip('v'), 'available': newer, 'installable': newer and verified,
            'url': (asset or {}).get('browser_download_url'), 'digest': digest,
            'checked_at': int(time.time()),
            'message': ('A newer version is ready.' if newer else 'You have the latest stable version.')
                       + (' This release has no verified update package yet.' if newer and not verified else '')}


def check():
    global _last
    if install_kind() == 'git':
        return _git_check()
    with _lock:
        try:
            _last = release_info(json.loads(_read_url(API, 2 * 1024 * 1024)))
        except HTTPError as exc:
            _last = {'error': 'No stable release has been published yet.' if exc.code == 404 else
                     'GitHub could not answer the update check. Try again later.', 'checked_at': int(time.time())}
        except Exception:
            _last = {'error': 'Could not check GitHub. Check your internet connection or try again later.',
                     'checked_at': int(time.time())}
            # No exception text: proxy URLs and credentials must never enter a public response.
        return status()


def allowed_path(name):
    if not isinstance(name, str):
        return False
    p = PurePosixPath(name)
    parts = name.split('/')
    reserved = {'con', 'prn', 'aux', 'nul'} | {f'{prefix}{i}' for prefix in ('com', 'lpt') for i in range(1, 10)}
    return (bool(name) and '\\' not in name and ':' not in name and not p.is_absolute()
            and all(x not in ('', '.', '..') and x == x.rstrip(' .') and
                    x.split('.')[0].casefold() not in reserved for x in parts)
            and (name in ROOT_FILES or (p.parts[0] in ('backend', 'frontend', 'docs')
                 and len(p.parts) > 1 and p.parts[1].casefold() not in ('data', '__pycache__'))))


def _protect_data(root, files):
    data = Path(os.environ.get('DEJAVU_DATA_DIR') or (Path(root) / 'backend' / 'data')).resolve()
    for name in files:
        path = (Path(root) / name).resolve()
        if path == data or data in path.parents:
            raise ValueError('This update would overlap your custom data folder. Nothing was installed')


def unpack(data, target, expected_version):
    """Validate every entry before writing any file. Data and links are never accepted."""
    target = Path(target)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 12000 or sum(x.file_size for x in entries) > MAX_UNPACKED:
            raise ValueError('The unpacked release is too large')
        names = set()
        for entry in entries:
            name = entry.filename
            if (not allowed_path(name) or name.casefold() in names or entry.is_dir()
                    or stat.S_ISLNK(entry.external_attr >> 16)):
                raise ValueError('The release contains an unsafe or duplicate file')
            names.add(name.casefold())
        for needed in ('VERSION', 'start.py', 'backend/app.py', 'frontend/index.html'):
            if needed.casefold() not in names:
                raise ValueError('The release is missing required application files')
        if archive.read('VERSION').decode().strip() != expected_version:
            raise ValueError('The package version does not match the release')
        for entry in entries:
            dest = target / entry.filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(archive.read(entry))  # zipfile also verifies each CRC
            if entry.filename.endswith(('.sh', '.command')):
                dest.chmod(0o755)
    return [e.filename for e in entries]


def prepare(root=ROOT, before_commit=None):
    global _busy
    root = Path(root)
    if os.environ.get('DEJAVU_LAUNCHER') != '1':
        raise ValueError('Close this server and open the app with its double-click launcher to install updates')
    if install_kind(root) == 'git':
        return _git_prepare(root, before_commit)
    with _lock:
        if _busy:
            raise ValueError('An update is already being prepared')
        _busy = True
    try:
        info = release_info(json.loads(_read_url(API, 2 * 1024 * 1024)))
        if not info['installable']:
            raise ValueError(info['message'])
        data = _read_url(info['url'], MAX_BYTES)
        if hashlib.sha256(data).hexdigest() != info['digest'][7:].lower():
            raise ValueError('The download checksum did not match. Nothing was installed')
        base = root / '.dejavu-update'
        if base.exists():
            raise ValueError('An update or recovery copy already exists. Restart with the launcher first')
        stage = base / 'stage'
        try:
            files = unpack(data, stage, info['version'])
            _protect_data(root, files)
            if before_commit:
                before_commit()
            storage.save_json(str(base / 'pending.json'), {'version': info['version'], 'files': files})
        except Exception:
            shutil.rmtree(base, ignore_errors=True)
            raise
        return {'ready': True, 'version': info['version']}
    finally:
        _busy = False


def apply_pending(root, health_check):
    """Launcher only, with server stopped. Journal first; roll back on startup failure.

    health_check starts the new server, checks its version, and stops it before
    returning False. Data lives outside these paths and is never moved.
    """
    root = Path(root)
    base = root / '.dejavu-update'
    pending = base / 'pending.json'
    git_pending = base / 'git-pending.json'
    if git_pending.exists():
        plan = json.loads(git_pending.read_text())
        if not re.fullmatch(r'[0-9a-f]{40}', str(plan.get('from', ''))):
            raise ValueError('Invalid update recovery plan; the recovery copy was kept')
        started = health_check(plan['version'])
        if not started:
            try:
                # --keep refuses rather than discarding anything changed since.
                _git(root, 'reset', '--keep', plan['from'], timeout=120)
            except Exception:
                raise ValueError('The new version did not start and git could not return to the previous one. '
                                 'Open GitHub Desktop to check the folder; the recovery note was kept')
        shutil.rmtree(base)
        return started
    if not pending.exists():
        return None
    plan = json.loads(pending.read_text())
    files = plan['files']
    if not files or any(not allowed_path(n) for n in files):
        raise ValueError('Invalid update recovery plan')
    _protect_data(root, files)
    backup = base / 'backup'
    journal = base / 'journal.json'
    def restore(items):
        for name, existed in reversed(items):
            dest = root / name
            if existed:
                shutil.copy2(backup / name, dest)
            elif dest.exists():
                dest.unlink()
    if journal.exists():
        recovery = json.loads(journal.read_text())
        if any(name not in files or not isinstance(existed, bool) for name, existed in recovery):
            raise ValueError('Invalid update recovery journal; the recovery copy was kept')
        restore(recovery)
        shutil.rmtree(base)
        return False
    changed = []
    try:
        for name in files:
            dest = root / name
            # Refuse symlinks at every existing component, including custom installations.
            if any(p.is_symlink() for p in [dest] + list(dest.parents) if p != root.parent):
                raise ValueError('Updates cannot replace symbolic links')
            existed = dest.exists()
            if existed:
                saved = backup / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dest, saved)
            changed.append((name, existed))
            storage.save_json(str(journal), changed)
            dest.parent.mkdir(parents=True, exist_ok=True)
            temp = dest.with_name(dest.name + '.update-tmp')
            shutil.copy2(base / 'stage' / name, temp)
            os.replace(temp, dest)
        if not health_check(plan['version']):
            raise ValueError('The new version did not start')
    except Exception:
        restore(changed)
        shutil.rmtree(base)
        return False
    shutil.rmtree(base)
    return True


def automatic_check():
    """At startup and while running, at most once a day. Off until the owner opts in."""
    if not settings()['automatic']:
        return
    checked = storage.load_json(_PATH, {}).get('checked_at', 0)
    if time.time() - checked < 86400:
        return
    check()
    with _lock:
        s = settings()
        s['checked_at'] = int(time.time())
        storage.save_json(_PATH, s)


def automatic_loop(stop=None):
    """Keep checking daily for a server left running for weeks."""
    while True:
        try:
            automatic_check()
        except Exception:
            pass
        if stop and stop.wait(3600):
            return
        if not stop:
            time.sleep(3600)
