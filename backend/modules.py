"""
modules.py
==========

The list of features this dashboard offers, and whether each one is turned
on. A module here is metadata, not code that gets loaded dynamically: each
module ID corresponds to one of the other backend files. Disabling a module
just makes its API routes refuse to answer; the code itself is never
unloaded, uninstalled, or swapped out. That is deliberate - dynamically
loading arbitrary code is a security problem this project does not need to
take on to deliver the useful part of the idea, which is "let me see
everything this dashboard can do, and turn off what I don't want."

status meanings:
  "ready"            - works today against a live printer, no extra parts
  "hardware_pending"  - logic is done, waiting on a physical add-on
  "optional"          - works today, off by default, not essential

kind says where a feature's switch lives (November 2026: the Modules list had grown to 29 rows,
most of them parts of Deja Vu1 itself, and nobody could tell what a switch was for):
  "extra"    - an optional extra that needs something outside Deja Vu1 (a program you install,
               a device, another service). The only kind in Settings > Optional extras.
  "setting"  - a normal setting that sits in its own card (the camera, time-lapses, continue on
               another device), with its switch there.
  "core"     - part of Deja Vu1 and always on. The server can still refuse its routes when told to
               (tests do), but no screen offers a switch, and a copy saved with one off is switched
               back on once (see DEFAULTS_VERSION).

Tester mode is a "setting" that this build keeps always on (TESTER_ALWAYS_ON below): the people who run
this build are testers, so it records from the first start and has no switch on screen. Setting
TESTER_ALWAYS_ON to False gives back the optional switch in Settings (off by default). A developer can
still start with DEJAVU_TESTER=0 to keep a run out of the record; nothing in the app offers that.
"""

import os
import threading

import storage

_lock = threading.Lock()

_DATA_DIR = storage.DATA_DIR
_STATE_PATH = os.path.join(_DATA_DIR, "modules.json")
# Features that now run as built-in plugins (backend/plugins_builtin/): their switch shows in Settings, Plugins.
_PLUGIN_OWNED = {"cost_calculator": "cost-calculator"}

# While True, Tester mode is on from the first start and cannot be switched off from Settings.
TESTER_ALWAYS_ON = True
_OFF_WORDS = ("0", "false", "no", "off")

REGISTRY = [
    {
        "id": "maintenance",
        "name": "Maintenance reminders",
        "description": "Tracks nozzle, bed, belt, rail, dock, and fan "
                        "maintenance from print history.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "printer_control",
        "name": "Printer control",
        "description": "Pause, resume, cancel, set temperatures, home "
                        "axes, and send G-code.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "led_status",
        "name": "Dock status rings",
        "description": "WS2812 rings on the dock, or the same state on a WLED "
                        "strip you already own.",
        "status": "hardware_pending",
        "default_enabled": True,
    },
    {
        "id": "color_check",
        "name": "Right colour loaded?",
        "description": "Checks each loaded filament's colour with a sensor "
                        "before a print starts. Needs extra hardware.",
        "status": "hardware_pending",
        "default_enabled": True,
    },
    {
        "id": "notifications",
        "name": "Push notifications",
        "description": "Alerts on print finish/fail via ntfy.sh, Discord, "
                        "or Telegram. Respects quiet hours.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "filament_inventory",
        "name": "Filament inventory",
        "description": "Tracks spools on hand, flags files needing a "
                        "colour you don't have, nudges on idle spools.",
        "status": "optional",
        "default_enabled": True,
    },
    {
        "id": "sanity_check",
        "name": "Pre-print sanity check",
        "description": "Combines maintenance, dock, and colour status "
                        "into one verdict before you print.",
        "status": "optional",
        "default_enabled": True,
    },
    {
        "id": "compare",
        "name": "What changed?",
        "description": "Compares the next job against your history and "
                        "flags likely causes from past failures.",
        "status": "optional",
        "default_enabled": True,
    },
    {
        "id": "updates",
        "name": "Update checker",
        "description": "Reads Moonraker's update-status API and flags "
                        "when Klipper or Moonraker have updates.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "backup",
        "name": "Config backup",
        "description": "One-click archive of this dashboard's settings "
                        "and history to a local file.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "camera",
        "name": "Camera bridge",
        "description": "Brings the printer's camera feed in, with a "
                        "watchdog that flags a frozen stream.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "webrtc_camera",
        "name": "Low-latency camera",
        "description": "Plays the camera with almost no delay. Needs go2rtc, a "
                        "separate program you install. Falls back to the "
                        "normal camera if it can't connect.",
        "status": "optional",
        "default_enabled": False,
    },
    {
        "id": "cost_calculator",
        "name": "Print cost calculator",
        "description": "Prices filament by material and adds electricity, "
                        "for past jobs and the one currently running.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "wled_bridge",
        "name": "WLED bridge",
        "description": "Sends the dock ring colours to a WLED light strip "
                        "you already own.",
        "status": "optional",
        "default_enabled": False,
    },
    {
        "id": "home_assistant_bridge",
        "name": "Home Assistant bridge",
        "description": "Shows printer state in Home Assistant as sensors. "
                        "No MQTT broker or custom component needed.",
        "status": "optional",
        "default_enabled": False,
    },
    {
        "id": "fleet",
        "name": "Printer fleet",
        "description": "An at-a-glance overview of every printer, and "
                        "switching the whole dashboard between them.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "printer_link",
        "name": "Printer connection (Moonraker)",
        "description": "Connects to the printers you add by address, through Moonraker's own "
                        "HTTP and WebSocket API, and keeps their live state current.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "fleet_command",
        "name": "Fleet command center",
        "description": "Select several printers and pause, resume, cancel, home or "
                        "preheat them together; send files between queues; the "
                        "farm's print history over time.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "file_library",
        "name": "Print file library",
        "description": "Your G-code, 3MF and STL files with thumbnails, a "
                        "G-code viewer with small edits, and a 3D viewer.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "print_queue",
        "name": "Print queue",
        "description": "Files to print one after another, each checked by "
                        "the Confirm Print gate before it starts.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "automations",
        "name": "Automations",
        "description": "Local when-this-then-that rules: temperatures, print "
                        "events, filament and maintenance to alerts, lights, "
                        "Home Assistant or pause.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "ar_preview",
        "name": "View on your desk (AR)",
        "description": "Places an STL or 3MF model at real size on your desk "
                        "through the phone camera. Works on Android/WebXR "
                        "browsers; iOS Safari has no equivalent.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "converter",
        "name": "3MF converter",
        "description": "Turns MakerWorld and NexPrint projects into Snapmaker "
                        "Orca projects set up for the U1.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "timelapse",
        "name": "Time-lapse flipbook",
        "description": "Keeps a camera frame every few layers and plays the "
                        "print back as a flipbook in the browser.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "chamber_climate",
        "name": "Chamber climate",
        "description": "Chamber temperature over the last half hour, where "
                        "Klipper reports a chamber sensor.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "photo_studio",
        "name": "Photo-to-Print Studio",
        "description": "Turns a photo into a colour-layered relief model from your "
                        "own filament colours, previewed in 3D and saved to the library.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "auto_print",
        "name": "Slicing",
        "description": "Slices STL and 3MF models with Snapmaker Orca or OrcaSlicer, a separate "
                        "program you install, and puts the G-code in your library or queue.",
        "status": "optional",
        "default_enabled": True,
    },
    {
        "id": "sandbox",
        "name": "Farm sandbox",
        "description": "A simulated farm of any size with scripted jams, runouts, network "
                        "drops and wear, to watch the whole dashboard react. Demo data only.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "ai_assistant",
        "name": "AI assistant",
        "description": "A chat that explains, plans and works the printer inside fixed safety limits, "
                        "using your own Claude or ChatGPT plan, an API key or a model on this computer.",
        "status": "optional",
        "default_enabled": True,
    },
    {
        "id": "handoff",
        "name": "Continue on another device",
        "description": "Offers to pick up on your phone exactly where another "
                        "device left off.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "tester",
        "name": "Tester mode",
        "description": "Keeps a report on this computer of how Deja Vu1 behaved while you used it: "
                        "what you pressed, errors, slow buttons, prints and what you tried. In this tester "
                        "build it is always on. Nothing is sent anywhere; you save one file and share it yourself.",
        "status": "optional",
        "default_enabled": TESTER_ALWAYS_ON,
    },
    {
        "id": "error_help",
        "name": "Error codes",
        "description": "Explains the codes the printer reports, in Snapmaker's own words from its wiki, "
                        "with their troubleshooting guides and videos.",
        "status": "ready",
        "default_enabled": True,
    },
]

EXTRAS = ("auto_print", "webrtc_camera", "led_status", "wled_bridge", "home_assistant_bridge", "color_check",
          "ai_assistant")
SETTINGS = ("camera", "timelapse", "handoff", "tester")
for _module in REGISTRY:
    _module["kind"] = ("extra" if _module["id"] in EXTRAS
                       else "setting" if _module["id"] in SETTINGS and not (_module["id"] == "tester" and TESTER_ALWAYS_ON)
                       else "core")

_BY_ID = {m["id"]: m for m in REGISTRY}


DEFAULTS_VERSION = 3
DEFAULTS_ON = ("filament_inventory", "sanity_check", "compare", "auto_print")


def _default_state():
    state = {m["id"]: m["default_enabled"] for m in REGISTRY}
    state["_defaults"] = DEFAULTS_VERSION
    return state


def _load_state():
    if not os.path.exists(_STATE_PATH):
        state = _default_state()
        _save_state(state)
        return state
    state = storage.load_json(_STATE_PATH, None)
    if not isinstance(state, dict):
        state = _default_state()
        _save_state(state)
    for module_id, enabled in _default_state().items():
        if module_id != "_defaults":
            state.setdefault(module_id, enabled)
    # November 2026: four features people need from day one start switched on
    # (DEFAULTS_ON). A copy saved before then still holds the old "off" default
    # for them, so they are switched on once; anything turned off afterwards stays off.
    if state.get("_defaults", 1) < DEFAULTS_VERSION:
        for module_id in DEFAULTS_ON:
            state[module_id] = True
        # Version 3: the parts of Deja Vu1 itself lost their switches. One that an earlier copy had
        # switched off would stay off with no way back on screen, so they are all on again, once.
        for module in REGISTRY:
            if module["kind"] == "core":
                state[module["id"]] = True
        state["_defaults"] = DEFAULTS_VERSION
        _save_state(state)
    return state


def _save_state(state):
    storage.save_json(_STATE_PATH, state)


def _tester_override():
    """True or False when the tester build decides Tester mode regardless of the saved switch, else None."""
    if os.environ.get("DEJAVU_TESTER", "").strip().lower() in _OFF_WORDS:
        return False                      # a developer's off: this run stays out of the record
    return True if TESTER_ALWAYS_ON else None


def _effective(module_id, state):
    if module_id == "tester":
        forced = _tester_override()
        if forced is not None:
            return forced
    on = state.get(module_id, _BY_ID[module_id]["default_enabled"])
    if on and module_id in _PLUGIN_OWNED:
        import plugins                  # here: a built-in plugin owns this switch, and safe start turns it off
        return not plugins.module_blocked(module_id)
    return on


def stored_enabled(module_id):
    """The saved switch alone, without safe start: a built-in plugin's own on or off."""
    return bool(_load_state().get(module_id, _BY_ID[module_id]["default_enabled"]))


def get_all():
    """Every module with its metadata and current on/off state."""
    state = _load_state()
    rows = []
    for module in REGISTRY:
        row = {**module, "enabled": _effective(module["id"], state)}
        if module["id"] == "tester":
            row["kind"] = "core" if TESTER_ALWAYS_ON else "setting"          # the flag can change at run time (tests do)
        if module["id"] in _PLUGIN_OWNED:
            row["plugin"] = _PLUGIN_OWNED[module["id"]]                      # switched in Settings, Plugins
        rows.append(row)
    return rows


def is_enabled(module_id):
    """
    Is this module currently switched on?

    Unknown IDs count as enabled, so a route with no matching module entry
    is never accidentally blocked.
    """
    if module_id not in _BY_ID:
        return True
    return bool(_effective(module_id, _load_state()))


def set_enabled(module_id, enabled):
    if module_id not in _BY_ID:
        raise ValueError(f"Unknown module: {module_id}")
    if module_id == "tester" and TESTER_ALWAYS_ON and not enabled:
        raise ValueError("Tester mode is always on in this tester build, so it has no switch")
    with _lock:                      # two devices switching two modules at once both stick
        state = _load_state()
        state[module_id] = bool(enabled)
        _save_state(state)
    return get_all()


def apply_environment():
    """
    DEJAVU_TESTER=1 switches Tester mode on at start (when the build does not keep it on already). Settings can
    still switch it off afterwards in that case. DEJAVU_TESTER=0 is read by _tester_override(), not here.
    """
    if os.environ.get("DEJAVU_TESTER", "").strip().lower() in ("1", "true", "yes", "on"):
        if not _load_state().get("tester"):
            set_enabled("tester", True)


def reset_state():
    """Wipe saved toggles and start over. Useful for tests."""
    state = _default_state()
    _save_state(state)
    return state
