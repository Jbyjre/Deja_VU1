# Copy ready for review

Drafts only. No application or social post has been submitted. Use the current
campaign images in `09-current-campaign/`; their captions and alternatives are in
`captions.json`. Recheck physical-testing status before posting.

## Repository description

Free, local workspace for Snapmaker U1 printers: fleet status, plate preparation,
G-code inspection and print checks. Physical U1 testing pending.

Suggested topics: `snapmaker-u1`, `snapmaker`, `3d-printing`, `moonraker`,
`klipper`, `print-farm`, `dashboard`, `toolchanger`.

## Short project description

Deja Vu1 brings your Snapmaker U1 printers into one local workspace. See which
printer needs attention, prepare a plate, inspect the sliced layers and review
checks before starting. It is free and open source, with no app account.
Slicing needs a separate engine. The public demo uses simulated printers;
physical U1 testing is still ahead.

## Project page / Phase 2 description

A paused job on one printer. A dock fault on another. A plate ready to collect.
Deja Vu1 puts those separate checks on one screen, alongside the tools for
preparing the next job.

It runs on your computer and opens in a browser. The fleet view shows each U1’s
reported state, temperatures and progress. Needs you ranks faults, paused jobs
and overdue care. A 3D twin and drawing provide another way to inspect the
selected printer; their body size and internal geometry are estimates.

The preparation workspace keeps objects, physical head assignments and profiles
together. A separately installed compatible engine does the slicing. The output
opens in a layer viewer with tool and requested-speed views. Confirm Print brings
together file and printer checks, and the server checks again when starting.
Blocking errors refuse the start; warnings require acknowledgement. The checks
do not guarantee a successful print.

The code is MIT licensed. The core uses Python’s standard library and plain
browser code. Setup, validation records and limitations are public. Software
checks include authenticated stand-in printer connections and recorded Linux
engine output. No physical U1 connection, mixed-nozzle print or measured colour
accuracy has been verified. The next useful milestone is a watch-only connection
to an owner’s U1, followed by staged hardware testing.

Try the simulated farm: https://deja-vu1.jmath1110.workers.dev/?demo

Code and setup: https://github.com/Jbyjre/Deja_VU1

Independent project; not affiliated with or endorsed by Snapmaker.

## Forum / Reddit introduction

**Deja Vu1: a local workspace for U1 status, plate preparation and print checks**

I’m building Deja Vu1 to bring the everyday U1 workflow into one browser window:
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

The important gap: it has not connected to a physical U1 yet. I’m looking for an
owner who can spare 30–45 minutes for a watch-only session with a print already
running. We would compare readings, without using Deja Vu1’s printer controls:
https://github.com/Jbyjre/Deja_VU1/blob/main/docs/first-connection.md

Which part of your current U1 workflow would you most want to keep in one place?

Independent project; not affiliated with or endorsed by Snapmaker. Screenshots
show simulated data. Development uses AI coding tools; the implementation and
change history are public.

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

**Deja Vu1 — U1 fleet status, plate preparation and print checks**

A tour of Deja Vu1, a free, open-source workspace for Snapmaker U1 printers.
Runs on your computer; opens in your browser. Slicing needs a separate engine.

Every printer in this film is simulated, and the phone's home-network address
is an example. The twin is a software model with
estimated body size and internal geometry. No physical U1 connection is verified,
and print checks do not guarantee a successful print. Older films contain
historical test counts; use the repository for current results.

Demo: https://deja-vu1.jmath1110.workers.dev/?demo
Code and setup: https://github.com/Jbyjre/Deja_VU1
First connection: https://github.com/Jbyjre/Deja_VU1/blob/main/docs/first-connection.md

Independent project; not affiliated with or endorsed by Snapmaker.
Piano: Salamander Grand Piano by Alexander Holm, CC BY 3.0.

Keep that piano attribution when posting the films (versions 16 and 17 use the same
recorded piano, bass and drums as versions 12 and 14). Post version 17, 16:9;
the V2 films and 9:16 cuts are set aside.
