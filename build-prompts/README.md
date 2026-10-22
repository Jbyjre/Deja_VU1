# Build prompts

> **Temporary. Delete this folder (with `marketing-library/`) before the
> launch post.** These are working notes for the owner, not documentation.

Follow-up briefs for work that needs a separate coding session. Start with
[07: physical validation and format fidelity](07-physical-validation-and-format-fidelity.md).
Read the current [validation record](../docs/slicer-workspace-validation.md)
and [working rules](../CLAUDE.md) before relying on an older brief.

## How to use one

1. Start a new Claude Code session on this repository (claude.ai/code, pick
   `Jbyjre/Deja_VU1`).
2. Open the prompt file below, copy everything under the line, and paste it
   as your first message.
3. The session should open a pull request and merge with one merge commit when
   checks are green or absent and there are no conflicts. Pending checks are
   reported without waiting, polling or enabling auto-merge.

## Current and historical briefs

| # | Prompt | What it gets you |
|---|---|---|
| 7 | [Physical validation and format fidelity](07-physical-validation-and-format-fidelity.md) | Current priorities: owner-authorized U1 testing, real-phone performance, platform setup, format fidelity and remaining launch media |
| 6 | [Native studio and compatibility](06-native-studio-hardware-and-compatibility.md) | Historical round-two brief; several engine, plate and recovery gaps are now resolved |
| 5 | [Launch follow-through](05-launch-follow-through.md) | Historical launch-polish brief; recheck against current evidence |
| 1–4 | [Reliability](01-make-everything-work.md), [materials/farm](02-multi-material-and-farm.md), [structure](03-structure-and-drawings.md), [real U1/launch](04-real-u1-and-launch.md) | Original goals, retained for context rather than a current completion list |
| 99 | [Cleanup merge notes](99-cleanup-merge-notes.md) | Historical wording pass; its test totals and branch notes are not current |

The unified workspace, capable-engine per-head heights, single-plate separation
and isolated app-data recovery are implemented. Feeder control, physical colour
accuracy and real-printer validation remain open. Avoid repeating resolved work
or treating an old brief's ambitions as shipped features.
