"""
autostart.py
============

"Start Deja Vu1 when this computer starts", and keep it running. The dashboard
is then already running whenever its address or the installed app is opened,
instead of showing the offline page because nobody started the launcher.

  - Windows: a task in Windows' own Task Scheduler, "Deja Vu1", for this user
    only and without administrator rights. It starts Deja Vu1 hidden
    (pythonw.exe) at sign-in, again whenever the computer wakes from sleep,
    and checks every 5 minutes, so a Deja Vu1 that stopped for any reason is
    back within minutes with no window ever open. Where Task Scheduler refuses
    (some managed computers), "Deja Vu1.cmd" in the Startup folder
    (%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup) starts it at
    sign-in instead.
  - macOS: a LaunchAgent, ~/Library/LaunchAgents/io.github.jbyjre.dejavu1.plist,
    with RunAtLoad (it runs start.py at each sign-in) and KeepAlive, so macOS
    starts it again if it ever stops with an error.
  - Linux desktops: ~/.config/autostart/deja-vu1.desktop (the XDG autostart
    folder), which runs start.py.

Each runs `start.py --ensure`: it starts Deja Vu1 when nothing answers and
exits quietly when Deja Vu1 already runs, so a check every 5 minutes never
starts a second copy. Each also sets DEJAVU_NO_BROWSER=1, so signing in doesn't
open a browser tab. Switching it off removes the task or file. Nothing is
written until the person turns it on.

Why Task Scheduler on Windows: it is part of every Windows, needs nothing
installed, runs a program with no window, can start it at sign-in, after
waking and on a timer, and keeps doing so after Deja Vu1 itself has stopped.
A tray icon or a packaged program would need extra libraries or an installer,
and Deja Vu1's core uses Python's standard library only.
"""

import datetime
import getpass
import os
import subprocess
import sys
import time
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABEL = "io.github.jbyjre.dejavu1"
TASK = "Deja Vu1"
CHECK_EVERY = "PT5M"            # Task Scheduler's own duration format: every 5 minutes
NO_WINDOW = 0x08000000          # CREATE_NO_WINDOW: schtasks never flashes a console window
_cache = {}                     # the Task Scheduler answer, kept a minute (the page asks every few seconds)


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


def quiet_python(python=None):
    """On Windows the windowless pythonw.exe beside python.exe, when there is one."""
    python = python or sys.executable
    if os.path.basename(python).lower() == "pythonw.exe":
        return python
    quiet = os.path.join(os.path.dirname(python), "pythonw.exe")
    return quiet if os.path.exists(quiet) else python


def content(platform=None, here=HERE, python=None):
    """The start-up file's text for this system."""
    kind = _platform(platform)
    python = python or sys.executable
    start = os.path.join(here, "start.py")
    if kind == "windows":
        quiet = quiet_python(python)
        if quiet.lower().endswith("pythonw.exe"):
            run = f'start "" "{quiet}" "{start}" --ensure\r\n'
        else:
            run = f'start "Deja Vu1" /min "{python}" "{start}" --ensure\r\n'
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
                f"<string>{escape(python)}</string><string>{escape(start)}</string><string>--ensure</string></array>\n"
                f"  <key>WorkingDirectory</key><string>{escape(here)}</string>\n"
                "  <key>EnvironmentVariables</key><dict><key>DEJAVU_NO_BROWSER</key><string>1</string></dict>\n"
                "  <key>RunAtLoad</key><true/>\n"
                "  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n"
                "</dict></plist>\n")
    if kind == "linux":
        # Desktop Entry Exec quoting: double quotes, with \ " ` $ escaped inside them.
        def q(s):
            return '"' + "".join("\\" + c if c in '\\"`$' else c for c in s) + '"'
        return ("[Desktop Entry]\n"
                "Type=Application\n"
                "Name=Deja Vu1\n"
                "Comment=Starts the Deja Vu1 dashboard at sign-in\n"
                f"Exec=env DEJAVU_NO_BROWSER=1 {q(python)} {q(start)} --ensure\n"
                f"Path={here}\n"
                "Terminal=false\n"
                "X-GNOME-Autostart-enabled=true\n")
    return None


# ---- Windows Task Scheduler ----------------------------------------------

def windows_user(env=None):
    """DOMAIN\\user for the person signed in: a task for them alone needs no administrator."""
    env = os.environ if env is None else env
    user = env.get("USERNAME") or getpass.getuser()
    domain = env.get("USERDOMAIN")
    return f"{domain}\\{user}" if domain else user


def task_xml(here=HERE, python=None, user=None, now=None):
    """
    The task, in Task Scheduler's own XML format (version 1.2, Windows 7 and
    later). Three triggers start the same quick check: sign-in, waking from
    sleep (System log, Power-Troubleshooter event 1) and every 5 minutes.
    """
    python = quiet_python(python)
    user = escape(user or windows_user())
    start = (now or datetime.datetime.now()).replace(microsecond=0).isoformat()
    wake = ("&lt;QueryList&gt;&lt;Query Id=\"0\" Path=\"System\"&gt;&lt;Select Path=\"System\"&gt;"
            "*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]"
            "&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;")
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Deja Vu1</Author>
    <Description>Keeps the Deja Vu1 dashboard running for {user}: starts it at sign-in, after the computer wakes and every 5 minutes if it has stopped. Turn it off in Deja Vu1: Settings, Desktop app.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{user}</UserId>
    </LogonTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>{wake}</Subscription>
    </EventTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>{CHECK_EVERY}</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>{start}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"{escape(python)}"</Command>
      <Arguments>"{escape(os.path.join(here, 'start.py'))}" --ensure</Arguments>
      <WorkingDirectory>{escape(here)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def _schtasks(args, timeout=20):
    """Run schtasks.exe without a window: (exit code, its words)."""
    try:
        done = subprocess.run(["schtasks"] + args, capture_output=True, timeout=timeout,
                              creationflags=NO_WINDOW if os.name == "nt" else 0)
    except (OSError, subprocess.SubprocessError) as exc:
        return 1, str(exc)
    words = (done.stdout or b"") + (done.stderr or b"")
    return done.returncode, words.decode("utf-8", "replace").strip()


def _task_on(run, fresh=False):
    hit = _cache.get("task")
    if hit and not fresh and time.monotonic() - hit[0] < 60:
        return hit[1]
    on = run(["/Query", "/TN", TASK])[0] == 0
    _cache["task"] = (time.monotonic(), on)
    return on


def _set_task(on, here, python, run, env):
    if not on:
        run(["/Delete", "/TN", TASK, "/F"])
        _cache.pop("task", None)
        return True, ""
    import tempfile
    fd, xml_path = tempfile.mkstemp(suffix=".xml", prefix="dejavu1-task-")
    try:
        with os.fdopen(fd, "w", encoding="utf-16") as f:
            f.write(task_xml(here, python, windows_user(env)))
        code, words = run(["/Create", "/TN", TASK, "/XML", xml_path, "/F"])
    finally:
        try:
            os.remove(xml_path)
        except OSError:
            pass
    _cache["task"] = (time.monotonic(), code == 0)
    return code == 0, words


# ---- on / off -------------------------------------------------------------

def status(platform=None, env=None, run=None):
    where = path(platform, env)
    file_on = bool(where and os.path.exists(where))
    out = {"supported": where is not None, "on": file_on, "where": where, "how": "file" if file_on else None}
    if _platform(platform) == "windows" and where is not None:
        if _task_on(run or _schtasks):
            out.update(on=True, how="task", where="Task Scheduler: " + TASK, keeps_running=True)
        elif file_on:
            out["how"] = "startup-folder"
    elif _platform(platform) == "mac" and file_on:
        out["keeps_running"] = True
    return out


def set_on(on, platform=None, env=None, here=HERE, python=None, run=None):
    where = path(platform, env)
    if where is None:
        raise ValueError("Starting with the computer isn't available on this system")
    note = ""
    if _platform(platform) == "windows":
        run = run or _schtasks
        made, words = _set_task(on, here, python, run, env)
        if on and made:
            _remove(where)          # one way only: the task replaces the Startup-folder file
            return status(platform, env, run)
        if on:
            note = ("Task Scheduler refused (" + (words or "no reason given") + "), so Deja Vu1 starts at sign-in "
                    "from the Startup folder instead. It isn't checked after sleep or every 5 minutes.")
    if on:
        os.makedirs(os.path.dirname(where), exist_ok=True)
        text = content(platform, here, python)
        tmp = where + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.replace(tmp, where)
    else:
        _remove(where)
    out = status(platform, env, run)
    if note:
        out["note"] = note
    return out


def refresh(platform=None, env=None, here=HERE, python=None, run=None):
    """
    Rewrite an entry that is on, so it names this copy's folder and Python and
    uses the newest way (an older Startup-folder file becomes a task). Called at
    every start; does nothing when starting with the computer is off.
    """
    current = status(platform, env, run)
    if current["on"]:
        return set_on(True, platform, env, here, python, run)
    return current


def _remove(where):
    try:
        os.remove(where)
    except OSError:
        pass


# ---- the person's own choice ---------------------------------------------------
# Every start by hand switches starting with the computer on, unless the person
# switched it off in Settings -> Desktop app; that choice is kept here.

CHOICE = "autostart-choice.json"


def remember_choice(data_dir, on):
    import json
    try:
        os.makedirs(data_dir, exist_ok=True)
        with open(os.path.join(data_dir, CHOICE), "w", encoding="utf-8") as f:
            json.dump({"on": bool(on), "at": time.time()}, f)
    except OSError:
        pass


def chosen_off(data_dir):
    import json
    try:
        with open(os.path.join(data_dir, CHOICE), encoding="utf-8") as f:
            return json.load(f).get("on") is False
    except (OSError, ValueError, AttributeError):
        return False


# ---- "stopped on purpose" ---------------------------------------------------
# Settings > Stop (and Ctrl+C in Deja Vu1's window) leave this note, so the
# 5-minute check doesn't start Deja Vu1 straight back up. Starting it any other
# way removes the note, and so does restarting the computer.

STOPPED = "stopped-on-purpose.json"


def _boot_time():
    """When this computer last started, from the clock that counts since start-up (Windows counts sleep too)."""
    return time.time() - time.monotonic()


def mark_stopped(data_dir):
    import json
    try:
        os.makedirs(data_dir, exist_ok=True)
        with open(os.path.join(data_dir, STOPPED), "w", encoding="utf-8") as f:
            json.dump({"at": time.time()}, f)
    except OSError:
        pass


def clear_stopped(data_dir):
    _remove(os.path.join(data_dir, STOPPED))


def stopped_on_purpose(data_dir):
    import json
    try:
        with open(os.path.join(data_dir, STOPPED), encoding="utf-8") as f:
            at = float(json.load(f).get("at", 0))
    except (OSError, ValueError, AttributeError):
        return False
    return at > _boot_time()
