"""
engine_support.py
=================

Which slicing engines Deja Vu1 has actually been run with, and what to tell
someone whose engine is not on that list. The list is evidence, not a promise:
a row exists only where real slices were made with that exact build on that
system and the result is written down in the repository. Everything else is
"not tested", said in words, and never blocks a slice (a slice that fails still
explains itself, see slice_diagnosis.py). docs/engine-support.md carries the
same table for people.

To add a row: run tools/engine-fixtures.py (or slice a sample model in the app
and press Copy report) with the build on that system, then add it here and to
the document in the same change.
"""

import re

# What the engine program prints first in `--help` ("<app>-<version>:") and the
# system name Python reports (platform.system(): Linux, Windows, Darwin).
VERIFIED = (
    {"app": "Snapmaker_Orca", "version": "02.08.01.55", "system": "Linux",
     "per_head_heights": True,
     "evidence": "docs/slicer-workspace-validation.md: version and help read, exported option schema read, "
                 "mixed-height slices for three nozzle pairs, three separated plates and heavy models, each "
                 "checked by pre-flight (recorded 21 October 2026, merge 9efb807)"},
    {"app": "OrcaSlicer", "version": "2.4.2", "system": "Linux",
     "per_head_heights": False,
     "evidence": "CHANGELOG.md and docs/native-studio-validation.md: real bracket, tile, swatch and relief slices; "
                 "a shared-height route only, since stock OrcaSlicer 2.4.2 has no per-head height options"},
)

_SYSTEM_WORDS = {"Darwin": "macOS", "Linux": "Linux", "Windows": "Windows"}


def _key(text):
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def system_name(system):
    return _SYSTEM_WORDS.get(system, system or "this system")


def _tested_words():
    return "; ".join(f"{row['app']} {row['version']} on {system_name(row['system'])}" for row in VERIFIED)


def assess(app, version, system):
    """
    What is known about this engine build on this system: `level` is "tested"
    (an exact row exists) or "untested", with the words to show and the rows.
    """
    same_app = [row for row in VERIFIED if _key(row["app"]) == _key(app)]
    exact = next((row for row in same_app if row["version"] == version and row["system"] == system), None)
    where = system_name(system)
    if exact:
        heights = ("Per-head layer heights are tested too." if exact["per_head_heights"]
                   else "Shared layer heights only: this build has no per-head height options.")
        return {"level": "tested", "title": f"Tested: this exact build has sliced on {where}.", "detail": heights,
                "evidence": exact["evidence"], "tested": _tested_words(), "per_head_heights": exact["per_head_heights"]}
    if any(row["version"] == version for row in same_app):
        title = f"Not tested on {where} yet: this build has only been run on {system_name(same_app[0]['system'])}."
    elif same_app:
        title = f"Not tested at this version ({version}). {app} has been run at {same_app[0]['version']}."
    else:
        title = f"Not tested: no recorded runs with {app or 'this engine'}."
    return {"level": "untested", "title": title,
            "detail": f"Tested so far: {_tested_words()}. Slicing can still work; if it fails, the report says why.",
            "evidence": None, "tested": _tested_words(), "per_head_heights": None}
