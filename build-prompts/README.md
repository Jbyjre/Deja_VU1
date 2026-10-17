# Build prompts

> **Temporary. Delete this folder (with `marketing-library/`) before the
> launch post.** These are working notes for the owner, not documentation.

One prompt per piece of work that's big enough for its own Claude Code
session. Each one says what the owner wants and why, gives the context a
fresh session needs, and leaves the *how* to that session.

## How to use one

1. Start a new Claude Code session on this repository (claude.ai/code, pick
   `Jbyjre/Deja_VU1`).
2. Open the prompt file below, copy everything under the line, and paste it
   as your first message.
3. Let it work. It will open a pull request and merge it when the checks
   are green, as `CLAUDE.md` says.

Four prompts, consolidated on 17 October 2026 from eight (the first,
multi-nozzle printing, was mostly built in that session; what's left of it
is in prompt 2). Each gives the goal, what's known, and directions, and
leaves the *how* to the session. Run them roughly in this order, and let
each session re-check what a prompt states before relying on it.

| # | Prompt | What it gets you |
|---|---|---|
| 1 | [Make everything work, every time](01-make-everything-work.md) | Every known bug fixed, the never-audited features (automations, converter, slicer bridge, Studio, queue, camera) tried hard and fixed, and a smarter dashboard |
| 2 | [More colours, more nozzles, the whole farm](02-multi-material-and-farm.md) | multiACE's 16 colours, mixed nozzles through the converter, slicer and Studio, and jobs that go to the right printer by themselves |
| 3 | [Make the big features lead](03-structure-and-drawings.md) | An app that feels as big as it is, with the digital twin's drawing style brought to the rest of the screens |
| 4 | [On a real U1, then launch](04-real-u1-and-launch.md) | An install a U1 owner can follow, the first real connection, then fresh pictures, honest copy and the GitHub page ready to post |

## Asked for, not built yet

From the owner's 17 October requests, these need a session of their own
and are written into the prompts above:

- The drawing style across the rest of the app (fleet cards, G-code viewer,
  charts, maintenance, converter previews): prompt 3.
- "Smarter" behaviour that notices problems before it's asked: prompts 1
  and 3.
- Mixed nozzles in the converter, slicer bridge and Photo Studio, and
  Photo Studio measured against HueForge: prompt 2.
- Installing next to Moonraker on the printer itself: prompt 4.
- The GitHub page itself (About text, topics, social preview), which only
  the owner can change: prompt 4 lists the clicks.
