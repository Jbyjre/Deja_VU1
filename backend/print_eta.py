"""
print_eta.py: how long the running print has left, from everything known about it.

The old estimate divided the time spent by the share of the file read so far. That share counts bytes, not
minutes: a colour change, a purge or a first layer spends a lot of time and reads almost no file, so early in a
print the guess could run to double or triple the real figure (and the clock time that follows from it with it).
This module keeps one answer for every screen and every rule, built from what is actually known:

  * the file's own estimate (Moonraker reads it from the slicer's comments: `job["total_hours"]`);
  * how this print is running against that estimate (time spent, print_stats.print_duration, which Klipper counts
    from the first extrusion and without pauses);
  * a truer share of the print done than bytes, when there is one: the progress the slicer put in the file itself
    (M73, which Klipper reports as display_status.progress), or else where the byte the printer has read up to falls
    on the file's byte-to-time track (print_preview.py builds it from the same G-code the twin draws).

Early on the file's estimate leads; as the print goes the print's own pace counts for more, and at the end the pace
is all there is. Nothing is made up: with no estimate in the file and too little print to judge, the answer is None
and every screen shows nothing rather than a number.

The result names its basis in words so a screen can say where the figure comes from.
"""

import bisect
import threading

# How much of the print must be done before its own pace weighs as much as the file's estimate does.
PRIOR = 0.15
# Under two minutes of printing the pace says nothing; under half a percent of the print likewise.
MIN_ELAPSED_H = 120.0 / 3600.0
MIN_SHARE = 0.005
# Without an estimate in the file, a pace needs at least this much of the print behind it.
MIN_SHARE_NO_FILE = 0.02
# The pace compared with the file's estimate is kept inside these limits so one odd stretch cannot swing the answer.
PACE_LOW, PACE_HIGH = 0.25, 4.0
# A byte-to-time track belongs to the file only while its length matches the file the printer reports (to 1 %).
SIZE_TOLERANCE = 0.01
# The slicer's progress counts as a truer share only where it differs from the bytes (Klipper reports the bytes
# when no M73 has come yet, which adds nothing).
M73_DIFFERENCE = 0.002

_lock = threading.Lock()
_tracks = {}          # printer id -> {"name", "size", "bytes": [...], "ms": [...], "total_ms"}


def remember(printer_id, name, preview):
    """Keep the byte-to-time track of the file a printer is running, from print_preview's result."""
    tl = (preview or {}).get("timeline") if isinstance(preview, dict) else None
    if not isinstance(tl, dict) or not tl.get("track") or not name:
        return
    flat, size = tl["track"], tl.get("bytes") or 0
    n = len(flat) // 5
    if n < 2 or size <= 0:
        return
    b = t = 0
    bytes_, ms = [], []
    for i in range(n):
        b += flat[i * 5]
        t += flat[i * 5 + 1]
        bytes_.append(b)
        ms.append(t)
    total = max(ms[-1], int(round((tl.get("seconds") or 0) * 1000)))
    if total <= 0:
        return
    with _lock:
        _tracks[printer_id] = {"name": name, "size": size, "bytes": bytes_, "ms": ms, "total_ms": total}


def forget(printer_id):
    with _lock:
        _tracks.pop(printer_id, None)


def file_time_share(printer_id, name, position, size):
    """The share of the file's own print time that comes before this byte, or None where there is no track for it."""
    with _lock:
        tr = _tracks.get(printer_id)
    if not tr or tr["name"] != name or not isinstance(position, (int, float)) or not isinstance(size, (int, float)) or size <= 0:
        return None
    if abs(tr["size"] - size) > SIZE_TOLERANCE * size:
        return None
    i = bisect.bisect_right(tr["bytes"], position)
    if i <= 0:
        return 0.0
    if i >= len(tr["bytes"]):
        return 1.0
    b0, b1, t0, t1 = tr["bytes"][i - 1], tr["bytes"][i], tr["ms"][i - 1], tr["ms"][i]
    ms = t0 + (t1 - t0) * ((position - b0) / (b1 - b0) if b1 > b0 else 0.0)
    return max(0.0, min(1.0, ms / tr["total_ms"]))


def estimate(progress, elapsed_hours, slicer_hours=None, shaped=None, shaped_by=None):
    """
    What is left of a print, as a dict, or None when nothing honest can be said yet.

    progress: share of the file read (virtual_sdcard.progress), 0 to 1.
    elapsed_hours: print_stats.print_duration in hours.
    slicer_hours: the file's own total, if it carries one.
    shaped: a share of the print's time done that is truer than bytes, with shaped_by naming where it came from
            ("slicer" for the file's own M73 progress, "file" for the byte-to-time track).
    """
    if not isinstance(progress, (int, float)) or not 0 <= progress < 1:
        return None
    e = max(0.0, float(elapsed_hours or 0.0))
    q, by = float(progress), "bytes"
    if isinstance(shaped, (int, float)) and 0 < shaped < 1:
        q, by = float(shaped), shaped_by or "file"
    s = float(slicer_hours) if isinstance(slicer_hours, (int, float)) and slicer_hours > 0 else None

    if s is not None:
        if e < MIN_ELAPSED_H or q < MIN_SHARE:
            remaining, pace, basis = s * (1 - q), None, "file"
        else:
            pace = max(PACE_LOW, min(PACE_HIGH, e / (q * s)))
            weight = q / (q + PRIOR)
            remaining = s * (1 - q) * ((1 - weight) + weight * pace)
            basis = "file_and_pace"
    else:
        if e < MIN_ELAPSED_H or q < MIN_SHARE_NO_FILE:
            return None
        remaining, pace, basis = e * (1 - q) / q, None, "pace"
    return {
        "remaining_hours": round(max(0.0, remaining), 3),
        "total_hours": round(e + max(0.0, remaining), 3),
        "basis": basis,                              # file | file_and_pace | pace
        "weighted_by": by,                           # bytes | slicer | file
        "slicer_hours": round(s, 3) if s is not None else None,
        "pace": round(pace, 2) if pace is not None else None,     # this print against the file's estimate; 1.0 is on time
        "settled": q >= 0.1 and basis != "file",     # False while it is mostly the file's figure
    }


def words(eta):
    """One short line saying where the estimate comes from, for a screen to show beside it."""
    if not eta:
        return ""
    s, pace = eta.get("slicer_hours"), eta.get("pace")
    basis = eta.get("basis")
    if basis == "file":
        return "From the file's own estimate; the print has only just started"
    if basis == "pace":
        return "From how this print is running so far; the file carries no estimate"
    if pace is not None and abs(pace - 1) >= 0.1:
        pct = int(round(pace * 100))
        return f"From the file's estimate and how this print is running ({pct}% of the file's pace)"
    return "From the file's estimate and how this print is running"


def remaining_hours(state):
    """Hours left for a printer state: the estimate when it has one, else None. Older callers' formula lives here too."""
    if not isinstance(state, dict) or state.get("state") != "printing":
        return None
    eta = state.get("eta")
    if isinstance(eta, dict) and eta.get("remaining_hours") is not None:
        return eta["remaining_hours"]
    return None


def attach(state, printer_id, slicer_hours):
    """
    Put "eta" (and the extra remaining_hours the fleet rows read) on a printer state that is printing or paused.
    Idle and finished states get none. Returns the same dict.
    """
    if not isinstance(state, dict) or state.get("state") not in ("printing", "paused"):
        if isinstance(state, dict):
            state.pop("eta", None)
        return state
    sync = state.get("sync") if isinstance(state.get("sync"), dict) else {}
    shaped, by = None, None
    dp, p = state.get("display_progress"), state.get("progress")
    if isinstance(dp, (int, float)) and isinstance(p, (int, float)) and abs(dp - p) > M73_DIFFERENCE:
        shaped, by = dp, "slicer"
    if shaped is None:
        share = file_time_share(printer_id, state.get("current_file"), sync.get("file_position"), sync.get("file_size"))
        if share is not None:
            shaped, by = share, "file"
    eta = estimate(state.get("progress"), state.get("print_duration_hours"), slicer_hours, shaped, by)
    if eta is None:
        state.pop("eta", None)
    else:
        eta["words"] = words(eta)
        state["eta"] = eta
    return state
