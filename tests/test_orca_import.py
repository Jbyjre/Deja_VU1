"""Finding your own Orca presets and recent projects, and bringing them in."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import file_library   # noqa: E402
import orca_import    # noqa: E402
import slicer_bridge  # noqa: E402


class OrcaFolder(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "Snapmaker_Orca"
        user = self.root / "user" / "default"
        for kind, name, extra in (("machine", "My U1 0.4", {"inherits": "Snapmaker U1 (0.4 nozzle)"}),
                                  ("process", "Fast 0.24", {"inherits": "0.20mm Standard @Snapmaker U1"}),
                                  ("filament", "Sunlu PLA", {})):
            (user / kind).mkdir(parents=True)
            (user / kind / f"{name}.json").write_text(json.dumps({"name": name, "type": kind, "from": "User", **extra}))
        (user / "process" / "broken.json").write_text("{not json")
        self.project = Path(tmp.name) / "projects" / "Gridfinity bins.3mf"
        self.project.parent.mkdir()
        self.project.write_bytes(b"PK\x03\x04 not really a project")
        conf = {"app": {"language": "en"}, "recent_projects": {"001": str(self.project), "002": str(Path(tmp.name) / "gone.3mf")}}
        (self.root / "Snapmaker_Orca.conf").write_text(json.dumps(conf) + "\n# MD5 checksum 0123456789abcdef\n")
        env = patch.dict(os.environ, DEJAVU_ORCA_DIR=str(self.root))
        env.start()
        self.addCleanup(env.stop)

    def test_presets_and_projects_are_found_without_paths_reaching_the_browser(self):
        out = orca_import.public()
        self.assertTrue(out["found"])
        app = out["apps"][0]
        self.assertEqual([p["name"] for p in app["presets"]["machine"]], ["My U1 0.4"])
        self.assertTrue(app["presets"]["machine"][0]["u1"])
        self.assertEqual([p["name"] for p in app["presets"]["process"]], ["Fast 0.24"])   # the broken file is skipped
        self.assertEqual([p["name"] for p in app["projects"]], ["Gridfinity bins.3mf"])  # a missing file is skipped
        self.assertNotIn(str(self.root), json.dumps(out))
        self.assertNotIn(str(self.project.parent), json.dumps(out))

    def test_a_profile_uses_the_presets_where_they_are(self):
        app = orca_import.public()["apps"][0]["presets"]
        with patch.object(slicer_bridge, "add_profile", return_value={"id": "prof-x"}) as add:
            orca_import.import_profile({"name": "My U1", "machine": app["machine"][0]["id"],
                                        "process": app["process"][0]["id"], "filaments": [app["filament"][0]["id"]]})
        name, machine, process, filaments = add.call_args[0]
        self.assertEqual(name, "My U1")
        self.assertTrue(machine.endswith("My U1 0.4.json") and process.endswith("Fast 0.24.json"))
        self.assertEqual(len(filaments), 1)
        with self.assertRaisesRegex(ValueError, "process"):
            orca_import.import_profile({"machine": app["machine"][0]["id"], "process": "nope", "filaments": []})

    def test_projects_are_copied_into_files(self):
        pid = orca_import.public()["apps"][0]["projects"][0]["id"]
        with patch.object(file_library, "save", return_value={"name": "Gridfinity bins.3mf"}) as save:
            out = orca_import.import_projects([pid, "unknown"])
        self.assertEqual(out["added"], ["Gridfinity bins.3mf"])
        self.assertEqual(len(out["skipped"]), 1)
        self.assertEqual(save.call_args[0][1], self.project.read_bytes())

    def test_no_slicer_found_is_said_plainly(self):
        with patch.dict(os.environ, DEJAVU_ORCA_DIR=str(self.root / "nope")):
            self.assertFalse(orca_import.public()["found"])


if __name__ == "__main__":
    unittest.main()
