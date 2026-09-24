"""
Static check of converted projects against Snapmaker Orca's own loader rules.

The converter has NOT been verified by opening its output in Snapmaker Orca.
These tests are the strictest check possible without running Orca itself:
each converted Metadata/project_settings.config is held to what Snapmaker
Orca's loader reads, and to Snapmaker's real U1 profiles.

Loader rules, from github.com/Snapmaker/OrcaSlicer at commit
da53bc5ffe47d7837ccdfde5f59a5ba1e9ec35f1:
  - bbs_3mf.cpp: Metadata/project_settings.config is read with
    ConfigBase::load_from_json.
  - Config.cpp load_from_json: each value must be a string or an array of
    strings (other values are skipped or rejected).
  - PresetBundle.cpp load_config_file_config: the filament count is the
    length of filament_colour; inherits_group and different_settings_to_system
    are resized to count + 2; slot 0 is the print profile, slots 1..count the
    filaments, slot count + 1 the printer.
  - Config.cpp unescape_strings_cstyle: each different_settings_to_system
    entry is a ';'-separated list of setting names.
  - Preset.cpp s_Preset_print_options / s_Preset_filament_options /
    s_Preset_printer_options: which setting names belong to each profile type.
    filament_colour is commented out of the filament list: it is a project
    setting, kept with the project whatever the kept-lists say.
  - PresetBundle.cpp adds its own ignore list to every kept-list, so the
    parent profile is always applied when inherits names a real profile.
The profile facts (names, compatible printers, setting names) are a snapshot
in tests/fixtures/snapmaker_u1_profiles.json, made by
tools/snapshot_snapmaker_profiles.py from the same commit.
"""

import io
import json
import os
import sys
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import converter_3mf   # noqa: E402
import sample_files    # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "snapmaker_u1_profiles.json")
with open(FIXTURE, encoding="utf-8") as _fh:
    ORCA = json.load(_fh)


def bambu(**changes):
    """The Bambu sample project's settings with some values changed."""
    with zipfile.ZipFile(io.BytesIO(sample_files.bambu_style_project())) as z:
        config = json.loads(z.read(converter_3mf.PROJECT_CONFIG))
    for key, value in changes.items():
        if value is None:
            config.pop(key, None)
        else:
            config[key] = value
    return sample_files._project_3mf("BambuStudio-02.00.00.00", config)


def split_keys(entry):
    """What unescape_strings_cstyle yields for a plain ';'-joined list."""
    return [k for k in entry.split(";") if k]


CASES = {
    "sample Bambu Studio project": sample_files.bambu_style_project,
    "sample Elegoo Slicer project": sample_files.elegoo_style_project,
    "one filament": lambda: bambu(filament_colour=["#FFFFFF"], filament_type=["PLA"],
                                  filament_settings_id=["Bambu PLA Basic @BBL X1C"]),
    "four filaments, mixed materials": lambda: bambu(
        filament_colour=["#FF0000", "#00FF00", "#0000FF", "#FFFFFF"],
        filament_type=["PLA", "PETG", "ABS", "TPU"], filament_settings_id=["a", "b", "c", "d"],
        filament_flow_ratio=["0.98", "1", "1", "1"], filament_retraction_length=["0.8", "0.8", "0.8", "1.2"],
        different_settings_to_system=["wall_loops", "filament_flow_ratio", "", "", "", "filament_retraction_length"]),
    "more filaments than toolheads": lambda: bambu(
        filament_colour=["#111111"] * 6, filament_type=["PLA"] * 6, filament_settings_id=["x"] * 6),
    "more types than colours": lambda: bambu(
        filament_colour=["#111111", "#222222"], filament_type=["PLA", "PETG", "ABS"],
        filament_settings_id=["a", "b", "c"]),
    "colours missing entirely": lambda: bambu(filament_colour=None),
    "0.2 nozzle": lambda: bambu(nozzle_diameter=["0.2"], layer_height="0.1"),
    "0.6 nozzle, PETG": lambda: bambu(nozzle_diameter=["0.6"], layer_height="0.3", filament_type=["PETG", "PETG"]),
    "0.8 nozzle, thick layers": lambda: bambu(nozzle_diameter=["0.8"], layer_height="0.4"),
    "unsupported 0.5 nozzle": lambda: bambu(nozzle_diameter=["0.5"]),
    "unknown material": lambda: bambu(filament_type=["UNOBTANIUM", "PLA"]),
    "no settings list at all": lambda: bambu(different_settings_to_system=None, inherits_group=None),
}


class ConverterAgainstOrcaLoader(unittest.TestCase):
    def converted(self, make):
        out, report = converter_3mf.convert(make())
        with zipfile.ZipFile(io.BytesIO(out)) as z:
            names = z.namelist()
            config = json.loads(z.read(converter_3mf.PROJECT_CONFIG))
        return config, report, names

    def test_fixture_is_the_snapshot_the_rules_came_from(self):
        self.assertEqual(ORCA["source"]["commit"], "da53bc5ffe47d7837ccdfde5f59a5ba1e9ec35f1")
        self.assertEqual(len(ORCA["machines"]), 4)

    def test_every_case_follows_the_loader_rules(self):
        for label, make in CASES.items():
            with self.subTest(label):
                config, report, names = self.converted(make)
                self.check(config, report, names)

    def check(self, config, report, names):
        # Values: strings or arrays of strings only (Config.cpp load_from_json).
        for key, value in config.items():
            ok = isinstance(value, str) or (isinstance(value, list) and all(isinstance(v, str) for v in value))
            self.assertTrue(ok, f"{key} = {value!r} would be skipped by Orca's JSON loader")

        # Slot layout (PresetBundle.cpp load_config_file_config).
        n = len(config.get("filament_colour") or [""])
        inherits, diffs = config["inherits_group"], config["different_settings_to_system"]
        self.assertEqual(len(inherits), n + 2, "inherits_group must be filament count + 2 long")
        self.assertEqual(len(diffs), n + 2, "different_settings_to_system must be filament count + 2 long")
        self.assertEqual(len(config["filament_settings_id"]), n, "one filament profile per colour")

        # Printer: a real U1 profile, and the machine settings match it exactly.
        printer = inherits[n + 1]
        self.assertEqual(config["printer_settings_id"], printer)
        self.assertIn(printer, ORCA["machines"], f"{printer} is not a Snapmaker U1 profile")
        machine = ORCA["machines"][printer]
        for key in ("printer_model", "printer_variant", "printable_area", "printable_height"):
            self.assertEqual(config[key], machine[key], key)

        # Print profile: real, visible, and made for this printer.
        process = inherits[0]
        self.assertEqual(config["print_settings_id"], process)
        self.assertIn(process, ORCA["processes"], f"{process} is not a Snapmaker U1 print profile")
        self.assertIn(printer, ORCA["processes"][process]["compatible_printers"])

        # Filaments: real, visible, made for this printer, same order.
        self.assertEqual(inherits[1:n + 1], config["filament_settings_id"])
        for name in config["filament_settings_id"]:
            self.assertIn(name, ORCA["filaments"], f"{name} is not a Snapmaker filament profile")
            self.assertIn(printer, ORCA["filaments"][name]["compatible_printers"],
                          f"{name} is not marked compatible with {printer}")

        # Kept settings: each list names settings Orca files under that
        # profile type, and each one really has a value in the project.
        kinds = ["process"] + ["filament"] * n + ["machine"]
        for i, (entry, kind) in enumerate(zip(diffs, kinds)):
            allowed = set(ORCA["options"][kind]) | ({"filament_colour"} if kind == "filament" else set())
            for key in split_keys(entry):
                self.assertIn(key, allowed, f"slot {i}: {key} is not a {kind} setting in Snapmaker Orca")
                self.assertIn(key, config, f"slot {i}: {key} is listed as kept but has no value in the project")
        self.assertIn("layer_height", split_keys(diffs[0]))
        self.assertEqual(len(config["filament_colour"]) if "filament_colour" in config else 1, n)
        for i in range(1, n + 1):
            self.assertIn("filament_colour", split_keys(diffs[i]))

        # No G-code sliced for the old printer survives.
        self.assertFalse([x for x in names if x.endswith(".gcode") or x == "Metadata/slice_info.config"])
        self.assertTrue(report["unverified"], "the report must keep saying this is not confirmed in Orca")

    def test_missing_colours_are_filled_and_said_out_loud(self):
        config, report, _ = self.converted(CASES["more types than colours"])
        self.assertEqual(config["filament_colour"], ["#111111", "#222222", "#FFFFFF"])
        self.assertEqual(config["inherits_group"][-1], "Snapmaker U1 (0.4 nozzle)")
        self.assertTrue(any("Filament 3 had no colour" in w for w in report["warnings"]))

    def test_layer_height_maps_to_the_nearest_real_profile(self):
        for nozzle, layer, expected in (("0.4", "0.2", "0.20mm Standard @Snapmaker U1 (0.4 nozzle)"),
                                        ("0.4", "0.09", "0.08mm Standard @Snapmaker U1 (0.4 nozzle)"),
                                        ("0.8", "0.4", "0.32mm Standard @Snapmaker U1 (0.8 nozzle)")):
            config, _, _ = self.converted(lambda: bambu(nozzle_diameter=[nozzle], layer_height=layer))
            self.assertEqual(config["print_settings_id"], expected)

    def test_every_profile_name_the_converter_can_emit_exists(self):
        for nozzle, options in converter_3mf.U1_PROCESSES.items():
            printer = f"Snapmaker U1 ({nozzle} nozzle)"
            self.assertIn(printer, ORCA["machines"])
            for name in options.values():
                self.assertIn(name, ORCA["processes"])
                self.assertIn(printer, ORCA["processes"][name]["compatible_printers"])
            for material, name in converter_3mf.U1_FILAMENTS[nozzle].items():
                self.assertIn(name, ORCA["filaments"], name)
                self.assertIn(printer, ORCA["filaments"][name]["compatible_printers"], name)
                self.assertEqual(ORCA["filaments"][name]["filament_type"], material, name)
        self.assertEqual(converter_3mf.U1_PRINTABLE_AREA, ORCA["machines"]["Snapmaker U1 (0.4 nozzle)"]["printable_area"])
        self.assertEqual(converter_3mf.U1_PRINTABLE_HEIGHT, ORCA["machines"]["Snapmaker U1 (0.4 nozzle)"]["printable_height"])
        self.assertEqual(converter_3mf.U1_TOOLHEADS, len(ORCA["machines"]["Snapmaker U1 (0.4 nozzle)"]["nozzle_diameter"]))


if __name__ == "__main__":
    unittest.main()
