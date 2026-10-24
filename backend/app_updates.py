"""Opt-in update checks and validated update staging. No user data is uploaded.

Two channels:
  stable  - published GitHub releases with a checksummed update package;
  latest  - the newest build on the main branch. Every app file is compared
            with GitHub's record of it (its git blob hash), only the files
            that differ are downloaded, and each download must hash to that
            exact record before anything is staged.
Either way the double-click launcher swaps the files in with the server
stopped and rolls back if the new version doesn't start (apply_pending).
Your data folder is never part of an update.
"""
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
from urllib.parse import quote, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
import zipfile

import storage

ROOT = Path(__file__).resolve().parent.parent
_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, 'app-updates.json')
REPO = 'Jbyjre/Deja_VU1'
BRANCH = 'main'
API = f'https://api.github.com/repos/{REPO}/releases/latest'
COMMIT_API = f'https://api.github.com/repos/{REPO}/commits/{BRANCH}'
TREE_API = 'https://api.github.com/repos/{repo}/git/trees/{tree}?recursive=1'
RAW = 'https://raw.githubusercontent.com/{repo}/{sha}/{path}'
CHANNELS = ('stable', 'latest')
LATEST_EVERY = 15 * 60          # how often automatic checks look for a newer build
MAX_BYTES = 128 * 1024 * 1024
MAX_UNPACKED = 512 * 1024 * 1024
_lock = threading.Lock()
_last = None
_busy = False
ROOT_FILES = {'VERSION', 'start.py', 'start-windows.bat', 'start-mac.command',
              'start-linux.sh', 'README.md', 'CHANGELOG.md', 'CLAUDE.md', 'LICENSE',
              'SECURITY.md', 'CONTRIBUTING.md', 'CREDITS.md', 'BUILD.json'}


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
    out = {'automatic': False, 'channel': 'stable', 'auto_install': False, **storage.load_json(_PATH, {})}
    if out['channel'] not in CHANNELS:
        out['channel'] = 'stable'
    return out


def save_settings(body):
    changes = {}
    if 'automatic' in body:
        if not isinstance(body['automatic'], bool):
            raise ValueError('Choose whether automatic update checks are on or off')
        changes['automatic'] = body['automatic']
    if 'auto_install' in body:
        if not isinstance(body['auto_install'], bool):
            raise ValueError('Choose whether updates install by themselves')
        changes['auto_install'] = body['auto_install']
    if 'channel' in body:
        if body['channel'] not in CHANNELS:
            raise ValueError('Choose stable releases or the newest builds')
        changes['channel'] = body['channel']
    if not changes:
        raise ValueError('Choose whether automatic update checks are on or off')
    global _last
    with _lock:
        before = settings()
        storage.save_json(_PATH, {**before, **changes, 'checked_at': 0 if changes.get('channel', before['channel']) != before['channel'] else before.get('checked_at', 0)})
        if changes.get('channel', before['channel']) != before['channel']:
            _last = None            # a check on the other channel no longer applies
    return status()


def build(root=ROOT):
    """Which commit this copy came from, when it was installed by the updater."""
    data = storage.load_json(str(Path(root) / 'BUILD.json'), {})
    return {k: data[k] for k in ('commit', 'date', 'title') if isinstance(data.get(k), str)}


def install_kind(root=ROOT):
    """'git' for a copy made with git or GitHub Desktop, 'download' for a ZIP or release copy."""
    return 'git' if (Path(root) / '.git').exists() else 'download'


def status():
    s = settings()
    kind = install_kind()
    launcher = os.environ.get('DEJAVU_LAUNCHER') == '1'
    git_found = bool(find_git()) if kind == 'git' else None
    # A git copy follows its branch on GitHub (git fetch + fast-forward), whatever the channel says.
    return {'version': version(), 'automatic': s['automatic'], 'channel': s['channel'], 'auto_install': s['auto_install'],
            'latest': _last, 'build': build(),
            'install_kind': kind, 'git_checkout': kind == 'git', 'git_found': git_found, 'launcher': launcher,
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
            or parsed.hostname not in {'api.github.com', 'github.com', 'release-assets.githubusercontent.com',
                                   'raw.githubusercontent.com'}):
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
    channel = settings()['channel']
    with _lock:
        try:
            _last = latest_info() if channel == 'latest' else release_info(json.loads(_read_url(API, 2 * 1024 * 1024)))
        except HTTPError as exc:
            _last = {'error': ('No stable release has been published yet. Choose "Newest builds" to get each '
                               'improvement as soon as it is published.') if exc.code == 404 and channel == 'stable' else
                     'GitHub could not answer the update check. Try again later.', 'checked_at': int(time.time())}
        except ValueError as exc:
            _last = {'error': str(exc), 'checked_at': int(time.time())}
        except Exception:
            _last = {'error': 'Could not check GitHub. Check your internet connection or try again later.',
                     'checked_at': int(time.time())}
            # No exception text: proxy URLs and credentials must never enter a public response.
        if _last is not None:
            _last['channel'] = channel
        return status()


# -- the newest build on main ---------------------------------------------------

_HEX40 = re.compile(r'[0-9a-f]{40}')
_hash_cache = {}


def git_blob_sha(data):
    """Git's own name for a file's content: sha1 of "blob <size>\0" + bytes."""
    return hashlib.sha1(b'blob %d\x00' % len(data) + data).hexdigest()


def _local_sha(path):
    try:
        st = path.stat()
    except OSError:
        return None
    key = (str(path), st.st_size, st.st_mtime_ns)
    hit = _hash_cache.get(key)
    if hit is None:
        try:
            hit = git_blob_sha(path.read_bytes())
        except OSError:
            return None
        _hash_cache[key] = hit
    return hit


def _newest(root):
    """(commit sha, commit, {path: tree entry}, [paths that differ here])."""
    commit = json.loads(_read_url(COMMIT_API, 2 * 1024 * 1024))
    sha = str(commit.get('sha', ''))
    tree_sha = str(((commit.get('commit') or {}).get('tree') or {}).get('sha', ''))
    if not _HEX40.fullmatch(sha) or not _HEX40.fullmatch(tree_sha):
        raise ValueError('GitHub gave an unexpected answer about the newest build')
    tree = json.loads(_read_url(TREE_API.format(repo=REPO, tree=tree_sha), 32 * 1024 * 1024))
    if tree.get('truncated'):
        raise ValueError('The newest build lists too many files for the built-in updater')
    wanted = {}
    for entry in tree.get('tree') or []:
        path = entry.get('path')
        if (entry.get('type') == 'blob' and path != 'BUILD.json' and allowed_path(path)
                and _HEX40.fullmatch(str(entry.get('sha', ''))) and entry.get('mode') in ('100644', '100755')):
            wanted[path] = entry
    for needed in ('VERSION', 'start.py', 'backend/app.py', 'frontend/index.html'):
        if needed not in wanted:
            raise ValueError('The newest build is missing required application files')
    root = Path(root)
    changed = sorted(p for p, e in wanted.items() if _local_sha(root / p) != e['sha'])
    return sha, commit, wanted, changed


def latest_info(root=ROOT):
    sha, commit, wanted, changed = _newest(root)
    meta = commit.get('commit') or {}
    title = str(meta.get('message') or '').strip().splitlines()[0][:160] if meta.get('message') else ''
    date = str((meta.get('committer') or {}).get('date') or '')[:25]
    size = sum(int(wanted[p].get('size') or 0) for p in changed)
    return {'channel': 'latest', 'commit': sha[:7], 'title': title, 'date': date,
            'available': bool(changed), 'installable': bool(changed), 'changed': len(changed), 'bytes': size,
            'checked_at': int(time.time()),
            'message': (f'A newer build is ready: {len(changed)} file{"s" if len(changed) != 1 else ""} changed '
                        f'({max(1, round(size / 1024))} KB).' if changed else 'You have the newest build.')}


def _stage_latest(root, base, before_commit):
    sha, commit, wanted, changed = _newest(root)
    if not changed:
        raise ValueError('You already have the newest build')
    total = sum(int(wanted[p].get('size') or 0) for p in changed)
    if total > MAX_BYTES:
        raise ValueError('The newest build is too large for the built-in updater')
    stage = base / 'stage'
    for path in changed:
        entry = wanted[path]
        data = _read_url(RAW.format(repo=REPO, sha=sha, path=quote(path)), int(entry.get('size') or 0) + 1)
        if git_blob_sha(data) != entry['sha']:
            raise ValueError(f'{path} did not match GitHub\'s record of it. Nothing was installed')
        dest = stage / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        if entry.get('mode') == '100755' or path.endswith(('.sh', '.command')):
            dest.chmod(0o755)
    meta = commit.get('commit') or {}
    info = {'commit': sha, 'date': str((meta.get('committer') or {}).get('date') or '')[:25],
            'title': str(meta.get('message') or '').strip().splitlines()[0][:160] if meta.get('message') else '',
            'installed_at': int(time.time())}
    (stage / 'BUILD.json').write_text(json.dumps(info, indent=2))
    files = changed + ['BUILD.json']
    _protect_data(root, files)
    new_version = (stage / 'VERSION').read_text().strip() if 'VERSION' in changed else version(root)
    if before_commit:
        before_commit()
    storage.save_json(str(base / 'pending.json'), {'version': new_version, 'files': files})
    return {'ready': True, 'version': new_version, 'commit': sha[:7], 'changed': len(changed)}


def git_update(root=ROOT):
    """
    A development copy (a git checkout) updates with git itself: a fast-forward
    pull, refused if any tracked file has local changes, so nothing is lost.
    """
    root = Path(root)
    if not (root / '.git').exists():
        raise ValueError('This copy was not installed with git')
    git = find_git()                 # PATH, or the git GitHub Desktop keeps for itself
    if not git:
        raise ValueError(GIT_MISSING)
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    dirty = subprocess.run([git, '-C', str(root), 'status', '--porcelain', '--untracked-files=no'],
                           capture_output=True, text=True, timeout=30, env=env)
    if dirty.returncode or dirty.stdout.strip():
        raise ValueError('This copy has local code changes. Commit or set them aside first; nothing was changed')
    pulled = subprocess.run([git, '-C', str(root), 'pull', '--ff-only'], capture_output=True, text=True,
                            timeout=180, env=env)
    words = re.sub(r'://[^/\s@]+@', '://', (pulled.stderr or pulled.stdout or '').strip())
    if pulled.returncode:
        raise ValueError('Git could not bring this copy up to date: ' + (words.splitlines() or ['no reason given'])[-1][:200])
    return {'updated': 'Already up to date' not in (pulled.stdout or ''), 'version': version(root)}


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


def prepare(root=ROOT, before_commit=None, channel=None):
    global _busy
    root = Path(root)
    channel = channel or settings()['channel']
    if os.environ.get('DEJAVU_LAUNCHER') != '1':
        raise ValueError('Close this server and open the app with its double-click launcher to install updates')
    if install_kind(root) == 'git':
        return _git_prepare(root, before_commit)
    with _lock:
        if _busy:
            raise ValueError('An update is already being prepared')
        _busy = True
    try:
        if channel == 'latest':
            base = root / '.dejavu-update'
            if base.exists():
                raise ValueError('An update or recovery copy already exists. Restart with the launcher first')
            try:
                return _stage_latest(root, base, before_commit)
            except Exception:
                shutil.rmtree(base, ignore_errors=True)
                raise
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
    """
    One automatic check, if one is due: the newest builds (and git copies, which
    follow main) every 15 minutes, stable releases at most once a day. Off until
    the owner opts in. Returns the result when a check ran.
    """
    s = settings()
    if not s['automatic']:
        return None
    every = LATEST_EVERY if s['channel'] == 'latest' or install_kind() == 'git' else 86400
    if time.time() - s.get('checked_at', 0) < every:
        return None
    result = check()
    with _lock:
        s = settings()
        s['checked_at'] = int(time.time())
        storage.save_json(_PATH, s)
    return result


def watch(install, stop=None, tick=60):
    """
    For the server's lifetime: run automatic checks as they fall due and, if
    the owner chose it, install a ready update through `install` (which
    refuses while any real printer is busy; the next round tries again).
    """
    stop = stop or threading.Event()
    while not stop.is_set():
        try:
            result = automatic_check()
            s = settings()
            if (result and s['auto_install'] and result.get('install_supported')
                    and (result.get('latest') or {}).get('installable')):
                install()
        except Exception:
            pass                 # a failed round is retried at the next check; nothing is half-installed
        if stop.wait(tick):
            break
