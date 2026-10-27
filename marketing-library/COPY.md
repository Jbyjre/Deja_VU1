# Copy ready for review

Drafts only. No application or social post has been submitted. Use the current
campaign images in `09-current-campaign/`; their captions and alternatives are in
`captions.json`. Recheck physical-testing status before posting.

## Repository description

Free, local dashboard and plate-preparation workspace for Snapmaker U1 printers:
fleet status, G-code inspection and server-checked print starts. Python only, MIT.
Simulated demo online; not yet tested on a physical U1.

The About box on GitHub still shows an older line that leads with LED rings and a
colour sensor, which have no hardware drivers yet. Replace it with the text above
(the cog next to About) and add the topics below.

Suggested topics: `snapmaker-u1`, `snapmaker`, `3d-printing`, `moonraker`,
`klipper`, `print-farm`, `dashboard`, `toolchanger`.

## Short project description

Deja Vu1 puts your Snapmaker U1 printers in one local workspace. See which
printer needs attention, prepare a plate, inspect the sliced layers and review the
checks before a print starts. It's free and open source, and it needs no app
account. Slicing needs a separate engine. The public demo uses simulated printers,
and I haven't connected it to a physical U1 yet.

## Project page / Phase 2 description

Deja Vu1 is a dashboard and plate-preparation workspace for Snapmaker U1 printers.
It runs on your computer and opens in a browser. You can try a simulated farm
without installing anything.

**What it does.** The fleet view shows each U1's reported state, temperatures and
progress. Needs you lists the faults, paused jobs and overdue care that want a
person. The preparation workspace keeps objects, head assignments and slicer
profiles together, and an engine you install yourself does the slicing. The result
opens in a layer viewer with tool and requested-speed views. Confirm Print runs
file and printer checks before a start, and the server runs them again when the
print starts. A blocking error refuses the start; a warning needs your OK. The
checks help you review a job. They don't guarantee a good print.

**What I wrote and what I used.** The Moonraker client, the print gate, the G-code
pre-flight, the mixed-nozzle layer planner and the interface are this project's
own code, under the MIT licence. It talks to Moonraker and Klipper through their
public API and slices with OrcaSlicer or Snapmaker Orca, which you install
separately. I read their source for message formats and plate sizes and copied no
code. CREDITS.md lists everything the project uses and how.

**What is tested and what isn't.** The 904 automated tests include ones that run
the Moonraker client against a stand-in Moonraker built from Moonraker's and
Snapmaker's source. A real slicing engine on Linux has sliced mixed-nozzle layer
heights. I don't own a U1, so nothing has run on a physical printer: no real
connection, no mixed-nozzle print, no measured colour accuracy. The README's
status table lists each limit.

**How it was written.** Much of the code is written with Claude Code, from my
direction. The working notes (CLAUDE.md) and every change are public.

**Next.** A watch-only first connection on an owner's U1, then staged hardware
tests.

Try the simulated farm: https://deja-vu1.jmath1110.workers.dev/?demo

Code and setup: https://github.com/Jbyjre/Deja_VU1

Independent project; not affiliated with or endorsed by Snapmaker.

## Forum / Reddit introduction

**Deja Vu1: a local workspace for U1 status, plate preparation and print checks**

I'm building Deja Vu1 to bring the everyday U1 workflow into one browser window:
see which printer needs attention, prepare the next plate, inspect the layers,
and check the job before starting.

The demo lets you explore a simulated farm without installing anything:
https://deja-vu1.jmath1110.workers.dev/?demo

A few things to try:

- Open a printer from Needs you and inspect its head details in the 3D twin.
- Open a sample G-code file and move through its layers.
- Explore the preparation workspace and physical T0–T3 assignments.

The core runs locally with Python. Slicing needs a separately installed engine.
The code and setup guide are here: https://github.com/Jbyjre/Deja_VU1

It has not connected to a physical U1 yet, and I don't own one. I'm looking for an
owner who can spare 30–45 minutes for a watch-only session with a print already
running. We would compare readings, without using Deja Vu1's printer controls:
https://github.com/Jbyjre/Deja_VU1/blob/main/docs/first-connection.md

If you run more than one U1, which check do you do most often by walking over to
the printer?

Independent project; not affiliated with or endorsed by Snapmaker. Screenshots
show simulated data. Much of the code is written with Claude Code; the
implementation and change history are public.

## Short social post

Which U1 needs attention? Deja Vu1 puts fleet status, plate preparation and print
checks in one local workspace. Free and open source. Try the simulated farm:
https://deja-vu1.jmath1110.workers.dev/?demo
Physical U1 testing is still ahead.

## First-connection invitation

Have a Snapmaker U1 and 30–45 minutes? Help test Deja Vu1’s first real connection.
Watch a print you already started, compare its readings, and share what differs.
No printer controls in this session. Details:
https://github.com/Jbyjre/Deja_VU1/blob/main/docs/first-connection.md

## Video title and description

**Deja Vu1: U1 fleet status, plate preparation and print checks**

A tour of Deja Vu1, a free, open-source workspace for Snapmaker U1 printers.
It runs on your computer and opens in your browser. Slicing needs a separate engine.

Every printer in this film is simulated, and the phone's home-network address
is an example. The twin is a software model with estimated body size and internal
geometry. I haven't connected Deja Vu1 to a physical U1, and print checks don't
guarantee a successful print. Older films contain historical test counts; use the
repository for current results.

Demo: https://deja-vu1.jmath1110.workers.dev/?demo
Code and setup: https://github.com/Jbyjre/Deja_VU1
First connection: https://github.com/Jbyjre/Deja_VU1/blob/main/docs/first-connection.md

Independent project; not affiliated with or endorsed by Snapmaker.
Piano: Salamander Grand Piano by Alexander Holm, CC BY 3.0.

Keep that piano attribution when posting the films (versions 16 and 17 use the same
recorded piano, bass and drums as versions 12 and 14). Post version 17, 16:9;
the V2 films and 9:16 cuts are set aside.
