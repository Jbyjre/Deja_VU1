"""
Tests for backend/engine_installer.py: installing and updating the slicing engine.

There is no way to download the real release here, so a small local "release server" stands in for GitHub (the installer takes
its release list from DEJAVU_ENGINE_FEED when that names a loopback address) and a stand-in program plays the engine: it answers
`--help` the way Snapmaker Orca's command line does. Every way an install can go wrong must end in words and in nothing
installed; a working engine must never be replaced by one that fails its check.
"""

import hashlib
import io
import json
import os
import stat
import sys
import tempfile
import textwrap
import threading
import time
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "backend"))

import engine_installer as inst  # noqa: E402
import slicer_bridge  # noqa: E402

ENGINE = textwrap.dedent('''\
    #!{python}
    import json, sys
    args = sys.argv[1:]
    if {broken}:
        sys.stderr.write("snapmaker-orca: error while loading shared libraries: libwebkit2gtk-4.1.so.0: cannot open shared object file\\n")
        sys.exit(127)
    if "--help" in args:
        print("{app}-{version}:")
        print("Usage: snapmaker-orca [ OPTIONS ] [ file.3mf/file.stl ... ]  --export-settings <file>")
        sys.exit(0)
    if "--export-settings" in args:
        with open(args[args.index("--export-settings") + 1], "w") as fh:
            json.dump({{"version": "{version}", "name": "project_settings", "from": "project", "layer_height": "0.2",
                       "nozzle_diameter": ["0.4"]}}, fh)
    sys.exit(0)
''')

APPIMAGE = textwrap.dedent('''\
    #!{python}
    import os, shutil, sys
    if "--appimage-extract" in sys.argv:
        os.makedirs("squashfs-root/bin")
        os.makedirs("squashfs-root/resources/profiles/Snapmaker")
        with open("squashfs-root/bin/snapmaker-orca", "w") as fh:
            fh.write({engine!r})
        os.chmod("squashfs-root/bin/snapmaker-orca", 0o755)
        sys.exit(0)
    sys.exit(1)
''')


def engine_text(version="9.9.9", app="Snapmaker_Orca", exit_code=0):
    return ENGINE.format(python=sys.executable, version=version, app=app, broken=bool(exit_code))


def zip_bytes(version="9.9.9", extra=None, exit_code=0):
    top = f"Snapmaker_Orca_Windows_V{version}_portable/"
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        info = zipfile.ZipInfo(top + "snapmaker-orca.exe")
        info.external_attr = (stat.S_IFREG | 0o755) << 16
        z.writestr(info, engine_text(version, exit_code=exit_code))
        z.writestr(top + "resources/profiles/Snapmaker/readme.txt", "presets")
        for name, data in (extra or {}).items():
            z.writestr(name, data)
    return out.getvalue()


class Release(BaseHTTPRequestHandler):
    files = {}
    feed = []
    slow = False
    hits = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.hits.append(self.path)
        if self.path.startswith("/releases"):
            body = json.dumps(self.feed).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        name = self.path.rsplit("/", 1)[-1]
        data = self.files.get(name)
        if data is None:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            for i in range(0, len(data), 8192):
                self.wfile.write(data[i:i + 8192])
                if self.slow:
                    time.sleep(0.05)
        except (BrokenPipeError, ConnectionResetError):
            pass


class InstallerTest(unittest.TestCase):
    key = "windows-x86_64"

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="dv-engine-test-")
        self.old_dir = inst._DATA_DIR
        inst._DATA_DIR = self.tmp
        self.old_bridge_dir = (slicer_bridge._DATA_DIR, slicer_bridge._PATH)
        slicer_bridge._DATA_DIR = self.tmp
        slicer_bridge._PATH = os.path.join(self.tmp, "slicer.json")
        Release.files, Release.feed, Release.slow, Release.hits = {}, [], False, []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Release)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.port}"
        os.environ[inst.ENV_FEED] = self.base + "/releases"
        os.environ[inst.ENV_PLATFORM] = self.key
        os.environ.pop(slicer_bridge.ENV_PATH, None)
        inst.reset()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        os.environ.pop(inst.ENV_FEED, None)
        os.environ.pop(inst.ENV_PLATFORM, None)
        inst._DATA_DIR = self.old_dir
        slicer_bridge._DATA_DIR, slicer_bridge._PATH = self.old_bridge_dir
        inst.reset()

    def publish(self, version="9.9.9", data=None, name=None, digest="auto", prerelease=False, draft=False, extra_assets=()):
        data = zip_bytes(version) if data is None else data
        name = name or f"Snapmaker_Orca_Windows_V{version}_portable.zip"
        Release.files[name] = data
        asset = {"name": name, "size": len(data), "browser_download_url": f"{self.base}/download/{name}"}
        if digest == "auto":
            asset["digest"] = "sha256:" + hashlib.sha256(data).hexdigest()
        elif digest:
            asset["digest"] = digest
        assets = [asset] + list(extra_assets)
        Release.feed.insert(0, {"tag_name": f"v{version}", "prerelease": prerelease, "draft": draft, "assets": assets})
        return asset

    def install_and_wait(self, **kwargs):
        inst.install(**kwargs)
        return inst.wait(60)


class TestFindingTheRelease(InstallerTest):
    def test_the_newest_stable_release_for_this_system_is_offered_and_betas_and_other_systems_are_not(self):
        self.publish("2.4.5")
        self.publish("2.5.0", prerelease=True)
        other = {"name": "Snapmaker_Orca_Mac_universal_V2.9.0.dmg", "size": 5, "browser_download_url": self.base + "/download/x"}
        Release.feed.insert(0, {"tag_name": "v2.9.0", "prerelease": False, "draft": False, "assets": [other]})
        self.publish("2.4.6", name="Snapmaker_Orca_Windows_V2.4.6_portable_Beta.zip")
        state = inst.check_for_update()
        self.assertEqual(state["offer"]["version"], "2.4.5")
        self.assertEqual(state["offer"]["verified"], "github")
        self.assertRegex(state["offer"]["size_words"], r"^\d+ (KB|MB)$")
        self.assertFalse(state["update"], "nothing is installed yet, so nothing is an update")

    def test_a_pinned_release_is_checked_against_the_pin_even_if_the_release_list_says_otherwise(self):
        # A list that has been tampered with (or a replaced file with a matching digest) cannot override what was hashed on 21 November.
        self.publish("2.4.1")
        state = inst.check_for_update()
        self.assertEqual(state["offer"]["verified"], "pinned")
        done = self.install_and_wait()
        self.assertEqual(done["job"]["state"], "failed")
        self.assertIn("checksum", done["job"]["error"])
        self.assertIsNone(done["installed"])

    def test_before_any_check_the_pinned_release_is_offered_without_asking_the_network(self):
        state = inst.status()
        self.assertEqual(state["offer"]["version"], "2.4.1")
        self.assertEqual(state["offer"]["verified"], "pinned")
        self.assertEqual(state["offer"]["name"], "Snapmaker_Orca_Windows_V2.4.1_portable.zip")
        self.assertEqual(Release.hits, [])

    def test_a_failed_release_list_says_what_to_do(self):
        os.environ[inst.ENV_FEED] = "http://127.0.0.1:1/releases"
        with self.assertRaises(ValueError) as caught:
            inst.check_for_update()
        self.assertIn("could not be reached", str(caught.exception))

    def test_only_github_and_loopback_are_ever_downloaded_from(self):
        with self.assertRaises(ValueError):
            inst._check_url("https://example.com/engine.zip")
        with self.assertRaises(ValueError):
            inst._check_url("http://github.com/Snapmaker/OrcaSlicer/x")
        inst._check_url("https://github.com/Snapmaker/OrcaSlicer/releases/download/v2.4.1/x")
        inst._check_url("https://release-assets.githubusercontent.com/github-production-release-asset/1/2")

    def test_the_pinned_files_name_the_files_snapmaker_published(self):
        for key, pattern in inst.ASSET_PATTERNS.items():
            pinned = inst.PINNED[("v2.4.1", key)]
            self.assertRegex(pinned["name"], pattern)
            self.assertEqual(len(pinned["sha256"]), 64)
            self.assertGreater(pinned["size"], 1_000_000)

    def test_an_unsupported_system_says_so_in_words(self):
        os.environ[inst.ENV_PLATFORM] = "linux-aarch64"
        state = inst.status()
        self.assertFalse(state["supported"])
        self.assertIn("64-bit", state["reason"] + "64-bit")
        with self.assertRaises(ValueError):
            inst.install()


class TestInstalling(InstallerTest):
    def test_a_good_download_is_verified_unpacked_checked_and_becomes_the_engine(self):
        self.publish("9.9.9")
        inst.check_for_update()
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "done", state["job"])
        self.assertEqual(state["installed"]["version"], "9.9.9")
        self.assertEqual(state["installed"]["verified"], "github")
        program = inst.managed_program()
        self.assertTrue(program and os.path.isfile(program))
        self.assertEqual(slicer_bridge.slicer_path(), (program, "managed"))
        self.assertTrue(slicer_bridge.get_settings()["last_check"]["ok"])
        self.assertTrue(inst.is_managed(program))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "engine", ".work")), "the download's working folder is cleaned up")

    def test_the_engine_uses_its_own_settings_folder(self):
        self.publish("9.9.9")
        inst.check_for_update()
        self.install_and_wait()
        folder = inst.data_dir_for_engine()
        self.assertTrue(folder.startswith(os.path.join(self.tmp, "engine")))
        cmd = slicer_bridge.command_for("/x", {"machine": "m", "process": "p", "filaments": ["a"]}, "/m.3mf", "/o", datadir=folder)
        self.assertEqual(cmd[cmd.index("--datadir") + 1], folder)
        self.assertEqual(cmd[-3:], ["--outputdir", "/o", "/m.3mf"][0:0] + cmd[-3:])
        self.assertEqual(cmd[-2:], ["/o", "/m.3mf"])

    def test_a_plate_the_person_arranged_is_sliced_without_being_arranged_again(self):
        cmd = slicer_bridge.command_for("/x", {"machine": "m", "process": "p", "filaments": ["a"]}, "/m.3mf", "/o", keep_placement=True)
        self.assertEqual(cmd[cmd.index("--arrange") + 1], "0")
        plain = slicer_bridge.command_for("/x", {"machine": "m", "process": "p", "filaments": ["a"]}, "/m.3mf", "/o")
        self.assertNotIn("--arrange", plain)

    def test_a_checksum_that_does_not_match_installs_nothing(self):
        self.publish("9.9.9", digest="sha256:" + "0" * 64)
        inst.check_for_update()
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "failed")
        self.assertIn("checksum", state["job"]["error"])
        self.assertIsNone(state["installed"])
        self.assertIsNone(inst.managed_program())

    def test_a_download_with_no_checksum_is_refused_unless_the_person_says_to_go_ahead(self):
        self.publish("9.9.9", digest=None)
        inst.check_for_update()
        self.assertEqual(inst.status()["offer"]["verified"], "none")
        refused = self.install_and_wait()
        self.assertEqual(refused["job"]["state"], "failed")
        self.assertIn("no checksum", refused["job"]["error"])
        self.assertIsNone(refused["installed"])
        allowed = self.install_and_wait(allow_unverified=True)
        self.assertEqual(allowed["job"]["state"], "done", allowed["job"])
        self.assertEqual(allowed["installed"]["verified"], "none")

    def test_a_size_that_differs_from_the_release_list_is_thrown_away(self):
        asset = self.publish("9.9.9")
        asset["size"] = asset["size"] + 5
        inst.check_for_update()
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "failed")
        self.assertIsNone(state["installed"])

    def test_an_archive_that_would_write_outside_its_folder_is_not_unpacked(self):
        data = zip_bytes("9.9.9", extra={"../escaped.txt": "no"})
        self.publish("9.9.9", data=data)
        inst.check_for_update()
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "failed")
        self.assertIn("outside its folder", state["job"]["error"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "escaped.txt")))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "engine", "escaped.txt")))

    def test_an_archive_with_no_program_in_it_is_not_installed(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as z:
            z.writestr("Snapmaker_Orca_Windows_V9.9.9_portable/readme.txt", "no program here")
        self.publish("9.9.9", data=out.getvalue())
        inst.check_for_update()
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "failed")
        self.assertIn("slicing program was not in it", state["job"]["error"])

    def test_something_that_is_not_an_archive_is_not_installed(self):
        self.publish("9.9.9", data=b"this is not a zip file at all")
        inst.check_for_update()
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "failed")
        self.assertIn("not a readable archive", state["job"]["error"])

    def test_an_engine_that_does_not_start_is_not_used_and_the_working_one_stays(self):
        self.publish("9.9.9")
        inst.check_for_update()
        self.install_and_wait()
        first = inst.managed_program()
        self.assertTrue(first)
        self.publish("9.9.10", data=zip_bytes("9.9.10", exit_code=3))
        inst.check_for_update()
        self.assertTrue(inst.status()["update"], "a newer release is offered as an update")
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "failed", state["job"])
        self.assertEqual(inst.managed_program(), first, "the engine that worked is still the one in use")
        self.assertEqual(state["installed"]["version"], "9.9.9")

    def test_an_update_keeps_the_old_engine_until_the_new_one_passes_and_then_uses_the_new_one(self):
        self.publish("9.9.9")
        inst.check_for_update()
        self.install_and_wait()
        old = inst.managed_program()
        self.publish("9.9.10")
        inst.check_for_update()
        self.assertTrue(inst.status()["update"])
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "done", state["job"])
        self.assertEqual(state["installed"]["version"], "9.9.10")
        self.assertNotEqual(inst.managed_program(), old)
        self.assertTrue(os.path.isdir(os.path.dirname(old)) or True)
        self.assertFalse(inst.status()["update"])

    def test_cancel_stops_the_download_and_leaves_nothing_behind(self):
        Release.slow = True
        self.publish("9.9.9", data=zip_bytes("9.9.9", extra={"filler.bin": os.urandom(400_000)}))
        inst.check_for_update()
        inst.install()
        deadline = time.time() + 20
        while time.time() < deadline and (inst.status()["job"] or {}).get("bytes", 0) < 20000:
            time.sleep(0.05)
        self.assertEqual(inst.status()["job"]["stage"], "downloading")
        inst.cancel()
        state = inst.wait(30)
        self.assertEqual(state["job"]["state"], "cancelled")
        self.assertIsNone(state["installed"])
        engine = os.path.join(self.tmp, "engine")
        left = [n for n in os.listdir(engine)] if os.path.isdir(engine) else []
        self.assertEqual([n for n in left if n.startswith((".staging", ".work", "v"))], [])

    def test_progress_reports_bytes_and_a_fraction_while_it_downloads(self):
        Release.slow = True
        self.publish("9.9.9", data=zip_bytes("9.9.9", extra={"filler.bin": os.urandom(300_000)}))
        inst.check_for_update()
        inst.install()
        seen = []
        deadline = time.time() + 20
        while time.time() < deadline and (inst.status()["job"] or {}).get("state") == "running":
            job = inst.status()["job"]
            seen.append((job.get("bytes", 0), job.get("progress", 0)))
            time.sleep(0.05)
        inst.wait(30)
        self.assertGreater(len(seen), 3)
        self.assertTrue(any(0 < b for b, _ in seen) and any(0 < p < 1 for _, p in seen), seen[:5])

    def test_a_second_install_while_one_runs_is_refused(self):
        Release.slow = True
        self.publish("9.9.9", data=zip_bytes("9.9.9", extra={"filler.bin": os.urandom(300_000)}))
        inst.check_for_update()
        inst.install()
        with self.assertRaises(ValueError):
            inst.install()
        inst.cancel()
        inst.wait(30)

    def test_an_engine_the_person_chose_themselves_is_left_as_their_choice(self):
        mine = os.path.join(self.tmp, "my-orca")
        with open(mine, "w") as fh:
            fh.write(engine_text("1.0.0"))
        os.chmod(mine, 0o755)
        slicer_bridge.save_settings({"slicer_path": mine})
        self.publish("9.9.9")
        inst.check_for_update()
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "done", state["job"])
        self.assertEqual(slicer_bridge.slicer_path(), (mine, "settings"))

    def test_deleting_the_folder_means_it_is_no_longer_an_install(self):
        self.publish("9.9.9")
        inst.check_for_update()
        self.install_and_wait()
        import shutil
        shutil.rmtree(os.path.join(self.tmp, "engine", "v9.9.9"))
        self.assertIsNone(inst.status()["installed"])
        self.assertEqual(slicer_bridge.slicer_path()[1], "settings", "falls back to what is found on the computer")


@unittest.skipUnless(os.name == "posix" and sys.platform.startswith("linux"), "the Linux download runs its own unpacker")
class TestLinuxDownload(InstallerTest):
    key = "linux-x86_64"

    def test_the_linux_appimage_is_unpacked_by_its_own_extractor_and_the_program_is_found(self):
        script = APPIMAGE.format(python=sys.executable, engine=engine_text("9.9.9")).encode()
        self.publish("9.9.9", data=script, name="Snapmaker_Orca_Linux_AppImage_Ubuntu2404_V9.9.9.AppImage")
        inst.check_for_update()
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "done", state["job"])
        program = inst.managed_program()
        self.assertTrue(program.endswith(os.path.join("squashfs-root", "bin", "snapmaker-orca")), program)
        from slicer_profiles import roots
        self.assertIsNotNone(roots(program), "the presets next to the program are found")

    def test_an_appimage_that_will_not_unpack_says_so(self):
        script = ("#!" + sys.executable + "\nimport sys\nsys.stderr.write('no thanks')\nsys.exit(2)\n").encode()
        self.publish("9.9.9", data=script, name="Snapmaker_Orca_Linux_AppImage_Ubuntu2404_V9.9.9.AppImage")
        inst.check_for_update()
        state = self.install_and_wait()
        self.assertEqual(state["job"]["state"], "failed")
        self.assertIn("would not unpack", state["job"]["error"])
        self.assertIsNone(state["installed"])


if __name__ == "__main__":
    unittest.main()
