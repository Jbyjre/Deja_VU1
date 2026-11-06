"""
slice_diagnosis.py
==================

Why a slice or an engine check failed, in words a person can act on, and the
facts a helper needs to look into it. Pure functions: nothing here runs a
program, reads a setting or touches a file, so every rule can be tested with
the text a failing engine really prints.

What it recognises is limited to messages whose wording is documented or was
seen from a real failing program:

  - Linux's loader: "error while loading shared libraries: X: cannot open
    shared object file" and "version `GLIBC_2.38' not found"
  - macOS's loader: "Library not loaded: X"
  - an AppImage whose runtime wants FUSE 2 ("dlopen(): error loading
    libfuse.so.2")
  - GTK's "cannot open display"
  - C++'s uncaught std::bad_alloc
  - POSIX signals (a negative exit code in Python) and the three Windows
    exit codes that mean "couldn't load a file" or "crashed"
  - Snapmaker Orca's own result.json codes (src/libslic3r/Utils.hpp)

Anything else stays what it was: "Orca exited with code N" and its last line.
The package names given as fixes are only the ones checked against Debian's and
Ubuntu's package lists; for any other library the fix says to install whatever
package provides it, never a guessed name.
"""

import hashlib
import os
import platform
import re
import sys

SCHEMA = "dejavu1.slice-report/1"

# Where a slice can stop, in the order it goes through them.
STAGES = (
    ("input", "Reading the model"),
    ("engine", "Checking the engine"),
    ("profile", "Checking the presets"),
    ("heights", "Checking layer heights"),
    ("prepare", "Preparing the plate"),
    ("slice", "Slicing"),
    ("output", "Checking the G-code"),
    ("save", "Saving to the library"),
    ("done", "Finished"),
)
_STAGE_WORDS = dict(STAGES)

LOG_LIMIT = 3000          # characters of each log kept in a report
SEARCH_LIMIT = 200000     # characters of engine output searched for a known message


def stage_label(stage):
    return _STAGE_WORDS.get(stage, "Not started")


# ---------------------------------------------------------------------------
# Wording for Orca's own error codes (the codes are in slicer_bridge.ORCA_ERRORS)
# ---------------------------------------------------------------------------

ORCA_FIXES = {
    -1: ["Press Check slicer: the engine's own words are shown there.",
         "On Linux this usually means a system library or a screen is missing; the report shows the line it printed."],
    -2: ["Press Check slicer again. If you updated the engine recently, go back to the version that worked."],
    -3: ["Save the profile again so it points at preset files that exist."],
    -5: ["Open Files, Slicing, Profiles and pick the machine, process and filament presets again."],
    -6: ["Open the model in the plate editor and save it again, or export it again from your design program."],
    -14: ["Close other programs and slice again. A large model needs more memory."],
    -17: ["Choose a process preset made for the same printer as the machine preset."],
    -50: ["Add a model to the plate, then slice again."],
    -51: ["Move every object fully inside the build plate, then slice again."],
    -52: ["Move every object fully inside the build plate, then slice again.",
          "If the model is far larger than the plate, check that it was saved in millimetres."],
    -58: ["Raise the slicing time limit in Files, Slicing, or use a smaller model."],
    -100: ["Open the report: the last lines of the engine's output say what failed."],
    -101: ["Move or turn the model, then slice again."],
    -102: ["Move or turn the model, then slice again."],
}

_SIGNALS = {
    4: ("illegal instruction", "The engine used a processor instruction this computer doesn't have. "
                               "Use an engine build made for this kind of processor."),
    6: ("abort", "The engine stopped itself after an internal error."),
    7: ("bus error", "The engine crashed while reading memory."),
    8: ("arithmetic error", "The engine crashed on a calculation."),
    9: ("killed", "Something ended the engine by force. On Linux this is often the system's out-of-memory "
                  "killer, so check the computer's free memory."),
    11: ("segmentation fault", "The engine crashed."),
    15: ("terminated", "Something asked the engine to stop."),
}

_WINDOWS = {
    0xC0000135: ("dll_missing", "Windows couldn't find a file the engine needs (error 0xC0000135).",
                 ["Reinstall the engine from its official download.",
                  "If it still fails, repair or reinstall the Microsoft Visual C++ Redistributable."]),
    0xC000007B: ("bad_image", "Windows couldn't load the engine or one of its files (error 0xC000007B).",
                 ["Reinstall the engine from its official download."]),
    0xC0000005: ("crashed", "The engine crashed (Windows error 0xC0000005, an access violation).",
                 ["Slice again. If it crashes every time, the report has the engine's last lines."]),
}

_LOADER = re.compile(r"(?:error while loading shared libraries:\s*)?([\w.+\-]+\.so(?:\.\d+)*):\s*"
                     r"cannot open shared object file", re.I)
_DYLD = re.compile(r"Library not loaded:\s*(\S+)", re.I)
_TOO_OLD = re.compile(r"version [`'‘]?((?:GLIBC|GLIBCXX|CXXABI)_[\d.]+)[`'’]? not found", re.I)
_FUSE = re.compile(r"libfuse\.so\.2|fusermount\b.*(?:not found|failed)|failed to exec fusermount", re.I)
_DISPLAY = re.compile(r"cannot open display|could not connect to display|failed to open display|"
                      r"unable to init server", re.I)
_MEMORY = re.compile(r"std::bad_alloc", re.I)

# Only names checked against both Debian's and Ubuntu's package lists belong here. libmspack.so.0 is left out on
# purpose: Debian calls its package libmspack0 and Ubuntu 24.04 calls it libmspack0t64.
DEBIAN_PACKAGES = {"libwebkit2gtk-4.1.so.0": "libwebkit2gtk-4.1-0",
                   "libjavascriptcoregtk-4.1.so.0": "libjavascriptcoregtk-4.1-0"}


def _cause(code, title, detail="", fixes=None, command=None, evidence=None, repairable=True):
    return {"code": code, "title": title, "detail": detail, "fixes": list(fixes or []),
            "command": command, "evidence": redact(evidence) if evidence else None, "repairable": repairable}


def make(code, title, detail="", fixes=None, command=None, evidence=None, repairable=True):
    """A cause built by the caller, for failures this file has no pattern for (a timeout, a missing file)."""
    return _cause(code, title, detail, fixes, command, evidence, repairable)


def _line_with(text, match):
    start = text.rfind("\n", 0, match.start()) + 1
    end = text.find("\n", match.end())
    return text[start:end if end != -1 else len(text)].strip()[:240]


def from_text(text):
    """A cause recognised from what the engine printed, or None."""
    text = (text or "")[:SEARCH_LIMIT]
    found = _FUSE.search(text)
    if found:
        return _cause(
            "needs_fuse", "The slicer is an AppImage and this computer can't run it without FUSE 2",
            "An AppImage mounts itself like a small disk when it starts. This one asks for the FUSE 2 library "
            "(libfuse.so.2), which newer Linux systems often don't include.",
            ["Install the FUSE 2 library for your system, then press Check slicer again.",
             "Or use an engine build that isn't an AppImage."],
            evidence=_line_with(text, found))
    found = _LOADER.search(text)
    if found:
        library = found.group(1)
        package = DEBIAN_PACKAGES.get(library)
        fixes = ([f"On Debian or Ubuntu, install the package {package}, then press Check slicer again."]
                 if package else
                 [f"Install the system package that provides {library} (search your package manager for "
                  f"{library.split('.so')[0]}), then press Check slicer again."])
        return _cause(
            "missing_library", f"The slicer can't start: this computer is missing the library {library}",
            "A library is a shared piece of software that programs borrow from the system. The slicer asked for "
            "this one and the system doesn't have it, so the slicer stopped before it did any work.",
            fixes, command=f"sudo apt-get install {package}" if package else None,
            evidence=_line_with(text, found))
    found = _DYLD.search(text)
    if found:
        return _cause(
            "missing_library", f"The slicer can't start: macOS couldn't load {found.group(1)}",
            "The slicer asked for a library file that isn't there, so it stopped before it did any work.",
            ["Reinstall the slicer from its official download, then press Check slicer again."],
            evidence=_line_with(text, found))
    found = _TOO_OLD.search(text)
    if found:
        return _cause(
            "system_too_old", f"This slicer build needs a newer system than this computer has ({found.group(1)})",
            "The slicer was built on a newer Linux than the one running here, so the system's own libraries "
            "are too old for it.",
            ["Use a slicer build made for your system's version, or update the system."],
            evidence=_line_with(text, found))
    found = _DISPLAY.search(text)
    if found:
        return _cause(
            "no_display", "The slicer wanted a screen and couldn't open one",
            "Some slicer builds start their window system even when run with no window.",
            ["Start Deja Vu1 from a normal desktop session.",
             "On a computer with no screen, a virtual screen such as xvfb-run can stand in."],
            evidence=_line_with(text, found))
    found = _MEMORY.search(text)
    if found:
        return _cause(
            "out_of_memory", "The slicer ran out of memory",
            "It asked the system for more memory than was free and stopped.",
            ["Close other programs and slice again.", "Try a smaller or simpler model."],
            evidence=_line_with(text, found))
    return None


def from_exit(code, os_name=None):
    """A cause recognised from how the program ended (a signal or a Windows code), or None."""
    os_name = os_name or os.name
    if not isinstance(code, int):
        return None
    if os_name == "posix" and code < 0 and -code in _SIGNALS:
        name, words = _SIGNALS[-code]
        return _cause("crashed", f"The slicer stopped unexpectedly ({name}, signal {-code})", words,
                      ["Slice again. If it stops every time, copy the report to ask for help."],
                      repairable=-code == 9)
    if os_name == "nt":
        known = _WINDOWS.get(code & 0xFFFFFFFF)
        if known:
            kind, title, fixes = known
            return _cause(kind, title, "", fixes, repairable=kind != "crashed")
    return None


def from_start(error_number, message, winerror=None, name="the slicer"):
    """A cause for a program the system refused to start at all."""
    if winerror == 193 or error_number == 8:
        return _cause(
            "wrong_program", f"{name} isn't a program this computer can run",
            "The file is either built for a different kind of processor (for example an ARM build on an Intel "
            "computer) or the download is damaged.",
            ["Download the build made for this computer's system and processor, then check again."],
            evidence=message)
    if error_number == 2:
        return _cause(
            "loader_missing", f"The system couldn't start {name} even though the file is there",
            "This usually means the file needs a helper the system doesn't have, such as the loader for a "
            "different kind of processor or a different C library.",
            ["Download the build made for this computer's system, then check again."], evidence=message)
    if error_number == 13:
        return _cause("permission", f"{name} isn't allowed to run",
                      "The file exists but its permissions don't let it start.",
                      ["On Linux or macOS, mark the file as a program (chmod +x)."], evidence=message)
    return _cause("cannot_start", f"The system couldn't start {name}", message or "", evidence=message)


def from_orca(code, words, orca_says):
    """A cause for one of Orca's own error codes (result.json)."""
    title = f"{words}. Orca said: {orca_says}" if words and orca_says else words or f"Orca said: {orca_says}"
    return _cause(f"orca_{code}" if code is not None else "orca_error", title, "", ORCA_FIXES.get(code))


def for_stage(stage, message):
    """A cause for a check that refused the slice before the engine ran."""
    fixes = {"engine": ["Open Files, Slicing, press Find it for me, then Check slicer."],
             "profile": ["Open Files, Slicing, Profiles and save the profile again."]}.get(stage)
    return _cause(f"{stage or 'setup'}_problem", message, "", fixes)


# ---------------------------------------------------------------------------
# What a report holds
# ---------------------------------------------------------------------------

def redact(text):
    """Hide the home folder, so a pasted report doesn't carry the user name in every path."""
    text = text if isinstance(text, str) else "" if text is None else str(text)
    home = os.path.expanduser("~")
    if len(home) > 1:
        for variant in {home, home.replace("\\", "/"), home.replace("/", "\\")}:
            text = text.replace(variant, "~")
    return text


def log_window(data, limit=LOG_LIMIT):
    """The start and the end of a log, so the first error and the last words both survive."""
    text = data.decode("utf-8", errors="replace") if isinstance(data, bytes) else (data or "")
    total = len(text)
    if total > limit:
        head, tail = limit // 3, limit - limit // 3
        text = f"{text[:head]}\n... ({total - limit} characters left out) ...\n{text[-tail:]}"
    return {"text": redact(text.strip()), "characters": total, "left_out": max(0, total - limit)}


def file_facts(name, kind, data, plates=None):
    return {"name": name, "kind": kind, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()[:16],
            "plates": plates}


def host_facts():
    return {"os": platform.system(), "release": platform.release(), "machine": platform.machine(),
            "python": sys.version.split()[0]}
