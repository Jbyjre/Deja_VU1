"""
engine_installer.py
===================

Installs and updates the slicing engine for the person: the official Snapmaker Orca release for this computer.

Snapmaker Orca is a separate program under the AGPL-3.0. Deja Vu1 does not include its code or its files: it downloads the release
Snapmaker publishes, checks it is the file Snapmaker published, unpacks it into its own folder and runs it the way a person
would from a terminal (slicer_bridge.py). Nothing here touches the Snapmaker Orca or OrcaSlicer the person may already have: the
engine is unpacked under <data>/engine/, and slicing with it uses its own settings folder (``--datadir``).

How a file is trusted, in order:
  1. its SHA-256 is in PINNED, computed on 21 November 2026 from the official v2.4.1 files;
  2. its SHA-256 matches the ``digest`` GitHub shows for that release file (a newer release);
  3. neither exists: the file is refused unless the person says to install it anyway, and it is recorded as unverified.
Only https, only GitHub's hosts (github.com and the *.githubusercontent.com hosts its downloads redirect to).

A half-finished install is never used: everything is unpacked into a staging folder, the engine is asked for its version, and only
then is the folder renamed into place and made the current engine. The previous engine stays until the next one passes its check.
The network is used only when the person presses something (check for an update, install); nothing runs in the background.
"""

import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime

import storage

_DATA_DIR = storage.DATA_DIR
ENV_FEED = "DEJAVU_ENGINE_FEED"            # tests only: a local address standing in for api.github.com
ENV_PLATFORM = "DEJAVU_ENGINE_PLATFORM"    # tests only: pretend to be another system

SOURCE_URL = "https://github.com/Snapmaker/OrcaSlicer"
RELEASES_URL = "https://api.github.com/repos/Snapmaker/OrcaSlicer/releases?per_page=12"
DOWNLOAD_URL = SOURCE_URL + "/releases/download/{tag}/{name}"
LICENCE = {"name": "AGPL-3.0", "url": SOURCE_URL + "/blob/main/LICENSE.txt", "source": SOURCE_URL,
           "note": "Snapmaker Orca runs as a separate program. Deja Vu1 does not include its code."}
ALLOWED_HOSTS = ("github.com", "api.github.com", "githubusercontent.com")
USER_AGENT = "DejaVu1-engine-installer"

# The official v2.4.1 release files, as downloaded and hashed on 21 November 2026.
PINNED = {
    ("v2.4.1", "linux-x86_64"): {
        "name": "Snapmaker_Orca_Linux_AppImage_Ubuntu2404_V2.4.1.AppImage", "size": 137423352,
        "sha256": "2b5117e22d04a3a27bcdfc5a873c55d28ff3b7ce9721946de1f134fa97d2cc06"},
    ("v2.4.1", "windows-x86_64"): {
        "name": "Snapmaker_Orca_Windows_V2.4.1_portable.zip", "size": 175353541,
        "sha256": "1f002e2168c576f800bcfd0509b5e164b5ad65a0963abc2bef8317d929d48c9d"},
    ("v2.4.1", "macos-universal"): {
        "name": "Snapmaker_Orca_Mac_universal_V2.4.1.dmg", "size": 274143110,
        "sha256": "7a590830a39835d103cd00f06f558eb0332fb4feda761e9397724c554720815f"},
}
# Which release file is the right one for each system: a pattern, because Snapmaker's file names carry the version.
ASSET_PATTERNS = {
    "linux-x86_64": re.compile(r"^Snapmaker_Orca_Linux_AppImage(?:_Ubuntu2404)?_V[\d.]+\.AppImage$"),
    "windows-x86_64": re.compile(r"^Snapmaker_Orca_Windows_V[\d.]+_portable\.zip$"),
    "macos-universal": re.compile(r"^Snapmaker_Orca_Mac_universal_V[\d.]+\.dmg$"),
}
STABLE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
MAX_ENTRIES = 40000                 # the Windows portable build has about 11,000 files
MAX_UNPACKED = 2 * 1024 ** 3        # and unpacks to about 400 MB
MAX_FILE = 800 * 1024 ** 2
UNPACK_FACTOR = 3.2                 # room needed on disk: the download plus what it unpacks to, with some to spare
EXTRACT_TIMEOUT = 600
FEED_MAX_AGE = 6 * 3600

_lock = threading.RLock()
_job = {}                           # the install in progress, or the last one that ended
_cancel = threading.Event()


class InstallCancelled(Exception):
    pass


def _now():
    return datetime.now().isoformat(timespec="seconds")


def folder():
    return os.path.join(_DATA_DIR, "engine")


def _current_file():
    return os.path.join(folder(), "current.json")


def _feed_file():
    return os.path.join(folder(), "feed.json")


def platform_key():
    forced = os.environ.get(ENV_PLATFORM, "").strip()
    if forced:
        return forced
    machine = platform.machine().lower()
    if sys.platform == "darwin":
        return "macos-universal"
    if os.name == "nt":
        return "windows-x86_64"
    if sys.platform.startswith("linux") and machine in ("x86_64", "amd64"):
        return "linux-x86_64"
    return None


def unsupported_reason(key=None):
    key = key or platform_key()
    if key in ASSET_PATTERNS:
        return None
    if sys.platform.startswith("linux"):
        return ("Snapmaker publishes its slicing engine for 64-bit Intel and AMD Linux only, not for this computer's processor "
                f"({platform.machine() or 'unknown'}). Install Snapmaker Orca another way and choose it in Slicer settings")
    return "Snapmaker publishes no slicing engine for this system. Install Snapmaker Orca yourself and choose it in Slicer settings"


# ---------------------------------------------------------------------------
# What is installed
# ---------------------------------------------------------------------------


def installed():
    """The current managed engine, or None. Checked on disk each time: a folder the person deleted is not an install."""
    rec = storage.load_json(_current_file(), None)
    if not isinstance(rec, dict) or not rec.get("program"):
        return None
    program = os.path.join(folder(), rec.get("dir", ""), rec["program"]) if rec.get("dir") else ""
    if not program or not os.path.isfile(program):
        return None
    out = dict(rec)
    out["path"] = program
    return out


def managed_program():
    rec = installed()
    return rec["path"] if rec else None


def is_managed(path):
    """True when this program lives in the managed folder, so slicing it uses the engine's own settings folder."""
    try:
        return bool(path) and os.path.realpath(path).startswith(os.path.realpath(folder()) + os.sep)
    except OSError:
        return False


def data_dir_for_engine():
    """The folder the managed engine keeps its own settings in (never the person's Snapmaker Orca folder)."""
    path = os.path.join(folder(), "engine-data")
    os.makedirs(path, exist_ok=True)
    return path


def _version_tuple(tag):
    m = STABLE_TAG.match(tag or "")
    return tuple(int(x) for x in m.groups()) if m else None


def _word_size(n):
    return f"{n / 1e6:.0f} MB" if n >= 1e6 else f"{max(1, n // 1000)} KB"


# ---------------------------------------------------------------------------
# Finding the newest release (only when asked)
# ---------------------------------------------------------------------------


def _check_url(url):
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    local = host in ("127.0.0.1", "localhost", "::1") and os.environ.get(ENV_FEED)
    if parts.scheme != "https" and not local:
        raise ValueError("The engine is downloaded over https only")
    if not local and not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
        raise ValueError(f"{host} is not a Snapmaker or GitHub address, so nothing is downloaded from it")
    return url


class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(url, timeout=30):
    _check_url(url)
    opener = urllib.request.build_opener(_Redirects)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json, */*"})
    return opener.open(req, timeout=timeout)


def _releases():
    url = os.environ.get(ENV_FEED) or RELEASES_URL
    with _open(url) as resp:
        data = json.loads(resp.read(4 * 1024 * 1024).decode("utf-8"))
    if not isinstance(data, list):
        raise ValueError("The releases list was not in the shape expected")
    return data


def _asset_for(release, key, tag):
    """The right file of one release for this system, from the release's own file list."""
    pattern = ASSET_PATTERNS[key]
    rows = [a for a in release.get("assets") or [] if isinstance(a, dict) and pattern.match(str(a.get("name") or ""))]
    # Ubuntu 24.04's build is the one Snapmaker publishes; a file marked Beta is never chosen.
    rows = [a for a in rows if "beta" not in a["name"].lower()]
    if not rows:
        return None
    a = sorted(rows, key=lambda r: ("Ubuntu2404" not in r["name"], r["name"]))[0]
    digest = str(a.get("digest") or "")
    sha = digest.split(":", 1)[1].lower() if digest.startswith("sha256:") else None
    url = a.get("browser_download_url") or DOWNLOAD_URL.format(tag=tag, name=a["name"])
    return {"name": a["name"], "size": int(a.get("size") or 0), "sha256": sha, "url": url}


def _pinned_offer(key, tag="v2.4.1"):
    p = PINNED.get((tag, key))
    if not p:
        return None
    return {"tag": tag, "version": tag.lstrip("v"), "name": p["name"], "size": p["size"], "sha256": p["sha256"],
            "url": DOWNLOAD_URL.format(tag=tag, name=p["name"]), "verified": "pinned"}


def newest(key=None):
    """The offer for this system from what is known without the network: the last answer from GitHub, or the pinned release."""
    key = key or platform_key()
    if key not in ASSET_PATTERNS:
        return None
    feed = storage.load_json(_feed_file(), None)
    if isinstance(feed, dict) and isinstance(feed.get("offers"), dict) and feed["offers"].get(key):
        offer = dict(feed["offers"][key])
        offer["checked_at"] = feed.get("checked_at")
        return offer
    return _pinned_offer(key)


def check_for_update(key=None):
    """Ask GitHub for the newest stable release (the person pressed Check). Saves the answer and returns the status."""
    key = key or platform_key()
    why = unsupported_reason(key)
    if why:
        raise ValueError(why)
    try:
        releases = _releases()
    except urllib.error.HTTPError as exc:
        raise ValueError(f"GitHub did not answer the request for the release list ({exc.code}). Try again in a minute, "
                         "or install from the file Snapmaker publishes") from None
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise ValueError(f"The release list could not be reached ({getattr(exc, 'reason', exc)}). Check the internet "
                         "connection") from None
    except ValueError as exc:
        raise ValueError(str(exc)) from None
    best = None
    for rel in releases:
        if not isinstance(rel, dict) or rel.get("draft") or rel.get("prerelease"):
            continue
        tag = str(rel.get("tag_name") or "")
        v = _version_tuple(tag)
        if not v:
            continue
        asset = _asset_for(rel, key, tag)
        if asset and (best is None or v > best[0]):
            best = (v, tag, asset)
    offers = {}
    old = storage.load_json(_feed_file(), None)
    if isinstance(old, dict) and isinstance(old.get("offers"), dict):
        offers.update(old["offers"])
    if best:
        _, tag, a = best
        pinned = PINNED.get((tag, key))
        sha = (pinned or {}).get("sha256") if pinned and pinned["name"] == a["name"] else a["sha256"]
        offers[key] = {"tag": tag, "version": tag.lstrip("v"), "name": a["name"], "size": a["size"] or (pinned or {}).get("size", 0),
                       "sha256": sha, "url": a["url"], "verified": "pinned" if pinned and pinned["name"] == a["name"] and sha == pinned["sha256"]
                       else ("github" if sha else "none")}
    os.makedirs(folder(), exist_ok=True)
    storage.save_json(_feed_file(), {"checked_at": _now(), "offers": offers})
    return status()


# ---------------------------------------------------------------------------
# Unpacking
# ---------------------------------------------------------------------------


def _safe_member(root, name):
    target = os.path.realpath(os.path.join(root, name))
    if not target.startswith(os.path.realpath(root) + os.sep) and target != os.path.realpath(root):
        raise ValueError("The download holds a file that would be written outside its folder, so it was not unpacked")
    return target


def unpack_zip(path, root):
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ValueError("The download holds far more files than a Snapmaker Orca release does, so it was not unpacked")
        total = 0
        for i, info in enumerate(infos):
            if info.file_size > MAX_FILE:
                raise ValueError("The download holds a file far larger than expected, so it was not unpacked")
            total += info.file_size
            if total > MAX_UNPACKED:
                raise ValueError("The download unpacks to far more than a Snapmaker Orca release does, so it was not unpacked")
            mode = (info.external_attr >> 16) & 0o170000
            if mode == stat.S_IFLNK:
                continue                     # a release has no use for links; one is skipped, never followed
            target = _safe_member(root, info.filename)
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out, 1024 * 1024)
            unix = (info.external_attr >> 16) & 0o777
            if unix & 0o111:
                os.chmod(target, 0o755)
            if i % 400 == 0:
                _progress(stage="unpacking", progress=0.62 + 0.3 * i / max(1, len(infos)))
                if _cancel.is_set():
                    raise InstallCancelled()


def _run(cmd, timeout, cwd=None):
    kwargs = {"stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT, "cwd": cwd}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.run(cmd, timeout=timeout, **kwargs)
    return proc.returncode, proc.stdout.decode("utf-8", "replace")


def unpack_appimage(path, root):
    """A Linux AppImage is a program that carries its files; its own --appimage-extract unpacks them without needing FUSE."""
    target = os.path.join(root, "engine.AppImage")
    shutil.move(path, target)
    os.chmod(target, 0o755)
    try:
        code, out = _run([target, "--appimage-extract"], EXTRACT_TIMEOUT, cwd=root)
    except subprocess.TimeoutExpired:
        raise ValueError("Unpacking the Linux download took more than ten minutes, so it was stopped") from None
    except OSError as exc:
        raise ValueError(f"The downloaded file could not be started to unpack it ({exc.strerror or exc})") from None
    if code != 0 or not os.path.isdir(os.path.join(root, "squashfs-root")):
        raise ValueError("The Linux download would not unpack" + (f" (it said: {out.strip()[-160:]})" if out.strip() else ""))
    os.remove(target)


def unpack_dmg(path, root):
    """macOS: mount the disk image read-only, copy the app out and unmount it."""
    mount = os.path.join(root, ".mount")
    os.makedirs(mount, exist_ok=True)
    code, out = _run(["hdiutil", "attach", "-nobrowse", "-readonly", "-noverify", "-mountpoint", mount, path], 300)
    if code != 0:
        raise ValueError("The macOS disk image could not be opened" + (f" ({out.strip()[-160:]})" if out.strip() else ""))
    try:
        apps = [n for n in os.listdir(mount) if n.endswith(".app")]
        if not apps:
            raise ValueError("The macOS disk image has no app in it")
        shutil.copytree(os.path.join(mount, apps[0]), os.path.join(root, apps[0]), symlinks=True)
    finally:
        _run(["hdiutil", "detach", mount, "-force"], 120)


def find_program(root, key):
    """The engine's command-line program inside an unpacked release, found by name, never by trusting a path in the download."""
    names = ("snapmaker-orca.exe",) if key.startswith("windows") else ("snapmaker-orca", "Snapmaker Orca", "snapmaker_orca")
    best = None
    base = os.path.realpath(root)
    for dirpath, dirs, files in os.walk(base):
        depth = dirpath[len(base):].count(os.sep)
        if depth > 5:
            dirs[:] = []
            continue
        for f in files:
            if f in names or (key.startswith("windows") and f.lower() == "snapmaker-orca.exe"):
                full = os.path.join(dirpath, f)
                if key.startswith("macos") and "Contents/MacOS" not in full.replace(os.sep, "/"):
                    continue
                if os.path.islink(full):
                    continue
                rank = depth
                if best is None or rank < best[0]:
                    best = (rank, full)
    if best is None and key.startswith("linux"):
        apprun = os.path.join(base, "squashfs-root", "AppRun")
        if os.path.isfile(apprun):
            return apprun
    return best[1] if best else None


# ---------------------------------------------------------------------------
# The install job
# ---------------------------------------------------------------------------


def _progress(**fields):
    with _lock:
        _job.update(fields)
        _job["updated"] = _now()


def _fail(message, cause=None):
    _progress(state="failed", stage="failed", error=message, cause=cause, progress=_job.get("progress", 0))


def _download(offer, dest):
    """Download to dest, counting bytes and the SHA-256 as they arrive. Returns (bytes, sha256)."""
    sha = hashlib.sha256()
    got = 0
    with _open(offer["url"], timeout=60) as resp:
        total = int(resp.headers.get("Content-Length") or offer.get("size") or 0)
        if offer.get("size") and total and abs(total - offer["size"]) > 0 and offer.get("verified") == "pinned":
            raise ValueError(f"The file on the server is {total} bytes, not the {offer['size']} bytes Deja Vu1 expects, so it was not downloaded")
        _progress(stage="downloading", total=total or offer.get("size", 0), progress=0.0)
        started = time.monotonic()
        with open(dest, "wb") as out:
            while True:
                if _cancel.is_set():
                    raise InstallCancelled()
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                sha.update(chunk)
                got += len(chunk)
                span = max(0.001, time.monotonic() - started)
                want = total or offer.get("size") or 0
                _progress(bytes=got, progress=min(0.58, 0.58 * got / want) if want else 0.0, rate=int(got / span))
    return got, sha.hexdigest()


def _free_space_ok(offer):
    os.makedirs(folder(), exist_ok=True)
    need = int((offer.get("size") or 150_000_000) * UNPACK_FACTOR)
    free = shutil.disk_usage(folder()).free
    if free < need:
        raise ValueError(f"There is not enough free space: the engine needs about {_word_size(need)} while it installs and this "
                         f"disk has {_word_size(free)} free")


def _install(offer, key, allow_unverified):
    import slicer_bridge
    tag, version = offer["tag"], offer["version"]
    work = os.path.join(folder(), ".work")
    staging = os.path.join(folder(), f".staging-{version}")
    final_dir = f"v{version}" if not tag.startswith("v") else tag
    final = os.path.join(folder(), final_dir)
    try:
        shutil.rmtree(work, ignore_errors=True)
        shutil.rmtree(staging, ignore_errors=True)
        os.makedirs(work)
        os.makedirs(staging)
        _free_space_ok(offer)
        part = os.path.join(work, offer["name"] + ".part")
        got, digest = _download(offer, part)
        _progress(stage="verifying", progress=0.6)
        if offer.get("size") and got != offer["size"]:
            raise ValueError(f"The download ended at {got} bytes, not the {offer['size']} bytes the release lists, so it was thrown away")
        expected = offer.get("sha256")
        if expected:
            if digest != expected.lower():
                raise ValueError("The file's checksum is not the one Snapmaker's release lists for it, so it was thrown away and "
                                 "nothing was installed")
            verified = offer.get("verified") if offer.get("verified") in ("pinned", "github") else "github"
        elif allow_unverified:
            verified = "none"
        else:
            raise ValueError("GitHub shows no checksum for this release file, so Deja Vu1 cannot tell it is the file Snapmaker "
                             "published. Nothing was installed. Install anyway only if you trust this release")
        _progress(stage="unpacking", progress=0.62, verified=verified)
        path = os.path.join(work, offer["name"])
        os.replace(part, path)
        if key.startswith("windows"):
            unpack_zip(path, staging)
        elif key.startswith("linux"):
            unpack_appimage(path, staging)
        else:
            unpack_dmg(path, staging)
        if _cancel.is_set():
            raise InstallCancelled()
        program = find_program(staging, key)
        if not program:
            raise ValueError("The download unpacked, but the slicing program was not in it where it should be")
        if os.name != "nt":
            os.chmod(program, os.stat(program).st_mode | 0o111)
        rel_program = os.path.relpath(program, staging)
        # Only a finished, checked engine takes the place of the old one.
        _progress(stage="checking", progress=0.95)
        previous = storage.load_json(_current_file(), None)
        shutil.rmtree(final, ignore_errors=True)
        os.replace(staging, final)
        new_program = os.path.join(final, rel_program)
        result = slicer_bridge.check(path=new_program, save=False)
        if not result.get("ok"):
            shutil.rmtree(final, ignore_errors=True)
            _fail("The engine unpacked but did not start: " + str(result.get("error") or "it gave no answer"), result.get("cause"))
            return
        record = {"version": version, "tag": tag, "dir": final_dir, "program": rel_program, "name": offer["name"], "size": got,
                  "sha256": digest, "verified": verified, "installed_at": _now(), "app": result.get("app"),
                  "engine_version": result.get("version"), "platform": key}
        os.makedirs(folder(), exist_ok=True)
        storage.save_json(_current_file(), record)
        if isinstance(previous, dict) and previous.get("dir") and previous["dir"] != final_dir:
            record_prev = {"version": previous.get("version"), "dir": previous["dir"]}
            storage.save_json(os.path.join(folder(), "previous.json"), record_prev)
        _tidy(keep=(final_dir, (previous or {}).get("dir")))
        _use_it(new_program)
        _progress(state="done", stage="done", progress=1.0, finished=_now(), check=result.get("detail"))
    except InstallCancelled:
        shutil.rmtree(staging, ignore_errors=True)
        _progress(state="cancelled", stage="cancelled", error="Installing was cancelled. Nothing was changed")
    except (ValueError, zipfile.BadZipFile) as exc:
        shutil.rmtree(staging, ignore_errors=True)
        _fail(str(exc) if not isinstance(exc, zipfile.BadZipFile) else "The download is not a readable archive, so nothing was installed")
    except urllib.error.HTTPError as exc:
        shutil.rmtree(staging, ignore_errors=True)
        _fail(f"The download was refused ({exc.code}). Try again in a minute")
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        shutil.rmtree(staging, ignore_errors=True)
        _fail(f"The download stopped ({getattr(exc, 'reason', None) or exc}). Check the internet connection and try again")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _tidy(keep):
    """Keep the new engine and the one before it; older ones go."""
    try:
        for name in os.listdir(folder()):
            if re.match(r"^v?\d+\.\d+\.\d+", name) and name not in keep:
                shutil.rmtree(os.path.join(folder(), name), ignore_errors=True)
    except OSError:
        pass


def _use_it(program):
    """Make the managed engine the one slicing uses, unless the person chose a program of their own."""
    import slicer_bridge
    s = slicer_bridge.get_settings()
    chosen = s.get("slicer_path") or ""
    if chosen and not is_managed(chosen):
        return
    s["slicer_path"] = ""
    s["last_check"] = None
    slicer_bridge._save(s)
    slicer_bridge.check()


def install(allow_unverified=False):
    """Start installing the newest engine for this system in the background. Returns the status."""
    key = platform_key()
    why = unsupported_reason(key)
    if why:
        raise ValueError(why)
    offer = newest(key)
    if not offer:
        raise ValueError("No engine release is known for this system")
    with _lock:
        if _job.get("state") in ("running",):
            raise ValueError("An engine install is already running")
        _cancel.clear()
        _job.clear()
        _job.update(state="running", stage="starting", progress=0.0, bytes=0, total=offer.get("size", 0), version=offer["version"],
                    verified=offer.get("verified"), started=_now(), error=None, cause=None)
    t = threading.Thread(target=_install, args=(offer, key, bool(allow_unverified)), daemon=True, name="engine-install")
    t.start()
    _job["_thread"] = t
    return status()


def cancel():
    _cancel.set()
    return status()


def wait(timeout=30):
    t = _job.get("_thread")
    if t:
        t.join(timeout)
    return status()


def reset():
    """Tests: forget the last job."""
    _cancel.clear()
    with _lock:
        _job.clear()


# ---------------------------------------------------------------------------
# What the screen shows
# ---------------------------------------------------------------------------


def status():
    key = platform_key()
    why = unsupported_reason(key)
    rec = installed()
    offer = newest(key) if not why else None
    update = bool(rec and offer and (_version_tuple(offer["tag"]) or (0,)) > (_version_tuple(rec.get("tag")) or (0,)))
    with _lock:
        job = {k: v for k, v in _job.items() if not k.startswith("_")} or None
    return {
        "supported": not why, "reason": why, "platform": key,
        "installed": ({k: rec.get(k) for k in ("version", "tag", "path", "installed_at", "verified", "app", "engine_version", "name", "size")}
                      if rec else None),
        "offer": ({"version": offer["version"], "tag": offer["tag"], "name": offer["name"], "size": offer.get("size", 0),
                   "size_words": _word_size(offer.get("size", 0)), "verified": offer.get("verified"),
                   "checked_at": offer.get("checked_at")} if offer else None),
        "update": update,
        "job": job,
        "licence": LICENCE,
        "data_dir": folder(),
        "separate": "Deja Vu1 keeps this engine and its settings in its own folder. Your own Snapmaker Orca or OrcaSlicer, if you have "
                    "one, is never read or changed.",
    }
