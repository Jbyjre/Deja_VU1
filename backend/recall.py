"""
recall.py
=========

Deja Vu1 remembers (RECALL). The print record (print_record.py) keeps every print; this module connects it to the files
you open, so a file that comes back is recognised with its history.

- A fingerprint for each file in Files: SHA-256 of a model's bytes, and of a G-code file's moves and settings with its
  comment lines left out, so the same model sliced again with the same settings has the same fingerprint even though the
  slicer writes a new date into its first lines. Fingerprints are worked out on this computer and never sent anywhere;
  they are kept in memory for as long as the file's size and modification time stay the same.
- When a print starts, its entry gets the file's fingerprint and the model it was sliced from (with that model's
  fingerprint), worked out in the background so the live readings never wait for a large file.
- about(name): the prints of this file (the same fingerprint, the same name, or a print sliced from this model), counted
  by how they ended, the last one, the last that finished and the last that did not. The page writes the sentences.
- like_last_time(name): the print to repeat ("print it like the time it worked") and what differs on the printer now:
  another material, colour or roll on a head the file uses.
- facts(): plain facts from your own ended prints, each with the prints behind it, only where at least three prints
  back it up. Nothing is estimated or made up: a fact needs real times, real grams or real endings.
"""

import hashlib
import os
import threading

import file_library
import print_record
import print_track

_lock = threading.Lock()
_cache = {}                      # name -> (size, mtime, fingerprint)
READ_CHUNK = 1 << 20
MIN_PRINTS_FOR_A_FACT = 3


# ---- fingerprints -----------------------------------------------------------------------------------------------------

def _digest(path, gcode):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        if not gcode:
            for chunk in iter(lambda: fh.read(READ_CHUNK), b""):
                h.update(chunk)
            return h.hexdigest()
        for line in fh:
            line = line.strip()
            if not line or line.startswith(b";"):
                continue
            cut = line.find(b";")
            h.update((line[:cut].rstrip() if cut > 0 else line) + b"\n")
    return h.hexdigest()


def fingerprint(name):
    """The file's fingerprint, or None when it isn't in Files."""
    try:
        path = file_library._path(name)
        st = os.stat(path)
    except (OSError, ValueError):
        return None
    with _lock:
        known = _cache.get(name)
    if known and known[0] == st.st_size and known[1] == st.st_mtime:
        return known[2]
    try:
        value = _digest(path, file_library.kind_of(name) == "gcode")
    except OSError:
        return None
    with _lock:
        _cache[name] = (st.st_size, st.st_mtime, value)
    return value


def _sliced_from(name):
    """The model a G-code file in Files was sliced from in Deja Vu1, when its note says so (else None)."""
    note = (file_library.origins().get(name) or {}).get("note") or ""
    found = print_record._SLICED_FROM.match(note)
    return found.group(1) if found else None


def describe_start(entry_id, filename):
    """Called in the background when a print starts: what the record should know about its file."""
    if not file_library.exists(filename):
        return
    model = _sliced_from(filename)
    print_record.set_identity(entry_id, fingerprint(filename), model,
                              fingerprint(model) if model and file_library.exists(model) else None)


def start_in_background(entry_id, filename):
    threading.Thread(target=describe_start, args=(entry_id, filename), name="recall-fingerprint", daemon=True).start()


# ---- what the record knows about a file ----------------------------------------------------------------------------

def _matches(name, entries):
    """The record's prints of this file: same fingerprint, same name, or sliced from this model (or one with its fingerprint)."""
    kind = file_library.kind_of(name)
    fp = fingerprint(name)
    low = name.lower()
    out = []
    for e in entries:
        if e.get("status") == "running":
            continue
        path = str(e.get("file") or "").lower()
        if path in (low, "/" + low) or path.rsplit("/", 1)[-1] == low or (fp and e.get("fingerprint") == fp):
            out.append(e)
        elif kind in ("stl", "obj", "3mf") and (name in (e.get("sliced_from"), e.get("model"))
                                                or (fp and e.get("model_fingerprint") == fp)):
            out.append(e)
    return out


def _short(e):
    if not e:
        return None
    keep = ("id", "file", "printer", "printer_name", "status", "started_at", "ended_at", "real_hours", "estimated_hours",
            "grams", "heads", "layer", "ended_because", "watch", "timelapse", "picture", "note", "in_library", "model",
            "sliced_from")
    return {k: e.get(k) for k in keep if k in e}


def _rows(demo, history=None, printer_id=None, printer_name=None):
    """The record as Printer › Prints shows it: our own entries and the printer's own history, with Files' links."""
    return print_record.listing(demo, printer_history=history, printer_id=printer_id, printer_name=printer_name)["prints"]


def about(name, demo=False, history=None, printer_id=None, printer_name=None):
    """What the record knows about this file. "count" is 0 when it has never been printed."""
    if not file_library.kind_of(name):
        raise ValueError("Name a model or G-code file")
    found = _matches(name, _rows(demo, history, printer_id, printer_name))
    order = {id(e): i for i, e in enumerate(found)}               # ties (the same second) keep the record's own order
    found.sort(key=lambda e: (print_record._stamp(e.get("ended_at") or e.get("started_at")) or 0, order[id(e)]), reverse=True)
    counts = {}
    for e in found:
        counts[e.get("status")] = counts.get(e.get("status"), 0) + 1
    worked = next((e for e in found if e.get("status") == "finished"), None)
    bad = next((e for e in found if e.get("status") in ("failed", "cancelled")), None)
    return {"file": name, "count": len(found), "counts": counts, "last": _short(found[0] if found else None),
            "worked": _short(worked), "last_bad": _short(bad), "prints": [e.get("id") for e in found[:50]]}


def _head(h):
    """What a head held, as the record and the printer report it (the page writes the sentence)."""
    h = h or {}
    return {k: h.get(k) for k in ("colour", "colour_name", "material", "spool") if h.get(k)}


def differences(then_heads, now_heads):
    """What differs between the heads of the print that worked and what is on the printer now, head by head."""
    now = {h.get("toolhead"): h for h in now_heads or [] if h.get("toolhead")}
    out = []
    for old in then_heads or []:
        head = old.get("toolhead")
        cur = now.get(head) or {}
        changed = []
        for key, label in (("material", "material"), ("colour_name", "colour"), ("spool", "roll")):
            a, b = (old.get(key) or "").strip().lower(), (cur.get(key) or "").strip().lower()
            if a and b and a != b:                  # only what both sides report: an unknown is never a difference
                changed.append(label)
        if not changed and old.get("colour") and cur.get("colour") and str(old["colour"]).lower() != str(cur["colour"]).lower():
            changed.append("colour")
        if changed:
            out.append({"toolhead": head, "changed": changed, "then": _head(old), "now": _head(cur)})
    return out


def like_last_time(name, demo=False, history=None, printer_id=None, printer_name=None):
    """
    The print to repeat and what differs now. The file to print is the one that finished: the same G-code (same settings) when
    it is still in Files. A model's last good print is its G-code; Confirm Print checks it again as for any print.
    """
    known = about(name, demo, history, printer_id, printer_name)
    worked = known.get("worked")
    if not worked:
        raise ValueError("This file has no finished print in the record yet")
    import mock_moonraker
    pid = worked.get("printer") or printer_id or mock_moonraker.selected_printer_id()
    try:
        with mock_moonraker.use_printer(pid):
            state = mock_moonraker.get_printer_state()
            job = {"required_filament": [{"toolhead": h.get("toolhead")} for h in worked.get("heads") or []]}
            now = print_record._heads(state, job, pid)
    except Exception:
        now = []
    return {"print": worked, "file": worked.get("file"), "ready": bool(worked.get("in_library")),
            "printer": pid, "differences": differences(worked.get("heads"), now)}


# ---- what the history says (RECALL.3) ------------------------------------------------------------------------------

def facts(demo=False, history=None, printer_id=None, printer_name=None):
    """
    Plain facts from your own ended prints, as figures (the page writes the sentence). Each one lists the prints behind it.
    A fact needs at least MIN_PRINTS_FOR_A_FACT prints with the figures it uses; nothing is estimated to fill a gap.
    """
    entries = [e for e in _rows(demo, history, printer_id, printer_name) if e.get("status") in print_record.ENDED]
    out = []
    by_printer = {}
    for e in entries:
        if e.get("status") == "finished" and (e.get("real_hours") or 0) > 0 and (e.get("estimated_hours") or 0) > 0:
            by_printer.setdefault(e.get("printer") or "", []).append(e)
    for pid, rows in sorted(by_printer.items()):
        if len(rows) < MIN_PRINTS_FOR_A_FACT:
            continue
        real = sum(r["real_hours"] for r in rows)
        planned = sum(r["estimated_hours"] for r in rows)
        out.append({"kind": "time", "printer": pid, "printer_name": rows[-1].get("printer_name") or pid,
                    "percent": round((real / planned - 1) * 100), "count": len(rows), "prints": [r["id"] for r in rows]})
    by_material = {}
    for e in entries:
        mat = str(e.get("material") or "").strip().upper()
        if mat:
            by_material.setdefault(mat, []).append(e)
    for mat, rows in sorted(by_material.items()):
        if len(rows) < MIN_PRINTS_FOR_A_FACT:
            continue
        done = sum(1 for r in rows if r.get("status") == "finished")
        out.append({"kind": "material", "material": mat, "finished": done, "count": len(rows), "prints": [r["id"] for r in rows]})
    weighed = [e for e in entries if e.get("status") == "finished" and (e.get("grams") or 0) > 0
               and (e.get("grams_in_file") or 0) > 0 and not e.get("grams_estimated")]
    if len(weighed) >= MIN_PRINTS_FOR_A_FACT:
        used = sum(e["grams"] for e in weighed)
        planned = sum(e["grams_in_file"] for e in weighed)
        out.append({"kind": "filament", "percent": round((used / planned - 1) * 100), "count": len(weighed),
                    "prints": [e["id"] for e in weighed]})
    failed = [e for e in entries if e.get("status") == "failed" and (e.get("layer") or {}).get("current")]
    if len(failed) >= MIN_PRINTS_FOR_A_FACT:
        early = [e for e in failed if e["layer"]["current"] <= 3]
        if early:
            out.append({"kind": "first_layers", "early": len(early), "count": len(failed), "prints": [e["id"] for e in early]})
    return {"facts": out, "needs": MIN_PRINTS_FOR_A_FACT, "ended": len(entries)}


def _layers_from(e, demo):
    """Where a replay's layers come from: this computer's copy of the G-code, a built-in sample (demo), or nowhere."""
    name = e.get("file") or ""
    if file_library.kind_of(name) != "gcode":
        return None
    if e.get("in_library"):
        return "library"
    if demo:
        import sample_files
        if name in sample_files.SAMPLES or name in sample_files.LEGACY:
            return "sample"
    return None


def _pauses(track):
    """The points where the trace went from printing to paused: [(seconds, layer)]."""
    out, was = [], 0
    for p in (track or {}).get("points") or []:
        if len(p) >= 8 and p[7] and not was:
            out.append((p[0], p[1]))
        was = p[7] if len(p) >= 8 else 0
    return out


def replay(entry_id, demo=False, history=None, printer_id=None, printer_name=None):
    """
    What a replay of one ended print plays back (RECALL.2): the print, the trace kept while it ran (temperatures, layers,
    time-lapse frames; None when none was kept), what happened along the way (the AI watch's notes, pauses, how it ended)
    and where its layers and frames come from. Everything is from the record; nothing is filled in.
    """
    e = print_record.get(entry_id, demo, history, printer_id, printer_name)
    if e.get("status") == "running":
        raise ValueError("This print is still running: watch it live on the Printer screen")
    track = print_track.load(entry_id) if not e.get("from_printer") else None
    layer = e.get("layer") or {}
    traced = [p[1] for p in (track or {}).get("points") or [] if len(p) > 1 and isinstance(p[1], int)]
    total = layer.get("total") or None
    stop = layer.get("current") or (max(traced) if traced else None)
    if e.get("status") == "finished" and total:
        stop = total
    events = []
    for n in e.get("watch") or []:
        at = (n.get("layer") or {}).get("current") if isinstance(n.get("layer"), dict) else None
        events.append({"kind": "watch", "layer": at, "at": n.get("at"), "verdict": n.get("verdict"), "text": n.get("why")})
    for t, at in _pauses(track):
        events.append({"kind": "pause", "layer": at, "seconds": t})
    if e.get("status") in ("failed", "cancelled"):
        events.append({"kind": "end", "layer": layer.get("current"), "status": e.get("status"), "text": e.get("ended_because")})
    tl = None
    if e.get("timelapse"):
        import modules
        import timelapse
        if modules.is_enabled("timelapse"):
            try:
                frames = timelapse.frames(e.get("printer"), e["timelapse"])
                if frames:
                    tl = {"session": e["timelapse"], "printer": e.get("printer"), "frames": frames}
            except (ValueError, OSError):
                tl = None
    return {"print": _short(e), "file": e.get("file"), "layers": _layers_from(e, demo), "track": track,
            "events": events, "total_layers": total, "stop_layer": stop, "timelapse": tl}


def replay_layers(entry_id, demo=False, history=None, printer_id=None, printer_name=None):
    """The G-code's layers for the twin (print_preview's form), from this computer's copy or a built-in sample."""
    import print_preview
    e = print_record.get(entry_id, demo, history, printer_id, printer_name)
    where = _layers_from(e, demo)
    if where is None:
        return {"file": e.get("file"), "reason": f"{e.get('file') or 'This file'} isn't in Files any more, so its layers can't be drawn"}
    return print_preview.for_library(e["file"], allow_sample=(where == "sample"))


def reset():
    with _lock:
        _cache.clear()
