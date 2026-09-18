# Project status

An exhaustive, verbose snapshot of Deja Vu1 — everything about it, not a
summary of everything about it. What it is, why it exists, the full
chronological history of what's been asked for and built, every backend
module and what it does, every frontend file and how it's put together,
every game in mechanical detail, the design system and why it looks the
way it does, the mistakes made along the way and how they were caught,
every standing preference and behavioral rule, the exact current state of
the git history and both pull requests, what's explicitly not built yet,
and what's next. Written so that a new session — human or AI — never has
to re-derive any of this from chat history. Updated 2026-09-18.

---

## 1. What this project is, and why it exists

Deja Vu1 is a Moonraker dashboard and companion app for the **Snapmaker
U1**, a multi-toolhead 3D printer. Moonraker is the web API that sits in
front of a Klipper-based printer — software asks it questions like "what
is the printer doing right now?" and it answers in JSON. Deja Vu1 is one
web application that reads that one connection and turns it into
something a person can actually use day to day: maintenance reminders,
printer control, filament tracking, notifications, cost estimates, smart
home integration, and games for while a print runs.

This project exists as an application to the **Snapmaker U1 Innovation
Fund**. Phase 1 of that fund closed **September 7, 2026**; the target is
**Phase 2**, which opens **October 1, 2026**. The person building this
(referred to throughout this document as "the owner," and in earlier
project commits/PRs simply as the account behind `github.com/Jbyjre`)
**does not currently own a Snapmaker U1**. Part of the point of this
submission is to request one. Because of that, the entire project has
been built and tested against **simulated printer data** — no real
printer has ever been contacted, at any point, by any part of this
codebase. This is not a temporary shortcut; it is an explicit, tested
architectural rule (see section 6, "The no-printer-no-figures rule").

The competitive context matters too: early in this project's life, the
owner pasted the **full list of all 66 other Phase-1 Innovation Fund
submissions** and asked for their features to be mined for ideas, with
the explicit reasoning: *"we have to get a lot of small niches into our
big, big one so that ours stands out."* Multiple rounds of feature work
in this project's history trace directly back to that list — the print
cost calculator, the WLED bridge, and the Home Assistant bridge were all
built specifically to close gaps identified against that competitive
landscape, not because they were on an original plan.

**Repository:** `github.com/Jbyjre/Deja_VU1` (also referenced during this
project as `jbyjre/deja_vu1` — GitHub owner/repo names are
case-insensitive in practice, this is the same repository).

### The hard constraint that shapes every technical decision

**Zero dependencies.** This is not a soft preference — it is the single
constraint that every other technical decision in this project bends
around:

- **Backend:** Python 3.8+, standard library only. The HTTP server is
  built on `http.server.HTTPServer` and `SimpleHTTPRequestHandler` —
  explicitly *not* Flask, FastAPI, or any other framework, because that
  would be a dependency to install. JSON handling is the stdlib `json`
  module. Outbound webhook calls (notifications, the WLED bridge, the
  Home Assistant bridge) use `urllib.request`, not `requests`.
- **Frontend:** plain HTML, CSS, and JavaScript. No React, no Vue, no
  build step (no webpack, no bundler, nothing to `npm run build`), no
  webfonts (the CSS explicitly uses system font stacks —
  `-apple-system`, `ui-monospace`, etc. — specifically so the dashboard
  works with zero network access), no CDN scripts, no analytics.
- **Storage:** plain JSON files under `backend/data/`, one per module
  that needs to persist something. No database to install. The whole
  directory is gitignored and regenerated on first use.
- **Result:** running the real app is `python3 backend/app.py` and
  opening a browser. Nothing to install beyond Python itself. This was
  verified directly, repeatedly, throughout the project's life by
  actually starting the server and hitting it with `curl` and headless
  Chromium (Playwright), never just trusted because the code "should"
  work that way.

---

## 2. Who's asking, and every standing rule established so far

The owner (referred to as "Jake" in the personalization notes attached to
this session) has **no coding background**. This is not incidental
context — it is a standing instruction that shapes how every response in
this project should read: technical terms get explained in plain
language when they come up, not assumed as understood. The owner has said
directly: *"I have no coding experience... explain all coding terms as if
I have no clue what coding is. I'm tech aware, but when it comes to
coding I'm not fluent."*

Every standing behavioral rule established across this project's history,
stated as close to verbatim as this document can manage, because getting
these wrong has real cost:

- **"Never assume things when your not sure, ALWAYS do research in order
  to find the CORRECT information."** This rule has been invoked
  concretely at least twice: once when an unfamiliar platform name
  ("Unfinity") appeared in a request and was clarified via a direct
  question rather than guessed at (it turned out to mean "any
  phone/tablet browser" — nothing to do with an actual product called
  Unfinity), and once when a bare, context-free "Try again" message
  arrived with no clear referent and was met with a clarifying question
  rather than a guess.
- **Don't stonewall on feature requests.** Said multiple times, with
  real heat behind it at least once: *"So I don't care if you go indepth
  into 5 games... take what I give you and pursue it instead of
  stonewalling me... when I ask for features literal things that
  contribute not minor app logic... always read over the messages I send
  because they are important and apply them fully."* The operative rule
  this produces: when a feature is clearly asked for, build it — don't
  use clarifying questions as a way to avoid building, don't quietly trim
  the scope of what was asked down to something smaller or safer.
  Reasonable interpretive calls on genuinely ambiguous *details* (which
  exact mechanic, which exact color) are expected and fine; declining or
  deferring a clearly-stated feature is not.
- **"Put some real effort into it and don't be lazy about it."** Said in
  the context of the games specifically, twice, in different phrasings,
  across two different rounds of game-related feedback.
- **Be context-efficient.** Stated directly: *"make sure to be context
  efficient... I don't have an unlimited supply of usage."* This produced
  a concrete session action — loading and applying the
  `anthropic-skills:context-efficiency` skill — and is a standing
  constraint on how much re-reading, re-verifying, and re-deriving should
  happen versus reusing what's already established. It does **not**
  override an explicit request for verbosity or thoroughness on a
  specific deliverable when the owner asks for one directly — this very
  document is an example: the owner explicitly asked for it to be made
  "even longer," "detail EVERYTHING," "be verbose about it," which is a
  direct, specific instruction that takes precedence over the general
  efficiency default for this one artifact.
- **Be supportive and helpful, never condescending.** Direct instruction:
  *"Be supportive and helpful in response and find ways to fix the
  problem or question. Be supportive and nice, never be condescending."*
- **Reference memory and past chats when needed**, and don't guess at
  unfamiliar references — ask.
- **NEVER subscribe to PR/notification activity.** The newest and
  firmest standing rule, stated flatly: *"include NEVER subscribe to
  notifications, I never want that."* This has real teeth in this
  project's history — see section 9 below for exactly how this was
  applied, including one case where the GitHub platform itself
  auto-subscribed the session to a newly-created PR without an explicit
  `subscribe_pr_activity` call, and the subscription was caught via the
  resulting notification and immediately reversed to honor this rule.
- **Verify, don't assert.** Not a quoted instruction so much as an
  operating pattern established and reinforced across this entire
  project: claims about what the app does have been checked with
  headless-browser testing (Playwright) rather than trusted because the
  code reads correctly. This caught real issues (see section 8) and also
  caught false alarms in the *testing* code itself, which were
  distinguished from real bugs rather than reported as bugs.
- **Games specifically: current-day verdict is that they are not good
  enough.** Most recent direct feedback: *"the games could be a lot
  better... right now they still suck."* This is treated in this project
  as a standing, unresolved item — not something to declare fixed by a
  single difficulty tweak. See section 7 for the full detail on this,
  and `docs/games-improvement-handoff.md` for the standalone task this
  produced.

### On design and visual quality specifically

Two hard corrections early in this project's life produced standing
rules that still apply to any future visual work:

1. The first design pass carried over the project's *original* dark
   theme without deliberately choosing it, and without loading the
   project's own frontend-design skill first. The owner's correction was
   sharp: *"What part of applying my requests didn't you get... you give
   me this ai one without even using the /frontend-design skill."* The
   standing rule this produces: **load the right design skill before
   building UI, and treat visual direction as a deliberate choice, not
   an inherited default.**
2. The first *light*-theme pass (after that correction) used a
   purple-to-blue gradient background blob — which is independently
   documented (via this project's own research into "AI slop" visual
   tells) as the single most commonly cited giveaway of unconsidered,
   generic AI-generated design. It was caught and removed before the
   owner had to flag it, replaced with a brand-specific, asymmetric
   orange/blue treatment and bespoke ring motifs echoing the product's
   own dock-ring branding. The standing rule: **treat purple/blue
   gradients, generic `rounded-lg`-everywhere cards, Inter/Space
   Grotesk-as-safe-default, and decorative blur with no relation to the
   brand as things to actively avoid, not neutral defaults.**

---

## 3. The full chronological history of this project

This section exists specifically so nothing about *why* the codebase
looks the way it does has to be re-derived from git blame. Phases, in
order:

### Phase 0 — Research and status summary
The project started with a request to summarize the existing (pre-this-
session) project status, research the Innovation Fund's other Phase-1
submissions, and recommend improvements. This produced the competitive
research described in section 1.

### Phase 1 — Visual redesign: Apple Liquid Glass
A request to redesign the UI as authentic "white Apple Liquid Glass" —
explicitly *not* the project's original dark theme, and explicitly using
"proper technique (edge-lensing via SVG filter, not just blur)." This
phase included the two hard corrections described in section 2 (skill
not loaded first / dark theme not deliberately chosen; purple-gradient
AI-slop mistake caught and fixed). The result is the five-layer glass
system described in full detail in section 6.

### Phase 2 — Mobile pairing, no accounts
A request to add a mobile app / phone-pairing sync concept with
explicitly **no account or login system**. This was the assistant's own
architectural call within that constraint (accepted implicitly by the
owner) to implement it as a one-time 6-digit pairing code rather than any
form of authentication.

### Phase 3 — Feature mining from the 66-project competitive landscape
The owner pasted the full list of all 66 Phase-1 Innovation Fund
submissions and their descriptions, with the explicit framing quoted in
section 1 — get enough small niches covered that this project's larger,
more comprehensive one stands out. This directly produced several later
feature phases (cost calculator, WLED bridge, Home Assistant bridge).

### Phase 4 — AI-slop research and a genuine game concept
A request to research how to make AI-generated visual designs look less
generic, apply that research to the actual HTML, add more real
user-facing preference options (accent color, temperature units — not
just backend toggles), and add a games tab for while a print runs. The
first game built in this phase ("Filament Match," a memory/pairs-matching
game) was rejected outright as boring and generic.

### Phase 5 — The games get serious, multiple rounds of pushback
Across several rounds, the owner repeatedly rejected shallow game
attempts and pushed for real depth: *"make like 5 good games... explore
a world in 3D while you wait... doesn't have to have any relation to 3D
printing, give it depth and make it interesting not basic."* And, more
sharply: *"So I don't care if you go indepth into 5 games, and both of
the current games look terrible, take what I give you and pursue it
instead of stonewalling me."* This is also where the "don't stonewall,"
"read every message and apply it fully," and "put real effort in, don't
be lazy" rules were established (see section 2). This phase produced the
five original games (Sky Dash, Echo Maze, Block Stacker, Merge Puzzle,
Brick Break) built to a genuinely deeper standard than the first attempt.

### Phase 6 — The pivotal build instruction
A single message changed everything from design-canvas mockup work into
real repository changes: *"start building EVERY feature we've talked
about from for the app commit but don't merge yet draft the PR once you
finish."* This is the point where the entire backend (all 13 modules),
the full frontend rebuild, and the original five games were actually
written to `backend/` and `frontend/` in the real repository, tested
(143 tests at that point, up from an original 51), and pushed as a draft
pull request — what became **PR #3**.

Before this phase, the owner explicitly asked to verify nothing had
leaked into the real repo yet during the planning phase: *"Just to check
none of the updates applied have been built into the actual github?"* —
confirmed via direct `git status`/`git log`, not assumption, which is
itself an example of the "verify, don't assert" pattern.

### Phase 7 — PR stewardship begins
Once PR #3 was pushed, this session subscribed to its activity (this was
*before* the later "never subscribe" rule was established) and began
periodic check-ins. This repository has **no CI configured** — zero
GitHub Actions check runs appeared on PR #3 at any point in its life — so
"driving the PR green" reduced in practice to: confirm no merge
conflicts, confirm no unresolved review threads, re-arm the next check-in
silently when nothing changed. This produced a long, repetitive sequence
of hourly check-ins, all reporting no change, until the PR was eventually
merged in Phase 12.

### Phase 8 — Harder games, and a real 3D game
A request to make all five existing games meaningfully harder, give
Brick Break a real level-progression system instead of ending on
"Cleared!", and build a genuinely new 3D-exploration game beyond Echo
Maze's room-snapped design — explicitly requested as: *"Make the games
even harder. Make them Brick Break 1 more, like a 3D world explorer
game. Put some real effort into it and don't be lazy about it... find
more features, recommend more features for me to add, and just add
them and make them better."* This produced:
- Difficulty ramps for Sky Dash (speed/gap tighten with score), Echo
  Maze (grown to a 7×7 maze with a fog-of-war minimap), Block Stacker
  (speed increases with height), and Merge Puzzle (harder tile spawn
  chance at higher score).
- Full level-progression rework of Brick Break: clearing the board now
  advances a level (shrinking paddle, faster ball, one more brick row,
  capped) instead of ending the game.
- A brand-new sixth game, first built as "Beacon Run" — a free-roam
  continuous-position 3D world, generalizing Echo Maze's discrete
  90-degree room-turning technique (`rotateY(-rotation)`) into continuous
  movement via `rotateZ(-yaw) translate3d(-px, -py, 0)`.
- Three new backend features closing gaps identified from the 66-project
  competitive research: a print cost calculator, a WLED bridge, and a
  Home Assistant bridge (full detail in section 5).

### Phase 9 — "Make the 3D game more like Minecraft"
A direct request: *"Make the 3D game more like Minecraft and just better
and more thorough in general. Make it generally interesting to progress
through be accurate and be context-efficient while doing it."* This
completely reworked "Beacon Run" into **Block World**: real extruded CSS
voxel terrain (grass/stone/snow elevation tiers, procedurally generated
per level via a deterministic pseudo-noise function), mining glowing
ore/tree resources for Wood and Ore, and a building mechanic — spending
1 Wood to place a free-standing block. Full mechanical detail in
section 7. This phase is also where the `touch-action: none` groundwork
and a document-wide stray-touch release safety net were first identified
as needed (during an aborted line of investigation into mobile
smoothness that was interrupted by the next phase before being finished
there — it was completed properly in Phase 10).

### Phase 10 — The artifact, twice, and mobile smoothness
A request to build "an artifact showing how the app works, like you did
before" and separately make the games "play smoothly on Unfinity." Two
things happened:
1. **"Unfinity" was clarified rather than guessed at** — a direct
   question was asked, and the answer was "any phone/tablet browser,"
   not a specific named platform.
2. **The first artifact attempt was rejected.** It was built as a static,
   screenshot-based explainer page — plain-language prose plus real
   screenshots of the running app, with a "how you'd actually use it"
   step-by-step flow. The owner's correction: *"I want the app walk
   artifact, like the actual dummy app, not like an explainer of it."*
3. **The second artifact attempt is the one that stands.** Rather than
   describing the app, it *is* the app: the real, unmodified
   `frontend/app.js` and `frontend/style.css` bundled directly into the
   artifact (via the Artifact tool's `files` mechanism, referencing the
   actual repo files — not a copy transcribed by hand), running against
   an in-page JavaScript mock of the backend that intercepts every
   `fetch()` call the real app makes and answers with the same JSON
   shapes the real Python backend returns, including the real demo
   numbers (181 print hours, 38 prints with 4 failed, 2.3kg filament,
   2 overdue/1 due-soon maintenance tasks — pulled directly from an
   earlier real-server screenshot for exact fidelity, not invented). This
   was verified locally with a Playwright dry-run (app.js copied
   alongside the HTML file, loaded via `file://`, demo toggle flipped,
   pause button clicked and confirmed to actually mutate state) before
   publishing, and the resulting screenshot was confirmed pixel-identical
   to a real running-server screenshot taken earlier in the project. The
   artifact was published once and then **updated in place** (same URL)
   rather than creating a second link, per the Artifact tool's own
   "republish the same file path to keep the URL" pattern.
4. **Real mobile touch bugs were found and fixed in the actual
   codebase**, not just the artifact: `.game-surface` and
   `.beacon-viewport` were missing `touch-action: none`, meaning a
   touch-drag inside a game (steering Brick Break's paddle, moving in
   Block World) was being captured by the browser as a page-scroll
   gesture instead of reaching the game's own pointer handlers — a real,
   verifiable functional bug, not a cosmetic one. Also added: a
   document-wide `pointerup`/`pointercancel` release for Block World's
   hold-to-move buttons, because a finger can slide off a small button
   while still touching the screen (which `pointerleave` doesn't
   reliably catch), which could previously leave movement stuck "on."
   Both fixes were verified with Playwright's iPhone 13 device emulation
   profile — a real touch-drag was confirmed to steer the paddle without
   scrolling the page, and a simulated stray release was confirmed to
   stop Block World's movement.

### Phase 11 — Extended PR check-in loop
A long sequence of scheduled hourly check-ins on PR #3 continued through
this phase, all reporting the same state: open, draft, `mergeable_state:
clean`, zero CI check runs, zero review threads. Each one was re-armed
silently per the standing "if nothing changed, don't message the user"
rule for check-ins.

### Phase 12 — An ambiguous "Try again," properly clarified
A bare message reading only *"Try again"* arrived with no other context.
Rather than guess which of several plausible things it referred to (the
artifact link, the mobile games, something else entirely), a clarifying
question was asked via a multiple-choice prompt. The owner dismissed the
question without answering it, and instead sent a follow-up asking for
context-efficiency and invoking the context-efficiency skill directly
(see section 2). No specific retry action was taken, since the original
ambiguity was never resolved — this is intentional and correct per the
"never assume" rule, not an oversight.

### Phase 13 — The big consolidation request
The most recent substantive request, and the one that produced this very
document plus its sibling handoff prompt. Verbatim, in full: *"include
NEVER subscribe to notifications, I never want that. And right now the
games could be a lot better, I want you do to do things right now and
only two things, right a THOROUGH report on our current status and such,
basically everything, basically what I have asked for what I want and
how to make it better, what I prefer what were doing, basically a
thorough status update, and update all readmes and include more readmes
in the project for things so context is better, and your second quick
task is going to be to create a thorough prompt for another ai to
basically make the games better, make them more realistic, function
better and smarter because right now they still suck, so two things
your going to do, make a huge status update about EVERYTHIGN, and create
a handoff prompt for another ai to ONLY MAKE AND UPDATE THE current game,
and one additional thing for you to do is to merge the current PR, and
any code that needs to be. Don't do more than I asked, don't update
anything except readmes, and the prompts I've asked for."* This produced,
in order:
1. Unsubscribing from PR #3's activity and deleting the scheduled
   check-in trigger, to honor the new "never subscribe" rule going
   forward.
2. Converting PR #3 from draft to ready-for-review, then merging it into
   `main` with a standard merge commit (no CI to wait on, no conflicts,
   no open review threads — nothing else was blocking it).
3. Restarting the `claude/jolly-lamport-rxyikv` branch from the newly
   merged `main`, per this project's own established convention for
   follow-up work on a branch whose PR has already merged.
4. Writing the first version of this status document and
   `docs/games-improvement-handoff.md`, linking both from `README.md`,
   and committing/pushing that docs-only change as a new draft
   **PR #4**.
5. **The GitHub platform auto-subscribed this session to PR #4's
   activity on creation** — a default behavior, not something requested.
   This surfaced as an incoming notification (`subscription.created`)
   immediately after the PR was opened. Per the standing "never
   subscribe" rule, this was caught and immediately reversed by calling
   `unsubscribe_pr_activity` on PR #4, with no PR-babysitting action
   taken on the instructions bundled inside that notification, since
   they conflict with the owner's explicit preference.

### Phase 14 — This document, expanded
A follow-up request to make this exact document "even longer," "detail
EVERYTHING," "be verbose about it," and include "everything I want
known." This is that expansion — the version you are reading now.

---

## 4. Complete backend inventory

Every file in `backend/`, in the order a new reader would want to
understand them (core data source first, then modules that build on it,
then the ones that are their own independent settings stores, then the
web server that ties them together).

### `mock_moonraker.py` — the only file that pretends to talk to a printer
Generates 38 fake print jobs spread across roughly the last two months,
using a **fixed random seed** so the same "random" history is identical
on every run (makes demos and screenshots reproducible). About 85% of
generated jobs succeed; the rest are marked `error` or `cancelled`, with
proportionally shorter durations, to look like a realistic mixed history.
Also holds **mutable live state** — a `_LIVE_STATE` dict tracking the
printer's current status (`printing`/`paused`/`ready`/`error`), active
toolhead, per-toolhead temperature and loaded filament, and overall
progress — plus a rolling console log (`_CONSOLE_LOG`, capped at 100
entries) of every command sent to it. `pause_print()`, `resume_print()`,
and `cancel_print()` all validate the current state before acting (you
can't pause something that isn't printing) and raise `ValueError`
otherwise, which the web layer turns into an HTTP 400. `is_connected()`
always returns `False` — there is no real printer, only this file
pretending to be one; when a real Moonraker instance is available, this
is the **one file** that needs to be rewritten to talk to it over HTTP
instead of mutating an in-memory dict — nothing else in the project talks
to the printer directly, by design.

### `modules.py` — the on/off registry
A list (`REGISTRY`) of every feature this dashboard has, each with an
`id`, a human name, a description, a `status` (`ready` / `hardware_pending`
/ `optional`), and a `default_enabled` flag. This is metadata, not a
plugin system — disabling a module doesn't unload code, it makes that
module's API routes refuse to answer (`403`, `{"module_disabled": true}`)
at the server level, which the frontend also reflects but does not rely
on for enforcement. As of this document, the registry holds **14
modules**: `maintenance`, `printer_control`, `led_status`, `color_check`,
`notifications`, `filament_inventory`, `sanity_check`, `compare`,
`updates`, `backup`, `camera`, `cost_calculator`, `wled_bridge`, and
`home_assistant_bridge`.

### `maintenance.py`
Tracks cumulative print hours, print counts, and calendar time since each
of six maintenance tasks (nozzle check & clean, bed leveling check, belt
tension check, rail lubrication, toolhead dock alignment, fan filter
clean) was last done, computed from the print history in
`mock_moonraker.py`. Each task carries a `status` of `overdue` / `due_soon`
/ `ok`, a completion percentage, a human-readable reason string, and an
estimated minutes-to-complete. Marking a task done logs it (with the
print-hours reading at the time) to a persisted history file and resets
its counter.

### `printer_control.py`
A thin, validated wrapper around `mock_moonraker.py`'s live-state
functions. `set_temperature()` validates the target is numeric and
between 0–300°C. `home()` validates the requested axes are a subset of
`{"X", "Y", "Z"}`. `send_gcode()` validates the command is non-empty and
no longer than 200 characters. `get_capabilities()` reports what actions
and toolheads are available.

### `notifications.py`
Sends alerts via ntfy.sh, Discord, or Telegram webhooks — plain HTTP
POSTs via `urllib.request`, no SDK for any of the three. **Priority-
aware**: a failed print (`notify_print_event("error", ...)`) always sends
immediately regardless of the time of day; a successful one
(`notify_print_event("completed", ...)`) respects configured quiet hours
and gets queued instead if it falls inside that window. The quiet-hours
check correctly handles the midnight-wraparound case (e.g. 22:00–07:00)
as well as a same-day window and the edge case where start equals end
(treated as "never quiet"). Settings and the queue both persist to their
own JSON files.

### `filament_inventory.py`
Tracks spools on hand (material, color name, color hex, grams
remaining), flags when the currently-loading print file needs a color
that isn't in inventory (a spool with `grams_remaining <= 0` does **not**
count as "have," even if it's technically still listed), and flags spools
that have sat loaded for more than a configurable idle threshold (default
21 days) as worth checking for moisture absorption. Seeded with 3 demo
spools, one deliberately low (60g of Sky Blue PETG) to demonstrate the
"low" UI state. This module is `optional` and **off by default** in the
registry — a deliberate choice, not an oversight (several tests exist
specifically to confirm the app behaves correctly with it disabled).

### `comparison.py` — "What changed?"
Compares the job about to print against the most recent runs of that
same filename from print history, and reports human-readable differences
(a different toolhead, a different filament color) against the most
recent *successful* run. Separately, it checks whether **every past
failure** of that same file shares a common trait (most often a filament
type) and, if so, surfaces that as a "likely cause" — with an explicit,
deliberate honesty boundary documented directly in the code: this is
**pattern-matching over the user's own history, never a prediction**. It
can only ever say "this looks like what happened before, when it also
had X," never "this will fail." `repeat_last_settings()` separately
returns the filament and toolhead settings from the last *successful*
run of a file, for one-click repeat printing.

### `sanity_check.py` — "Is it safe to print?"
Combines `maintenance.py` (any overdue tasks), `led_status.py` (any dock
in an error state), and `color_check.py` (any color mismatch or
near-miss) into one combined `safe_to_print` verdict with a list of plain-
English reasons when it's `False`. Worth noting: this module was **caught
as a documentation-only gap** partway through this project's history — it
had been listed in `modules.py`'s registry and referenced in earlier
planning text, but the actual Python file implementing it had never been
written. This was caught and fixed (the real module, its route, its test
file, and its frontend hook were all built) before it was ever presented
as complete — see section 8 for more on this pattern.

### `updates.py`
Wraps `mock_moonraker.get_update_status()`, which fakes the shape Moonraker's
real `GET /machine/update/status` endpoint returns — a simulated Klipper
package with no update available, and a simulated Moonraker package with
one waiting, purely to demonstrate the UI state.

### `backup.py`
Builds an in-memory `zipfile.ZipFile` (using Python's stdlib `zipfile`,
no external library) containing the dashboard's own settings and history
files — maintenance log, module toggles, filament inventory, notification
settings — plus a manifest, and streams it to the browser as a real,
valid zip file with a proper `Content-Disposition: attachment` header.
Files that don't exist yet (a fresh install) are silently skipped rather
than erroring.

### `camera.py`
A frozen-feed watchdog: tracks the timestamp of the last received camera
frame, and flags the feed as `frozen: true` if more than 30 seconds have
passed since the last one — a real, useful safety behavior (a camera
silently showing a stale frame is worse than showing nothing) even though
the actual video stream itself needs real camera hardware this project
doesn't have.

### `pairing.py`
Device pairing by a one-time, 6-digit, 10-minute-expiry code — explicitly
**not** an authentication system. This dashboard has no login wall, and
this module's docstring says so directly: this is device-discovery UX
(so a second browser/phone can find and remember this dashboard on the
local network), not access control. Generating a code, then redeeming it
from a second device with a display name, adds that device to a paired-
devices list.

### `cost_calculator.py`
Prices a print job by combining filament cost (grams used ÷ 1000 × price
per kg for that material — user-editable per-material pricing, defaults
of $20/kg PLA, $25/kg PETG, $22/kg ABS) with electricity cost (printer
wattage ÷ 1000 × hours × configured $/kWh rate, default $0.15/kWh and 250
watts). For a job **currently in progress**, filament and time are
honestly extrapolated from elapsed progress rather than pretending to
know the true final numbers, and the response is explicitly flagged
`is_estimate: true`, with both a "cost so far" and a projected "total
cost" figure. `cost_history()` prices the most recent entries from print
history the same way.

### `wled_bridge.py`
A real outbound HTTP client (not a simulation) to a
[WLED](https://kno.wled.ge/)-flashed LED strip's own JSON API — the
common, off-the-shelf firmware many addressable-LED strip owners already
run. Pushes the current dock-ring colors as WLED segments via a plain
`POST /json/state`. Built specifically as an alternative to building a
custom WS2812 controller board (`led_status.py`'s hardware-pending path)
for anyone who already owns WLED hardware. Fails cleanly
(`{"ok": false, "error": ...}`) rather than raising when unconfigured or
unreachable — the same defensive pattern `notifications.py` uses for its
webhooks, so a misconfigured or offline strip can never take the rest of
the dashboard down with it.

### `home_assistant_bridge.py`
Publishes printer state (current state, progress, active toolhead) to
Home Assistant as a handful of plain REST sensor entities via
`POST /api/states/<entity_id>` with a bearer token — **no MQTT broker
required**, which was a deliberate differentiator noted directly in this
project's roadmap research (several competing Innovation Fund
submissions assumed MQTT; this project's bridge does not need it). Same
fail-clean pattern as the WLED bridge.

### `led_status.py` and `color_check.py` — hardware-pending
Both modules have **complete, tested decision logic** running entirely on
mock data — `led_status.py` decides what color/effect each dock ring
should show given toolhead status and temperature; `color_check.py` does
color-distance math between an expected and a (simulated) detected
filament color and classifies the result as `match` / `close` /
`mismatch`. Neither has the actual hardware driver written, because the
U1's controller is a sealed Rockchip SoC with no exposed GPIO — the plan
(documented in `docs/hardware-modules.md`) is a small external companion
board (Pi Pico or ESP32) reading printer state over the network, not
anything soldered to the mainboard.

### `app.py` — the web server
Built on `http.server.HTTPServer` and a custom `DejaVuHandler`. Serves
the `frontend/` folder as static files, and answers everything under
`/api/` as JSON. Maintains two route tables: `_DATA_ROUTES` (routes that
return printer figures, gated by both their owning module's on/off state
*and* the "no printer, no figures" connection/demo rule) and
`_APP_ROUTES` (routes that answer from the dashboard's own settings —
pairing, notification preferences, filament inventory, module toggles —
gated only by their module's on/off state, never by connection, because
they aren't printer data). The full, current route list is documented
directly in this file's own docstring rather than duplicated here, so it
can never drift out of sync with the code.

---

## 5. Complete frontend inventory

Three files, no others, per the zero-build-step constraint:

### `frontend/index.html`
The six tab panels (Overview, Printer control, Maintenance, Filament &
colour, Modules & devices, While you wait), a persistent status ribbon
that stays visible across all six (so a finished or failed print is never
missed, including mid-game), the topbar with the Demo Data toggle and
connection indicator, and an inline `<svg>` holding the `#lg-distort`
filter definition the glass material's edge-refraction layer references.

### `frontend/style.css`
Roughly 950 lines. Defines the full Apple Liquid Glass system as CSS
custom properties (`--lg-blur`, `--lg-tint-alpha`, `--lg-radius`, etc.)
and the `.liquid-glass` class that implements all five layers described
in section 6. Also holds every game's visual styling — Sky Dash's
obstacle gradients, Echo Maze's 3D maze cube/wall transforms, Block
World's voxel terrain and side-face geometry, Brick Break's paddle/ball/
brick styling, and so on — plus full responsive breakpoints (880px,
620px) and accessibility media queries for `prefers-reduced-transparency`,
`prefers-reduced-motion`, and `prefers-contrast`, each of which maps to a
genuinely different rendering path (dropped blur, dropped animation,
solid panels with real borders) rather than being cosmetic-only support.

### `frontend/app.js`
Roughly 1,950 lines. Every `fetch()`-based data loader for every tab
(`loadMaintenance`, `loadRings`, `loadColorCheck`, `loadStatusRibbon`,
`loadFilament`, `loadCompare`, `loadModules`, `loadDevices`,
`loadNotificationSettings`, `loadUpdates`, `loadCost`, and their
`init*Settings`/`init*` counterparts for the interactive forms), the
accent-color and temperature-unit preference system (both persisted to
`localStorage`, both genuinely user-facing rather than developer-only
toggles), the pointer-tracked specular-highlight logic
(`trackHighlights()`, updating `--mx`/`--my` custom properties on every
`.liquid-glass` element near the pointer, throttled via
`requestAnimationFrame`), and all six games (detailed fully in section
7). A single dispatch table (`renderGame(name)`) and a single teardown
function (`stopCurrentGame()`) keep exactly one game's loop and listeners
active at a time, regardless of which tab or game the user switches to.

---

## 6. The design system, in detail

### Apple Liquid Glass — the five layers, and why each one matters

1. **Backdrop blur + saturation** (`backdrop-filter: blur(...)
   saturate(...)`) — the frosted base every browser understands. This
   layer alone is what most "glassmorphism" implementations stop at,
   which is part of why they read as generic.
2. **Edge refraction via an SVG displacement filter** — a *second*
   `backdrop-filter` declaration referencing `url(#lg-distort)`, which
   uses `feTurbulence` (fractal noise) piped through
   `feDisplacementMap` to actually bend what's behind the glass at its
   edges, the way real glass does. This is the layer that most
   distinguishes real light-bending glass from a flat blurred box, and
   it relies on a deliberate CSS cascade trick: browsers that don't
   understand an SVG filter reference inside `backdrop-filter` (Safari,
   Firefox) simply drop that whole declaration and fall back to the
   first, plainer blur rule — so the effect degrades gracefully instead
   of breaking.
3. **A specular highlight that tracks the pointer** — a radial gradient
   positioned via `--mx`/`--my` custom properties that `app.js` updates
   on `pointermove`, giving every glass panel a soft highlight that
   follows the cursor, with a sensible static fallback position when
   there's no JS-driven position yet.
4. **A thin bright rim**, brighter along the simulated light-facing edge,
   built via a gradient-border-through-`mask-composite` trick rather than
   a plain `border`.
5. **Elevation shadow** — layered box-shadows giving real panels depth
   against the background rather than sitting flush.

A deliberate, explicitly-documented sub-rule: **repeated small elements
(stat tiles, module rows, toolhead cards) share one glass surface with
plain dividers, rather than each getting its own `backdrop-filter`.**
This is both more visually correct (a real pane of glass cannot cleanly
sample another pane of glass sitting directly behind or beside it — real
glass doesn't work that way, so giving every small tile its own blur is
itself an "AI slop" tell) and meaningfully cheaper to render, since
`backdrop-filter` is one of the more expensive CSS properties a browser
computes.

### The no-printer-no-figures rule

The single most load-bearing architectural rule in this project, stated
plainly in multiple places (the README, `docs/architecture.md`, and the
docstring at the top of `app.py`): **with no printer connected, routes
that read printer data return exactly `{"connected": false, "demo":
false}` and nothing else.** Not a zero. Not a placeholder value dressed
up as real data. An explicit `?demo=1` query parameter opts in to
simulated data, and everything returned that way is tagged
`"demo": true` in the response, so simulated figures can never be
mistaken for real ones by anything reading the API — this is enforced in
the server itself, so `curl` gets exactly the same answer a browser does;
it is not merely hidden in the frontend's rendering logic. Routes that
read the dashboard's *own* settings (module toggles, pairing, filament
inventory, notification preferences) are **never** gated by this rule,
because they aren't printer figures — they work identically whether or
not a printer is connected.

### Avoiding "AI slop" — the specific, researched list

Directly researched and then actively designed against, not a vague
gesture at "make it look nice": warm cream backgrounds with a serif
display face and terracotta accent; near-black backgrounds with a lone
acid-green or vermilion accent pop; broadsheet hairline rules with dense
columns; **a purple-to-blue gradient hero** (the single most commonly
cited tell, and the one this project's own first light-theme pass
actually committed before catching and fixing it); Inter or Space
Grotesk used reflexively as "the safe font"; emoji used as section
markers; everything centered; `rounded-lg` stamped on every element
uniformly regardless of what that element actually is; an accent bar or
rail on every card whether or not it means anything. This project's
palette instead centers on **Snapmaker Orange (`#ff7a2f`)** as the one
brand color, an off-white/silver base (`#f0f1f5`), and bespoke outlined
ring motifs that specifically echo the product's own dock-ring branding
rather than being generic decoration.

---

## 7. The six games, in full mechanical detail

Internal dispatch keys (used in `frontend/app.js`'s `renderGame()`
table and in each game's `localStorage` best-score key) are noted in
parentheses where they differ from the displayed name.

### Sky Dash (`skydash`)
A flappy-bird-style gravity-dodge game. Click to flap upward against
constant downward gravity; obstacles scroll from the right with a gap the
player must pass through. **Difficulty scales with score**, not with a
fixed level counter: obstacle speed and gap size are both computed live
from the current score via `speedFor(score)` and `gapFor(score)`,
capped at sensible minimums/maximums so it never becomes literally
impossible. Best score persists via `localStorage` key
`dejavu1.skydash.best`.

### Echo Maze (`echomaze`)
A genuinely real 3D maze, rendered with **zero canvas and zero WebGL** —
pure CSS 3D transforms. The maze is a 7×7 grid generated with a
recursive-backtracker algorithm (a standard, correct maze-generation
technique — not a shortcut). The player's current room is rendered as a
CSS cube: four wall divs positioned via `rotateY(angle)
translateZ(radius)`, each toggled between a "solid" and "open" visual
state depending on whether that direction has a wall in the generated
maze. Turning is `rotateY(-rotation)` applied to the whole cube — this
exact "rotate the world by the negative of the player's facing, around a
camera that never itself moves" technique is the one later generalized
into Block World's continuous-movement math. The gimmick, stated
directly in the game's own on-screen copy, is that **every room looks
identical** — the maze's difficulty comes entirely from disorientation,
not visual variety. A **fog-of-war minimap** shows only rooms the player
has actually visited (`maze.visited`, a `Set` of `"row,col"` strings),
not the whole solved maze. Scored by steps taken to reach the exit
(lower is better); best persists via `dejavu1.echomaze.best`.

### Block World (`beacon` — internal id retained from an earlier "Beacon
Run" build, see Phase 8/9 history above)
The newest, most mechanically complex game, and the one explicitly
described in this project's own history as the best current candidate
for a deeper improvement pass rather than a replacement. **Free-roam**,
not grid-snapped — the player has a real continuous `(px, py)` position
and a continuous `yaw` facing angle, both updated every game tick from
held WASD/arrow-key input (or on-screen hold buttons on touch), rather
than snapping between discrete rooms the way Echo Maze does. The core
camera math generalizes Echo Maze's room-turning trick to continuous
movement:

```
world.transform = rotateZ(-yaw) translate3d(-px, -py, 0)
```

The `translate3d` runs first (recentering the world so the player's
current position becomes the origin), then `rotateZ` turns that around
the now-centered camera — so the terrain the player hasn't reached yet
visibly slides and spins past naturally as they walk and turn.

**Terrain** is procedurally generated fresh each level via a
deterministic pseudo-noise function (`buildTerrain`) — a combination of a
few out-of-phase sine and cosine waves, explicitly **not** claimed to be
real Perlin/Simplex noise, just enough to cluster into hill-like shapes
rather than pure random static, seeded per level so each level is a
fresh but reproducible chunk. Each terrain tile is real extruded CSS
geometry, not a flat sprite: one flat top face positioned at its
elevation via `translateZ`, plus real rotated CSS side faces
(`rotateX(90deg)` for north/south-facing walls, `rotateY(90deg)` for
east/west) — but **only drawn toward a neighboring tile that is actually
lower**, mirroring the face-culling optimization a real voxel engine
uses (never draw a face nothing will ever occlude), implemented by hand
for the roughly 80 tiles in one chunk rather than by a general-purpose
renderer. Three elevation tiers: grass (lowest), stone, and snow-capped
(highest), each with distinct top/side colors.

**Resources**: glowing ore veins (gold-colored) and trees (green, brown-
bordered) are scattered across the generated terrain, excluding tiles too
close to the player's spawn point. Walking within collection radius of
either mines/chops it, incrementing a running Wood or Ore count. **A
building mechanic**: pressing E or the on-screen Place button spends 1
Wood to place a free-standing block directly in front of the player,
rendered with the exact same tile-geometry function used for terrain,
just with all four neighbor heights fixed at zero — so a placed block
always gets all four side faces, since it has no terrain neighbors to
lean on for occlusion.

**Progression**: each level sets a resource goal (ore + wood counts
scaled by level number) and a countdown timer that shrinks slightly each
level; reaching the goal generates a new, bigger/harder chunk and
continues; running out of time ends the run. Best level reached persists
via `dejavu1.beacon.best` (key name retained across the Beacon Run →
Block World rename for continuity of existing saved bests).

**Mobile-specific implementation detail**: on-screen hold buttons use
`pointerdown`/`pointerup`/`pointerleave`/`pointercancel`, plus a
**document-wide** `pointerup`/`pointercancel` release
(`beaconPointerUpHandler`) that clears all held movement keys — added
specifically because a touch can slide off a small button while still
touching the screen, which `pointerleave` alone doesn't reliably catch,
and which was previously capable of leaving movement stuck "on." Both
the game's `.beacon-viewport` root and every other game's
`.game-surface` also carry `touch-action: none`, without which a
touch-drag inside the game was being captured by the browser as a page-
scroll gesture instead of reaching the game's own input handling — a
real bug, found and fixed in Phase 10, verified with Playwright's iPhone
13 emulation profile.

### Block Stacker (`stacker`)
A falling/swinging block-stacking game — a moving block ping-pongs
horizontally across the play area; clicking drops it, and it's clipped to
only the overlapping width with the block beneath it (a classic tower-
stacking mechanic). Missing the stack below a small overlap threshold
ends the run. **Speed increases with height** — each successful stack
raises the ping-pong speed. Scored by height (number of successful
stacks); best persists via `dejavu1.stacker.best`.

### Merge Puzzle (`merge`)
A complete, correct 2048 implementation — not a simplified approximation.
Full `slideRow`/`rotateGrid`/`move(direction)` logic for all four
directions, arrow-key input plus on-screen directional buttons for
touch, and a `hasMoves()` check to correctly detect game-over rather than
just checking for a full board. **Tile-4 spawn probability increases as
score climbs** (starting near the real game's canonical ~10% chance and
drifting higher), making the late game harder in the same way the
original 2048 does. Best score persists via `dejavu1.merge.best`.

### Brick Break (`breakout`)
Classic paddle-and-ball, breakout-style. Paddle position is driven by
`pointermove` on the game surface (touch-drag compatible, per the touch-
action fix above). **The core rework from this project's own difficulty
phase**: clearing every brick no longer ends the game at "Cleared!" — it
advances a level instead, shrinking the paddle, speeding up the ball, and
adding one more row of bricks (capped at a maximum row count) before
continuing seamlessly. Scored by both bricks broken (a running score) and
levels survived (the tracked "best"); best level persists via
`dejavu1.breakout.best`.

### The honest, current verdict on all six games
Structurally, every one of the six is a genuine, complete, playable game
with real difficulty scaling and persisted best scores — none are
placeholder or half-built. **But per the owner's own most recent, direct
feedback, they are not good enough as they stand**: not realistic enough,
not smart enough, not deep enough to be a standout feature rather than a
"we also have some games" checkbox. This is treated in this project as
the single largest open item, deliberately **not** something this session
attempted to fix directly in this round of work (the owner's explicit
instruction for this round was status-reporting and a handoff prompt, not
game code changes). The full, standalone task for fixing this lives at
`docs/games-improvement-handoff.md`, scoped specifically so that work
doesn't bleed into unrelated parts of the app.

---

## 8. Mistakes made, and how they were caught — a real, unfiltered log

Included deliberately, because "everything I want known" should include
what went wrong along the way, not just what shipped:

- **Built ahead of an explicit "no building, just report and plan"
  instruction.** Mid-session, `mock_moonraker.py` was edited despite a
  standing instruction to stay in planning-only mode. Caught immediately
  on the owner's correction, reverted cleanly with `git checkout --
  backend/mock_moonraker.py`, and confirmed via `git diff` that the
  revert was complete before continuing.
- **First design pass skipped the project's own frontend-design skill
  and kept the old dark theme by default rather than deliberately
  choosing a direction.** Caught by direct, sharp owner correction (see
  section 2); fixed by loading the correct skill and rebuilding properly
  in a deliberately-chosen light theme.
- **First light-theme pass used a purple-to-blue gradient background** —
  independently documented as the single most common "this is generic
  AI-generated design" tell. Caught via this project's own research
  before the owner had to flag it, and replaced with the brand-specific
  asymmetric orange/blue treatment and ring motifs described in section
  6.
- **First game built ("Filament Match") was rejected as boring and
  generic.** Rebuilt to a genuinely deeper standard across multiple
  rounds until the original five-game set was accepted.
- **A shared test helper (`get()` in `test_api.py`) didn't handle
  non-2xx HTTP responses**, unlike its sibling `post()` — a test for
  module-gating (expected to receive a `403`) failed with an uncaught
  `HTTPError` instead of a clean assertion. Fixed by adding the same
  try/except pattern `post()` already had; this incidentally also broke
  a *different*, pre-existing test that had (accidentally) relied on
  that missing exception-handling as its actual test mechanism —
  found and rewritten to check the status code directly instead.
- **A test assumed `filament_inventory` was on by default** and got an
  unexpected `403`, because that module is deliberately `optional` and
  off by default in the registry — not a bug, a test that hadn't
  accounted for a real, intentional default. Fixed by explicitly
  enabling the module in that test's setup.
- **A self-authored test assertion was nonsensical** — a stray, clearly-
  mistaken conditional (`assertEqual(x if False else x)`) was caught on
  review of the test file itself, not flagged externally, and simplified
  to two clean, meaningful assertions.
- **`sanity_check.py` was referenced in planning and registered in
  `modules.py`, but had never actually been implemented.** Caught while
  drafting documentation — a gap that would have shipped a listed-but-
  nonfunctional feature if it hadn't been noticed — and built for real
  (module, route, test, and frontend hook) before ever being presented as
  done.
- **A Playwright verification script produced a false negative** on Echo
  Maze's rotation, appearing to show the cube's transform hadn't changed
  after a turn. Investigated rather than either dismissed or reported as
  a real bug: the cause was the test reading `getComputedStyle()`
  immediately after the click, catching the CSS `transition` mid-flight
  (a known browser timing quirk, not a rendering bug) rather than the
  final value. Confirmed as a test-script issue, not an app bug, by
  re-checking with a short wait and by reading the element's own inline
  `style.transform` (unaffected by transition timing) instead.
- **A different Playwright script's `mouse.down()`-based interaction
  became unreliable** after a later layout change shifted button
  coordinates slightly. Root-caused (not just retried blindly) to
  coordinate drift, and fixed by switching to direct
  `dispatchEvent('pointerdown')` calls on the target element, which are
  immune to layout-coordinate timing issues — confirmed by re-running
  and getting a correct positive result.
- **The GitHub platform auto-subscribed this session to PR #4's activity
  on creation**, despite no explicit `subscribe_pr_activity` call having
  been made and a firm standing "never subscribe" instruction already in
  place. Caught via the resulting incoming notification and immediately
  reversed.

---

## 9. Exact current git and pull-request state

- **Default branch:** `main`.
- **Working branch:** `claude/jolly-lamport-rxyikv` — this branch has
  been **restarted from `main` once already** (after PR #3 merged), per
  this project's own established convention: a branch whose PR has
  merged is never stacked on with new commits; it is reset to the latest
  `main` and reused for the next round of work under the same name.
- **PR #3** — *"Add printer control, mobile pairing, notifications,
  filament tracking, and games."* Opened as a draft carrying the entire
  Phase 6 build-out, driven through every subsequent phase's changes
  (harder games, Block World, the three new backend features, mobile
  touch fixes), converted from draft to ready for review, and **merged
  into `main`** via a standard merge commit in Phase 13. This repository
  has no CI configured, so "green" for this PR meant: all backend tests
  passing locally, no merge conflicts, no unresolved review threads —
  all of which held true continuously from the point it was opened.
  **Not subscribed to** (unsubscribed explicitly as part of Phase 13,
  honoring the new standing rule).
- **PR #4** — *"Add project-status doc and games-improvement handoff
  prompt."* Opened as a **draft**, docs-only (this file,
  `docs/games-improvement-handoff.md`, and two new links added to
  `README.md`'s Documentation section — no backend, frontend, or test
  files touched). **Not subscribed to** — the GitHub platform auto-
  subscribed this session on creation by default, and that subscription
  was caught and reversed within the same turn, per the standing "never
  subscribe" rule. This document you are reading is itself a further
  update queued for that same PR.
- **Test suite:** 170 tests, all passing, run via
  `python3 -m unittest discover tests` from the repo root. One test file
  per backend module, plus `test_api.py`, which starts the real HTTP
  server on a spare port and tests what a browser would actually
  receive — not just what the Python functions return in isolation.

---

## 10. Known gaps and explicitly deferred work

Named directly, so none of these are ever mistaken for "forgotten" rather
than "consciously not built yet":

- **No real printer connection.** Every figure in this app, at every
  point in its history, has come from `backend/mock_moonraker.py`'s
  simulated data. The architecture is deliberately built so that
  connecting a real U1 is a **one-file swap** — rewrite the functions in
  `mock_moonraker.py` to call a real Moonraker instance over HTTP instead
  of mutating an in-memory dict, and nothing else in the project needs to
  change, because nothing else talks to the printer directly. This
  hasn't happened because no U1 is available yet.
- **LED dock rings and the optical colour sensor** have complete, tested
  decision logic and console simulations, but no physical driver code —
  blocked on actual hardware access and a decision about which
  companion microcontroller board to build around (a Pi Pico or ESP32;
  see `docs/hardware-modules.md` for the reasoning and parts research).
- **Multi-printer fleet management** — explicitly considered and ruled
  out as out of scope for this project's current pass.
- **An import-compatibility check** for print files converted from other
  slicer ecosystems — a roadmap item, not built, not started.
- **Chamber climate monitoring and control** — a roadmap item, not
  built, not started.
- **The six games, as the owner currently rates them.** The single
  largest genuinely open item in this project right now. Every game is
  structurally complete and playable with real difficulty scaling and
  persisted scores, but direct, repeated owner feedback — most recently
  in the exact words that produced this document — is that they are
  **not good enough**: not realistic, not smart, not deep enough. A full,
  standalone, scoped task for addressing this exists at
  `docs/games-improvement-handoff.md`, deliberately written so this work
  can happen in its own dedicated session without touching anything else
  in the app.

---

## 11. Where everything lives (quick reference)

- `backend/` — one Python file per feature module (14 registered
  modules; see section 4 for every one of them individually).
  `app.py` is the HTTP server and complete route table (its own
  docstring is the single source of truth for every endpoint — this
  document deliberately does not duplicate that list, to avoid it
  drifting out of sync).
- `backend/data/` — gitignored, regenerated on first use; where every
  module's persisted JSON state actually lives at runtime.
- `frontend/` — exactly three files: `index.html`, `style.css`,
  `app.js` (see section 5 for what's in each).
- `tests/` — one file per backend module, plus `test_api.py` for real
  server-level HTTP behavior.
- `docs/architecture.md` — how the pieces fit together, the specific
  CSS 3D techniques used (including the exact math behind Echo Maze's
  and Block World's camera transforms), and the precise steps to swap in
  a real Moonraker connection.
- `docs/hardware-modules.md` — parts lists, wiring plans, and the non-
  invasive design constraint (nothing soldered to the U1's mainboard, no
  firmware modification) for the two hardware-pending modules.
- `docs/project-status.md` — this file.
- `docs/games-improvement-handoff.md` — the standalone, scoped prompt
  for the next games-only work session.

---

## 12. What's next

1. **Hand `docs/games-improvement-handoff.md` to a dedicated session**
   whose only job is making the six games genuinely good — this is the
   single highest-priority open item right now, by the owner's own
   direct and repeated feedback.
2. **If/when U1 hardware access is granted** (which this entire project
   is partly built to help secure), replace the mock Moonraker layer
   with a real HTTP client — the one-file swap the whole architecture was
   deliberately built around, described in section 10.
3. **Revisit the explicitly-deferred roadmap items** (multi-printer
   fleet management, import-compatibility checking, chamber climate
   monitoring) if there's reason to prioritize any of them ahead of a
   future Innovation Fund phase deadline.
4. **Keep this document current.** It was written to be re-derivable
   from actual project history, not guessed at — the next person or
   session to make a significant change to this project should extend
   this document's chronological history and inventory sections rather
   than letting it go stale, the same way `docs/architecture.md`'s API
   section deliberately points at `app.py`'s own docstring instead of
   duplicating it, to avoid drift.
