# Project messaging

**One screen for every U1 you run.**

See which printer needs attention, prepare a plate, inspect its layers and review
the checks before starting. Deja Vu1 runs on your computer and opens in a browser.
Free, open source, no app account. Slicing needs a separate compatible engine.

Ready-to-use descriptions and posts: [COPY.md](COPY.md).
Current share images and their captions: [09-current-campaign](09-current-campaign/).

## What to lead with

1. **See what needs you.** A fleet view and ranked attention list make the next
   printer to check easy to find. Show three printers, rather than implying the
   27-printer sandbox is the real-printer capacity.
2. **Prepare, slice, inspect.** Objects, physical T0–T3 assignments, profiles and
   output inspection in one workspace. Explain the separate engine at first mention.
3. **Review before starting.** Pre-flight and Confirm Print explain refusals.
   Known mismatches block; missing filament information asks for a visual check.
4. **Inspect the implementation.** Public code, setup and validation records.
   Keep optional integrations, colour generation and games as supporting details.
5. **Help test the first connection.** A specific watch-only request for U1 owners.

## Claims to keep consistent

| Topic | Supported wording | Avoid |
|---|---|---|
| Printer status | Reported state, shared through a 250 ms server loop; freshness varies | Guaranteed four updates per second from every printer |
| Test evidence | Current suite: 852 cases; see validation for the latest run | Treating software tests as real-printer certification |
| Print checks | Blocking errors refuse; warnings need acknowledgement | Safe-print guarantees or automatic success |
| Filament | Compare available reported material and colour; unknown stays unknown | Claiming an optical sensor measures the loaded spool today |
| Slicing | A separately installed compatible engine produces G-code | A bundled slicer or guaranteed support for every engine |
| Per-head heights | Recorded Linux engine output for three tested pairs | A verified physical mixed-nozzle print |
| Conversion | Supported projects and selected plates, with a conversion report | Universal one-click fidelity for all vendor projects |
| Twin | Software model, driven by reported state; geometry partly estimated | Camera footage or an exact mechanical model |
| Phone | Chromium layout checked at 390 px | Real-phone performance testing |
| Recovery | Versioned app-data backup and separate recovery; Linux launcher checked | Backing up external engines or verified Windows/macOS recovery |
| Local operation | Local core; optional services contact configured endpoints | Nothing ever connects to the internet |
| Accounts | No Deja Vu1 account | No accounts or credentials for third-party services |

No physical U1 connection, mixed-nozzle print or measured colour accuracy is
verified. Dock-ring and optical-sensor drivers remain unfinished. Heavy-model
rendering is slow in software graphics. Full vendor paint and texture fidelity
remains incomplete. Keep these limits close to the relevant claim.

## Visual and editorial rules

Use actual app captures for product evidence. Keep one main subject per card,
short headlines, readable type and an obvious next step. Put the demo or engine
evidence label inside the image so it survives sharing. Never use a synthetic
photo as proof of a physical setup. Retain selectable HTML text and useful image
alternatives. Review at desktop and phone widths and inspect every final image.

Write what a person can do and what they will see. Prefer concrete examples to
superlatives. Vary sentence length naturally. Do not add fake mistakes, invented
personal experience, testimonials or detector scores. Keep the public disclosure
of AI-assisted development. No marketing or award-score uplift is measured here.

## Source and notices

Current implementation evidence: [workspace validation](../docs/slicer-workspace-validation.md),
[current status](../README.md#current-status), [first connection](../docs/first-connection.md).
Private study records stay outside the repository. Keep required notices for
actual reused assets. The existing films require the piano credit in COPY.md.
Deja Vu1 is independent and is not affiliated with or endorsed by Snapmaker.
