"""
launch_link.py
==============

The "Start Deja Vu1" button on the offline page. A web page can't start a
program by itself, and shouldn't. What it can do is open a link that the
computer has been told belongs to a program, the way mailto: links open the
mail app. Deja Vu1 registers its own link, deja-vu1://start, for the person
signed in (no administrator rights). When the offline page's button opens it,
the browser first asks "Open Deja Vu1?", and only after a yes does the
computer run `start.py --from-link`, which starts Deja Vu1 in the background
if it isn't running.

Nothing from the link reaches the program: the command never includes the
address that was opened, so a page that opens deja-vu1://anything can at most
start Deja Vu1 (after the browser has asked).

  - Windows: HKEY_CURRENT_USER\\Software\\Classes\\deja-vu1 (the per-user
    place Windows looks up a link's program), running pythonw.exe so no
    window opens.
  - Linux desktops: ~/.local/share/applications/deja-vu1-link.desktop, set as
    the x-scheme-handler/deja-vu1 default in ~/.config/mimeapps.list.
  - macOS: ~/Applications/Deja Vu1 Link.app, a small app whose Info.plist
    claims the link; registered with Launch Services.

Registered at every start, so it always points at this copy's folder.
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEME = "deja-vu1"
DESKTOP = "deja-vu1-link.desktop"
LSREGISTER = ("/System/Library/Frameworks/CoreServices.framework/Frameworks/"
              "LaunchServices.framework/Support/lsregister")


def _kind(platform=None):
    p = platform or sys.platform
    return "windows" if p.startswith("win") else "mac" if p == "darwin" else "linux" if p.startswith("linux") else None


def windows_command(here=HERE, python=None):
    import autostart
    return f'"{autostart.quiet_python(python)}" "{os.path.join(here, "start.py")}" --from-link'


def linux_entry(here=HERE, python=None):
    python = python or sys.executable

    def q(s):
        return '"' + "".join("\\" + c if c in '\\"`$' else c for c in s) + '"'
    return ("[Desktop Entry]\n"
            "Type=Application\n"
            "Name=Deja Vu1\n"
            "Comment=Starts the Deja Vu1 dashboard from its offline page\n"
            f"Exec=env DEJAVU_NO_BROWSER=1 {q(python)} {q(os.path.join(here, 'start.py'))} --from-link\n"
            f"Path={here}\n"
            f"MimeType=x-scheme-handler/{SCHEME};\n"
            "NoDisplay=true\n"
            "Terminal=false\n")


def _set_default(mimeapps, entry):
    """Put x-scheme-handler/deja-vu1=entry under [Default Applications], keeping every other line."""
    key = f"x-scheme-handler/{SCHEME}"
    lines = []
    if os.path.exists(mimeapps):
        with open(mimeapps, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    out, section = [], None
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped
        elif section == "[Default Applications]" and stripped.split("=", 1)[0].strip() == key:
            continue                 # an older entry for the link: replaced below
        out.append(line)
    if "[Default Applications]" in (s.strip() for s in out):
        at = [s.strip() for s in out].index("[Default Applications]") + 1
        out.insert(at, f"{key}={entry}")
    else:
        if out and out[-1].strip():
            out.append("")
        out += ["[Default Applications]", f"{key}={entry}"]
    os.makedirs(os.path.dirname(mimeapps), exist_ok=True)
    tmp = mimeapps + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    os.replace(tmp, mimeapps)


def mac_bundle(here=HERE, python=None):
    """The files of the small link app: {relative path: (text, executable)}."""
    python = python or sys.executable

    def sh(s):
        return "'" + s.replace("'", "'\\''") + "'"
    plist = ('<?xml version="1.0" encoding="UTF-8"?>\n'
             '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
             '<plist version="1.0"><dict>\n'
             '  <key>CFBundleIdentifier</key><string>io.github.jbyjre.dejavu1.link</string>\n'
             '  <key>CFBundleName</key><string>Deja Vu1</string>\n'
             '  <key>CFBundleExecutable</key><string>deja-vu1-link</string>\n'
             '  <key>CFBundlePackageType</key><string>APPL</string>\n'
             '  <key>LSBackgroundOnly</key><true/>\n'
             '  <key>CFBundleURLTypes</key><array><dict>\n'
             '    <key>CFBundleURLName</key><string>Deja Vu1</string>\n'
             f'    <key>CFBundleURLSchemes</key><array><string>{SCHEME}</string></array>\n'
             '  </dict></array>\n'
             '</dict></plist>\n')
    script = ("#!/bin/sh\n"
              "# Opened by the deja-vu1:// link on Deja Vu1's offline page: start Deja Vu1 if it isn't running.\n"
              f"cd {sh(here)} && DEJAVU_NO_BROWSER=1 exec {sh(python)} {sh(os.path.join(here, 'start.py'))} --from-link\n")
    return {"Contents/Info.plist": (plist, False), "Contents/MacOS/deja-vu1-link": (script, True)}


def where(platform=None, env=None):
    env = os.environ if env is None else env
    home = env.get("HOME") or os.path.expanduser("~")
    kind = _kind(platform)
    if kind == "linux":
        data = env.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share")
        return os.path.join(data, "applications", DESKTOP)
    if kind == "mac":
        return os.path.join(home, "Applications", "Deja Vu1 Link.app")
    if kind == "windows":
        return "HKEY_CURRENT_USER\\Software\\Classes\\" + SCHEME
    return None


def register(platform=None, env=None, here=HERE, python=None, winreg=None, run=None):
    """Make deja-vu1:// start this copy. Returns where it was registered; raises OSError when it can't be."""
    env = os.environ if env is None else env
    kind = _kind(platform)
    place = where(platform, env)
    if kind == "windows":
        if winreg is None:
            import winreg
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, "Software\\Classes\\" + SCHEME)
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "URL:Deja Vu1")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
        command = winreg.CreateKey(key, "shell\\open\\command")
        winreg.SetValueEx(command, "", 0, winreg.REG_SZ, windows_command(here, python))
        return place
    if kind == "linux":
        os.makedirs(os.path.dirname(place), exist_ok=True)
        with open(place + ".tmp", "w", encoding="utf-8") as f:
            f.write(linux_entry(here, python))
        os.replace(place + ".tmp", place)
        config = env.get("XDG_CONFIG_HOME") or os.path.join(env.get("HOME") or os.path.expanduser("~"), ".config")
        _set_default(os.path.join(config, "mimeapps.list"), DESKTOP)
        return place
    if kind == "mac":
        for rel, (text, executable) in mac_bundle(here, python).items():
            full = os.path.join(place, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as f:
                f.write(text)
            if executable:
                os.chmod(full, 0o755)
        if os.path.exists(LSREGISTER):
            (run or subprocess.run)([LSREGISTER, "-f", place], capture_output=True, timeout=20)
        return place
    raise OSError("This system has no way to register a link")


def status(platform=None, env=None, winreg=None):
    """Whether deja-vu1:// is registered to this copy."""
    kind = _kind(platform)
    place = where(platform, env)
    try:
        if kind == "windows":
            if winreg is None:
                import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Software\\Classes\\" + SCHEME + "\\shell\\open\\command") as k:
                value = winreg.QueryValueEx(k, "")[0]
            return {"on": os.path.join(HERE, "start.py") in value, "where": place}
        if kind in ("linux", "mac"):
            return {"on": bool(place and os.path.exists(place)), "where": place}
    except (OSError, ImportError):
        pass
    return {"on": False, "where": place}
