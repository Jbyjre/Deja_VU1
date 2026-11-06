"""
Why a slice or an engine check failed, in words (backend/slice_diagnosis.py).

The texts here are the lines real failing programs print: the Linux loader's
"cannot open shared object file", an AppImage without FUSE 2, GTK without a
screen. The Windows exit codes are the documented NTSTATUS values; no Windows
computer was used, so those tests prove the mapping, not a real run.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

import slice_diagnosis as diag  # noqa: E402

LOADER = ("/opt/snapmaker-orca/bin/snapmaker-orca: error while loading shared libraries: "
          "libwebkit2gtk-4.1.so.0: cannot open shared object file: No such file or directory")


class TestFromText(unittest.TestCase):
    def test_a_missing_library_is_named_with_the_package_that_provides_it(self):
        cause = diag.from_text(LOADER)
        self.assertEqual(cause["code"], "missing_library")
        self.assertIn("libwebkit2gtk-4.1.so.0", cause["title"])
        self.assertEqual(cause["command"], "sudo apt-get install libwebkit2gtk-4.1-0")
        self.assertIn("libwebkit2gtk-4.1-0", cause["fixes"][0])
        self.assertIn("cannot open shared object file", cause["evidence"])
        self.assertTrue(cause["repairable"])

    def test_the_other_libraries_the_linux_engine_needs(self):
        script = diag.from_text("orca: error while loading shared libraries: libjavascriptcoregtk-4.1.so.0: "
                                "cannot open shared object file: No such file or directory")
        self.assertEqual(script["command"], "sudo apt-get install libjavascriptcoregtk-4.1-0")
        # Debian's package is libmspack0 and Ubuntu 24.04's is libmspack0t64, so no single name is given.
        mspack = diag.from_text("orca: error while loading shared libraries: libmspack.so.0: "
                                "cannot open shared object file: No such file or directory")
        self.assertIsNone(mspack["command"])
        self.assertIn("search your package manager for libmspack", mspack["fixes"][0])

    def test_a_library_with_no_checked_package_gets_no_guessed_name(self):
        cause = diag.from_text("orca: error while loading shared libraries: libfoo.so.3: "
                               "cannot open shared object file: No such file or directory")
        self.assertEqual(cause["code"], "missing_library")
        self.assertIsNone(cause["command"])
        self.assertIn("package that provides libfoo.so.3", cause["fixes"][0])

    def test_an_appimage_without_fuse_is_not_reported_as_a_missing_library(self):
        for text in ("dlopen(): error loading libfuse.so.2\n\nAppImages require FUSE to run.",
                     "orca.AppImage: error while loading shared libraries: libfuse.so.2: "
                     "cannot open shared object file: No such file or directory"):
            self.assertEqual(diag.from_text(text)["code"], "needs_fuse", text)

    def test_a_system_too_old_names_the_version_it_asked_for(self):
        cause = diag.from_text("./orca: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found "
                               "(required by ./orca)")
        self.assertEqual(cause["code"], "system_too_old")
        self.assertIn("GLIBC_2.38", cause["title"])

    def test_macos_loader(self):
        cause = diag.from_text("dyld[4412]: Library not loaded: @rpath/libwx_baseu-3.2.dylib\n  Referenced from: orca")
        self.assertEqual(cause["code"], "missing_library")
        self.assertIn("libwx_baseu-3.2.dylib", cause["title"])

    def test_no_screen(self):
        cause = diag.from_text("Gtk-WARNING **: 10:02:11.123: cannot open display: ")
        self.assertEqual(cause["code"], "no_display")
        self.assertIn("xvfb-run", " ".join(cause["fixes"]))

    def test_out_of_memory(self):
        cause = diag.from_text("terminate called after throwing an instance of 'std::bad_alloc'\n"
                               "  what():  std::bad_alloc")
        self.assertEqual(cause["code"], "out_of_memory")

    def test_ordinary_output_is_not_a_cause(self):
        self.assertIsNone(diag.from_text("OrcaSlicer-2.4.2:\nUsage: orca-slicer [ OPTIONS ]"))
        self.assertIsNone(diag.from_text(""))
        self.assertIsNone(diag.from_text(None))

    def test_the_evidence_is_the_one_line_that_matched(self):
        cause = diag.from_text("starting\n" + LOADER + "\nmore text after")
        self.assertEqual(cause["evidence"], LOADER.strip())


class TestFromExit(unittest.TestCase):
    def test_signals_on_posix(self):
        self.assertEqual(diag.from_exit(-11, "posix")["title"],
                         "The slicer stopped unexpectedly (segmentation fault, signal 11)")
        killed = diag.from_exit(-9, "posix")
        self.assertIn("out-of-memory", killed["detail"])
        self.assertTrue(killed["repairable"])
        self.assertFalse(diag.from_exit(-11, "posix")["repairable"])

    def test_a_negative_code_means_nothing_on_windows_and_a_plain_code_nothing_anywhere(self):
        self.assertIsNone(diag.from_exit(-11, "nt"))
        self.assertIsNone(diag.from_exit(3, "posix"))
        self.assertIsNone(diag.from_exit(0, "posix"))
        self.assertIsNone(diag.from_exit(None, "posix"))
        self.assertIsNone(diag.from_exit("failed", "posix"))

    def test_windows_codes_in_both_forms_python_may_return(self):
        for code in (0xC0000135, 0xC0000135 - 2 ** 32):
            cause = diag.from_exit(code, "nt")
            self.assertEqual(cause["code"], "dll_missing")
            self.assertIn("0xC0000135", cause["title"])
        self.assertEqual(diag.from_exit(0xC000007B, "nt")["code"], "bad_image")
        self.assertEqual(diag.from_exit(0xC0000005, "nt")["code"], "crashed")
        self.assertIsNone(diag.from_exit(0xC0000999, "nt"))


class TestFromStart(unittest.TestCase):
    def test_a_file_the_system_cannot_run(self):
        self.assertEqual(diag.from_start(8, "Exec format error")["code"], "wrong_program")
        self.assertEqual(diag.from_start(22, "invalid", winerror=193)["code"], "wrong_program")

    def test_a_file_that_is_there_but_will_not_start(self):
        cause = diag.from_start(2, "No such file or directory", name="orca-slicer")
        self.assertEqual(cause["code"], "loader_missing")
        self.assertIn("orca-slicer", cause["title"])

    def test_permission_and_anything_else(self):
        self.assertEqual(diag.from_start(13, "Permission denied")["code"], "permission")
        other = diag.from_start(5, "Input/output error")
        self.assertEqual((other["code"], other["detail"]), ("cannot_start", "Input/output error"))


class TestOrcaCodes(unittest.TestCase):
    def test_orca_words_and_its_own_text_both_survive(self):
        cause = diag.from_orca(-52, "Part of the model is outside the printable area", "over the boundary")
        self.assertEqual(cause["code"], "orca_-52")
        self.assertEqual(cause["title"],
                         "Part of the model is outside the printable area. Orca said: over the boundary")
        self.assertIn("inside the build plate", cause["fixes"][0])

    def test_every_error_code_the_bridge_words_has_a_fix(self):
        import slicer_bridge
        missing = sorted(set(slicer_bridge.ORCA_ERRORS) - set(diag.ORCA_FIXES))
        self.assertEqual(missing, [], "a code with words but nothing to try")


class TestWhatAReportHolds(unittest.TestCase):
    def test_the_home_folder_is_hidden_in_every_spelling(self):
        home = os.path.expanduser("~")
        if len(home) < 2:
            self.skipTest("no home folder to hide")
        self.assertEqual(diag.redact(f"{home}/Downloads/orca"), "~/Downloads/orca")
        self.assertEqual(diag.redact(f"{home}\\x".replace("/", "\\")).startswith("~"), True)
        self.assertEqual(diag.redact(None), "")

    def test_a_long_log_keeps_its_first_error_and_its_last_words(self):
        text = "FIRST ERROR\n" + "x" * 10000 + "\nLAST WORDS"
        window = diag.log_window(text.encode(), limit=300)
        self.assertIn("FIRST ERROR", window["text"])
        self.assertIn("LAST WORDS", window["text"])
        self.assertEqual((window["characters"], window["left_out"]), (len(text), len(text) - 300))
        self.assertLess(len(window["text"]), 400)

    def test_a_short_log_is_whole(self):
        window = diag.log_window(b"all of it")
        self.assertEqual((window["text"], window["left_out"]), ("all of it", 0))

    def test_every_stage_has_words_and_an_unknown_one_reads_as_not_started(self):
        for stage, label in diag.STAGES:
            self.assertEqual(diag.stage_label(stage), label)
        self.assertEqual(diag.stage_label(None), "Not started")

    def test_file_facts_identify_the_input_without_holding_it(self):
        facts = diag.file_facts("part.stl", "stl", b"abc", None)
        self.assertEqual((facts["bytes"], facts["sha256"]), (3, "ba7816bf8f01cfea"))


if __name__ == "__main__":
    unittest.main()
