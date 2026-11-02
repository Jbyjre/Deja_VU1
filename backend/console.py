"""
console.py
==========

Where Deja Vu1's own messages go, made safe for every way it can be started.

Three problems this solves, all seen only away from a terminal:

  - No window at all. Started in the background on Windows (pythonw.exe, a
    detached process), Python has no output streams: sys.stdout and
    sys.stderr are None. The web server wrote one line per button press to
    sys.stderr, so every move, home or other command raised an error while
    replying and the browser never heard back. `ensure_streams` gives a
    program without streams a log file instead (<data>/logs/<name>.log).
  - A paused window. In a Windows console, clicking inside the window starts
    "Quick Edit" selection, and every program writing to that window stops at
    its next line until a key is pressed. `buffered` hands lines to a
    background thread, so a paused window never holds up a reply, and
    `disable_quick_edit` switches the selection mode off for Deja Vu1's own
    window.
  - A broken stream. A closed pipe or a full disk never stops the dashboard:
    a line that can't be written is dropped.
"""

import atexit
import os
import queue
import sys
import threading
import time

LOG_LIMIT = 1024 * 1024          # a log over this size keeps only its newest half at the next start


def _trim(path, limit=LOG_LIMIT):
    try:
        if os.path.getsize(path) <= limit:
            return
        with open(path, "rb") as f:
            f.seek(-limit // 2, os.SEEK_END)
            tail = f.read()
        with open(path, "wb") as f:
            f.write(tail)
    except OSError:
        pass


def log_path(data_dir, name):
    return os.path.join(data_dir, "logs", name + ".log")


def ensure_streams(data_dir, name):
    """
    Give a program started without output streams a log file for them. Returns
    the file's path when one was opened, else None (the streams already work).
    """
    missing = [s for s in ("stdout", "stderr") if not _usable(getattr(sys, s, None))]
    if not missing:
        return None
    path = log_path(data_dir, name)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        _trim(path)
        out = open(path, "a", encoding="utf-8", errors="replace", buffering=1)
    except OSError:
        out = _Nowhere()
        path = None
    for s in missing:
        setattr(sys, s, out)
    if path:
        out.write(time.strftime("\n%Y-%m-%d %H:%M:%S ") + f"Started without a window; messages go here (pid {os.getpid()})\n")
    return path


def _usable(stream):
    if stream is None:
        return False
    try:
        stream.fileno()
    except (AttributeError, OSError, ValueError):
        # No file descriptor (a test's StringIO, an IDE's console) still writes fine.
        return hasattr(stream, "write")
    return True


class _Nowhere:
    encoding = "utf-8"

    def write(self, text):
        return len(text)

    def flush(self):
        pass

    def isatty(self):
        return False


class _Buffered:
    """A stream whose writes never wait: a thread of its own does the real writing."""

    def __init__(self, stream):
        self._stream = stream
        self._lines = queue.SimpleQueue()
        self._idle = threading.Event()
        self._idle.set()
        self.encoding = getattr(stream, "encoding", None) or "utf-8"
        threading.Thread(target=self._run, name="console-writer", daemon=True).start()

    def write(self, text):
        if text:
            self._idle.clear()
            self._lines.put(text)
        return len(text)

    def flush(self):
        pass

    def isatty(self):
        try:
            return self._stream.isatty()
        except (AttributeError, OSError, ValueError):
            return False

    def fileno(self):
        return self._stream.fileno()

    def drain(self, timeout=1.0):
        """Wait a moment for queued lines to be written (at exit)."""
        self._idle.wait(timeout)

    def _run(self):
        while True:
            text = self._lines.get()
            try:
                self._stream.write(text)
                self._stream.flush()
            except Exception:
                pass                 # a closed window or full disk drops the line, never the dashboard
            if self._lines.empty():
                self._idle.set()


def buffered():
    """Make sys.stdout and sys.stderr never block the caller. Safe to call twice."""
    for s in ("stdout", "stderr"):
        current = getattr(sys, s, None)
        if current is None or isinstance(current, _Buffered):
            continue
        wrapped = _Buffered(current)
        setattr(sys, s, wrapped)
        atexit.register(wrapped.drain)


def write(text, stream=None):
    """One line to stderr (or the stream given) that can never raise."""
    try:
        target = stream or sys.stderr
        if target is not None:
            target.write(text)
    except Exception:
        pass


def disable_quick_edit():
    """
    Windows only: switch off Quick Edit selection in this program's console
    window, so a click inside it doesn't pause Deja Vu1. Selecting text with
    the mouse then needs the window menu's Edit > Mark. Returns True when it
    was switched off.
    """
    if os.name != "nt":
        return False
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-10)          # STD_INPUT_HANDLE
        mode = ctypes.c_uint32()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False                             # no console (background start): nothing to pause
        quick_edit, extended = 0x0040, 0x0080        # ENABLE_QUICK_EDIT_MODE, ENABLE_EXTENDED_FLAGS
        return bool(kernel32.SetConsoleMode(handle, (mode.value & ~quick_edit) | extended))
    except Exception:
        return False
