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

Run them one at a time, roughly in this order. Each was written on
17 October 2026 against the code at that point; a session should re-check
anything a prompt states before relying on it.

| # | Prompt | What it gets you |
|---|---|---|
| 1 | [Multi-nozzle printing](01-multi-nozzle-printing.md) | Different nozzle sizes and layer heights per toolhead: the feature behind the $5,000 Tier 1 winner, made safe to print from Deja Vu1 |
| 2 | [Fix the known open issues](02-reliability-known-issues.md) | Every bug the October audit found, fixed and tested |
| 3 | [Make every feature work every time](03-feature-backend-audit.md) | An end-to-end audit of the features nobody has audited yet |
| 4 | [Send each job to the right printer](04-farm-job-routing.md) | A farm queue that picks the printer with the right filament and nozzles loaded |
| 5 | [multiACE and 16 colours](05-multiace-16-colour.md) | Support for U1s with Anycubic ACE units, the other Tier 1 winner |
| 6 | [Make the big features lead](06-app-structure.md) | An app that feels as big as it is: navigation, Overview and weak features reworked |
| 7 | [Install on a real U1](07-real-u1-install.md) | Running Deja Vu1 next to Fluidd/Mainsail, ready for the first real connection |
| 8 | [Launch prep](08-launch-prep.md) | Fresh pictures, honest copy, temporary folders removed, ready to post |
