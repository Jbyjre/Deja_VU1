"""
tester_study.py
===============

The tester's answers to the 22 questions in tester_questions.py. They live in <data>/tester/study.json beside the recorded
events, stay on this computer, and go into the saved report only when the tester saves one.

Recording is always on and never has an end date, so nothing here asks how long to test. The tester answers when they like
(Settings, Tester mode), in any order, and every question can be skipped.

Answers are typed text, so each one is passed through tester.mask() like every other string. Nothing here touches the
network.

study.json version 1 came from the build that asked for a round of one to three days and 52 questions. Its question
numbers mean different questions now, so those answers are set aside under "earlier_answers" and never shown or exported.
"""

import os
import threading
import time

import storage
import tester
import tester_questions

VERSION = 2
MAX_ANSWER = 1500
MAX_ANSWERS_PER_CALL = 60
_lock = threading.RLock()


def _path():
    return os.path.join(tester.folder(), "study.json")


def _now_ms():
    return int(time.time() * 1000)


def _fresh(now_ms):
    return {"v": VERSION, "started": now_ms, "answers": {}, "exports": []}


def _load(create=True):
    path = _path()
    data = storage.load_json(path, None) if os.path.exists(path) else None
    if not isinstance(data, dict) or not isinstance(data.get("started"), int):
        data = _fresh(_now_ms())
        if create and tester.enabled():
            _save(data)
    elif data.get("v") != VERSION:
        data = _migrated(data)
        if create and tester.enabled():
            _save(data)
    data.setdefault("answers", {})
    data.setdefault("exports", [])
    return data


def _migrated(old):
    """A file from the 52-question build: keep when recording began and the saves, set the answers aside."""
    data = _fresh(old["started"])
    data["exports"] = old.get("exports") if isinstance(old.get("exports"), list) else []
    if isinstance(old.get("answers"), dict) and old["answers"]:
        data["earlier_answers"] = old["answers"]
    return data


def _save(data):
    try:
        os.makedirs(tester.folder(), exist_ok=True)
        storage.save_json(_path(), data)
    except OSError:
        pass


def _iso(ms):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ms / 1000.0)) if ms else None


def _is_answered(answer):
    return bool(isinstance(answer, dict) and (answer.get("c") in tester_questions.CHOICES or (answer.get("t") or "").strip()))


def describe(now=None, create=True):
    """Where the tester is: when recording began, how many questions are answered, when the report was last saved."""
    with _lock:
        data = _load(create)
    now = int(now if now is not None else _now_ms())
    answers = data["answers"]
    answered = [q for q, a in answers.items() if q in tester_questions.BY_ID and _is_answered(a)]
    optional_left = [q["id"] for q in tester_questions.QUESTIONS if q["optional"] and q["id"] not in answered]
    exports = data.get("exports") or []
    return {"started": _iso(data["started"]), "started_ms": data["started"], "now_ms": now,
            "answered": len(answered), "total": tester_questions.COUNT, "optional_unanswered": len(optional_left),
            "last_export": _iso(exports[-1]["at"]) if exports else None, "exports": len(exports)}


def save_answers(batch):
    """
    Store answers: {"q16": {"c": "didnt_try", "t": ""}, "q19": {"c": null, "t": "The twin lagged"}, ...}. An answer
    with no choice and no words clears that question. Unknown questions and choices are ignored. Returns how many were kept.
    """
    if not isinstance(batch, dict):
        raise ValueError("Send {\"answers\": {\"q19\": {\"c\": null, \"t\": \"...\"}}}")
    now = _now_ms()
    with _lock:
        data = _load()
        for qid, value in list(batch.items())[:MAX_ANSWERS_PER_CALL]:
            if qid not in tester_questions.BY_ID or not isinstance(value, dict):
                continue
            choice = value.get("c") if value.get("c") in tester_questions.CHOICES else None
            text = tester.mask(value.get("t") or "", MAX_ANSWER) if isinstance(value.get("t"), str) else ""
            if not choice and not text.strip():
                data["answers"].pop(qid, None)
            else:
                data["answers"][qid] = {"c": choice, "t": text, "at": now}
        _save(data)
    return describe()


def note_export(size):
    """The tester saved a report (the zip route calls this once it has built the file)."""
    with _lock:
        data = _load()
        data["exports"] = (data.get("exports") or [])[-19:] + [{"at": _now_ms(), "bytes": int(size)}]
        _save(data)


def answers_view():
    """Every question with its answer, for the browser's form and the report."""
    with _lock:
        data = _load(False)
    out = {}
    for qid, a in data["answers"].items():
        if qid in tester_questions.BY_ID and _is_answered(a):
            out[qid] = {"c": a.get("c"), "t": a.get("t") or "", "at": _iso(a.get("at"))}
    return out


def view(progress, answers):
    """The progress and the answers as the report holds them: every question, in order, with its answer."""
    rows = []
    for section in tester_questions.SECTIONS:
        for q in section["questions"]:
            a = answers.get(q["id"])
            rows.append({"id": q["id"], "n": q["n"], "section": section["id"], "section_name": section["name"],
                         "question": q["text"], "optional": q["optional"], "answered": bool(a),
                         "choice": a["c"] if a else None, "choice_label": tester_questions.CHOICES.get(a["c"]) if a and a["c"] else None,
                         "answer": a["t"] if a else ""})
    by_section = []
    for section in tester_questions.SECTIONS:
        mine = [r for r in rows if r["section"] == section["id"]]
        by_section.append({"section": section["id"], "name": section["name"], "optional": section["optional"],
                           "answered": sum(1 for r in mine if r["answered"]), "of": len(mine),
                           "didnt_try": sum(1 for r in mine if r["choice"] == "didnt_try")})
    return {"progress": progress, "answered": sum(1 for r in rows if r["answered"]), "total": tester_questions.COUNT, "sections": by_section,
            "didnt_try": sum(1 for r in rows if r["choice"] == "didnt_try"),
            "with_words": sum(1 for r in rows if r["answer"].strip()), "answers": rows}


def for_report(now=None):
    """The saved plan and answers, as the report holds them."""
    return view(describe(now, create=False), answers_view())


# ---------------------------------------------------------------------------
# What the app saw, shown next to a question (built from the report, never from typed text)
# ---------------------------------------------------------------------------

def _auto_values(report):
    server = (report.get("setup") or {}).get("server") or {}
    browsers = (report.get("setup") or {}).get("browsers") or []
    firmware = (report.get("printer") or {}).get("firmware") or {}
    engine = server.get("engine") or {}
    out = {"firmware": None, "computer": None, "engine": None}
    browser = None
    if browsers:
        b = browsers[-1]
        browser = ("%s %s" % (b.get("browser"), b.get("bver") or "")).strip() if b.get("browser") else None
    if firmware:
        first = next(iter(firmware.values())) or {}
        out["firmware"] = ", ".join("%s %s" % (k, v) for k, v in sorted(first.items())) or None
    bits = [server.get("os"), ("Python %s" % server["python"]) if server.get("python") else None, browser]
    out["computer"] = ", ".join(str(b) for b in bits if b) or None
    out["engine"] = ("%s %s" % (engine.get("app"), engine.get("version") or "")).strip() if engine.get("app") else "none set up"
    return out


def _count_word(n, one, many=None):
    return "%d %s" % (n, one if n == 1 else (many or one + "s"))


def hints(report):
    """
    {"auto": {"q1": "Ubuntu 24.04", ...}, "saw": {"q8": "The app saw: ...", ...}}
    Short facts the report already holds, so a tester can check their memory and the owner can compare the answer
    with what happened.
    """
    features = {f["id"]: f for f in (report.get("features") or {}).get("detail", [])}
    screens = {s["screen"]: s for s in (report.get("screens") or {}).get("totals", [])}
    printer = report.get("printer") or {}
    summary = report.get("summary") or {}
    server = (report.get("setup") or {}).get("server") or {}
    slow = summary.get("slow_spots") or 0
    link = printer.get("connections") or {}
    prints = (printer.get("prints") or {}).get("real") or {}
    gate = report.get("confirm_print") or {}
    slices = report.get("slicing") or []

    def fact(name):
        if name == "connects":
            return "the printer connected %s and dropped %s" % (_count_word(link.get("connect", 0), "time"), _count_word(link.get("drop", 0), "time"))
        if name == "watch_only":
            return "watch-only is %s" % ("on" if server.get("watch_only") else "off")
        if name == "slow":
            return "%s recorded" % _count_word(slow, "slow spot")
        if name == "gate":
            by = gate.get("by_verdict") or {}
            return "Confirm Print refused %s and asked you to confirm %s" % (_count_word(by.get("blocked", 0), "start"), _count_word(by.get("confirm", 0), "time"))
        if name == "confirmed":
            n = sum(c.get("count", 0) for c in printer.get("confirmed_by_printer") or [])
            return "the printer confirmed %s" % _count_word(n, "command")
        if name == "prints":
            return "%s started and %s finished on a printer" % (prints.get("print_started", 0), prints.get("print_finished", 0))
        if name == "slices":
            worked = sum(1 for s in slices if s.get("ok"))
            return "%s worked, %s failed" % (_count_word(worked, "slice"), len(slices) - worked)
        return None

    saw = {}
    QUESTIONS = tester_questions.QUESTIONS
    for q in QUESTIONS:
        bits = []
        for token in q["saw"]:
            kind, _, name = token.partition(":")
            if kind == "feature" and name in features:
                bits.append("%s was %s" % (features[name]["name"], "used" if features[name]["used"] else "not used"))
            elif kind == "screen":
                s = screens.get(name)
                bits.append("the %s screen was %s" % (name.capitalize(), "opened %s" % _count_word(s["opens"], "time") if s else "not opened"))
            elif kind == "fact":
                text = fact(name)
                if text:
                    bits.append(text)
        if bits:
            saw[q["id"]] = "The app saw: " + "; ".join(bits) + "."
    values = _auto_values(report)
    return {"auto": {q["id"]: values[q["auto"]] for q in QUESTIONS if q["auto"] and values.get(q["auto"])}, "saw": saw}
