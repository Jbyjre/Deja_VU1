"""
engine_support.py
=================

Which slicing engines Deja Vu1 has actually been run with, and what to tell
someone whose engine is not on that list. The list is evidence, not a promise:
a row exists only where real slices were made with that exact build on that
system and the result is written down in the repository. Everything else is
shown as "ready to slice" with the builds that do have recorded runs, and never
blocks a slice (a slice that fails still explains itself, see slice_diagnosis.py). docs/engine-support.md carries the
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
    {"app": "Snapmaker_Orca", "version": "01.10.01.50", "system": "Linux",
     "per_head_heights": False,
     "evidence": "docs/engine-support.md: the release the Slicer installs (v2.4.1, checksum matched the pin) run through the app's own plate "
                 "project, 22 November 2026: the 3DBenchy, a gear, a vase and a bracket sliced (the Benchy 240 layers), the engine's arrange and "
                 "orient exported; shared layer heights only, since this build has no per-head height options"},
    {"app": "Snapmaker_Orca", "version": "01.10.01.50", "system": "Windows",
     "per_head_heights": False,
     "evidence": "docs/testing.md: the same v2.4.1 release, installed by the Slicer's Install engine button on Windows 11 and run through the "
                 "app's own plate project on 22 November 2026 beside a real U1: the 3DBenchy sliced in 12.7 s, and a 20 mm cube and two 16 mm "
                 "cubes sliced and printed to the end; the engine's own arrange and orient steps crash there (exit 3221225477), so the app "
                 "keeps its own arrange; shared layer heights only"},
    {"app": "OrcaSlicer", "version": "2.4.2", "system": "Linux",
     "per_head_heights": False,
     "evidence": "CHANGELOG.md and docs/native-studio-validation.md: real bracket, tile, swatch and relief slices; "
                 "a shared-height route only, since stock OrcaSlicer 2.4.2 has no per-head height options"},
)

_SYSTEM_WORDS = {"Darwin": "macOS", "Linux": "Linux", "Windows": "Windows"}

# One release, two names. `--help` names the build ("Snapmaker_Orca-01.10.01.50:"); the settings file `--export-settings` writes says
# "version": "2.4.1". Windows builds do not print `--help` where the app can read it, so there the app only ever sees the release name.
# Both were read from the same v2.4.1 Linux download on 22 November 2026. The Windows run of the same release (22 November 2026) read only
# the settings file's "2.4.1", which this table treats as the same build.
RELEASE_BUILDS = {("snapmakerorca", "2.4.1"): "01.10.01.50"}


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
    build = RELEASE_BUILDS.get((_key(app), str(version)), version)
    exact = next((row for row in same_app if row["version"] == build and row["system"] == system), None)
    where = system_name(system)
    if exact:
        heights = ("Per-head layer heights are tested too." if exact["per_head_heights"]
                   else "Shared layer heights only: this build has no per-head height options.")
        return {"level": "tested", "title": f"Tested: this exact build has sliced on {where}.", "detail": heights,
                "evidence": exact["evidence"], "tested": _tested_words(), "per_head_heights": exact["per_head_heights"]}
    if any(row["version"] == build for row in same_app):
        seen = list(dict.fromkeys(system_name(row["system"]) for row in same_app if row["version"] == build))
        title = f"Ready to slice. This build's recorded runs are on {' and '.join(seen)}; {where} is next."
    elif same_app:
        title = f"Ready to slice with {app} {version}. Its recorded runs are at {same_app[0]['version']}."
    else:
        title = f"Ready to slice with {app or 'this engine'}. Recorded runs so far use other engines."
    return {"level": "untested", "title": title,
            "detail": f"Tested so far: {_tested_words()}. If a slice fails, the report says why.",
            "evidence": None, "tested": _tested_words(), "per_head_heights": None}
