# Your computer runs it. Your phone opens it.

Deja Vu1 runs on your own Windows, Mac or Linux computer, including a suitable
Raspberry Pi with Python 3.8 or newer. Keep that computer awake. Nothing is
installed on the printer. A phone is another screen for the same dashboard.

```text
Computer running Deja Vu1 ── home network ── U1 printer
           ▲
           │ http://COMPUTER-ADDRESS:8000
           │
      Phone browser
```

The [public website](https://deja-vu1.jmath1110.workers.dev/?demo) plays a
recording of simulated printers. It cannot connect to or control your printer.
You need your own running copy for real readings.

## On my computer

1. **Fastest: paste a few lines.** They download the newest release into your
   Documents folder and start it. Skip to step 4 afterwards.

   **Windows:** open **PowerShell** (Windows key, type `PowerShell`, Enter). If
   you have no Python yet, paste `winget install -e --id Python.Python.3.12`
   first, wait, then close and reopen PowerShell. Then paste:

   ```powershell
   $ProgressPreference = 'SilentlyContinue'
   $dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Deja_VU1'
   Invoke-WebRequest 'https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip' -OutFile "$env:TEMP\dejavu1.zip"
   Expand-Archive "$env:TEMP\dejavu1.zip" -DestinationPath $dest -Force
   Set-Location $dest
   if (Get-Command py -ErrorAction SilentlyContinue) { py -3 start.py --background --autostart } else { python start.py --background --autostart }
   ```

   **Mac, Linux or Raspberry Pi:** open **Terminal** (on a Mac: Cmd + Space, type
   `Terminal`, Enter) and paste:

   ```bash
   curl -fL -o /tmp/dejavu1.zip https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip
   python3 -m zipfile -e /tmp/dejavu1.zip ~/Documents/Deja_VU1 && chmod +x ~/Documents/Deja_VU1/*.command ~/Documents/Deja_VU1/*.sh
   cd ~/Documents/Deja_VU1 && python3 start.py --background --autostart
   ```

   If a Mac says the `python3` command needs the command line developer tools,
   click **Install**, wait, and paste the block again. Running a block again
   later repairs the app and keeps your settings, which live in `backend/data/`.
2. **No code instead:** install Python 3.8 or newer from [python.org](https://www.python.org/downloads/)
   if you do not already have it. On Windows, the launcher tries `py -3` and then
   `python`; allow the installer to add Python to PATH if that option appears.
   PATH is the computer's list of places to look for programs. Then download the
   [newest release](https://github.com/Jbyjre/Deja_VU1/releases/latest)
   (**deja-vu1-update.zip** or **Source code (zip)**) and extract it to a folder in
   Documents, or clone the project with GitHub Desktop (**File → Clone repository
   → URL**). Keep this folder: your saved settings and files normally live inside
   `backend/data/`.
3. Open the folder and double-click **start-windows.bat**, **start-mac.command**,
   or **start-linux.sh**. On Mac/Linux, if the file opens as text or cannot run,
   open Terminal in the folder and run `python3 start.py`. Downloaded files may
   need your operating system's permission to open; do not disable its security.
4. Your browser opens [the local dashboard](http://localhost:8000). A double-clicked
   launcher's window must stay open: closing it stops the dashboard (if it stops by itself
   after a crash, the launcher starts it again). The paste blocks above start Deja Vu1 in
   the background instead, so no window has to stay open, and it starts by itself whenever
   you sign in (**Settings → Desktop app → Start Deja Vu1 when this computer starts**). The launcher also
   prints **From a phone**, followed by your computer's home-network address,
   and, where the console can draw it, a QR code of it for the phone's camera.
5. Follow **Set up & help**, or skip and replay it from **Settings**. Your
   optional name stays only in this browser, on this device. It is never sent
   to the dashboard server; delete it in Settings. It does not sync to a phone.
6. Choose **Connect my printer**. This turns demo data off. Press **Find printers**,
   select a result and **Test and connect**. Discovery checks local network
   announcements and the usual Moonraker port on the computer's local subnet;
   it cannot find every printer across different networks.
7. If no result appears, get the printer's IP address from its screen or your
   router's device list. Enter `http://PRINTER-IP:7125`, for example
   `http://192.168.1.50:7125`. An IP address is a device's address on the network.
   Enter the printer's API key only if it requires one; this is its access key.
   Test the connection. Do not share the key in screenshots or bug reports.
8. Wait for **Connected**, with **Demo data** off. Check that temperatures and
   print status match the printer. A successful connection test is not proof
   that every printer function works. Start with the watch-only checks in
   [first connection](first-connection.md).

You can also add or edit printers under **Printers → Add a printer**. Adding a
printer does not start a print. To explore first, choose **Try the demo**;
simulated figures are labelled and simulated commands cannot control a real U1.

## On my phone at home

1. Leave Deja Vu1 running and the computer awake. Put the phone, computer and
   printer on the same trusted home network. Avoid guest Wi-Fi, which can keep
   devices apart.
2. **The easy way: scan a code.** On the computer, press **Connect your phone**
   on the Overview (it is also in Settings → Paired devices and in setup). A QR
   code appears. Open the phone's **Camera**, point it at the code and tap the
   link that pops up. The dashboard opens on the phone and the phone pairs
   itself; the computer shows "connected and paired". The code works for 10
   minutes and only once; **New code** makes another. The launcher window
   draws the same address as a code too, when the console can.
3. **Or type it.** On the phone open Safari (iPhone) or Chrome (Android) and type
   the address the sheet (or the launcher's **From a phone** line) shows, for
   example `192.168.1.20:8000`. Use a **colon** before the port number, not a
   dot: `192.168.1.20.8000` is not an address, so the phone searches the web and
   shows unrelated pages about routers. If search results appear anyway, type
   `http://` in front. **Use the computer's address, not the printer's.**
   `localhost` on your phone means the phone itself, so it will not reach your
   computer.
4. If the launcher cannot find an address: Windows → Settings → Network &
   internet → your active connection → properties → IPv4 address; Mac → System
   Settings → Network → your active connection → Details → TCP/IP; Linux → your
   desktop's network connection details, or run `hostname -I` and choose the
   address belonging to your home network. Several addresses can appear if
   you have a VPN. These OS screens vary by version.
5. Select your real printer and leave **Demo data** off on this browser too.
   The phone shares server settings, files and printers; browser preferences
   such as the name, selected printer and demo choice are separate.
6. To put it on the home screen, open **More → Install app** on the phone. It
   shows the steps for that phone, below.

### Install it on your phone

**Why Android first offers only a shortcut.** Chrome installs a website as an
app only from a secure address: `https://` with a valid certificate, `localhost`,
or an address you list in Chrome's own setting **Insecure origins treated as
secure**. That rule is in Chrome's source code
(`components/webapps/browser/installable/installable_evaluator.cc`, and the
`unsafely-treat-insecure-origin-as-secure` entry in `chrome://flags`, offered on
Android too). Your phone opens Deja Vu1 at a plain home-network address such as
`http://192.168.1.20:8000`, so Chrome's **Add to Home screen** makes a shortcut
that opens in a browser tab.

**The fix, once per phone (Android, Chrome):**

1. On the phone, open **More → Install app** in Deja Vu1. It shows the two
   things to copy.
2. Paste `chrome://flags/#unsafely-treat-insecure-origin-as-secure` into
   Chrome's address bar and open it.
3. Under **Insecure origins treated as secure**, paste the dashboard's address
   exactly as the phone opens it (for example `http://192.168.1.20:8000`, with
   `http://` and the port), and set it to **Enabled**.
4. Tap **Relaunch**, come back to Deja Vu1 and press **Install Deja Vu1** (or
   Chrome's menu ⋮ → **Add to Home screen** → **Install**).

This trusts only that one address, your own computer on your own Wi-Fi. If the
computer's address changes, add the new one the same way.

**Without the setting:** open Deja Vu1 through an `https://` address, such as
Tailscale Serve or a Cloudflare Tunnel ([remote access](remote-access.md)).
Chrome can install from those directly.

**iPhone:** Safari → **Share → Add to Home Screen**; enable **Open as Web App**
if offered. [Apple's instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios).

A PWA is a website that can install with an app-like window; full install
support and the offline page require a secure address as above.
Deja Vu1 includes an app manifest, icons and a service worker, the small browser
script that supplies its offline page. It **does not cache printer readings or
queue commands offline**. A previously loaded secure installation shows a
“dashboard is offline” page if the server cannot be reached; it cannot control
anything until reconnected. Browser installation rules vary.
[Browser requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

**Pairing is optional device bookkeeping, not a login or a step needed to open
the dashboard** (scanning the code just does it for you). Anyone with network access to this dashboard
can operate it. Use the remote guide below for access away from home.

## On my phone away from home

1. Install [Tailscale](https://tailscale.com/download) (free) on the computer
   running Deja Vu1 and on your phone, signed in to the same account.
2. On the computer: **Settings → Away from home → Turn on Away from home**.
3. Point the phone's camera at the code it shows. Deja Vu1 opens on the phone
   at a private `https://…ts.net` address that works on any network while
   Tailscale is connected. **More → Install app** keeps it on the home screen.

Tailscale itself is a separate app; Deja Vu1 runs its commands for you and
never makes the dashboard public. Details, and the Cloudflare Access
alternative: [the private remote-access guide](remote-access.md). Never forward
the dashboard's port through your router: the app has no login.

## If the phone cannot open it

| What you see | What to do |
|---|---|
| Nothing opens, or connection timed out | Check the computer is awake, the launcher is still open and the address has `http://` and `:8000`. Try the address on the computer first. Check both devices are on the same home network. |
| Works on computer, fails on phone | Check guest-network isolation and the computer's firewall, below. A VPN can change which network route is used. |
| “Refused” / status 421 | The server does not recognise that host name. Use the computer's local IP; for a custom remote domain follow `DEJAVU_ALLOWED_HOSTS` in the remote guide. |
| Find printers finds nothing | Wake the printer and enter its address manually. A different subnet, blocked discovery traffic or a nonstandard port can hide it. |
| Connection refused | Check the IP and port; Moonraker might not be running there. |
| API key / Unauthorized | Supply the printer's actual key. Do not disable authentication just to make the message disappear. |
| Empty readings | Check **Demo data**, the selected printer, **Printer link** in Settings and the connection error shown. No connection means no invented readings. |
| Phone stopped working after a router restart | The computer's IP may have changed. Use its new address; a reserved address in your router can prevent future changes. |

### Allow the app through the firewall

- **Windows:** mark your trusted home connection Private. In Windows Security →
  Firewall & network protection → Allow an app through firewall, allow the Python
  executable running Deja Vu1 on **Private** networks. Keep the firewall on and
  leave Public unchecked. [Microsoft's guidance](https://support.microsoft.com/en-us/windows/security/firewall/risks-of-allowing-apps-through-windows-firewall).
- **Mac:** if the firewall is enabled, System Settings → Network → Firewall →
  Options; allow incoming connections for the Python program. “Block all incoming
  connections” can prevent access. [Apple's guidance](https://support.apple.com/en-ie/guide/mac-help/mh34041/mac).
- **Linux:** firewall tools vary. On Ubuntu with UFW enabled, permit TCP port
  8000 **from your actual home subnet only**. For a `192.168.1.0/24` network the
  command is `sudo ufw allow proto tcp from 192.168.1.0/24 to any port 8000`.
  That address is an example, not a value to paste on a different network.
  [Ubuntu's guidance](https://ubuntu.com/server/docs/firewalls/).

The server's own address checks permit local IPs and familiar local host names;
they do not replace your firewall or a remote login.

## In its own window: the desktop app

You can keep Deja Vu1 out of your browser tabs. Open **Settings → Desktop app**:

- **Install Deja Vu1** turns it into an app with its own window and an icon in
  the Start menu or Dock. This works in Chrome and Edge on the computer that runs
  Deja Vu1 (the `http://localhost:8000` address). Safari on macOS Sonoma or newer
  uses **File → Add to Dock**. Firefox cannot install websites as apps.
- **In its own app window** makes the launcher open Deja Vu1 in a window with no
  tabs or address bar, using Edge (included with Windows) or Chrome. It applies
  the next time you start the launcher.

The launcher window still runs the dashboard. Keep it open; closing only the app
window leaves the dashboard running for your phone.

## Updating

Every change merged on GitHub becomes a new numbered release, so updates come
small and often. Your settings, printers and files are never part of one, a
safety copy comes first, and the old version comes back if the new one fails
to start.

1. **In the app:** **Settings → Version & updates → Check for updates**, then
   **Install**. Tick **Look for updates by itself** to have it check every hour;
   the glass orb in the bottom-right corner tells you. Start Deja Vu1 with its
   launcher, and wait until every real printer is idle.
2. **One paste**, when the button can't help (0.8.0's Install button has a bug,
   so 0.8.0 copies need this once). It stops Deja Vu1 in Documents, installs the
   newest release over it and starts it again.

   **Windows:** open a new **PowerShell** window and paste:

   ```powershell
   $ProgressPreference = 'SilentlyContinue'
   $dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Deja_VU1'
   try { Invoke-RestMethod -Method Post 'http://localhost:8000/api/app/stop' -TimeoutSec 5 | Out-Null; Start-Sleep 2 } catch {}
   Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" | Where-Object { $_.CommandLine -like '*Deja_VU1*app.py*' } | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)"; if ($p.CommandLine -like '*start.py*') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
   Invoke-WebRequest 'https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip' -OutFile "$env:TEMP\dejavu1.zip"
   Expand-Archive "$env:TEMP\dejavu1.zip" -DestinationPath $dest -Force
   Set-Location $dest
   if (Get-Command py -ErrorAction SilentlyContinue) { py -3 start.py --background } else { python start.py --background }
   ```

   **Mac, Linux or Raspberry Pi:** open a **new** Terminal window and paste:

   ```bash
   curl -s -o /dev/null -X POST http://localhost:8000/api/app/stop; sleep 2; pkill -f 'Deja_VU1/backend/app.py'
   curl -fL -o /tmp/dejavu1.zip https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip
   python3 -m zipfile -e /tmp/dejavu1.zip ~/Documents/Deja_VU1 && chmod +x ~/Documents/Deja_VU1/*.command ~/Documents/Deja_VU1/*.sh
   cd ~/Documents/Deja_VU1 && python3 start.py --background
   ```

   The same blocks are in **Settings → Version & updates → Update or repair with a
   command**. The Windows block has not been run on a Windows computer yet; the
   Mac and Linux block was tested on Linux.
3. **GitHub Desktop copies:** **Fetch origin**, then **Pull origin**, then start
   the launcher again. If it says you changed files, read the list; **Discard
   changes** is usually right. Your settings live in `backend/data/`, which git
   never lists. Once the project's history has been rewritten (the CHANGELOG
   gives the date), a copy cloned before then follows the one-time steps in the
   README ([installed with git or GitHub Desktop before the history rewrite](../README.md#installed-with-git-or-github-desktop-before-the-history-rewrite))
   instead of pulling.

**Look after this copy** in the same card can also **Restart** the dashboard,
**Repair files** (put the published app files back, data untouched), make a
**Safety copy now** and **Stop** Deja Vu1.

The built-in **app-data backup** (Settings) includes settings, library files and
per-printer records, with validated recovery into a separate copy. Make one
before your first update. It excludes printer firmware and external
engines/presets; see [backup and recovery](backup-and-recovery.md).

### If Deja Vu1 won't open

Your browser says "Deja Vu1 isn't running right now", or the dashboard stopped
answering? Paste one block. It starts Deja Vu1 in Documents if it isn't
running, then that window shows **Deja Vu1 is ready and fully working**, or what
is wrong and the next block to paste. Then close the window if you like: Deja Vu1
keeps running in the background, and starts by itself whenever you sign in.

   **Windows:** open a new **PowerShell** window and paste:

   ```powershell
   $dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Deja_VU1'
   if (-not (Test-Path "$dest\start.py")) { $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest 'https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip' -OutFile "$env:TEMP\dejavu1.zip"; Expand-Archive "$env:TEMP\dejavu1.zip" -DestinationPath $dest -Force }
   Set-Location $dest
   if (Get-Command py -ErrorAction SilentlyContinue) { py -3 start.py --background --autostart } elseif (Get-Command python -ErrorAction SilentlyContinue) { python start.py --background --autostart } else { Write-Host 'Deja Vu1 needs Python 3.8 or newer: https://www.python.org/downloads/' }
   ```

   **Mac, Linux or Raspberry Pi:** open a new Terminal window and paste:

   ```bash
   [ -f ~/Documents/Deja_VU1/start.py ] || { curl -fL -o /tmp/dejavu1.zip https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip && python3 -m zipfile -e /tmp/dejavu1.zip ~/Documents/Deja_VU1 && chmod +x ~/Documents/Deja_VU1/*.command ~/Documents/Deja_VU1/*.sh; }
   cd ~/Documents/Deja_VU1 && python3 start.py --background --autostart
   ```

If that window still shows a problem, paste the update block above: it also
repairs a copy, putting fresh app files in place. Your settings, printers and
files stay.

## What has not been proved yet

The Linux launcher, disposable update/rollback processes and git-copy updates
(against real git repositories on Linux) have automated checks. Installing the
desktop app in a real Chrome or Edge window, the launcher's app window on Windows
or macOS, the Windows update block and an update between two published releases have not been tried yet. Windows/macOS double-click launching, a real U1, real iPhone/Android
installation, home firewalls and remote access still need device testing. An
emulated phone-sized browser is useful for layout, but does not prove those.
