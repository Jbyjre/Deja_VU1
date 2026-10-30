# First connection: help Deja Vu1 meet a real U1

Deja Vu1 has never talked to a physical Snapmaker U1. Its printer connection
was written against Snapmaker's published `u1-klipper` and `u1-moonraker`
source and tested against a stand-in built from that source, over real network
connections ([real-printer.md](real-printer.md) has the details). Reading the
source already turned up about a dozen things that would each have been a bug
on a first real connection. The first real connection is where anything the source
doesn't show will turn up, and this page is how to help find it.

Snapmaker shipped a U1 to the maintainer on 29 October 2026 through the
Innovation Fund's hardware sponsorship, so the first connection will run on that
printer. A session on your U1 still helps: a second printer, on another network
and with other filaments, catches things one printer can't.

## What it involves

- **About 30 to 45 minutes**, on a video call with the maintainer or on your
  own, sending what you saw afterwards.
- **Watch-only.** Watch a print you're already running. Don't press any of
  Deja Vu1's controls (pause, resume, cancel, temperatures, home, G-code,
  start) in this first session.
- **Nothing installed on the printer.** Deja Vu1 runs on a computer on the
  same network and talks to Moonraker, the web API built into the U1.

On a fresh install Deja Vu1 has no automation rules and an empty print queue,
so it only asks the printer for information (live state, print history and
the like) until someone presses a control.

Deja Vu1 has no login: anyone who can reach port 8000 on that computer can use
its controls. Keep it on your home network for the session (see
[security](../README.md#security-and-your-network)).

## Before you start

- A computer on the same network as the U1, with Python 3.8 or newer (the
  tests pass on 3.8, 3.10, 3.12 and 3.13 in GitHub Actions). It hasn't been confirmed on Windows yet; if that's
  what you have, say so when you sign up.
- The printer's address: the same one Fluidd or Mainsail uses, usually
  `http://<printer-ip>:7125`.
- Which firmware the U1 runs (stock or the community Extended Firmware), and
  its version if you know it.

## Steps

1. Get the code: `git clone https://github.com/Jbyjre/Deja_VU1.git`, then
   `cd Deja_VU1`. Or use GitHub's **Code → Download ZIP**, unzip it, and open a
   terminal in the unzipped folder (GitHub names it `Deja_VU1-main`).
2. Start it with every exchange recorded, saved to a file:
   - macOS or Linux: `DEJAVU_MOONRAKER_LOG=1 python3 backend/app.py 2> dejavu-log.txt`
   - Windows PowerShell: `$env:DEJAVU_MOONRAKER_LOG = "1"; python backend\app.py 2> dejavu-log.txt`

   While a print runs, Klipper reports several times a second, so the detailed
   log is long. The `2> dejavu-log.txt` part puts it in a file in that folder
   instead of the terminal; the terminal still shows the address to open. If
   the dashboard doesn't start, the reason is in that file.
3. Open **http://localhost:8000** in a browser on that computer. It will say
   no printer is connected.
4. **Printers → Add a printer.** Give it a name, paste the address, and add an API
   key only if your Moonraker asks for one.
5. Within a few seconds the row shows **Connected**, or says in words why it
   isn't. [real-printer.md](real-printer.md#what-happens-if-something-is-wrong)
   explains each message.
6. Watch your print for a few minutes. Compare the dock states, temperatures,
   progress and finish time with the printer's own screen.
7. Open **Details** on the printer's row. It shows whether the link is open,
   Klipper's state, which toolheads and chamber sensor were found, how much
   print history was read, and the newest 14 exchanges with Moonraker.
8. Save the full record, once right after connecting and again at the end:
   open **http://localhost:8000/api/fleet/registry**, find your printer's `id`
   (it looks like `printer-1a2b3c`), then open
   `http://localhost:8000/api/printers/diagnostics?printer=` followed by that
   id, and save the page (File → Save Page As). It holds the last 300
   exchanges; with detailed logging on, live updates fill those quickly, which
   is why the first save matters.

## What to send back

- What looked right and what looked wrong, compared with the printer's screen.
- The saved diagnostics pages from step 8 and `dejavu-log.txt` from step 2.
- **Read them before you share them.** They include the printer's address on
  your network and can include the names of your print files. They never
  contain your API key (only whether one is set). Remove anything you'd rather
  keep private.

## Sign up

[Open a "First connection" issue](https://github.com/Jbyjre/Deja_VU1/issues/new?title=First+connection%3A+I+have+a+U1&body=%2A%2AFirmware+on+my+U1%3A%2A%2A+stock+%2F+Extended+Firmware+%28version%2C+if+known%3A+%29%0A%2A%2AComputer+that+will+run+Deja+Vu1%3A%2A%2A+macOS+%2F+Linux+%2F+Windows%0A%2A%2ASession%3A%2A%2A+on+a+video+call+with+the+maintainer+%2F+on+my+own%2C+sending+the+log+afterwards%0A%2A%2AOK+to+record+the+screen+%28network+addresses+blurred%29%3F%2A%2A+yes+%2F+no%0A%2A%2AThank+me+by+name+in+the+release+notes%3F%2A%2A+yes%2C+as%3A+%2F+no%0A)
on GitHub. The questions are filled in already; you need a free GitHub
account. Screen recordings happen only with your permission, with network
addresses blurred.

Whatever breaks gets fixed in the open, and the README's
[Current status](../README.md#current-status) is updated to say exactly what
was tested, and on which firmware.
