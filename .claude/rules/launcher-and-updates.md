---
paths:
  - "start.py"
  - "start-windows.bat"
  - "start-mac.command"
  - "start-linux.sh"
  - "backend/app_updates.py"
  - "backend/updates.py"
  - "backend/paste_blocks.py"
  - "backend/autostart.py"
  - "backend/console.py"
  - "backend/launch_link.py"
  - "backend/readiness.py"
  - "backend/desktop.py"
  - "backend/update_hold.py"
  - "frontend/offline.html"
  - "frontend/sw.js"
  - "frontend/versions.js"
  - "frontend/versions.json"
  - "tools/update_blocks.py"
  - "tools/package-update.py"
  - "tools/next-release.py"
  - "tools/release-notes.py"
  - ".github/**"
  - "VERSION"
  - "CHANGELOG.md"
  - "docs/releasing.md"
---

# Installing, starting, updating and releasing

Installing and updating must work every time, including while a print runs.

## Releases

- Every merge to `main` is a release. `.github/workflows/release.yml` runs `tools/next-release.py`
  (next patch number, merged PR titles as the changes), commits `Release <version>` and publishes.
  Don't hand-edit around that commit. A marketing-video merge is not a release: put
  `[marketing video]` in its merge message (checked first).
- Raise `VERSION` by hand only for a named release with its own tour. Then `VERSION`, the top entry
  of `frontend/versions.json` and a `## <version> (<date>): <name>` heading in `CHANGELOG.md` must
  agree (`tests/test_versions.py`). A version's `highlights` become its in-app tour; point each at
  a real element.
- `next-release.py` inserts the new heading above the first `## ` heading, so dated bold paragraphs
  at the top of the CHANGELOG stay above it. Put notes under the release they belong to.
- PR titles become release notes: write what a U1 owner can now do.

## Paste blocks

- `backend/paste_blocks.py` is the one source of the Start-and-check and update blocks
  (`tools/update_blocks.py` re-exports it). Copies: README, `docs/getting-started.md`,
  `frontend/index.html` (`data-start-block`, `data-os-block`), `frontend/offline.html`
  (`data-block`) and `frontend/welcome.html`. Keep every copy identical
  (`tests/test_install_blocks.py`). They use `releases/latest/download/deja-vu1-update.zip`.
- `offline.html` is cached by `sw.js`: bump `OFFLINE_CACHE` when it changes.
- Never change the first lines of `start-windows.bat`: a running batch file is re-read from its old
  position after an update.

## The launcher (`start.py`)

- No flag, `--background` and `--from-link` start apart from the window (`start_in_background`);
  `--foreground` is the supervisor; `--ensure` is the quiet start-up check; `--check` checks a running
  copy. Output goes to `<data>/logs/background.log`.
- The supervisor restarts a crashed server (not exit 0, 75, 3 or a signal) at most `CRASH_LIMIT`
  times in `CRASH_WINDOW`, and one that is running but silent for about 2 minutes. It writes
  `<data>/supervisor.json` every 5 s; a second launcher that finds a fresh note waits.
- The health check matches `DEJAVU_LAUNCH_ID` or the PID, never through a proxy, for up to
  `START_WAIT` (90 s), asking `/api/app/alive` first and falling back to `/api/app/info` on 404.
- `autostart.py`: Windows Task Scheduler task "Deja Vu1" (sign-in, wake, every 5 minutes; no admin)
  running `pythonw start.py --ensure`, else the Startup folder; macOS LaunchAgent; Linux XDG
  autostart. Settings → Stop and Ctrl+C write `stopped-on-purpose.json`, which `--ensure` respects
  until a start by hand, a reboot or `STOP_HOURS` (4). Only Linux is exercised in tests.
- `console.py` gives a window-less process a log file and writes through a thread so a paused
  console never blocks a reply. On Windows the server holds its port with SO_EXCLUSIVEADDRUSE.
- `launch_link.py` registers `deja-vu1://`; the command never receives the opened address. Tests
  that start the launcher set `DEJAVU_NO_REGISTER=1`.

## Updates (`app_updates.py`)

- Channels: `stable` (releases, default, checked hourly) and `latest` (main branch, per-file git blob
  hashes; only changed files staged). Git copies update by `fetch` + `merge --ff-only`, refused on
  hand-edited files or local commits, rolled back with `git reset --keep`.
- `_install_update(background=True)` checks only that a launcher exists and no install is running,
  then runs on a thread; `job()` (in `/api/app/info` as `update_job`) carries the step and bytes.
- `apply_update()` in start.py never dies: it catches everything, writes
  `<data>/update-result.json` and `<data>/logs/launcher.log`, and starts the server anyway.
  `apply_pending` removes `pending.json` first so nothing is applied or rolled back twice.
- A print, a pause or a silent printer never decides whether an update installs. `update_hold.py`
  holds printer writes during the restart; a running slice gets `SLICE_GRACE` (90 s).
- `_lock` is held for an instant only (`_check_lock` serialises checks). `_clear_stale_stage`
  removes a staging folder with no journal.
- 0.8.0's Install button crashed in `_require_idle_for_update` (now guarded); 0.8.0 copies need the
  one-paste update once.
- `offline.html` reconnects quietly for 12 s (90 s during an update) before showing Start and the
  paste blocks. `watchForUpdate()` in app.js reloads open pages on a new version or build.
- `desktop.py`: the launcher opens a browser tab, an Edge/Chrome `--app` window or nothing, once per
  start, not after an update restart.
- `POST /api/app/report` (this computer only) is Settings' Copy a report for help: logs, checks and
  printer links with keys blanked. `POST /api/app/ready` (Check it all works, `start.py --check`)
  answers ok / note / bad per check. The server logs only POSTs and refused requests.
- `app.js` `watchServer()` shows the "stopped answering" strip.
