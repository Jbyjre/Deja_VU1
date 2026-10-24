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

1. Install Python 3.8 or newer from [python.org](https://www.python.org/downloads/)
   if you do not already have it. On Windows, the launcher tries `py -3` and then
   `python`; allow the installer to add Python to PATH if that option appears.
   PATH is the computer's list of places to look for programs.
2. Open [Deja Vu1 on GitHub](https://github.com/Jbyjre/Deja_VU1), choose **Code →
   Download ZIP**, and extract it to a folder in Documents. Keep this folder:
   your saved settings and files normally live inside `backend/data/`.
3. Open the folder and double-click **start-windows.bat**, **start-mac.command**,
   or **start-linux.sh**. On Mac/Linux, if the file opens as text or cannot run,
   open Terminal in the folder and run `python3 start.py`. Downloaded files may
   need your operating system's permission to open; do not disable its security.
4. Your browser opens [the local dashboard](http://localhost:8000). Keep the
   launcher window open. Closing it stops the dashboard. The launcher also
   prints **From a phone**, followed by your computer's home-network address.
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
printer does not start a print. To explore first, choose **Explore demo data**;
simulated figures are labelled and simulated commands cannot control a real U1.

## On my phone at home

1. Leave Deja Vu1 running and the computer awake. Put the phone, computer and
   printer on the same trusted home network. Avoid guest Wi-Fi, which can keep
   devices apart.
2. On the phone open Safari (iPhone) or Chrome (Android). Type the full **From a
   phone** address from the launcher, for example `http://192.168.1.20:8000`.
   **Use the computer's address, not the printer's.** `localhost` on your phone
   means the phone itself, so it will not reach your computer.
3. If the launcher cannot find an address: Windows → Settings → Network &
   internet → your active connection → properties → IPv4 address; Mac → System
   Settings → Network → your active connection → Details → TCP/IP; Linux → your
   desktop's network connection details, or run `hostname -I` and choose the
   address belonging to your home network. Several addresses can appear if
   you have a VPN. These OS screens vary by version.
4. Select your real printer and leave **Demo data** off on this browser too.
   The phone shares server settings, files and printers; browser preferences
   such as the name, selected printer and demo choice are separate.
5. On iPhone, **Share → Add to Home Screen**; enable **Open as Web App** if
   offered. On Android, Chrome menu → **Add to Home screen** or **Install app**,
   whichever appears. [Apple's instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios)
   and [Chrome's instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).

A plain `http://192.168…` address may offer only a shortcut. A PWA is a website
that can install with an app-like window; full install support and the offline
page require HTTPS (a secure address), or localhost on the computer itself.
Deja Vu1 includes an app manifest, icons and a service worker, the small browser
script that supplies its offline page. It **does not cache printer readings or
queue commands offline**. A previously loaded secure installation shows a
“dashboard is offline” page if the server cannot be reached; it cannot control
anything until reconnected. Browser installation rules vary.
[Browser requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

**Pair another device is optional device bookkeeping, not a login or a step
needed to open the dashboard.** Anyone with network access to this dashboard
can operate it. Use the remote guide below for access away from home.

## On my phone away from home

Use [the private remote-access guide](remote-access.md). The recommended route
is Tailscale on your computer and phone, with Tailscale Serve supplying a private
HTTPS address. The alternative is a Cloudflare tunnel protected by Cloudflare
Access **before** you make the address reachable. Neither is built into Deja Vu1.
Never forward the dashboard's port through your router: the app has no login.

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

Open **Settings → Version & updates**. It shows the version you run, how your
copy updates and what every version changed. Press **Check for updates**; when
one is ready, press **Install**. To have Deja Vu1 look by itself, turn on **Look
for updates by itself**: it checks at startup and once a day, and the glass orb
in the bottom-right corner tells you. A check sends GitHub no name, printer
details or settings; GitHub still sees the network address making the request.

- **A copy made with GitHub Desktop or git** pulls the newest version of `main`
  from GitHub. It only moves forward: if you changed any of its files by hand,
  or it has commits of its own, it stops and changes nothing. On Windows it also
  finds the copy of git that GitHub Desktop keeps for itself.
- **A downloaded copy** installs the newest published release. It checks the
  download's SHA-256 fingerprint before using it.

Either way: start Deja Vu1 with its launcher, and wait until every real printer
is idle and slicing has finished. Install keeps the data folder, restarts the
dashboard, and puts the previous version back if the new one fails its startup
check. Keep the launcher window open. Printer firmware updates are separate.

### Updating an older copy for the first time

If Settings has no **Version & updates** card, your copy is older than the
updater for it. Update by hand once; after that, updates come through the app.

1. Close the launcher window to stop Deja Vu1.
2. Then, depending on how you got it:
   - **GitHub Desktop:** open GitHub Desktop and choose the **Deja_VU1**
     repository at the top left. Press **Fetch origin**, then **Pull origin**
     when it appears. If GitHub Desktop says you changed files, it lists them;
     you made no deliberate changes, so **Discard changes** is usually right,
     but read the list first. Your settings live in `backend/data/`, which git
     ignores and never lists.
   - **git:** open a terminal in the folder and run `git pull`.
   - **ZIP:** download the newest version into a new folder. Copy the whole
     `backend/data/` folder from the old copy into the new one. Keep the old
     folder until the new one works. If you set `DEJAVU_DATA_DIR`, keep pointing
     to that same folder instead.
3. Start the launcher again. The header shows the new version.

The built-in **app-data backup** (Settings) includes settings, library files and
per-printer records, with validated recovery into a separate copy. Make one
before your first update. It excludes printer firmware and external
engines/presets; see [backup and recovery](backup-and-recovery.md).

## What has not been proved yet

The Linux launcher, disposable update/rollback processes and git-copy updates
(against real git repositories on Linux) have automated checks. Installing the
desktop app in a real Chrome or Edge window, the launcher's app window on Windows
or macOS, and an update between two published releases have not been tried yet. Windows/macOS double-click launching, a real U1, real iPhone/Android
installation, home firewalls and remote access still need device testing. An
emulated phone-sized browser is useful for layout, but does not prove those.
