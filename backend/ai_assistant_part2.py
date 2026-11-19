"""
ai_assistant_part2.py: part 2 of 3 split out of ai_assistant.py (the AI assistant: its tools, safety limits,
prompts and answers) on 19 November 2026, so a session reads only the part it needs. ai_assistant.py imports
every name here back, so `ai_assistant.<name>` works as before. Holds: _ACTION, _GATES, _HEX, _PICTURE, _add,
_card, _chat_path, _ctx, _drop_chat_file, _load_chat, _neg, _picture, _results_text, _save_chat, _thread,
_touch, chats, clear, parse, reset, stop, view.
"""

import ai_providers
import ai_signin
import base64
import json
import mock_moonraker
import os
import re
import storage
import time
from ai_assistant_part1 import MAX_RESULT, MAX_SAVED_CHATS, MAX_THREADS, _CHATS_DIR, _SETTINGS_PATH, _lock, _threads  # noqa: F401


def reset():
    """Forget settings, keys and conversations. For tests."""
    with _lock:
        storage.save_json(_SETTINGS_PATH, {})
        _threads.clear()
        for row in chats()["chats"]:
            _drop_chat_file(row["id"])
    ai_providers.reset()
    ai_signin.reset()


_GATES = {"queue": "print_queue", "queue_add": "print_queue", "queue_remove": "print_queue", "queue_move": "print_queue",
          "queue_tidy": "print_queue", "maintenance": "maintenance", "care_done": "maintenance", "care_snooze": "maintenance",
          "filament": "filament_inventory", "filament_check": "filament_inventory", "spool_add": "filament_inventory",
          "spool_weight": "filament_inventory", "print_settings": "auto_print", "suggest_settings": "auto_print",
          "slice": "auto_print", "slice_status": "auto_print", "slicer_profiles": "auto_print",
          "costs": "cost_calculator", "look": "camera", "automations": "automations", "automation_add": "automations",
          "automation_toggle": "automations", "automation_remove": "automations", "print_watch": "camera", "timelapses": "timelapse", "timelapse_keep": "timelapse"}


def _neg(value):
    try:
        return float(value) < 0
    except (TypeError, ValueError):
        return False


_ACTION = re.compile(r"```action\s*(.*?)```", re.S | re.I)


def parse(answer):
    """Split a model's answer into the words for the owner and the steps it asks for."""
    actions = []
    for block in _ACTION.findall(answer or ""):
        try:
            data = json.loads(block)
        except ValueError:
            actions.append({"tool": "", "args": {}, "error": "That action block wasn't valid JSON"})
            continue
        for item in data if isinstance(data, list) else [data]:
            if isinstance(item, dict):
                args = item.get("args")
                actions.append({"tool": str(item.get("tool") or ""), "args": args if isinstance(args, dict) else {}})
    return _ACTION.sub("", answer or "").strip(), actions


def _chat_path(tid):
    return os.path.join(_CHATS_DIR, tid + ".json")


def _save_chat(thread):
    """Keep a conversation on disk so it can be opened again after a restart. Pictures are left out."""
    if not any(m["role"] == "user" for m in thread["messages"]):
        return
    first = next(m["text"] for m in thread["messages"] if m["role"] == "user")
    record = {"id": thread["id"], "title": thread.get("title") or re.sub(r"\s+", " ", first).strip()[:70],
              "created": thread.get("created") or thread["messages"][0]["at"], "updated": time.time(),
              "printer": thread.get("printer"), "seq": thread["seq"], "usage": thread["usage"],
              "messages": thread["messages"][-200:],
              "history": [{"role": h["role"], "text": h["text"][:20000], "images": []} for h in thread["history"][-40:]]}
    try:
        os.makedirs(_CHATS_DIR, exist_ok=True)
        storage.save_json(_chat_path(thread["id"]), record, indent=None)
    except OSError:
        return
    names = [n for n in os.listdir(_CHATS_DIR) if n.endswith(".json") and not n.startswith(".")]
    if len(names) > MAX_SAVED_CHATS:
        names.sort(key=lambda n: os.path.getmtime(os.path.join(_CHATS_DIR, n)))
        for name in names[:len(names) - MAX_SAVED_CHATS]:
            _drop_chat_file(name[:-5])


def _drop_chat_file(tid):
    for path in (_chat_path(tid), storage.prev_path(_chat_path(tid))):
        try:
            os.remove(path)
        except OSError:
            pass


def _load_chat(tid):
    record = storage.load_json(_chat_path(tid), None) if os.path.exists(_chat_path(tid)) else None
    if not isinstance(record, dict) or not isinstance(record.get("messages"), list):
        return None
    for m in record["messages"]:
        if m.get("status") in ("running", "waiting"):
            m["status"] = "declined" if m["status"] == "waiting" else "refused"
            m["detail"] = m.get("detail") or "Stopped when Deja Vu1 closed"
    usage = {"answers": 0, "in": 0, "out": 0, "counted": 0, "cost_usd": 0.0, "model": ""}
    usage.update(record.get("usage") or {})
    return {"id": tid, "printer": record.get("printer"), "messages": record["messages"],
            "history": [h for h in record.get("history") or [] if isinstance(h, dict) and h.get("role") in ("user", "assistant")],
            "busy": False, "pending": None, "work": None, "stop": False, "seq": int(record.get("seq") or len(record["messages"])),
            "touched": time.time(), "usage": usage, "title": record.get("title") or "", "created": record.get("created")}


def chats():
    """The saved conversations, newest first: id, title, when, how many messages."""
    rows = []
    try:
        names = [n for n in os.listdir(_CHATS_DIR) if n.endswith(".json") and not n.startswith(".")]
    except OSError:
        names = []
    for name in names:
        record = storage.load_json(os.path.join(_CHATS_DIR, name), None)
        if not isinstance(record, dict):
            continue
        said = [m for m in record.get("messages") or [] if m.get("role") in ("user", "assistant")]
        last = next((m.get("text") for m in reversed(said) if m.get("role") == "assistant"), "")
        rows.append({"id": record.get("id") or name[:-5], "title": record.get("title") or "Conversation",
                     "updated": record.get("updated") or 0, "created": record.get("created") or 0,
                     "count": len(said), "last": re.sub(r"\s+", " ", re.sub(r"[*`#]", "", str(last or "")))[:120]})
    rows.sort(key=lambda r: -r["updated"])
    return {"chats": rows}


def _thread(tid, printer=None):
    tid = str(tid or "")
    if not re.match(r"^[A-Za-z0-9_-]{6,64}$", tid):
        raise ValueError("Bad conversation id")
    with _lock:
        thread = _threads.get(tid) or _load_chat(tid)
        if thread is not None:
            _threads[tid] = thread
        if thread is None:
            while len(_threads) >= MAX_THREADS:
                _threads.pop(min(_threads, key=lambda k: _threads[k]["touched"]))
            thread = _threads[tid] = {"id": tid, "printer": printer, "messages": [], "history": [], "busy": False,
                                      "pending": None, "work": None, "stop": False, "seq": 0, "touched": time.time(),
                                      "usage": {"answers": 0, "in": 0, "out": 0, "counted": 0, "cost_usd": 0.0, "model": ""}}
        thread["touched"] = time.time()
        return thread


def _add(thread, role, **fields):
    thread["seq"] += 1
    row = {"n": thread["seq"], "role": role, "at": time.time(), **fields}
    thread["messages"].append(row)
    del thread["messages"][:-200]
    return row


def view(tid, since=0):
    """The conversation for the browser: messages after `since`, whether it is working, what waits for a yes."""
    thread = _thread(tid)
    try:
        since = int(since)
    except (TypeError, ValueError):
        since = 0
    return {"id": thread["id"], "busy": thread["busy"], "seq": thread["seq"],
            "messages": [m for m in thread["messages"] if m["n"] > since or m.get("changed", 0) > since],
            "pending": thread["pending"], "usage": thread["usage"],
            "title": thread.get("title") or next((m["text"][:70] for m in thread["messages"] if m["role"] == "user"), "")}


def _touch(thread, row):
    thread["seq"] += 1
    row["changed"] = thread["seq"]


def _results_text(results):
    lines = ["[Deja Vu1] Results of your steps:"]
    for name, ok, result in results:
        shown = {k: v for k, v in result.items() if not k.startswith("_") and k != "confirmed_state"}
        lines.append(f"- {name}: {'done' if ok else 'NOT done'} {json.dumps(shown, default=str)[:MAX_RESULT]}")
    return "\n".join(lines)


_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _card(name, args, result):
    """A small picture of a step's result for the chat: readings as gauges, a sliced file, a new model, spools."""
    try:
        if name == "status":
            heads = [{"name": k, "temp": h.get("temperature"), "target": h.get("target")}
                     for k, h in (result.get("heads") or {}).items()]
            return {"kind": "printer", "name": result.get("printer") or "", "state": result.get("state") or "",
                    "file": result.get("file") or "", "progress": result.get("progress_percent"), "heads": heads,
                    "bed": result.get("bed") or {}, "active": result.get("active_head") or ""}
        if name in ("slice", "slice_status") and result.get("files"):
            return {"kind": "slice", "files": [{"name": f.get("name"), "hours": f.get("estimated_hours"),
                                                "grams": f.get("filament_grams"), "layers": f.get("layers")}
                                               for f in result["files"][:3]]}
        if result.get("saved_as"):
            return {"kind": "model", "file": result["saved_as"], "size": result.get("size_mm") or result.get("size")}
        if name == "filament" and isinstance(result.get("spools", result), list):
            spools = result.get("spools", result) if isinstance(result, dict) else result
            return {"kind": "spools", "spools": [{"name": f"{s.get('material', '')} {s.get('color_name', '')}".strip(),
                                                  "hex": s.get("color_hex") if _HEX.match(str(s.get("color_hex") or "")) else "",
                                                  "grams": s.get("grams_remaining")} for s in spools[:12]]}
        if name == "maintenance":
            tasks = [t for t in result.get("tasks", []) if t.get("status") in ("overdue", "due_soon", "due")]
            return {"kind": "care", "tasks": [{"name": t.get("name"), "status": t.get("status"), "why": t.get("reason")}
                                              for t in tasks[:6]], "total": len(result.get("tasks", []))}
        if name == "queue":
            return {"kind": "queue", "jobs": [{"name": i.get("filename") or i.get("name"), "status": i.get("status")}
                                              for i in (result.get("items") or [])[:8]]}
        if name == "automation_add" and result.get("rule"):
            return {"kind": "rule", "name": result["rule"].get("name"), "id": result["rule"].get("id")}
        if name == "look":
            return {"kind": "look"}
    except Exception:
        return None
    return None


def _ctx(printer_id, demo):
    connected = mock_moonraker.is_connected(printer_id)
    return {"printer": printer_id, "demo": bool(demo), "live": bool(connected or demo)}


_PICTURE = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$")


def _picture(picture):
    """A photo the owner attached (a data: address the browser made), as (mime, base64), or None."""
    if not picture:
        return None
    m = _PICTURE.match(str(picture))
    if not m or len(m.group(2)) > 1_000_000:
        raise ValueError("Attach a JPEG or PNG photo, up to about 700 KB once Deja Vu1 has shrunk it")
    try:
        base64.b64decode(m.group(2), validate=True)
    except ValueError:
        raise ValueError("That photo couldn't be read")
    return m.group(1), m.group(2)


def stop(tid):
    thread = _thread(tid)
    thread["stop"] = True
    if not thread["busy"]:
        for m in thread["messages"]:
            if m.get("status") == "waiting":
                m["status"] = "declined"
                _touch(thread, m)
        thread["work"], thread["pending"] = None, None
        _save_chat(thread)
    return view(tid, 0)


def clear(tid):
    """Delete a conversation, from memory and from this computer."""
    stop(tid)
    with _lock:
        _threads.pop(str(tid), None)
        _drop_chat_file(str(tid))
    return {"cleared": True, **chats()}
