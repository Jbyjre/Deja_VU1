"""
model_inbox.py
==============

Models from the web, onto a plate. Two ways in:

  - The Downloads watcher. Off until you switch it on. While the Models or Files page is open the page asks every two
    seconds what is new in one folder (your Downloads folder unless you choose another); a model file that arrived
    after you switched it on becomes an offer: Open in Slicer, Keep in Files, or Not this one. The folder is only
    read: nothing in it is moved, changed or deleted, and nothing runs while no page asks, so the watcher costs
    nothing when Deja Vu1 is closed.
  - A pasted link to a model file, downloaded with a size cap, only from public internet addresses (never this
    computer or your home network), at most five redirects, each checked again.

Every model that comes in keeps where it came from on its card: the site and page (from the link, from the address
Windows or Linux recorded with the download, or from the 3MF itself), and the designer, title and licence when the
3MF says them, so the designer is always credited.

A .zip is unpacked with the same checks as a 3MF (safe_zip): at most 20 model files, each within the library's size
limit, folders inside it flattened, everything else left out.
"""

import email.message
import http.client
import ipaddress
import os
import socket
import ssl
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from xml.parsers import expat

import file_library
import safe_zip
import storage

MODEL_EXTENSIONS = (".3mf", ".stl", ".obj")
ARCHIVE_EXTENSIONS = (".zip",)
TAKEN_EXTENSIONS = MODEL_EXTENSIONS + ARCHIVE_EXTENSIONS
MAX_BYTES = file_library.MAX_BYTES
MAX_IN_ZIP = 20
MAX_REDIRECTS = 5
OFFER_LIMIT = 8
_SETTINGS = os.path.join(storage.DATA_DIR, "model_inbox.json")
_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_folder():
    """The Downloads folder in the person's home, when there is one."""
    home = os.path.expanduser("~")
    for name in ("Downloads", "downloads"):
        path = os.path.join(home, name)
        if os.path.isdir(path):
            return path
    return None


def _settings():
    data = storage.load_json(_SETTINGS, {})
    return {"watch": bool(data.get("watch")), "folder": data.get("folder") or None,
            "since": float(data.get("since") or 0), "handled": dict(data.get("handled") or {})}


def _save(settings):
    # Keep the handled list short: only files that could still be offered matter.
    handled = settings["handled"]
    if len(handled) > 200:
        settings["handled"] = dict(sorted(handled.items(), key=lambda kv: kv[1])[-200:])
    storage.save_json(_SETTINGS, settings)


def _folder(settings):
    return settings["folder"] or default_folder()


def _key(name, mtime):
    return f"{name}|{int(mtime)}"


def _arrivals(settings):
    """New model files in the watched folder since the watcher was switched on, newest first."""
    folder = _folder(settings)
    if not settings["watch"] or not folder or not os.path.isdir(folder):
        return []
    found = []
    try:
        names = os.listdir(folder)
    except OSError:
        return []
    for name in names:
        if not name.lower().endswith(TAKEN_EXTENSIONS) or name.startswith("."):
            continue
        path = os.path.join(folder, name)
        try:
            info = os.stat(path)
        except OSError:
            continue
        if not os.path.isfile(path) or info.st_mtime < settings["since"] or info.st_size == 0:
            continue
        if _key(name, info.st_mtime) in settings["handled"]:
            continue
        found.append({"name": name, "size": info.st_size, "too_big": info.st_size > MAX_BYTES,
                      "kind": "zip" if name.lower().endswith(ARCHIVE_EXTENSIONS) else name.rsplit(".", 1)[-1].lower(),
                      "arrived": datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat(timespec="seconds"),
                      "_mtime": info.st_mtime})
    found.sort(key=lambda f: f["_mtime"], reverse=True)
    for f in found:
        f.pop("_mtime")
    return found[:OFFER_LIMIT]


def status(here=True):
    """here is False for a phone or another computer: it sees whether the watcher is on, but not the folder's path
    or the names of the files in it, which stay on the computer running Deja Vu1."""
    with _lock:
        settings = _settings()
        folder = _folder(settings)
        out = {"watch": settings["watch"], "here": bool(here), "folder": folder, "default_folder": default_folder(),
               "folder_found": bool(folder and os.path.isdir(folder)), "offers": _arrivals(settings),
               "extensions": list(TAKEN_EXTENSIONS), "max_mb": MAX_BYTES // (1024 * 1024)}
        if not here:
            out.update(folder=None, default_folder=None, offers=[])
        return out


def set_watch(on, folder=None):
    """Switch the watcher on or off. Only files that arrive after switching on are offered."""
    with _lock:
        settings = _settings()
        if folder is not None:
            folder = str(folder).strip()
            if folder:
                folder = os.path.abspath(os.path.expanduser(folder))
                if not os.path.isdir(folder):
                    raise ValueError(f"There is no folder at {folder}. Choose a folder that exists on this computer")
            settings["folder"] = folder or None
        if on and not _folder(settings):
            raise ValueError("No Downloads folder was found on this computer. Type the folder to watch first")
        if on and not settings["watch"]:
            settings["since"] = time.time() - 1
            settings["handled"] = {}
        settings["watch"] = bool(on)
        _save(settings)
    return status()


def _find(settings, name):
    """The arrival called name, matched against the folder's own listing, so no other path can be named."""
    folder = _folder(settings)
    if not settings["watch"] or not folder:
        raise ValueError("Switch on Watch my Downloads first")
    if os.path.basename(name) != name or name not in os.listdir(folder):
        raise ValueError(f"There's no file called {name} in {folder} now")
    path = os.path.join(folder, name)
    return path, os.stat(path).st_mtime


def dismiss(name):
    with _lock:
        settings = _settings()
        path, mtime = _find(settings, str(name or ""))
        settings["handled"][_key(name, mtime)] = time.time()
        _save(settings)
    return status()


def take(name):
    """Copy an arrival into Files (unpacking a zip). Returns the files it added. The folder's file is left as it is."""
    name = str(name or "")
    with _lock:
        settings = _settings()
        path, mtime = _find(settings, name)
    if os.path.getsize(path) > MAX_BYTES:
        raise ValueError(f"{name} is over {MAX_BYTES // (1024 * 1024)} MB, more than Files takes")
    with open(path, "rb") as fh:
        data = fh.read()
    source = download_origin(path)
    added = _add(name, data, source, "download")
    with _lock:
        settings = _settings()
        settings["handled"][_key(name, mtime)] = time.time()
        _save(settings)
    return {"added": added, "status": status()}


# ---------------------------------------------------------------------------
# Adding files, with where they came from
# ---------------------------------------------------------------------------

def _add(name, data, source, origin):
    if name.lower().endswith(ARCHIVE_EXTENSIONS):
        return _unzip(name, data, source, origin)
    if not name.lower().endswith(MODEL_EXTENSIONS):
        raise ValueError(f"{name} isn't a model file. Deja Vu1 takes {', '.join(TAKEN_EXTENSIONS)}")
    src = dict(source or {})
    if name.lower().endswith(".3mf"):
        src.update({k: v for k, v in read_3mf_credits(data).items() if v and not src.get(k)})
    saved = file_library.save(name, data, origin=origin, source=_clean_source(src))
    return [saved["name"]]


def _unzip(name, data, source, origin):
    archive = safe_zip.open_archive(data, what="zip file")
    parts = [i for i in archive.infolist() if not i.is_dir()
             and i.filename.lower().endswith(MODEL_EXTENSIONS)
             and "__MACOSX" not in i.filename and not os.path.basename(i.filename).startswith(".")]
    if not parts:
        raise ValueError(f"{name} holds no model files ({', '.join(MODEL_EXTENSIONS)})")
    added = []
    for info in parts[:MAX_IN_ZIP]:
        inner = safe_zip.read(archive, info.filename, limit=MAX_BYTES, what="zip file")
        src = dict(source or {}, archive=name)
        added += _add(os.path.basename(info.filename.replace("\\", "/")), inner, src, origin)
    return added


def _clean_source(src):
    keep = {}
    for key in ("site", "page", "designer", "title", "licence", "archive", "how"):
        value = src.get(key)
        if isinstance(value, str) and value.strip():
            keep[key] = " ".join(value.split())[:300]
    page = keep.get("page")
    if page and urllib.parse.urlsplit(page).scheme not in ("http", "https"):
        keep.pop("page")
    keep["date"] = _now()[:10]
    return keep


def _site(url):
    host = (urllib.parse.urlsplit(url or "").hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


_CREDIT_NAMES = {"Designer": "designer", "Title": "title", "License": "licence", "LicenseTerms": "licence",
                 "Copyright": "copyright"}


def read_3mf_credits(data):
    """Designer, title and licence from a 3MF's own metadata (the 3MF standard's names), when it says them."""
    found = {}
    try:
        archive = safe_zip.open_archive(data, what="3MF file")
        if "3D/3dmodel.model" not in archive.namelist():
            return {}
        stream = safe_zip.open_part(archive, "3D/3dmodel.model", what="3MF file")
    except ValueError:
        return {}
    current = {"name": None, "text": []}

    class _Done(Exception):
        pass

    def start(tag, attrs):
        tag = tag.rsplit("}", 1)[-1]
        if tag == "metadata":
            current["name"], current["text"] = attrs.get("name"), []
        elif tag in ("resources", "build"):
            raise _Done()

    def end(tag):
        name = current["name"]
        if tag.rsplit("}", 1)[-1] == "metadata" and name in _CREDIT_NAMES:
            found.setdefault(_CREDIT_NAMES[name], "".join(current["text"]).strip()[:300])
        current["name"] = None

    def text(chunk):
        if current["name"] in _CREDIT_NAMES and sum(map(len, current["text"])) < 600:
            current["text"].append(chunk)

    parser = expat.ParserCreate(namespace_separator="}")
    parser.StartElementHandler, parser.EndElementHandler, parser.CharacterDataHandler = start, end, text
    try:
        with stream:
            parser.ParseFile(stream)
    except (_Done, expat.ExpatError, ValueError, OSError):
        pass
    if not found.get("licence") and found.get("copyright"):
        found["licence"] = found["copyright"]
    found.pop("copyright", None)
    return found


def download_origin(path):
    """The page a downloaded file came from, as the computer recorded it with the download (when it did)."""
    page = None
    stream = path + ":Zone.Identifier"          # Windows keeps it beside the file (Mark of the Web)
    if os.name == "nt":
        try:
            with open(stream, encoding="utf-8", errors="replace") as fh:
                values = dict(line.strip().split("=", 1) for line in fh if "=" in line)
            page = values.get("ReferrerUrl") or values.get("HostUrl")
        except OSError:
            page = None
    elif hasattr(os, "getxattr"):              # Linux browsers record it as an extended attribute
        for attr in ("user.xdg.referrer.url", "user.xdg.origin.url"):
            try:
                page = os.getxattr(path, attr).decode("utf-8", "replace")
                break
            except OSError:
                continue
    if page and urllib.parse.urlsplit(page).scheme in ("http", "https"):
        return {"site": _site(page), "page": page, "how": "Downloads"}
    return {"how": "Downloads"}


# ---------------------------------------------------------------------------
# A pasted link
# ---------------------------------------------------------------------------

def _public(address):
    """True for an address on the public internet (never this computer, a home network or a reserved range)."""
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if getattr(ip, "ipv4_mapped", None):
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _resolve(host, port):
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise ValueError(f"{host} couldn't be found. Check the link and your internet connection")
    addresses = [info[4][0] for info in infos]
    if not addresses or not all(_public(a) for a in addresses):
        raise ValueError(f"{host} is on this computer or your own network, and links are only taken from public "
                         "sites")
    return addresses[0]


class _Pinned(http.client.HTTPSConnection):
    """HTTPS to the address that was checked, so the name can't be pointed elsewhere between check and connect."""

    def __init__(self, host, port, address, **kw):
        super().__init__(host, port, context=ssl.create_default_context(), **kw)
        self._address = address

    def connect(self):
        sock = socket.create_connection((self._address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _open(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https":
        raise ValueError("Paste a link that starts with https://")
    if parts.username or parts.password:
        raise ValueError("Links with a name or password in them aren't taken")
    host, port = parts.hostname, parts.port or 443
    if not host:
        raise ValueError("That isn't a complete link")
    conn = _Pinned(host, port, _resolve(host, port), timeout=30)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    conn.request("GET", path, headers={"User-Agent": "DejaVu1-model-import", "Accept": "*/*"})
    return conn, conn.getresponse()


def _filename(response, url):
    disposition = response.getheader("Content-Disposition") or ""
    if disposition:
        msg = email.message.Message()
        msg["Content-Disposition"] = disposition
        name = msg.get_filename()
        if name:
            return os.path.basename(name.replace("\\", "/"))
    return os.path.basename(urllib.parse.unquote(urllib.parse.urlsplit(url).path))


def fetch_link(url):
    """Download a model from a pasted https link into Files. Returns the files it added."""
    url = str(url or "").strip()
    page = url
    for _ in range(MAX_REDIRECTS + 1):
        conn, response = _open(url)
        try:
            if response.status in (301, 302, 303, 307, 308):
                target = response.getheader("Location")
                if not target:
                    raise ValueError("The site sent Deja Vu1 on without saying where")
                url = urllib.parse.urljoin(url, target)
                continue
            if response.status != 200:
                raise ValueError(f"The site answered {response.status} {response.reason}. Try its own download "
                                 "button instead")
            length = response.getheader("Content-Length")
            if length and length.isdigit() and int(length) > MAX_BYTES:
                raise ValueError(f"That file is over {MAX_BYTES // (1024 * 1024)} MB, more than Files takes")
            data = response.read(MAX_BYTES + 1)
            name = _filename(response, url)
        finally:
            conn.close()
        break
    else:
        raise ValueError("The link redirected more than five times, so it was stopped")
    if len(data) > MAX_BYTES:
        raise ValueError(f"That file is over {MAX_BYTES // (1024 * 1024)} MB, more than Files takes")
    head = data[:200].lstrip().lower()
    if head.startswith((b"<!doctype", b"<html")) or not name.lower().endswith(TAKEN_EXTENSIONS):
        raise ValueError("That link opens a web page, not a model file. Open the page and use its download button: "
                         "with Watch my Downloads on, the file comes here by itself")
    return {"added": _add(name, data, {"site": _site(page), "page": page, "how": "Link"}, "download")}
