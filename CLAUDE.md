# Deja Vu1: notes for AI coding sessions

A local dashboard and model-preparation workspace for Snapmaker U1 printers. It talks to Moonraker,
edits plates, runs a separately installed slicing engine and checks G-code before a print. The
core is standard-library Python and plain HTML/CSS/JS with no build step and no packages. It has
been tested on a real U1 with stock firmware (`docs/testing.md`). README.md is the human overview;
this file is the working core. Checked against the code on 8 November 2026: if code and notes
disagree, trust the code and fix the note.

## Start here

1. **Area notes load by themselves.** `.claude/rules/` holds one note per area; Claude Code loads a
   note when you open a file it covers. If you are about to edit an area and its note isn't in your
   context, read it first.

   | Area | Note |
   |---|---|
   | Server, modules, storage, checks before a print | `.claude/rules/backend.md` |
   | Real printers, Moonraker, camera, watch-only | `.claude/rules/printer-link.md` |
   | Slicing engine, profiles, plates, G-code | `.claude/rules/slicing.md` |
   | Install, start-up, updates, releases | `.claude/rules/launcher-and-updates.md` |
   | Screens, looks, sidebar, online demo | `.claude/rules/frontend.md` |
   | The 3D twin | `.claude/rules/twin.md` |
   | Tests | `.claude/rules/tests.md` |
   | README, docs, CHANGELOG, pictures | `.claude/rules/public-text.md` |

2. **The private repository `Jbyjre/Deja-VU1-Studio` is attached to every build session.** Its
   `context/README.md` says what to read for each task; `STATUS.md` is where the project stands;
   `FEATURES.md` indexes the work; `context/dependency-map.md` (generated) shows what depends on
   what. Owner preferences, plans and marketing live there, never here.
3. **Never read these whole:** `CHANGELOG.md`, `docs/architecture.md`, `frontend/games.js`,
   `frontend/workshop.js`, `frontend/app.js`, `backend/app.py`, `backend/moonraker_client.py`.
   Search, then read a part with offset and limit.

## Skills

Load `anthropic-skills:context-efficient` first in every session. For any screen, style or picture
of the app, then load `anthropic-skills:frontend-design` and `anthropic-skills:liquid-glass` (Glass
is the default look). For public text, `anthropic-skills:stop-slop`. Others as the job needs
(`context/skills.md` in the private repository).

## Working rules

- The owner is not a programmer. Explain changes in plain words and define each technical term the
  first time you use it. Lead with what works and the next step.
- Verify before you state anything (APIs, paths, counts, claims about the U1 or other products) and
  say plainly what you could not verify. The product has the same rule: it never invents figures.
- Do every part of what is asked, exactly, including counts and formats. Whatever the owner
  emphasises matters most. Before finishing, answer `context/finish-questions.md` (private).
- Read before editing: grep first, then read with offset and limit. Cap command output.
- Never spawn subagents, agent teams or workflows, and never start `/loop`, scheduled or background
  jobs, unless asked in this session. Never change model, effort, fast mode or permission mode
  unless asked. Never subscribe to PR or CI activity, poll checks or turn on auto-merge unless asked.
- Confirm before delete, overwrite, force-push or `reset --hard`.
- Every change also shows in the online demo: frontend changes reach it by themselves (check
  `/?demo` on a static server); a new or changed route needs `tools/online-demo/record.py` and
  `frontend/demo/`.
- Study other projects' behaviour, then write your own code. Never copy or closely adapt external
  code (u1-moonraker, u1-klipper, the Extended Firmware, OrcaSlicer and Snapmaker Orca are GPL or
  AGPL; Deja Vu1 is MIT). Never name a studied project as a feature's source in app text, comments,
  the README or commits.
- **Merging:** every session that edits this repository merges its own finished work without being
  told to. Commit on the session's branch, push, open the pull request, check the work (tests,
  screenshots or measurements the task calls for), then merge it with one merge commit. The one
  exception: don't merge when the owner says not to. A merge conflict or a failing required check
  is yours to fix first; if you can't, say what blocks it. Don't wait on pending CI, never
  force-push, and report what merged and how to undo it (`git revert -m 1 <merge commit>`).

## Public text

Pull request titles (they become release notes), merge messages, commits, the CHANGELOG and docs
say what a U1 owner can now do. No personal information: no names, school, location, emails, chat
history or "the owner said". No em dashes, no "not X, it's Y", no stock praise. Never remove or
soften the AI-assistance disclosure. Details: `.claude/rules/public-text.md`.

## Rules the code depends on

- **No invented figures.** Without a connected printer and without `?demo=1`, a data route returns
  exactly `{"connected": false, "demo": false}`.
- **Demo data never reaches a real printer.** Demo and sandbox hooks start with `_sim()`.
- **Module switches are enforced by the server:** a disabled module's routes answer 403; background
  automation, queue advancement, camera capture, time-lapse and filament deduction are gated too.
  An in-flight request cannot be recalled. `ar_preview` is browser-only; pairing is always on.
- **Honest controls:** a command the printer refuses is shown as refused, in words.
- **Security:** there is no login. Protection is a Host-header allowlist (421), an Origin check on
  POSTs and the WebSocket (403) and anti-framing headers. Never add an exception keyed on a request
  header; a web page can set it (DNS rebinding). A tunnel's domain goes in `DEJAVU_ALLOWED_HOSTS`.
- **Escape** everything that reaches `innerHTML` with `esc()`, including file metadata. Colours
  from files are validated server-side because they end up in style attributes.
- **Accessibility:** `theme.css` loads late, so its reduced-transparency and increased-contrast
  blocks repeat overrides with selectors at least as specific as the rules they override.
- **Updates never wait for a print.** The printer runs its file by itself; Deja Vu1 holds printer
  writes during a restart (`update_hold.py`).
- **Keep README "What has been tested" and `docs/testing.md` honest:** real U1, stand-in printer and
  "not built yet" are different things.

## Commands

```bash
python3 start.py                            # the launcher: starts the server, opens the browser
python3 backend/app.py                      # the server alone, http://localhost:8000 (binds 0.0.0.0)
PORT=8791 python3 backend/app.py            # another port
python3 -m unittest discover tests          # the full suite, about 15 minutes; count in docs/testing.md
python3 -m unittest tests.test_api          # one module
python3 -m unittest tests.test_api.TestRoutingAndErrors.test_every_file_the_pages_load_is_served
ruff check --select E701,E702 backend tests tools   # must stay clean
python3 tools/online-demo/record.py         # re-record the online demo (about 3 minutes)
python3 backend/maintenance.py              # console demos (also led_status.py, color_check.py)
```

Settings for a start: `PORT` (default 8000), `DEJAVU_ALLOWED_HOSTS` (extra host names, such as a
tunnel domain), `DEJAVU_MOONRAKER_LOG=1` (print every Moonraker exchange), `DEJAVU_SLICER_PATH`,
`DEJAVU_DATA_DIR` (default `backend/data/`), `DEJAVU_NO_BROWSER=1`, `DEJAVU_WINDOW=browser|window|none`,
`DEJAVU_WATCH_ONLY=1` (Settings can't turn it off for that start).

Browser checks in the cloud sandbox: Playwright for Node is installed; launch Chromium with
`executablePath: process.env.DEJAVU_BROWSER || '/usr/bin/chromium'` (or `/opt/pw-browsers/chromium`)
and `args: ['--no-sandbox']`. Turn on demo data by clicking `label[for=demo-toggle]`. Take
screenshots at 1366 px and 390 px and look at them. To mimic the public static host, serve
`frontend/` with any static server; the root should hand over to `welcome.html`.

## Code style

- Python: match the file you are in. One statement per line, about 120 columns at most, comments
  only for the why. GitHub Actions still runs Python 3.8: no parenthesised `with (a, b):`.
- JavaScript: Prettier style with single quotes, two spaces, 120 columns, no trailing commas, arrows
  without parentheses for one argument.
- A formatting-only change proves it: compare syntax trees before and after (Python `ast.dump`,
  JavaScript acorn) and say so in the commit message, then run the whole suite.

## Map in one screen

- `backend/`: `app.py` (the whole web server and its route tables), `mock_moonraker.py` (one
  interface for simulated and real printers), `moonraker_client.py` (real printers), `live_feed.py`
  (250 ms tick), `fleet.py`, `print_gate.py` (Confirm Print), `gcode_tools.py`, `slicer_bridge.py`,
  `app_updates.py`, `storage.py`, `modules.py`, and one module per feature.
- `frontend/`: published as the product page and online demo. `index.html` + `app.js` (shared
  globals) + one script per feature, `rail.js` (sidebar) last; `welcome.html` (product page);
  `demo/` (the recording); `media/` (the launch film).
- `tests/`: unittest; `fake_moonraker.py` is a Moonraker stand-in.
- `tools/`: release tools, the online-demo recorder, `readme-images/` (README pictures),
  `engine-fixtures.py`.
- `docs/`: user guides and the evidence (`testing.md`, `slicer-workspace-validation.md`,
  `engine-support.md`). `docs/architecture.md` is the long version of this map.
- Root: `start.py` and the double-click launchers `start-windows.bat`, `start-mac.command`,
  `start-linux.sh`; `wrangler.jsonc` publishes `frontend/` to Cloudflare.

## Known open issues

- Windows and macOS launcher, autostart and recovery paths are read from documentation and tested
  on Linux only; the Windows engine-check fallback has run against a stand-in engine only.
- The colour checker, LED dock rings and spool scales are not built; `color_check.py` and
  `led_status.py` hold the decision logic and a simulation.
- Heavy models render slowly under software graphics; real-phone performance is unmeasured.

When compacting, keep: the files changed, the test commands and their results, open decisions and
the owner's emphasised requests.
