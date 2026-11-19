"""
ai_assistant.py
===============

The assistant: a chat that can read what Deja Vu1 knows and, inside fixed limits, work the printer.

How it stays safe, in the order a request meets each layer:

  1. The model never talks to the printer. It can only ask for one of the named tools in TOOLS, by
     writing a small block of JSON. Anything else it writes is just words.
  2. Every tool that changes something calls the same checked function the Printer page's buttons
     call (printer_control.py): temperatures inside the heater limits, moves inside the printer's
     own reported size and only after homing, no moves through a running print. On top of that the
     assistant has limits of its own (LIMITS): it keeps the nozzle a few millimetres off the bed,
     can only send read-only G-code, and can never start a print by itself: Confirm Print does that,
     with the owner's tap.
  3. The owner chooses how much it may do without asking (MODES). Out of the box it works freely
     inside the limits and stops only before ending a print early (HIGH_STAKES); the owner can
     switch even that off, or ask for a yes before every step. A step that needs a yes waits in the
     chat with Approve and Decline, and nothing is sent until one is pressed.
  4. Watch-only mode, the hold during a restart and the module switches apply to it like any other
     sender. Demo printers and real printers never mix: a tool acts on the printer the chat is
     about, and answers {"connected": false} when there is none.

The model's answers use one small text convention (ACTION blocks) instead of each service's own
tool-calling format, so every provider in ai_providers.py, the two subscription programs included,
behaves the same way.
"""

import base64
import json
import math
import os
import re
import threading
import time
import uuid

import ai_providers
import automations
import ai_signin
import carve
import cost_calculator
import file_library
import filament_inventory
import insights
import logbook
import live_feed
import maintenance
import mesh_tools
import mock_moonraker
import modules
import notifications
import print_gate
import print_queue
import printer_control
import process_settings
import shapes
import slicer_bridge
import storage
import timelapse
import update_hold
import watch_only
from ai_assistant_part1 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    CHARS_PER_TOKEN, DEFAULT_MODE, HIGH_STAKES, JUMPS, LIMITS, MAX_ACTIONS, MAX_MODEL_BYTES, MAX_RESULT,
    MAX_ROUNDS, MAX_SAVED_CHATS, MAX_TEXT, MAX_THREADS, MODES, OLD_PLACES, PLACES, Refused, SLICE_WAIT_S,
    STATE_CHARS, WATCH_CONFIRM_S, WATCH_DEFAULT_LOOKS, WATCH_LOOKS, WATCH_MINUTES, WATCH_SENSITIVITY, _CHATS_DIR,
    _DATA_DIR, _DETAIL, _FILE_TOOLS, _OFFLINE, _SAFE_GCODE, _SETTINGS_PATH, _automation_add, _automation_toggle,
    _automations, _brief_state, _build_model, _connections, _cool_down, _cut_holes, _demo_now, _edit_model,
    _extrude, _file_delete, _file_info, _files, _gcode, _job_words, _lib_name, _lock, _logbook_add, _logbook_read,
    _look, _make_shape, _model_info, _model_name, _money, _move, _move_by, _now, _now_ctx, _nozzle, _op,
    _open_page, _part_triangles, _placed, _position, _print_settings, _printers, _ring, _save_model, _set_look,
    _shape, _slice, _slice_status, _slicer_profiles, _snapshot, _start_print, _state, _stem, _suggest_settings,
    _threads, _timelapse_keep, _timelapses, _tokens, _tool, _tour, _triangles, _ui, _watch, _watch_due,
    _watch_log, _watch_settings, _watch_system, _watch_verdict, _z_floor, watch_picture,
)
from ai_assistant_part2 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    _ACTION, _GATES, _HEX, _PICTURE, _add, _card, _chat_path, _ctx, _drop_chat_file, _load_chat, _neg, _picture,
    _results_text, _save_chat, _thread, _touch, chats, clear, parse, reset, stop, view,
)
from ai_assistant_part3 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    TOOLS, _NEEDS_PRINTER, _WRITES_PRINTER, _advance, _carry_out, _check_allowed, _count_usage, _label,
    _needs_yes, _price_row, _print_watch, _run, _settings, _start, _system, _watch_ask, _watch_one, budget, chat,
    decide, estimate, forget, select, signin, status, test, watch_loop, watch_now, watch_once_for_rule,
    watch_settings, watch_tick, watch_view,
)


# ---- settings ---------------------------------------------------------------


# ---- the tools --------------------------------------------------------------


# -- models: small, exact edits that write a new file beside the original ------


# -- the rest of the app: queue, care, notes, spools, settings, places -----------


# -- print watch: your AI looks through the camera while a real printer prints -------------
#
# What the owner can set: how often, an extra look at the first layers (where most prints fail), what to
# look for, how readily it worries, their own notes ("ignore the mark on the left of the sheet"), whether a
# clear failure pauses the print, whether it compares each picture with the one before (a print that stops
# growing is a clog or an empty spool, which one picture can't show) and whether it sends an alert.
# Before pausing it takes a second picture and asks again, so one odd frame never stops a print.


_NEEDS_PRINTER |= {"status", "console", "look", "health", "filament_check"}


# ---- the conversation -------------------------------------------------------


