"""
safe_zip.py
===========

Opening ZIP archives someone uploaded (3MF projects and models are ZIPs)
without letting a damaged or hostile one hurt the dashboard.

  - Every part's unpacked size is checked *before* it is unpacked, and the
    read is capped too: zipfile never unpacks more than a part declares,
    so a "zip bomb" (a small file that unpacks to gigabytes) is refused in
    words instead of filling the Raspberry Pi's memory.
  - Every way a damaged archive fails - not a zip at all, a bad checksum,
    corrupt compressed data, a compression method or ZIP version Python
    can't read, an encrypted part - becomes a ValueError that says so, which
    the web server reports as a 400 in words, never a crash.
"""

import io
import zipfile
import zlib

MAX_PART_BYTES = 512 * 1024 * 1024       # no real 3MF part is anywhere near this
MAX_TOTAL_BYTES = 1024 * 1024 * 1024


class DamagedArchive(ValueError):
    """The archive can't be read (damaged, hostile, or a kind Python can't unpack)."""


def open_archive(data, what="3MF file"):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        infos = archive.infolist()
    except (zipfile.BadZipFile, zipfile.LargeZipFile, NotImplementedError, ValueError, OSError, EOFError) as exc:
        raise DamagedArchive(f"Not a readable {what} (it isn't a valid zip archive: {exc})")
    total = sum(i.file_size for i in infos)
    if total > MAX_TOTAL_BYTES:
        raise DamagedArchive(f"The {what} would unpack to {total // (1024 * 1024)} MB - far more than a real one "
                             "holds, so it wasn't opened")
    return archive


def _check(archive, name, limit, what):
    try:
        info = archive.getinfo(name)
    except KeyError:
        raise DamagedArchive(f"The {what} has no part called {name}")
    if info.flag_bits & 0x1:
        raise DamagedArchive(f"The {what}'s part {name} is encrypted - it can't be read")
    if info.file_size > limit:
        raise DamagedArchive(f"The {what}'s part {name} would unpack to {info.file_size // (1024 * 1024)} MB - "
                             "more than a real one holds, so it wasn't opened")
    return info


def read(archive, name, limit=MAX_PART_BYTES, what="3MF file"):
    """One part's bytes, size-checked before and while unpacking."""
    info = _check(archive, name, limit, what)
    try:
        with archive.open(info) as fh:
            data = fh.read(limit + 1)
    except (zipfile.BadZipFile, zlib.error, NotImplementedError, EOFError, OSError, RuntimeError) as exc:
        raise DamagedArchive(f"The {what} is damaged - its part {name} can't be unpacked ({exc})")
    if len(data) > limit:
        raise DamagedArchive(f"The {what}'s part {name} is larger than it says - refused")
    return data


class _Guarded(io.RawIOBase):
    """A part opened for streaming whose unpacking errors come out as DamagedArchive."""

    def __init__(self, fh, name, what):
        self._fh, self._name, self._what = fh, name, what

    def readable(self):
        return True

    def read(self, n=-1):
        try:
            return self._fh.read(n)
        except (zipfile.BadZipFile, zlib.error, NotImplementedError, EOFError, OSError, RuntimeError) as exc:
            raise DamagedArchive(f"The {self._what} is damaged - its part {self._name} can't be unpacked ({exc})")

    def close(self):
        self._fh.close()
        super().close()


def open_part(archive, name, limit=MAX_PART_BYTES, what="3MF file"):
    """A part as a stream (for a parser that reads as it goes), with the same checks as read()."""
    info = _check(archive, name, limit, what)
    try:
        return _Guarded(archive.open(info), name, what)
    except (zipfile.BadZipFile, zlib.error, NotImplementedError, EOFError, OSError, RuntimeError) as exc:
        raise DamagedArchive(f"The {what} is damaged - its part {name} can't be unpacked ({exc})")
