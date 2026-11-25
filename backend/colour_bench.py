"""
colour_bench.py
===============

Bench readings of spools whose colour is known, and the honest numbers they give.

The point is to find out, with real spools, what the colour checker can and cannot do before anyone relies on it: how steady
its readings are, how far they sit from the colour on the spool's label, and which near shades it mixes up. Nothing here is
a result until real readings have been taken. The code only records them and does the sums.

What a sample is
----------------
One reading of one spool: which spool (brand, material, colour name and the colour on its label or listing), whether it is
in the blind set, which insertion of the strand it was (take it out and put it back for the next), the raw counts, the
quality flags, the settings, the white and dark references in force, and the colour Deja Vu1 worked out. The raw counts and
references are kept so the sums can be redone later with a better method.

What it will not do
-------------------
* A label colour is the maker's or the seller's colour, not a measurement. Distances to it show how far the checker is from
  what the spool says, not its accuracy.
* It never quotes a rate from fewer than MIN_SPOOLS spools. It always shows the counts and a 95 % range.
* Blind spools are kept apart so nobody tunes the method on them; their numbers are reported separately.
* Samples marked synthetic (the tool's own test data) put a banner on every report.
"""

import math
import os
import re
import secrets
import threading
import time

import color_check
import companion_sensor
import mock_moonraker
import sensor_calibration
import storage

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, "colour_bench.json")
_lock = threading.RLock()
MAX_SAMPLES = 5000
MAX_AGE_S = 5
MIN_SPOOLS = 10      # fewest spools a rate may be quoted from
MIN_REPEATS = 3      # fewest readable samples a spool needs to count
MODES = ("strand", "surface")
_HEX = re.compile(r"#[0-9a-fA-F]{6}\Z")
_TEXT = re.compile(r"[ -~]{1,40}\Z")


# -- recording ------------------------------------------------------------------------------------------------------

def _text(value, field, required=True):
    value = "" if value is None else str(value).strip()
    if not value and not required:
        return ""
    if not _TEXT.fullmatch(value):
        raise ValueError(f"{field} must be 1 to 40 plain characters")
    return value


def spool_key(spool):
    """One spool's identity: its brand, material, colour name and label colour, case and spacing aside."""
    parts = [str(spool.get(k, "")).strip().lower() for k in ("brand", "material", "name")] + [str(spool.get("hex", "")).lower()]
    return "|".join(re.sub(r"\s+", " ", part) for part in parts)


def _spool(body):
    spool = body.get("spool")
    if not isinstance(spool, dict):
        raise ValueError("Say which spool this is: brand, material, colour name and its colour")
    hex_value = str(spool.get("hex", "")).strip()
    if not _HEX.fullmatch(hex_value):
        raise ValueError("The spool's colour is six hex digits, such as #f26a1b: the colour on its label or listing")
    return {"brand": _text(spool.get("brand"), "brand"), "material": _text(spool.get("material"), "material"),
            "name": _text(spool.get("name"), "colour name"), "hex": hex_value.lower()}


def _load():
    return storage.load_json(_PATH, {"samples": []})


def record(body):
    """Keep the latest reading of a head's sensor as one labelled sample. The counts come from the app, never from the page."""
    if not isinstance(body, dict):
        raise ValueError("Send the spool and the head as a JSON object")
    pid = mock_moonraker.selected_printer_id()
    if not mock_moonraker.is_real(pid):
        raise ValueError("Bench readings need an added printer with a colour sensor; demo printers have none")
    head = body.get("toolhead")
    if head not in ("T0", "T1", "T2", "T3"):
        raise ValueError("Choose a head from T0 to T3")
    spool = _spool(body)
    mode = body.get("mode", "strand")
    if mode not in MODES:
        raise ValueError("mode is strand (in the holder) or surface (pressed against the spool)")
    insertion = body.get("insertion", 1)
    if isinstance(insertion, bool) or not isinstance(insertion, int) or not 1 <= insertion <= 99:
        raise ValueError("insertion is a whole number from 1 to 99")
    sensor = companion_sensor.read(head)
    if sensor is None:
        raise ValueError(f"No colour sensor is assigned to head {head}")
    reading = sensor.get("reading")
    if not reading or sensor["age_s"] is None or sensor["age_s"] > MAX_AGE_S:
        raise ValueError(f"Wait for a new reading (under {MAX_AGE_S} seconds old), then try again")
    identity = {key: sensor[key] for key in sensor_calibration.IDENTITY}
    with _lock:
        data = _load()
        samples = data["samples"]
        last = max((s["captured_at"] for s in samples if s["toolhead"] == head and s["printer_id"] == pid), default=0)
        if reading["captured_at"] <= last:
            raise ValueError("That reading is already recorded. Wait for the next one")
        entry = {
            "id": "b-" + secrets.token_hex(4), "recorded_at": time.time(), "printer_id": pid, "toolhead": head,
            "spool": spool, "blind": bool(body.get("blind")), "insertion": insertion, "mode": mode,
            "notes": _text(body.get("notes"), "notes", required=False), "captured_at": reading["captured_at"],
            "device_id": sensor["device_id"], "sensor_id": sensor["sensor_id"], "sensor_model": sensor["sensor_model"],
            "raw": reading["raw"], "quality_flags": reading["quality_flags"], "settings": reading.get("settings"),
            "reference": sensor_calibration.references(pid, head, identity),
            "measured_hex": sensor["detected_hex"], "status": sensor["status"],
        }
        samples.append(entry)
        del samples[:-MAX_SAMPLES]
        storage.save_json(_PATH, data)
    return {"recorded": entry["id"], **listing()}


def listing(full=False):
    """The recorded samples (without their raw counts unless `full`) and a line per spool."""
    with _lock:
        samples = _load()["samples"]
    spools = {}
    for sample in samples:
        key = spool_key(sample["spool"])
        row = spools.setdefault(key, {"key": key, **sample["spool"], "blind": sample["blind"], "samples": 0, "readable": 0,
                                      "insertions": set()})
        row["samples"] += 1
        row["readable"] += 1 if sample.get("measured_hex") and not sample["quality_flags"] else 0
        row["insertions"].add(sample["insertion"])
    rows = []
    for row in spools.values():
        row["insertions"] = len(row["insertions"])
        rows.append(row)
    shown = samples if full else [{k: v for k, v in s.items() if k not in ("raw", "reference")} for s in samples[-200:]]
    return {"count": len(samples), "spools": rows, "samples": shown, "min_spools": MIN_SPOOLS, "min_repeats": MIN_REPEATS}


def delete(body):
    """Remove one sample (`id`) or every sample of one spool (`spool`, its key)."""
    if not isinstance(body, dict) or not (body.get("id") or body.get("spool")):
        raise ValueError("Say which sample (id) or which spool (spool) to remove")
    with _lock:
        data = _load()
        before = len(data["samples"])
        data["samples"] = [s for s in data["samples"]
                           if s["id"] != body.get("id") and spool_key(s["spool"]) != body.get("spool")]
        if len(data["samples"]) == before:
            raise ValueError("Nothing matched that")
        storage.save_json(_PATH, data)
    return listing()


# -- the sums ---------------------------------------------------------------------------------------------------------

def _rgb(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def _hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*(max(0, min(255, int(round(c)))) for c in rgb))


def _distance(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _lab(rgb):
    """sRGB to CIE L*a*b* (D65), for a reading of how different two colours look. Delta E 76: the simple one."""
    def linear(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (linear(c) for c in rgb)
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


def delta_e(a, b):
    return _distance(_lab(a), _lab(b))


def wilson(hits, total, z=1.96):
    """A 95 % range for a share that is hits of total (Wilson). (0, 1) for no samples at all."""
    if total <= 0:
        return 0.0, 1.0
    p = hits / total
    centre = (p + z * z / (2 * total)) / (1 + z * z / total)
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / (1 + z * z / total)
    return max(0.0, centre - half), min(1.0, centre + half)


def _percentile(values, share):
    ordered = sorted(values)
    if not ordered:
        return None
    index = (len(ordered) - 1) * share
    low, high = int(math.floor(index)), int(math.ceil(index))
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def _share(hits, total):
    low, high = wilson(hits, total)
    return {"hits": hits, "of": total, "low": round(low, 3), "high": round(high, 3),
            "rate": round(hits / total, 3) if total >= MIN_SPOOLS else None}


def analyse(samples, min_spools=MIN_SPOOLS, min_repeats=MIN_REPEATS):
    """Everything the bench readings show, with what is missing for it to show more. Pure: it reads only `samples`."""
    spools = {}
    for sample in samples:
        spools.setdefault(spool_key(sample["spool"]), []).append(sample)
    flags = {}
    rows = []
    for key, group in spools.items():
        for sample in group:
            for flag in sample["quality_flags"]:
                flags[flag] = flags.get(flag, 0) + 1
        readable = [s for s in group if s.get("measured_hex") and not s["quality_flags"]]
        known = group[0]["spool"]
        row = {"key": key, **known, "blind": any(s["blind"] for s in group), "samples": len(group), "readable": len(readable),
               "insertions": len({s["insertion"] for s in readable}), "measured": None, "repeat_p95": None,
               "reinsert_spread": None, "distance": None, "delta_e": None, "verdict": None, "enough": len(readable) >= min_repeats}
        if readable:
            colours = [_rgb(s["measured_hex"]) for s in readable]
            mean = tuple(sum(c[i] for c in colours) / len(colours) for i in range(3))
            row["measured"] = _hex(mean)
            spread = [_distance(c, mean) for c in colours]
            row["repeat_p95"] = round(_percentile(spread, 0.95), 1)
            by_insertion = {}
            for sample, colour in zip(readable, colours):
                by_insertion.setdefault(sample["insertion"], []).append(colour)
            means = [tuple(sum(c[i] for c in cs) / len(cs) for i in range(3)) for cs in by_insertion.values()]
            if len(means) > 1:
                row["reinsert_spread"] = round(max(_distance(a, b) for a in means for b in means), 1)
            row["distance"] = round(_distance(mean, _rgb(known["hex"])), 1)
            row["delta_e"] = round(delta_e(mean, _rgb(known["hex"])), 1)
            d = row["distance"]
            row["verdict"] = ("match" if d <= color_check.MATCH_TOLERANCE else "close" if d <= color_check.WARN_TOLERANCE
                              else "mismatch")
        rows.append(row)
    usable = [r for r in rows if r["enough"]]
    result = {"synthetic": any(s.get("synthetic") for s in samples), "samples": len(samples), "spools": rows,
              "flags": flags, "min_spools": min_spools, "min_repeats": min_repeats, "usable_spools": len(usable),
              "enough": len(usable) >= min_spools, "missing": [], "tolerances": {"match": color_check.MATCH_TOLERANCE,
                                                                                    "close": color_check.WARN_TOLERANCE}}
    if len(usable) < min_spools:
        result["missing"].append(f"{min_spools - len(usable)} more spools with at least {min_repeats} readable readings "
                                 f"each (there are {len(usable)})")
    # Which known colour is each reading nearest to? Rows are the real spool, columns what the readings said.
    labels = sorted({r["hex"] for r in usable})
    matrix, readings, per_spool = {}, {"tune": [0, 0], "blind": [0, 0]}, {}
    for key, group in spools.items():
        row = next(r for r in rows if r["key"] == key)
        if not row["enough"]:
            continue
        for sample in group:
            if not sample.get("measured_hex") or sample["quality_flags"]:
                continue
            guess = min(labels, key=lambda h: _distance(_rgb(h), _rgb(sample["measured_hex"])))
            cell = matrix.setdefault(row["hex"], {})
            cell[guess] = cell.get(guess, 0) + 1
            part = "blind" if row["blind"] else "tune"
            readings[part][1] += 1
            readings[part][0] += 1 if guess == row["hex"] else 0
            per_spool.setdefault(key, [0, 0])
            per_spool[key][1] += 1
            per_spool[key][0] += 1 if guess == row["hex"] else 0
    result["confusion"] = {"labels": labels, "matrix": matrix}
    # Readings of one spool are not independent, so a spool counts once: it is right when most of its readings were.
    by_spool = {"tune": [0, 0], "blind": [0, 0]}
    for key, (right, seen) in per_spool.items():
        part = "blind" if next(r for r in rows if r["key"] == key)["blind"] else "tune"
        by_spool[part][1] += 1
        by_spool[part][0] += 1 if right * 2 >= seen else 0
    result["nearest_label"] = {part: {**_share(*vals), "readings": readings[part]} for part, vals in by_spool.items()}
    verdicts = {"tune": [0, 0], "blind": [0, 0]}
    for row in usable:
        part = "blind" if row["blind"] else "tune"
        verdicts[part][1] += 1
        verdicts[part][0] += 1 if row["verdict"] == "match" else 0
    result["match_label"] = {part: _share(*vals) for part, vals in verdicts.items()}
    # Near shades: pairs of label colours closer than the spread of the readings, which the checker cannot be expected to part.
    spreads = [r["repeat_p95"] for r in usable if r["repeat_p95"] is not None]
    result["repeat_p95"] = {"median": round(_percentile(spreads, 0.5), 1) if spreads else None,
                            "worst": round(max(spreads), 1) if spreads else None}
    pairs = []
    for i, a in enumerate(usable):
        for b in usable[i + 1:]:
            gap = _distance(_rgb(a["hex"]), _rgb(b["hex"]))
            if gap <= color_check.WARN_TOLERANCE:
                apart = _distance(_rgb(a["measured"]), _rgb(b["measured"]))
                limit = (a["repeat_p95"] or 0) + (b["repeat_p95"] or 0)
                pairs.append({"a": a["name"], "b": b["name"], "labels_apart": round(gap, 1), "measured_apart": round(apart, 1),
                              "told_apart": apart > limit})
    result["near_pairs"] = pairs
    return result


def render(result):
    """The report as Markdown, in words a spool owner can read."""
    out = ["# Colour checker bench report", ""]
    if result["synthetic"]:
        out += ["> **SYNTHETIC DATA.** These readings came from the tool's own test generator, not from a sensor. "
                "Nothing below is a result.", ""]
    out += [f"{result['samples']} readings of {len(result['spools'])} spools; {result['usable_spools']} spools have at least "
            f"{result['min_repeats']} readable readings.", ""]
    if not result["enough"]:
        out += ["## Not enough data to quote a rate", ""] + [f"- Needs {m}." for m in result["missing"]] + [""]
    if result["flags"]:
        out += ["Readings the sensor refused to turn into a colour: " + ", ".join(f"{k} {v}" for k, v in sorted(result["flags"].items())) + ".", ""]
    out += ["## Each spool", "", "| Spool | Label colour | Measured (mean) | Distance | Delta E | Steady (95 %) | Re-insert spread | Readable |",
            "|---|---|---|---|---|---|---|---|"]
    for r in sorted(result["spools"], key=lambda r: (r["blind"], r["name"])):
        out.append(f"| {r['brand']} {r['material']} {r['name']}{' (blind)' if r['blind'] else ''} | {r['hex']} | {r['measured'] or 'none'} | "
                   f"{'' if r['distance'] is None else r['distance']} | {'' if r['delta_e'] is None else r['delta_e']} | "
                   f"{'' if r['repeat_p95'] is None else r['repeat_p95']} | {'' if r['reinsert_spread'] is None else r['reinsert_spread']} | "
                   f"{r['readable']} of {r['samples']} |")
    t = result["tolerances"]
    out += ["", f"Distance is straight-line distance in RGB (0 to 441) between the mean reading and the colour on the label: it shows how far "
            f"the checker is from what the spool says, not its accuracy. Deja Vu1 calls a distance of {t['match']} or less a match and "
            f"{t['close']} or less close. Delta E is CIE76 Delta E in L*a*b*.", ""]
    rp = result["repeat_p95"]
    if rp["median"] is not None:
        out += [f"Steadiness: the middle spool's 95th percentile reading sits {rp['median']} from its own mean; the worst spool's sits "
                f"{rp['worst']}. A match limit tighter than that cannot work.", ""]
    for title, key, what in (("Spools whose reading matches their label", "match_label", "the mean reading is a match"),
                             ("Spools whose readings are nearest their own label colour", "nearest_label",
                              "most readings were nearest its own label colour among the spools tested")):
        out += [f"## {title}", "", f"A spool counts once, when {what}.", ""]
        for part, name in (("tune", "Spools used to tune"), ("blind", "Blind spools")):
            share = result[key][part]
            if share["of"] == 0:
                out.append(f"- {name}: none.")
                continue
            line = f"- {name}: {share['hits']} of {share['of']} spools"
            if share["rate"] is not None:
                line += f", {round(100 * share['rate'])} %"
            else:
                line += f". Too few to quote a rate (it needs {result['min_spools']} spools)"
            line += f". 95 % range {round(100 * share['low'])} to {round(100 * share['high'])} %."
            if "readings" in share:
                line += f" Readings: {share['readings'][0]} of {share['readings'][1]}."
            out.append(line)
        out.append("")
    if result["near_pairs"]:
        out += ["## Near shades", "", "| Pair | Labels apart | Readings apart | Told apart |", "|---|---|---|---|"]
        for pair in result["near_pairs"]:
            told = "yes" if pair["told_apart"] else "no"
            out.append(f"| {pair['a']} and {pair['b']} | {pair['labels_apart']} | {pair['measured_apart']} | {told} |")
        out.append("")
    labels = result["confusion"]["labels"]
    if labels and len(labels) <= 20:
        out += ["## Which colour each reading was nearest to", "", "Rows: the real spool's label colour. Columns: the label colour its readings were nearest to.", "",
                "| | " + " | ".join(labels) + " |", "|---|" + "---|" * len(labels)]
        for label in labels:
            cells = result["confusion"]["matrix"].get(label, {})
            out.append(f"| {label} | " + " | ".join(str(cells.get(other, 0)) for other in labels) + " |")
        out.append("")
    out += ["## What this does not show", "",
            "- Label colours are the maker's or seller's, not measurements.",
            "- One sensor, one holder, one room's light and one set of references. Another build may differ.",
            "- Spools of one brand and material are not every filament: silk, translucent and glitter filaments are the hard ones.",
            "- A colour never identifies a material."]
    return "\n".join(out) + "\n"
