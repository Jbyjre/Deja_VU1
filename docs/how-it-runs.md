# How Deja Vu1 runs, and what it relies on

Deja Vu1 is a small program on your own computer. Your browser (or the installed app window) shows its pages, and the
program does the work behind them: it talks to your U1, keeps your files and settings, and runs the slicing engine
when you slice. This page says what runs, where its files are, what it connects to, and when it starts and stops.

## What it needs from your computer

- **Python 3.8 or newer.** That is all: Deja Vu1 uses only what comes with Python, so there is nothing else to install.
  - **Windows:** double-click `start-windows.bat`. If Python is missing, it offers to install it with winget, Windows'
    own installer; press Y. Without winget it gives three short steps for python.org instead (tick "Add python.exe to
    PATH" when the installer asks).
  - **Mac:** double-click `start-mac.command`. If macOS offers to install its command line developer tools, press
    Install: they include Python. Otherwise the window gives the python.org steps.
  - **Linux:** most systems already have it. If not, `sudo apt install python3` (Ubuntu, Debian, Mint, Raspberry Pi OS).
- **A browser.** Microsoft Edge or Google Chrome for the app window; any current browser for the dashboard.
- **The slicing engine**, only for slicing inside Deja Vu1. If Snapmaker Orca (or OrcaSlicer) is already on your
  computer, Deja Vu1 finds it and uses it, so there is nothing to install. Otherwise the Slicer offers to download
  Snapmaker's own copy.
- **Memory and processor.** Deja Vu1 is built for a computer with 8 GB of memory, and lighter is better. Measured on 24 November 2026 in a Linux cloud computer with no printer connected: the server uses about 37 MB of memory and under 1% of one processor core, with or without a page open (`tools/load-time.js` and a short memory check). It answers about a quarter of a second after it starts. A first visit from a phone-like link (30 Mbit/s home Wi-Fi) downloads about 1.2 MB and is usable after about 1.4 seconds (about 3.1 MB and 1.6 seconds before this version); a browser on the same computer is usable after about half a second. With a printer connected, the work grows with what the printer reports; that was not measured here.

## What runs, and when

| What | What it is | When it runs |
|---|---|---|
| The launcher | `start.py`, run by Python. Double-clicking `start-windows.bat`, `start-mac.command` or `start-linux.sh` runs it. | It starts the server, opens the dashboard and shows whether everything works. Then one small copy of it stays to restart the server if it ever crashes and to install updates, and ends with the server. |
| The server | `backend/app.py`, run by Python. It answers the pages at http://localhost:8000. | While you use Deja Vu1, and until 5 minutes after its last page closes. |
| The slicing engine | Snapmaker Orca: your own copy, or the one Deja Vu1 downloaded into its own folder. | Only while a slice is being made, at lower priority so the rest of the computer stays responsive. It ends when the slice ends. |
| The pages | Your browser tab, or the installed app window. | While you have them open. Closing them never harms a print. |

On Windows the launcher and the server show in Task Manager as **Python** or **pythonw.exe** (pythonw is Python with
no window). On a Mac they show in Activity Monitor as **Python**. That is Deja Vu1 and nothing else. There is no
other program, service or background helper.

### What it does while it runs

- **Your printer** sends its changes to Deja Vu1 over one connection, so Deja Vu1 does not keep asking it.
- **With a page open,** Deja Vu1 passes those changes to the page four times a second, so the dashboard moves with the
  print. If the printer stops answering, it also looks for it on your home network in case it moved to a new address
  (at most every 10 minutes).
- **With no page open,** it looks at the printer's state only once every 2 seconds, which is enough to notice a print
  ending or a pause, and it never searches the network.
- **Checking for Deja Vu1 updates** happens only if you switched it on in setup or Settings: one small request to
  GitHub an hour (every 15 minutes if you follow the newest files).
- **A safety copy** of your settings is made when the newest one is 6 hours old. Print watch, if you switched it on
  with an AI, looks at the camera during a print.

## When it stops

Closing the browser tab, the app window or the launcher window does not stop Deja Vu1 at once, because a print, a
slice or a download may still be under way. It stops by itself **5 minutes after its last page closes**, once:

- no Deja Vu1 page is open on any device (a phone counts too),
- no print is running or paused on a real printer,
- nothing is being sliced, no engine install or app update is running, and no time-lapse is being copied.

Then the server and the launcher that was watching it both end, and no Python is left running. Settings › Desktop app
shows how long is left, or what is keeping it running.

A print keeps Deja Vu1 running because it records the print as it happens: the time-lapse frames, the print record and
the filament it used. The print itself never depends on Deja Vu1: the U1 runs its file by itself, and if you stop
Deja Vu1 during a print, the print carries on.

**Settings › Version & updates › Stop Deja Vu1** stops it straight away.

## Starting it again

- Open http://localhost:8000 or the installed app. When Deja Vu1 is not running you see a short page with a **Start
  Deja Vu1** button, which starts it and opens the dashboard.
- Or double-click the launcher again.

## It never starts with the computer

Deja Vu1 never starts when you switch on or sign in to the computer, and there is no setting for it. Earlier versions
could add an entry that did; starting this version once removes it and says so in the launcher window. To remove one by
hand instead:

| System | What an earlier version may have added | How to remove it by hand |
|---|---|---|
| Windows | A Task Scheduler task named Deja Vu1, or `Deja Vu1.cmd` in the Startup folder. | Delete the task named Deja Vu1 in Task Scheduler, or the file in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`. |
| macOS | `~/Library/LaunchAgents/io.github.jbyjre.dejavu1.plist` | Delete that file and sign out. |
| Linux | `~/.config/autostart/deja-vu1.desktop` | Delete that file. |

## Where its files are

Everything stays in the folder you downloaded, mostly in `backend/data/`:

| Folder or file | What is in it |
|---|---|
| `backend/` | The server's program files. |
| `frontend/` | The pages, styles and pictures your browser shows. |
| `backend/data/` | Your printers, settings, plates, print record, spools, time-lapse frames and saved files. Back up this folder to keep your setup (see [backup-and-recovery.md](backup-and-recovery.md)). |
| `backend/data/engine/` | The slicing engine, once it is installed. |
| `backend/data/logs/` | `launcher.log` (starts, stops, updates) and `background.log` (what the server printed while it ran in the background). Read these when something went wrong. |

`DEJAVU_DATA_DIR` points `backend/data/` somewhere else for one start.

## What it connects to

| Where | Why | When |
|---|---|---|
| Your U1, on your home network (Moonraker, port 7125, and its camera) | Status, controls, files and video. | While a printer is set up. |
| GitHub | To check for and download Deja Vu1 updates, and to download the slicing engine. | When it checks for updates or you install the engine. |
| The AI service you chose | The assistant's answers. | Only once you set up an AI provider and ask it something. |
| Services you set up yourself | Notifications (ntfy, Discord, Telegram), Home Assistant, WLED lights. | Only when you set them up. |

There is no Deja Vu1 account and nothing is sent to the people who make it.
