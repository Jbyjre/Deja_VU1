# Getting started

From nothing to your U1 on screen, without typing commands. About ten
minutes the first time.

## 1. Pick a computer

Any computer on the same home network as your printer: a Windows PC, a
Mac, a Linux machine or a Raspberry Pi. Deja Vu1 runs on that computer;
your phone and other computers then open it in a browser. It never talks
to the internet, and it doesn't install anything on the printer.

## 2. Install Python (once)

Deja Vu1 needs Python 3.8 or newer and nothing else.

- **Windows:** download the installer from
  [python.org/downloads](https://www.python.org/downloads/). On its first
  screen, tick **Add python.exe to PATH**, then **Install Now**.
- **Mac:** download the macOS installer from the same page and run it.
- **Linux / Raspberry Pi:** Python 3 is almost always there already. Check
  with `python3 --version` in a terminal.

## 3. Download Deja Vu1

On [the project page](https://github.com/Jbyjre/Deja_VU1), click **Code →
Download ZIP**, then unzip it somewhere you'll find again (Documents is
fine). If you use git: `git clone https://github.com/Jbyjre/Deja_VU1.git`.

## 4. Start it

Open the unzipped folder and double-click:

| Computer | Double-click |
|---|---|
| Windows | `start-windows.bat` |
| Mac | `start-mac.command`. The first time, macOS may say it's from an unidentified developer: right-click it, choose **Open**, then **Open** again |
| Linux | `start-linux.sh` (or run `python3 start.py` in the folder) |

A window opens with the dashboard's messages, and your browser opens the
dashboard by itself. Keep that window open while you use it; closing it
stops Deja Vu1. Nothing else is installed or changed on your computer.

The window also prints the address to use **from your phone**, like
`http://192.168.1.20:8000`, when your computer is on a home network.

## 5. Find your printer

In the dashboard: **Fleet → Add a printer → Find printers on my network.**

It asks the network who's running Moonraker (the printer's own web
service; Snapmaker's U1 announces itself), then tries Moonraker's port,
7125, on each address of your home network. Every printer it finds is
checked and listed: whether it's a U1, how many toolheads it has, and
whether it needs an API key. Press **Use this**, give it a name, and
**Add printer**.

If nothing is found: make sure the printer is on and connected to the same
Wi-Fi or router. You can also type its address yourself: your router's
list of connected devices shows the printer's IP address, and the address
to type is then `http://<that IP>:7125`. Press **Test** first. Test says in words what's
wrong if it can't connect: nothing answering there, the wrong port, or
Moonraker asking for an API key.

## 6. Use it from your phone

On your phone, on the same Wi-Fi, open the address the window printed. To
keep it on your phone's home screen, use the browser's **Add to Home
Screen**. **Settings → Pair another device** adds the phone to the
dashboard's list of devices.

Away from home: see [docs/remote-access.md](remote-access.md). Don't open a
port on your router for it; Deja Vu1 has no login of its own.

## 7. Try it without a printer

Flip **Demo data** in the header: three simulated U1s print, pause and
fail on cue, so you can try everything first. Simulated figures are always
labelled as such.

## Updating

Download the ZIP again and replace the folder (your settings live in
`backend/data/` inside it: copy that folder across to keep them), or run
`git pull` if you used git.

## If something goes wrong

| What you see | What to do |
|---|---|
| The window closes straight away (Windows) | Python isn't installed, or **Add python.exe to PATH** wasn't ticked. Reinstall Python with it ticked |
| "Address already in use" | Deja Vu1 is already running in another window, or another program uses port 8000. Close the other one |
| The phone can't open the address | The phone must be on the same network as the computer. Some guest Wi-Fi networks keep devices apart |
| Find printers finds nothing | Check the printer's on the same network; type its address and press **Test** |
| "Moonraker wants an API key" | Add the key in the form, or add your computer to the printer's Moonraker `[authorization] trusted_clients` |

## What hasn't been checked yet

Deja Vu1 hasn't run on a real U1 yet: the connection was written against
Snapmaker's own U1 source and tested against a stand-in built from it. The
double-click starters were tested on Linux; the Windows and Mac ones are
two-line wrappers around the same `start.py` and haven't been run on those
systems yet. If you try it, [the first-connection guide](first-connection.md)
says what's useful to send back.
