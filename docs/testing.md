# What has been tested

Updated 10 November 2026. Three kinds of evidence, kept apart so you can see which is which:

- **Real U1:** run on a real Snapmaker U1.
- **Automated and stand-in:** the test suite (it runs before every release is published), a
  Moonraker stand-in built from Moonraker's source, and browser checks in Chromium.
- **Not built yet / not tried yet:** said plainly below.

## On a real Snapmaker U1

Snapmaker sponsored a U1 for Deja Vu1 through the Innovation Fund (delivered 31 October 2026). It
runs Snapmaker's stock firmware, and Deja Vu1 runs on a Windows computer on the same network.
Tested on it:

- Adding the printer and connecting to it.
- Live readings: state, temperatures, progress, the four heads, and the 3D twin following the print.
- Starting prints through Confirm Print, pausing and cancelling.
- The camera and time-lapses.
- The Printer page controls: moving the head, heating, fans, lights, macros and the console.

The rest of the dashboard was used with the same printer. The firmware version will be added here.

## Automated and stand-in

- **The test suite:** 1359 tests passed in 809.5 seconds on Python 3.13.18 (Linux, 11 November 2026,
  version 0.20.7 plus the AI assistant). GitHub Actions runs the suite on Python 3.8, 3.10, 3.12 and 3.13, and the
  release job runs it again before publishing.
- **The printer connection** in the suite, against a Moonraker stand-in (`tests/fake_moonraker.py`)
  over real sockets: commands, refusals, watch-only mode (no write gets through), sign-in, the
  camera list, pictures and live stream, reconnects, a printer that moved to another address, and
  updates while a print runs.
- **Install, start-up and updates** in the suite on Linux: staging, restart, rollback after a failed
  start, git-copy updates against real git repositories, and the paste blocks kept identical
  everywhere they appear. A real download, restart and health check with the real launcher took
  7 seconds on Linux (6 November 2026).
- **Screens** in Chromium at 1366 px and 390 px wide, checked by the session that changed them: each
  look in light and dark, text contrast measured against WCAG AA, and the online demo at both
  widths.
- **The AI assistant:** a full conversation through a Claude plan (Claude Code 2.1.322) on a demo
  printer on Linux, 11 November 2026: reading the printer, a fan change, an Approve step for heat and
  a refused 500 °C request. The 30 key services' addresses answered a request without a key the same
  day. In the suite, stand-in services and stand-in `claude` and `codex` programs cover both wire
  formats, error messages, key handling and every safety limit. No paid key, real ChatGPT plan or
  real U1 has been tried with it. Panel checked at 1366 px and 390 px, light and dark, and in the
  static online demo, with no page errors. [AI assistant](ai-assistant.md).
- **Colour-checker ingestion:** synthetic version 1 messages through the actual local HTTP API and
  a Moonraker stand-in, including identity mismatch, replay, clock changes, expiry, low quality,
  raw-only samples, reassignment and restart. The colour card was checked at both widths in all
  three looks, light and dark, with details and keyboard focus retained on refresh. There were no
  page errors or sideways scrolling; the static demo also passed its browser check.
  [Browser evidence](evidence/colour-sensor-browser.json) and [API contract](colour-sensor-api.md).

## Slicing engines

Deja Vu1 runs an engine you install; it doesn't bundle one. Builds run for real:

| Engine | Version | System |
|---|---|---|
| Snapmaker_Orca | 02.08.01.55 | Linux |
| OrcaSlicer | 2.4.2 | Linux |

Any other build shows "Not tested" when you press **Check slicer** and still slices. Snapmaker_Orca
sliced different heights per head (0.4/0.6 mm nozzles at 0.14/0.28 mm, 0.4/0.8 mm at 0.2/0.4 mm,
two 0.4 mm at 0.1/0.2 mm). OrcaSlicer 2.4.2 sliced multi-object plates, four-tool image tiles,
layered swatches and heightmap reliefs. All three plates of the converted MakerWorld fixture
sliced, each on its own. Details:
[engine support](engine-support.md) and [slicer workspace validation](slicer-workspace-validation.md).

## Not built yet

- **The colour checker** ("Right colour loaded?"). The comparison logic and a simulation exist; the
  companion API receives identified observations, but firmware, sensor drivers and guided calibration
  are not written. No physical colour sensor or colour accuracy was tested in the API work.
  The sensor and board get a bench test first. [Design](hardware-modules.md)
- **LED dock rings.** The on-screen states exist; the ring driver doesn't. A WLED strip you already
  own can show the same states today.
- **Spool scales.** Planned after the colour checker.

## Not tried yet

These need hardware or software the tester doesn't have:

- **macOS:** the launcher, start-at-sign-in and the `deja-vu1://` link.
- **Windows engine check:** the 7 November fallback for Windows builds of Snapmaker Orca has run
  only against a stand-in engine; no Windows row is in the engine table yet.
- **A second U1, or another Klipper printer:** one printer only so far; other Klipper printers were
  tried with a stand-in (a one-head 235 × 235 × 250 mm printer).
- **The community Extended Firmware** and its low-latency camera, and go2rtc.
- **Outside services and devices:** a real Spoolman install, a WLED strip, Home Assistant, a
  Tailscale subnet route, a Cloudflare tunnel.
- **Heavy models on a real phone or GPU:** frame times were measured only in software rendering,
  where full-frame drawing of very large models is slow.

## Earlier records

- [Slicer workspace validation](slicer-workspace-validation.md): engine output, plate selection,
  recovery and browser checks for the slicing rounds.
- [Native studio](native-studio-validation.md): the round-two evidence, kept for history.
- [The CHANGELOG](../CHANGELOG.md): what each version changed and how it was checked.
