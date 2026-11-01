"""
autostart.py
============

"Start Deja Vu1 when this computer starts": one small file in the place each
system runs things from at sign-in, and nothing else. The dashboard is then
already running whenever its address or the installed app is opened, instead
of showing the offline page because nobody started the launcher.

  - Windows: "Deja Vu1.cmd" in the Startup folder
    (%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup), which starts
    Deja Vu1 in the background (start.py --background, with pythonw.exe when
    there is one), so no console window is left that closing would stop it.
  - macOS: a LaunchAgent, ~/Library/LaunchAgents/io.github.jbyjre.dejavu1.plist,
    with RunAtLoad (it runs start.py at each sign-in).
  - Linux desktops: ~/.config/autostart/deja-vu1.desktop (the XDG autostart
    folder), which runs start.py.

Each starts the launcher with DEJAVU_NO_BROWSER=1, so signing in doesn't open
a browser tab; the dashboard simply waits at its address. Switching it off
removes the file. Nothing is written until the person turns it on.
"""

import os
import sys
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABEL = "io.github.jbyjre.dejavu1"


def _platform(platform=None):
    p = platform or sys.platform
    if p.startswith("win"):
        return "windows"
    if p == "darwin":
        return "mac"
    if p.startswith("linux"):
        return "linux"
    return None


def path(platform=None, env=None):
    """Where the start-up file lives on this system, or None where it isn't supported."""
    env = os.environ if env is None else env
    kind = _platform(platform)
    home = env.get("HOME") or env.get("USERPROFILE") or os.path.expanduser("~")
    if kind == "windows":
        appdata = env.get("APPDATA")
        if not appdata:
            return None
        return os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Deja Vu1.cmd")
    if kind == "mac":
        return os.path.join(home, "Library", "LaunchAgents", LABEL + ".plist")
    if kind == "linux":
        config = env.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
        return os.path.join(config, "autostart", "deja-vu1.desktop")
    return None


def content(platform=None, here=HERE, python=None):
    """The start-up file's text for this system."""
    kind = _platform(platform)
    python = python or sys.executable
    start = os.path.join(here, "start.py")
    if kind == "windows":
        folder = os.path.dirname(python)
        quiet = os.path.join(folder, "pythonw.exe")
        if os.path.basename(python).lower() == "pythonw.exe" or os.path.exists(quiet):
            run = f'start "" "{quiet if os.path.exists(quiet) else python}" "{start}" --background\r\n'
        else:
            run = f'start "Deja Vu1" /min "{python}" "{start}" --background\r\n'
        return ("@echo off\r\n"
                "rem Starts Deja Vu1 at sign-in. Turn it off in Deja Vu1: Settings, Desktop app.\r\n"
                "set DEJAVU_NO_BROWSER=1\r\n"
                f'cd /d "{here}"\r\n' + run)
    if kind == "mac":
        return ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
                '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
                '<plist version="1.0"><dict>\n'
                f"  <key>Label</key><string>{LABEL}</string>\n"
                "  <key>ProgramArguments</key><array>"
                f"<string>{escape(python)}</string><string>{escape(start)}</string></array>\n"
                f"  <key>WorkingDirectory</key><string>{escape(here)}</string>\n"
                "  <key>EnvironmentVariables</key><dict><key>DEJAVU_NO_BROWSER</key><string>1</string></dict>\n"
                "  <key>RunAtLoad</key><true/>\n"
                "</dict></plist>\n")
    if kind == "linux":
        # Desktop Entry Exec quoting: double quotes, with \ " ` $ escaped inside them.
        def q(s):
            return '"' + "".join("\\" + c if c in '\\"`$' else c for c in s) + '"'
        return ("[Desktop Entry]\n"
                "Type=Application\n"
                "Name=Deja Vu1\n"
                "Comment=Starts the Deja Vu1 dashboard at sign-in\n"
                f"Exec=env DEJAVU_NO_BROWSER=1 {q(python)} {q(start)}\n"
                f"Path={here}\n"
                "Terminal=false\n"
                "X-GNOME-Autostart-enabled=true\n")
    return None


def status(platform=None, env=None):
    where = path(platform, env)
    return {"supported": where is not None, "on": bool(where and os.path.exists(where)), "where": where}


def set_on(on, platform=None, env=None, here=HERE, python=None):
    where = path(platform, env)
    if where is None:
        raise ValueError("Starting with the computer isn't available on this system")
    if on:
        os.makedirs(os.path.dirname(where), exist_ok=True)
        text = content(platform, here, python)
        tmp = where + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.replace(tmp, where)
    elif os.path.exists(where):
        os.remove(where)
    return status(platform, env)
