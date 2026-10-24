"""
insights.py
===========

What a printer's own history says, in plain sentences.

Read from get_print_history(): Moonraker's job history on a real U1 (so a
printer that has been printing for months arrives with everything it has
done), or the simulated history in the demo. Nothing is estimated.

Each finding is careful about evidence, so one bad evening can't turn into
a "pattern":
  - a comparison needs at least MIN_GROUP prints on each side and a clear
    gap (GAP_POINTS percentage points) before it is said;
  - every finding states what it is based on ("from 38 prints");
  - nothing is said at all below MIN_PRINTS prints.
"""

from collections import Counter, defaultdict
from datetime import datetime, timedelta

import mock_moonraker

MIN_PRINTS = 5
MIN_GROUP = 4
GAP_POINTS = 15
LONG_HOURS = 4.0


def _when(value):
    try:
        return datetime.fromisoformat(str(value)[:19])
    except ValueError:
        return None


def _rate(jobs):
    done = sum(1 for j in jobs if j.get("status") == "completed")
    return done / len(jobs) if jobs else 0.0


def _pct(x):
    return f"{round(x * 100)}%"


def summary(jobs):
    """Totals since the first recorded print."""
    if not jobs:
        return None
    starts = [d for d in (_when(j.get("start_time")) for j in jobs) if d]
    done = [j for j in jobs if j.get("status") == "completed"]
    return {
        "prints": len(jobs),
        "completed": len(done),
        "failed": sum(1 for j in jobs if j.get("status") == "error"),
        "cancelled": sum(1 for j in jobs if j.get("status") == "cancelled"),
        "hours": round(sum(float(j.get("print_duration_hours") or 0) for j in jobs), 1),
        "grams": round(sum(float(j.get("filament_used_grams") or 0) for j in jobs), 1),
        "since": min(starts).date().isoformat() if starts else None,
        "success_rate": round(_rate(jobs), 3),
    }


def findings(jobs, now=None):
    """The insights, most useful first: [{id, tone, title, detail, evidence}]."""
    out = []
    n = len(jobs)
    if n < MIN_PRINTS:
        return out
    now = now or datetime.now()
    jobs = sorted(jobs, key=lambda j: str(j.get("start_time") or ""))
    rate = _rate(jobs)

    # Recent trend: the last 30 days against the 30 before.
    recent = [j for j in jobs if (_when(j.get("start_time")) or now) >= now - timedelta(days=30)]
    before = [j for j in jobs if now - timedelta(days=60) <= (_when(j.get("start_time")) or now) < now - timedelta(days=30)]
    if len(recent) >= MIN_GROUP and len(before) >= MIN_GROUP and abs(_rate(recent) - _rate(before)) * 100 >= GAP_POINTS:
        better = _rate(recent) > _rate(before)
        out.append({"id": "trend", "tone": "good" if better else "watch",
                    "title": f"Success rate {'up' if better else 'down'} to {_pct(_rate(recent))} this month",
                    "detail": f"From {_pct(_rate(before))} in the 30 days before."
                              + ("" if better else " Worth a look at what changed: a new filament, a plate, a nozzle."),
                    "evidence": f"{len(recent)} recent and {len(before)} earlier prints"})

    # Long prints against short ones.
    long_jobs = [j for j in jobs if float(j.get("print_duration_hours") or 0) > LONG_HOURS]
    short = [j for j in jobs if 0 < float(j.get("print_duration_hours") or 0) <= LONG_HOURS]
    if len(long_jobs) >= MIN_GROUP and len(short) >= MIN_GROUP and (_rate(short) - _rate(long_jobs)) * 100 >= GAP_POINTS:
        out.append({"id": "long", "tone": "watch",
                    "title": f"Prints over {LONG_HOURS:g} hours finish less often",
                    "detail": f"{_pct(_rate(long_jobs))} of long prints finished, against {_pct(_rate(short))} of shorter ones. "
                              "Before a long job: a clean plate, a fresh spool check and a first-layer look pay off most.",
                    "evidence": f"{len(long_jobs)} long and {len(short)} shorter prints"})

    # A file that keeps failing.
    by_file = defaultdict(list)
    for j in jobs:
        by_file[j.get("filename") or "?"].append(j)
    worst = sorted(((f, js) for f, js in by_file.items()
                    if len(js) >= 2 and sum(1 for j in js if j.get("status") == "error") >= 2
                    and _rate(js) <= 0.5), key=lambda x: (_rate(x[1]), -len(x[1])))
    if worst:
        f, js = worst[0]
        fails = sum(1 for j in js if j.get("status") == "error")
        out.append({"id": "file", "tone": "watch", "title": f"{f} failed {fails} of {len(js)} times",
                    "detail": "Open it in Files: the pre-flight check and the layer view often show why "
                              "(a thin first layer, a move off the bed, a tool it expects that isn't loaded).",
                    "evidence": f"{len(js)} attempts"})

    # A material that does worse than the rest.
    by_material = defaultdict(list)
    for j in jobs:
        by_material[str(j.get("filament_type") or "Unknown")].append(j)
    for material, js in sorted(by_material.items(), key=lambda kv: _rate(kv[1])):
        rest = [j for j in jobs if str(j.get("filament_type") or "Unknown") != material]
        if (material != "Unknown" and len(js) >= MIN_GROUP and len(rest) >= MIN_GROUP
                and (_rate(rest) - _rate(js)) * 100 >= GAP_POINTS):
            out.append({"id": "material", "tone": "watch", "title": f"{material} prints finish less often",
                        "detail": f"{_pct(_rate(js))} of {material} prints finished, against {_pct(_rate(rest))} of the others. "
                                  f"Check its temperatures and drying; {material} that has taken on moisture often fails mid-print.",
                        "evidence": f"{len(js)} {material} prints"})
            break

    # Cancelled early, often.
    cancelled = sum(1 for j in jobs if j.get("status") == "cancelled")
    if n >= 8 and cancelled / n >= 0.25:
        out.append({"id": "cancel", "tone": "info", "title": f"About 1 in {round(n / cancelled)} prints is stopped early",
                    "detail": "If that's to fix something you spotted, Confirm Print and the pre-flight check can catch "
                              "many file problems before the plate heats.",
                    "evidence": f"{cancelled} of {n} prints"})

    # A good run.
    streak = 0
    for j in reversed(jobs):
        if j.get("status") != "completed":
            break
        streak += 1
    if streak >= 5:
        out.append({"id": "streak", "tone": "good", "title": f"{streak} prints in a row finished",
                    "detail": "Whatever you're doing, it's working.", "evidence": f"the last {streak} prints"})

    # Filament use and how long a spool lasts.
    weeks = [j for j in jobs if (_when(j.get("start_time")) or now) >= now - timedelta(days=28)]
    first = _when(jobs[0].get("start_time"))
    if weeks and first and (now - first).days >= 28:
        grams = sum(float(j.get("filament_used_grams") or 0) for j in weeks)
        if grams > 0:
            per_week = grams / 4
            out.append({"id": "usage", "tone": "info", "title": f"About {round(per_week)} g of filament a week",
                        "detail": f"At this rate a 1 kg spool lasts about {max(1, round(1000 / per_week * 7))} days.",
                        "evidence": f"{len(weeks)} prints in the last 4 weeks"})

    # Which heads do the work.
    heads = Counter(t for j in jobs for t in (j.get("toolheads_used") or []))
    if sum(heads.values()) >= MIN_PRINTS:
        top, count = heads.most_common(1)[0]
        idle = [t for t in ("T0", "T1", "T2", "T3") if heads.get(t, 0) == 0]
        share = count / n
        if share >= 0.6 or idle:
            out.append({"id": "heads", "tone": "info",
                        "title": f"{top} is in {_pct(share)} of your prints",
                        "detail": (f"{', '.join(idle)} {'has' if len(idle) == 1 else 'have'} not printed in this history. "
                                   if idle else "") + "Swapping which head carries your everyday filament spreads wear across them.",
                        "evidence": f"{n} prints"})

    # The busiest day.
    days = Counter()
    for j in jobs:
        d = _when(j.get("start_time"))
        if d:
            days[d.strftime("%A")] += float(j.get("print_duration_hours") or 0)
    if days and n >= 10:
        day, hours = days.most_common(1)[0]
        out.append({"id": "day", "tone": "info", "title": f"{day} is your busiest printing day",
                    "detail": f"{round(hours)} hours of printing started on {day}s. A good day to keep a spare spool ready.",
                    "evidence": f"{n} prints"})

    order = {"watch": 0, "good": 1, "info": 2}
    out.sort(key=lambda f: order.get(f["tone"], 3))
    # The overall rate leads when nothing more specific is worth saying first.
    out.insert(0 if not out or out[0]["tone"] != "watch" else 1,
               {"id": "rate", "tone": "good" if rate >= 0.85 else "info" if rate >= 0.7 else "watch",
                "title": f"{_pct(rate)} of prints finish", "detail": f"{sum(1 for j in jobs if j.get('status') == 'completed')} "
                f"of {n} prints in this printer's history completed.", "evidence": f"{n} prints"})
    return out


def current():
    """The selected printer's summary and findings."""
    jobs = list(mock_moonraker.get_print_history() or [])
    loaded = mock_moonraker.history_loaded() if hasattr(mock_moonraker, "history_loaded") else True
    return {"summary": summary(jobs), "findings": findings(jobs), "history_loaded": bool(loaded),
            "minimum": MIN_PRINTS,
            "note": "From this printer's own print history. A finding appears only with enough prints behind it."}
