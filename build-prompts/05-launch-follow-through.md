# Finish launch readiness from measured evidence

Historical starting brief: native tools, per-printer time-lapse, profile selection,
plate editing and image geometry have since been implemented. Use
[the current remaining-work brief](07-physical-validation-and-format-fidelity.md)
and current status before treating anything below as unfinished.

The owner has no coding experience. Explain decisions in everyday language,
verify claims from primary sources and never present simulator success as a
physical-printer test. Read CLAUDE.md and the current guides. No subagents.
Keep the existing standard-library Python/plain-JS architecture and Layer lines
identity unless the owner approves a larger dependency decision.

## Current foundation

The launch-polish branch adds setup, private browser names, local update staging
and rollback, selected-printer stock camera snapshots, OBJ geometry and viewer
transforms, and local slicer discovery. Main module side effects are gated and
refused print starts preserve history. The public demo is still a recording.
These additions do not mean the whole product is launch-proven.

## Stage 1: prove and close the everyday printer loop

Use a real U1 with owner consent for physical actions. Start watch-only; capture
firmware versions and redacted diagnostics. Prove connection/authentication,
reconnect, discovery/manual entry, live values, per-head nozzles and filament
colours, stock camera start/refresh/stop, upload and readback. Then prove a tiny
known-safe print through Confirm Print, pause/resume/cancel, queue handoff and
failure propagation. Verify real ntfy/Discord/Telegram deliveries only with the
owner's explicit instruction. Test two printers with different states and ensure
commands, snapshots, inventory and time-lapses never use the wrong printer.

Unify the new stock snapshot source with camera watchdog and time-lapse, which
still use a globally configured manual camera. Model a camera capability per
printer, fail plainly for unsupported firmware, test disconnect/reconnect,
expired authentication, stale pictures, concurrent tabs and idle shutdown.
Do not fall back silently from a failed real camera to an illustration.

Fix full backup/restore before describing the configuration download as a backup:
versioned manifest of the whole data directory, secrets handling, dry-run restore,
path validation, deliberate conflict resolution, atomic replacement and tested
recovery. Keep the original installation intact until restore is verified.
Review simulated cancel/history/toolhead state and fleet change-listener gaps.
Do not implement experimental filament hardware drivers until capabilities and
real device protocols can be proved; extra logical slots are not physical U1 heads.

## Stage 2: make slicing a usable product

Prove the existing bridge with an actual supported Orca release on each supported
OS. Keep the engine separately installed unless the owner approves packaging
and licence implications. Build a fixture corpus of STL, geometry 3MF, painted
3MF, embedded/inherited presets and multiple plates. Include failures and
malformed/oversized input. Report exactly what the engine accepts.

Replace raw JSON path entry with a beginner profile picker and validated U1
preset resolution. Expose layer height, walls, infill, supports and speeds only
when they map to real engine settings. Connect four tool assignments and nozzle
sizes to file metadata, the layer planner, generated output, queue and Confirm
Print. Refuse unsupported mixed-height options instead of treating the planner
as a slicer. Keep source geometry, texture/paint and per-object assignments as
separate information; a flattened STL is explicitly destructive to those details.

Build a real multi-model plate workspace: model selection, numeric movement,
orientation/scale, units, duplicate/delete, undo/redo, safe save-as and multi-plate
navigation. Distinguish a bounding-box warning from actual geometric overlap,
bed fit, sequential-print clearance and support detection. Make current preview
and AR use the same edited model. Improve per-tool/layer filtering and report
engine-derived time/filament only. Do not invent missing estimates.

Image/colour geometry needs further original research: robust meshing, colour
calibration, texture coordinates, material/tool remapping and colour-preserving
project round trips. A terrain tool, plugin installer, native Android app and
custom filament hardware drivers are separate decisions; studying them does not
mean they are already part of this dashboard. Private study records stay outside
the repo. Never copy or closely adapt restricted source.

A WebAssembly engine is optional research, not a promised shortcut. Assess source
licences and dependencies, memory bounds, worker cancellation, browser limits,
real output parity and maintenance cost before proposing it to the owner.

## Stage 3: release confidence and accessible daily use

Exercise ZIP-download and launcher update on Windows/macOS/Linux with spaces,
non-ASCII paths, custom data locations, permission failures, interruption at
replacement steps, child hangs and bad version/health responses. Test a real
GitHub release asset with its published digest. Plan obsolete-file removal and
future data migrations explicitly. Preserve failed-recovery copies. Publish no
stable package until these checks have evidence.

Walk every section on 390 px and 1366 px screens, plus real phones. Cover keyboard,
screen reader, contrast, reduced transparency/motion, orientation change and
long text. Guided tour highlights must point to visible controls. Name storage
must remain browser-only and absent from requests, logs, update checks and shared
backups. Handle an in-flight discover/connect response after setup was skipped.
Verify public demo controls never pretend to modify a server. Verify Tailscale
Serve and Access-protected Cloudflare with denied-user tests; pairing is not auth.

Update marketing claims, current screenshots, explainer boards, social card,
recorded demo and launch videos only from verified behavior. Test counts are not
a proxy for printer safety. Finish with a before/after audit, exact check evidence,
remaining limitations and a concise owner device-test list. Use small feature
commits and the repository's normal PR workflow.
