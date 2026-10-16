"""
Snapshot the Snapmaker U1 profile facts the 3MF converter depends on.

Reads a local checkout of Snapmaker's OrcaSlicer (github.com/Snapmaker/OrcaSlicer)
and writes tests/fixtures/snapmaker_u1_profiles.json, which
tests/test_converter_orca_rules.py checks the converter against. Run it again
whenever Snapmaker updates its profiles:

    git clone --depth 1 --filter=blob:none --sparse https://github.com/Snapmaker/OrcaSlicer orca
    git -C orca sparse-checkout set --no-cone '/resources/profiles/Snapmaker.json' \
        '/resources/profiles/Snapmaker/**' '/src/libslic3r/Preset.cpp'
    python3 tools/snapshot_snapmaker_profiles.py orca

Standard library only. Nothing here runs when the dashboard runs.
"""

import json
import os
import re
import subprocess
import sys

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "tests", "fixtures", "snapmaker_u1_profiles.json")
META_KEYS = {"type", "name", "inherits", "from", "instantiation", "setting_id", "filament_id",
             "version", "is_custom_defined", "description", "renamed_from"}


def preset_options(checkout):
    """The setting names each profile type owns, from Preset.cpp's lists
    (s_Preset_print_options, s_Preset_filament_options, and
    s_Preset_printer_options + s_Preset_machine_limits_options). Commented-out
    names are left out, exactly as the compiler would."""
    src = open(os.path.join(checkout, "src", "libslic3r", "Preset.cpp"), encoding="utf-8").read()
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"//[^\n]*", "", src)

    def block(name):
        m = re.search(r"static std::vector<std::string> " + name + r"\s*\{(.*?)\};", src, re.S)
        if not m:
            raise SystemExit(f"{name} not found in Preset.cpp")
        return re.findall(r'"([^"]+)"', m.group(1))

    return {"process": sorted(set(block("s_Preset_print_options"))),
            "filament": sorted(set(block("s_Preset_filament_options"))),
            "machine": sorted(set(block("s_Preset_printer_options") + block("s_Preset_machine_limits_options")))}


def main(checkout):
    root = os.path.join(checkout, "resources", "profiles")
    vendor = json.load(open(os.path.join(root, "Snapmaker.json"), encoding="utf-8"))
    index = {}
    for kind in ("machine_list", "process_list", "filament_list"):
        for item in vendor[kind]:
            index[item["name"]] = (kind.split("_")[0], item["sub_path"])

    cache = {}

    def resolve(name):
        """The profile with everything it inherits, as Orca flattens it."""
        if name in cache:
            return cache[name]
        kind, sub_path = index[name]
        own = json.load(open(os.path.join(root, "Snapmaker", sub_path), encoding="utf-8"))
        parent = own.get("inherits")
        merged = dict(resolve(parent)) if parent else {}
        if parent and parent not in index:
            raise SystemExit(f"{name} inherits {parent}, which Snapmaker.json doesn't list")
        merged.update(own)
        merged["_kind"] = kind
        cache[name] = merged
        return merged

    for name in index:
        resolve(name)
    visible = {n: p for n, p in cache.items() if str(p.get("instantiation")).lower() == "true"}
    machines = {n: p for n, p in visible.items() if p["_kind"] == "machine" and p.get("printer_model") == "Snapmaker U1"}

    def keys(kind):
        return sorted({k for p in cache.values() if p["_kind"] == kind for k in p} - META_KEYS - {"_kind"})

    def compatible(p):
        return sorted(set(p.get("compatible_printers") or []) & set(machines))

    try:
        commit = subprocess.run(["git", "-C", checkout, "rev-parse", "HEAD"], capture_output=True,
                                text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = "unknown"
    snapshot = {
        "source": {"repository": "https://github.com/Snapmaker/OrcaSlicer", "commit": commit,
                   "vendor_profile_version": vendor.get("version")},
        "machines": {n: {k: p.get(k) for k in ("printer_model", "printer_variant", "nozzle_diameter",
                                               "printable_area", "printable_height")}
                     for n, p in sorted(machines.items())},
        "processes": {n: {"layer_height": p.get("layer_height"), "compatible_printers": compatible(p)}
                      for n, p in sorted(visible.items()) if p["_kind"] == "process" and compatible(p)},
        "filaments": {n: {"filament_type": (p.get("filament_type") or [None])[0],
                          "compatible_printers": compatible(p)}
                      for n, p in sorted(visible.items()) if p["_kind"] == "filament" and compatible(p)},
        "keys": {"process": keys("process"), "filament": keys("filament"), "machine": keys("machine")},
        "options": preset_options(checkout),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(snapshot, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(f"{len(snapshot['machines'])} U1 printers, {len(snapshot['processes'])} processes, "
          f"{len(snapshot['filaments'])} filaments -> {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
