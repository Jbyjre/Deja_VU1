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


class TestWhatTheEnginePrintsOnEveryRun(unittest.TestCase):
    def test_the_lines_printed_by_slices_that_work_are_never_given_as_the_reason(self):
        # The U1's preset lists one excluded area with a single point, so the engine says this twice on every run, even a good one
        # (read on a real Linux slice that finished). A Windows tester's report quoted it as the reason for a -50.
        text = ("[2026-11-22 11:35:39.765216] [0x00001ca4] [error]   Slic3r::GUI::PartPlate::calc_exclude_triangles:Unable to create exclude triangles\r\n\r\n"
                "[2026-11-22 11:35:39.766231] [0x00001ca4] [error]   calc_exclude_triangles:Unable to create exclude triangles\n\n"
                "[2026-11-22 11:35:39.767235] [0x00001ca4] [error]   plate 1: Nothing to be sliced, Either the print is empty or no object is "
                "fully inside the print volume before apply.\r\n\r\nSlic3r::CLI::run found error, exit")
        lines = diag.reason_lines(text)
        self.assertEqual(len(lines), 1)
        self.assertIn("Nothing to be sliced", lines[0])

    def test_a_real_problem_with_the_same_words_elsewhere_is_still_a_reason(self):
        self.assertEqual(diag.reason_lines("[error] could not create exclude triangles for the plate"),
                         ["[error] could not create exclude triangles for the plate"])


class TestCodesAProjectFromAnotherSlicerRaises(unittest.TestCase):
    def test_windows_and_macos_numbers_map_back_to_the_documented_codes(self):
        for code, number in ((4294967272, -24), (232, -24), (4294967273, -23), (4294967237, -59)):
            self.assertEqual(diag.orca_code(code), number)

    def test_each_has_words_and_something_to_try(self):
        import slicer_bridge
        for number in (-15, -16, -18, -19, -20, -21, -22, -23, -24, -59, -61, -62, -63, -64, -65):
            self.assertIn(number, slicer_bridge.ORCA_ERRORS)
            self.assertTrue(diag.ORCA_FIXES[number])

    def test_no_model_inside_the_plate_no_longer_says_to_add_one_first(self):
        import slicer_bridge
        self.assertNotIn("empty", slicer_bridge.ORCA_ERRORS[-50])
        self.assertIn("inside the plate", diag.ORCA_FIXES[-50][0])
        self.assertIn("empty", diag.ORCA_FIXES[-50][-1])


class TestOrcaNumbersFromHowTheProgramEnded(unittest.TestCase):
    """result.json is written on Linux only, so Windows and macOS give the exit code alone: -100 arrives as 4294967196 or 156."""

    def test_windows_reports_minus_100_as_an_unsigned_32_bit_number(self):
        self.assertEqual(diag.orca_code(4294967196), -100)           # 2**32 - 100, as a Windows tester's report showed
        self.assertEqual(diag.orca_code(4294967246), -50)
        self.assertEqual(diag.orca_code(4294967295), -1)

    def test_macos_and_linux_report_it_as_its_low_byte(self):
        self.assertEqual(diag.orca_code(156), -100)
        self.assertEqual(diag.orca_code(204), -52)
        self.assertEqual(diag.orca_code(255), -1)

    def test_an_ordinary_exit_code_is_never_taken_for_one(self):
        for code in (0, 1, 2, 3, 127, 126, 130, 4294967295 - 100000, None, True, "156"):
            self.assertIsNone(diag.orca_code(code), code)
        for signal_code in (-1, -6, -9, -11, -15, -100):               # on Linux and macOS a negative code is a signal: -6 is an abort, not Orca's -6
            self.assertIsNone(diag.orca_code(signal_code), signal_code)

    def test_the_reason_is_never_orcas_found_error_line(self):
        out = ("starting\n[warning] plate 1: found slicing warnings: Empty layers detected\nSlic3r::CLI::run found error, exit\n")
        self.assertEqual(diag.reason_lines(out), ["[warning] plate 1: found slicing warnings: Empty layers detected"])
        self.assertEqual(diag.reason_lines("", "Slic3r::CLI::run found error, return -100, exit..."), [])
        self.assertEqual(diag.reason_lines("a\nb\nc\nd\ne", limit=2), ["d", "e"])                 # no line names a problem: the last lines
        self.assertEqual(diag.reason_lines("x" * 500)[0], "x" * 240)

    def test_the_bridge_words_the_windows_code_with_the_reason(self):
        import slicer_bridge
        out = b"[warning] plate 1: found slicing warnings: Empty layers detected between 4.2 and 4.4\nSlic3r::CLI::run found error, exit\n"
        headline, cause = slicer_bridge.diagnose(4294967196, None, out, b"")
        self.assertEqual(headline, "Orca hit an error while slicing (Orca's code -100). It printed: "
                                   "[warning] plate 1: found slicing warnings: Empty layers detected between 4.2 and 4.4")
        self.assertEqual(cause["code"], "orca_-100")
        self.assertIn("Empty layers detected", cause["evidence"])
        self.assertTrue(any("slices on screen" in fix for fix in cause["fixes"]))
        # With only Orca's own line there is no reason to show, and the headline says so plainly rather than quoting the exit line.
        headline, cause = slicer_bridge.diagnose(4294967196, None, b"Slic3r::CLI::run found error, exit\n", b"")
        self.assertEqual(headline, "Orca hit an error while slicing (Orca's code -100)")


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
