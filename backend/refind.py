"""
refind.py
=========

A printer that stops answering at its saved address may simply have a new one: most home
routers hand addresses out for a while and can give a device a different one after a restart,
and a printer moved to another Wi-Fi gets another one too. Snapmaker's U1 reports its serial
number (u1-moonraker components/machine.py product_info.serial_number, and "sn" in its mDNS
announcement), so the same printer can be recognised wherever it answers.

Every printer that has reported a serial number is kept in fleet.json with it. When one has not
answered for DOWN_FOR seconds, Deja Vu1 looks for it (the wider search: this computer's networks,
nearby home ranges and the Tailscale network; discovery.discover) at most once every
SEARCH_EVERY seconds. A printer answering with the same serial number at another address becomes
that printer's address, and the change is said in words (an event the page shows, and the log).
A printer with no serial number is never guessed at.
"""

import threading
import time

import discovery
import fleet
import mock_moonraker

CHECK_EVERY = 30.0
DOWN_FOR = 90.0
SEARCH_EVERY = 600.0
_down_since = {}
_searched_at = {}
_lock = threading.Lock()


def remember_serials():
    """Keep each connected printer's serial number with its saved entry."""
    for pid in mock_moonraker.real_printer_ids():
        printer = mock_moonraker.real_printer(pid)
        if printer is not None and printer.is_connected() and getattr(printer, "serial", None):
            fleet.remember_serial(pid, printer.serial)


def check(now=None, search=None, publish=None):
    """One look at every saved printer. Returns the moves made: [{"id", "name", "from", "to"}]."""
    now = time.monotonic() if now is None else now
    search = search or (lambda urls: discovery.discover(urls, wider=True))
    moves = []
    with _lock:
        remember_serials()
        entries = fleet.registered()
        for entry in entries:
            pid, serial = entry["id"], entry.get("serial")
            printer = mock_moonraker.real_printer(pid)
            if printer is None or printer.is_connected():
                _down_since.pop(pid, None)
                continue
            since = _down_since.setdefault(pid, now)
            if not serial or now - since < DOWN_FOR or now - _searched_at.get(pid, -SEARCH_EVERY) < SEARCH_EVERY:
                continue
            _searched_at[pid] = now
            try:
                found = search([p["moonraker_url"] for p in entries])
            except ValueError:            # someone is already looking: try on the next round
                _searched_at.pop(pid, None)
                continue
            match = next((r for r in found.get("printers") or []
                          if r.get("ok") and (r.get("serial") or "").upper() == serial), None)
            if not match or match["url"].rstrip("/") == entry["moonraker_url"].rstrip("/"):
                continue
            moved = fleet.move(pid, match["url"])
            _down_since.pop(pid, None)
            moves.append({"id": pid, "name": entry["name"], "from": entry["moonraker_url"], "to": moved["moonraker_url"]})
    for m in moves:
        import console
        console.write(f"  {m['name']} answered at a new address, {m['to']} (was {m['from']}); Deja Vu1 uses it now\n")
        if publish:
            publish({"type": "printer_moved", "printer": m["id"], "printer_name": m["name"],
                     "from": m["from"], "to": m["to"]})
    return moves


def watch(stop_event=None, publish=None):
    """The background loop, started with the server."""
    while not (stop_event and stop_event.is_set()):
        try:
            check(publish=publish)
        except Exception as exc:          # noqa: BLE001 - a failed look must never stop the next one
            import console
            console.write(f"  looking for a moved printer failed: {exc!r}\n")
        if stop_event:
            if stop_event.wait(CHECK_EVERY):
                return
        else:
            time.sleep(CHECK_EVERY)
