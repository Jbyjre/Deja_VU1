"""
Translations: the scanner that lists the words on screen, the catalogue it writes, and the commands that hand missing words to a
translator and check what comes back (tools/i18n_scan.py, tools/i18n.py, frontend/strings/).

Nothing here needs a browser or the internet. The page side (frontend/i18n.js) is checked in a browser by tests/test_i18n_browser.py.
"""

import contextlib
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
import i18n_scan as scan  # noqa: E402

_spec = importlib.util.spec_from_file_location("i18n_tool", os.path.join(ROOT, "tools", "i18n.py"))
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)

STRINGS = os.path.join(ROOT, "frontend", "strings")


def texts(source):
    """What the scanner takes from a script."""
    out = []
    for lit in scan.lex(source):
        out += scan._collect(lit.text, lit.call)
    return out


class TestFindingWords(unittest.TestCase):
    def test_quoted_and_template_strings_that_read_as_words_are_found(self):
        found = texts("toast('Needs you'); const a = \"Couldn't change\"; label = `Saved ${name} to ${where}`;")
        self.assertEqual(found, ["Needs you", "Couldn't change", "Saved {0} to {1}"])

    def test_a_sentence_made_of_pieces_numbers_them_in_order_and_strings_inside_the_pieces_are_found_too(self):
        found = texts("x = `${a} is ${on ? 'switched on' : 'switched off'} now`;")
        self.assertIn("{0} is {1} now", found)
        self.assertIn("switched on", found)
        self.assertIn("switched off", found)

    def test_names_paths_styles_selectors_codes_and_numbers_are_left_out(self):
        for text in ["ov-printers", "#tab-overview", ".card-head", "/api/printer", "https://example.com/x", "a.b.c", "M12 4l9 16H3zM12 10v4",
                     "rgba(0, 0, 0, .5)", "1px solid #ccc", "section.card, section.stats", "SET_LED LED={0} WHITE={1}",
                     "image/png", "KB", "12.5", "{0}", "(max-width: 720px)", "is-open tab-panel", "getUpdates", "PLA",
                     "attribute vec3 p; void main(){ gl_Position = vec4(p, 1.0); }"]:
            self.assertEqual(texts(f"x = {json.dumps(text)};"), [], text)

    def test_short_words_that_are_made_of_svg_path_letters_are_still_words(self):
        # "Save" and "Set" are built only from letters a path may use; a path needs a digit.
        self.assertEqual(texts("a = 'Save'; b = 'Set';"), ["Save", "Set"])

    def test_plain_lowercase_phrases_are_words_but_one_lowercase_word_is_a_name(self):
        self.assertEqual(texts("a = 'no spool reported'; b = 'heater off'; c = 'waiting'; d = 'attention';"), ["no spool reported", "heater off"])

    def test_object_keys_and_case_labels_are_not_words(self):
        self.assertEqual(texts("const m = { 'digital twin': 1, 'Needs you': 2 }; switch (x) { case 'Needs you': break; }"), [])
        self.assertEqual(texts("const m = { title: 'Needs you' };"), ["Needs you"])

    def test_i18n_t_takes_its_text_whatever_it_looks_like(self):
        self.assertEqual(texts("I18n.t('on'); I18n.t('Saved {name}', { name })"), ["on", "Saved {name}"])

    def test_comments_and_regular_expressions_hide_nothing_and_add_nothing(self):
        found = texts("// 'Not a word here'\n/* 'nor here' */ const re = /it's \"fine\"/g; a = 'Real words';")
        self.assertEqual(found, ["Real words"])

    def test_escapes_and_entities_are_read_the_way_the_page_will(self):
        self.assertEqual(texts(r"a = 'It’s here'; b = 'Save &amp; close';"), ["It’s here", "Save & close"])

    def test_the_words_inside_html_are_found_and_code_is_not(self):
        html = ('<p>Press <b>Home</b> first.</p><button title="Open it" aria-label="Open">x</button>'
                '<pre>curl -s http://localhost</pre><code>M112</code><kbd>Ctrl</kbd><p translate="no">Deja Vu1</p>'
                '<input placeholder="Search everything"><script>var a = "Not words";</script>')
        found = texts(f"el.innerHTML = '{html}';")
        for want in ("Press", "Home", "first.", "Open it", "Open", "Search everything"):
            self.assertIn(want, found)
        for no in ("curl -s http://localhost", "M112", "Ctrl", "Deja Vu1", "Not words"):
            self.assertNotIn(no, found)

    def test_the_small_words_between_tags_are_found(self):
        found = texts("el.innerHTML = '<b>3</b> printing <i>of</i> <b>4</b> or <u>paused</u>';")
        for want in ("printing", "of", "or", "paused"):
            self.assertIn(want, found)

    def test_an_icon_stuck_to_a_label_is_not_part_of_the_text(self):
        found = texts("el.innerHTML = `<button>${icon}Sync</button><p>${name} printing</p>`;")
        self.assertIn("Sync", found)
        self.assertNotIn("{0}Sync", found)
        self.assertIn("{1} printing", found)           # a space: the piece may be a name, so both forms are listed
        self.assertIn("printing", found)

    def test_attributes_alone_in_a_string_give_their_words(self):
        self.assertEqual(texts("a = `disabled title=\"Fix the loaded filament first\"`;"), ["Fix the loaded filament first"])

    def test_a_template_with_too_little_text_around_its_pieces_is_not_a_sentence(self):
        for template in ("`${a} KB`", "`${a}${b}`", "`${a} · ${b}`"):
            self.assertEqual(texts(f"x = {template};"), [], template)

    def test_whitespace_is_collapsed_the_way_the_page_matches_it(self):
        self.assertEqual(texts("a = `  Two\n     lines   here `;"), ["Two lines here"])

    def test_the_servers_own_sentences_are_found_without_docstrings_and_with_pieces_numbered(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "m.py")
            with open(path, "w", encoding="utf-8") as f:
                f.write('"""A module docstring that is not shown."""\n\ndef f(x):\n    """Not shown either."""\n'
                        '    raise ValueError(f"Target must be between {x} and {x + 1}")\n    return "Bed leveling check"\n')
            self.assertEqual(sorted(scan.scan_python(path)), ["Bed leveling check", "Target must be between {0} and {1}"])


class TestTheCatalogue(unittest.TestCase):
    def test_a_key_is_made_from_the_words_so_changed_words_get_a_new_key(self):
        self.assertEqual(scan.key_for("Needs you"), scan.key_for("Needs you"))
        self.assertNotEqual(scan.key_for("Needs you"), scan.key_for("Need you"))
        self.assertEqual(len(scan.key_for("x")), scan.KEY_LEN)

    def test_two_texts_that_share_a_short_key_get_longer_ones(self):
        old = scan.KEY_LEN
        scan.KEY_LEN = 1                                   # 16 possible keys, so 60 texts must collide
        try:
            made = scan.catalogue({f"Text number {i}": [] for i in range(60)})
        finally:
            scan.KEY_LEN = old
        self.assertEqual(len(made), 60)
        self.assertEqual(sorted(made.values()), sorted(f"Text number {i}" for i in range(60)))

    def test_the_same_words_in_two_files_are_one_entry_with_both_places(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ("a.js", "b.js"):
                with open(os.path.join(d, name), "w", encoding="utf-8") as f:
                    f.write("x = 'Needs you';")
            found = scan.scan(frontend=d, backend=d)
        self.assertEqual(found, {"Needs you": ["a.js", "b.js"]})

    def test_the_shipped_english_file_is_well_formed(self):
        with open(os.path.join(STRINGS, "en.json"), encoding="utf-8") as f:
            en = json.load(f)
        self.assertGreater(len(en), 3000)
        self.assertEqual(len(set(en.values())), len(en), "the same words listed twice")
        for key, text in en.items():
            self.assertTrue(scan.key_for(text).startswith(key) or len(key) > scan.KEY_LEN, f"{key} is not made from {text!r}")
            self.assertEqual(text, scan.normalise(text), f"{key}: spaces are collapsed and trimmed")
        for must in ("Needs you", "Halt", "Temperatures", "Save", "Sync", "heater off", "Each file passes the Confirm Print check before it starts"):
            self.assertIn(must, en.values(), must)

    def test_the_language_list_is_valid_and_names_languages_the_translator_knows(self):
        with open(os.path.join(STRINGS, "languages.json"), encoding="utf-8") as f:
            data = json.load(f)
        codes = [item["code"] for item in data["languages"]]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertGreaterEqual(len(codes), 10)
        for item in data["languages"]:
            self.assertEqual(sorted(item), ["code", "dir", "name", "native"])
            self.assertEqual(item["dir"], "ltr", "right-to-left languages wait until the layout can be mirrored")
            self.assertIn(item["code"], tool.translate.LANGUAGES, item["code"])
        self.assertNotIn("en", codes)
        self.assertEqual([item["code"] for item in data["later"]], ["ar", "he"])

    def test_every_stored_translation_passes_the_checks_and_the_list_in_meta_matches_the_files(self):
        with open(os.path.join(STRINGS, "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
        with open(os.path.join(STRINGS, "en.json"), encoding="utf-8") as f:
            en = json.load(f)
        self.assertEqual(meta["strings"], len(en), "run: python3 tools/i18n.py meta")
        files = sorted(n[:-5] for n in os.listdir(STRINGS) if n.endswith(".json") and n not in ("en.json", "languages.json", "meta.json"))
        self.assertEqual(sorted(meta["languages"]), files)
        for code in files:
            good, bad, _stale = tool.check_language(code)
            self.assertEqual(bad, [], f"{code}: {bad[:3]}")
            with open(os.path.join(STRINGS, code + ".json"), encoding="utf-8") as f:
                have = json.load(f)
            self.assertEqual(meta["languages"][code]["translated"], len([k for k in have if k in en]), code)

    def test_the_page_and_the_scanner_agree_on_which_attributes_carry_words(self):
        with open(os.path.join(ROOT, "frontend", "i18n.js"), encoding="utf-8") as f:
            js = f.read()
        attrs = re.search(r"const ATTRS = \[([^\]]*)\]", js).group(1)
        self.assertEqual(re.findall(r"'([^']+)'", attrs), list(scan.ATTRS))
        skip = re.search(r"const SKIP = '([^']*)'", js).group(1)
        for tag in scan.NOT_WORDS:
            self.assertIn(tag, skip)

    def test_the_page_loads_the_loader_early_and_has_the_picker(self):
        with open(os.path.join(ROOT, "frontend", "index.html"), encoding="utf-8") as f:
            html = f.read()
        head = html[:html.index("</head>")]
        self.assertLess(head.index("theme-boot.js"), head.index('<script src="i18n.js"></script>'))
        self.assertIn('id="language-choice"', html)
        self.assertIn('id="language-note"', html)


class TestTheCodeNeverReadsItsOwnEnglish(unittest.TestCase):
    def test_no_script_compares_what_is_on_screen_with_an_english_word(self):
        # A page in another language shows other words, so a heading found by its English text, or a button compared with "On", stops working.
        # Use I18n.same(text, 'English'), I18n.source(text) or I18n.englishText(element) instead (docs/translating.md).
        pattern = re.compile(r"(?:textContent|innerText)(?:\.trim\(\))?\s*(?:===|!==|==|!=)\s*['\"`(]")
        found = []
        frontend = os.path.join(ROOT, "frontend")
        for name in sorted(os.listdir(frontend)):
            if name.endswith(".js") and not name.startswith(("tester", "games")):
                with open(os.path.join(frontend, name), encoding="utf-8") as f:
                    for number, line in enumerate(f, 1):
                        if pattern.search(line):
                            found.append(f"{name}:{number}: {line.strip()[:90]}")
        self.assertEqual(found, [])


class TestChecksOnATranslation(unittest.TestCase):
    keep = ["Deja Vu1", "G-code"]

    def test_a_good_translation_passes(self):
        self.assertEqual(tool.why_not("Open {0} in Deja Vu1", "Öffne {0} in Deja Vu1", self.keep), [])
        self.assertEqual(tool.why_not("Send `M112` now", "Jetzt `M112` senden", self.keep), [])
        self.assertEqual(tool.why_not("<b>Home</b> first", "Zuerst <b>Home</b>", self.keep), [])

    def test_a_lost_changed_or_extra_placeholder_tag_code_or_link_is_refused(self):
        for source, result in [("Open {0}", "Öffnen"), ("Open {0}", "Öffne {1}"), ("Open {0}", "Öffne {0} {0}"),
                               ("<b>Home</b>", "Home"), ("Send `M112`", "Senden `M113`"), ("See https://a.b/c", "Siehe https://a.b/d"),
                               ("Press [[heads]]", "Drücke [[Köpfe]]"), ("Used %s", "Benutzt")]:
            self.assertTrue(tool.why_not(source, result, self.keep), (source, result))

    def test_a_kept_name_must_stay_as_written(self):
        self.assertTrue(tool.why_not("Open Deja Vu1", "Öffne Déjà Vu", self.keep))
        self.assertTrue(tool.why_not("Print the G-code", "Drucke den G-Code", self.keep))
        self.assertEqual(tool.why_not("Print", "Drucken", self.keep), [])

    def test_empty_runaway_leftover_marks_and_changed_line_breaks_are_refused(self):
        for result in ("", "   ", None, 5, "x" * 500, "⟦0⟧ Drucken"):
            self.assertTrue(tool.why_not("Print", result, self.keep), repr(result))
        self.assertTrue(tool.why_not("One\nTwo", "Eins Zwei", self.keep))


class TestTheCommands(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        d = self.dir.name
        self.old = (tool.STRINGS, tool.EN, tool.LANGUAGES, tool.META, tool.i18n_scan.scan, tool.head_sha)
        tool.STRINGS, tool.EN = d, os.path.join(d, "en.json")
        tool.LANGUAGES, tool.META = os.path.join(d, "languages.json"), os.path.join(d, "meta.json")
        tool.head_sha = lambda: "abc123"
        self.en = {scan.key_for(t): t for t in ("Needs you", "Open {0} in Deja Vu1", "Heater off", "Back")}
        self.a, self.b, self.c, self.d = list(self.en)
        self.write("en.json", self.en)
        self.write("languages.json", {"languages": [{"code": "de", "name": "German", "native": "Deutsch", "dir": "ltr"},
                                                     {"code": "fr", "name": "French", "native": "Français", "dir": "ltr"}]})
        tool.i18n_scan.scan = lambda: {text: ["x.js"] for text in self.en.values()}
        self.glossary_path = os.path.join(d, "glossary.json")
        with open(tool.translate.GLOSSARY, encoding="utf-8") as src, open(self.glossary_path, "w", encoding="utf-8") as dst:
            dst.write(src.read())
        self.real_glossary = tool.translate.GLOSSARY
        tool.translate.GLOSSARY = self.glossary_path           # a merge that saves screen names must never touch the real glossary
        self.addCleanup(self.restore)

    def restore(self):
        tool.translate.GLOSSARY = self.real_glossary
        tool.STRINGS, tool.EN, tool.LANGUAGES, tool.META, tool.i18n_scan.scan, tool.head_sha = self.old

    def write(self, name, data):
        with open(os.path.join(self.dir.name, name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

    def read(self, name):
        with open(os.path.join(self.dir.name, name), encoding="utf-8") as f:
            return json.load(f)

    def run_tool(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = tool.main(list(argv))
        return code, out.getvalue()

    def test_todo_lists_only_what_a_language_lacks_with_instructions_and_context(self):
        path = os.path.join(self.dir.name, "todo.json")
        code, said = self.run_tool("todo", "de", "--out", path)
        self.assertEqual(code, 0)
        todo = self.read("todo.json")
        self.assertEqual(todo["items"], self.en)
        self.assertEqual(todo["language_name"], "German")
        self.assertIn("Never translate these names", todo["instructions"])
        self.assertEqual(todo["context"][self.a], ["x.js"])
        self.write("de.json", {self.a: "Braucht dich"})
        self.run_tool("todo", "de", "--out", path)
        self.assertEqual(sorted(self.read("todo.json")["items"]), sorted([self.b, self.c, self.d]))

    def test_screen_names_are_asked_for_once_and_remembered_for_every_later_round(self):
        path = os.path.join(self.dir.name, "todo.json")
        self.run_tool("todo", "de", "--out", path)
        todo = self.read("todo.json")
        self.assertIn("Confirm Print", todo["fixed_names"])
        self.assertIn("exactly that translation", todo["instructions"])
        self.write("answers.json", {"chosen": {"Confirm Print": "Druck bestätigen", "Not a fixed name": "x"},
                                    "translations": {self.d: "Zurück"}})
        code, said = self.run_tool("merge", "de", os.path.join(self.dir.name, "answers.json"))
        self.assertEqual(code, 0)
        self.assertIn("Saved 1 screen name(s)", said)
        with open(self.glossary_path, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["chosen"]["de"], {"Confirm Print": "Druck bestätigen"})
        self.run_tool("todo", "de", "--out", path)
        again = self.read("todo.json")
        self.assertNotIn("Confirm Print", again["fixed_names"])
        self.assertIn("Confirm Print = Druck bestätigen", again["instructions"])

    def test_an_unknown_language_is_refused(self):
        with self.assertRaises(SystemExit):
            self.run_tool("todo", "xx")

    def test_merge_stores_the_good_answers_refuses_the_bad_and_ignores_unknown_keys(self):
        answers = os.path.join(self.dir.name, "answers.json")
        self.write("answers.json", {"translations": {self.a: "Braucht dich", self.b: "Öffne {1} in Deja Vu1",
                                                      self.c: "Heizung aus", "zzzzzzzzzz": "stray"}})
        code, said = self.run_tool("merge", "de", answers)
        self.assertEqual(code, 1, "something was refused, so the exit code says so")
        self.assertIn("stored 2, refused 1, ignored 1", said)
        self.assertEqual(self.read("de.json"), {self.a: "Braucht dich", self.c: "Heizung aus"})
        meta = self.read("meta.json")
        self.assertEqual(meta["languages"]["de"]["translated"], 2)
        self.assertEqual(meta["baseline"], "abc123")
        self.assertEqual(meta["strings"], 4)
        # The refused one is still wanted; a second answer for it is taken and the file keeps the English order.
        self.write("answers.json", {self.b: "Öffne {0} in Deja Vu1"})
        code, _ = self.run_tool("merge", "de", answers)
        self.assertEqual(code, 0)
        self.assertEqual(list(self.read("de.json")), [self.a, self.b, self.c])

    def test_merge_drops_translations_of_words_that_are_gone(self):
        self.write("de.json", {self.a: "Braucht dich", "gone000000": "Weg"})
        self.write("answers.json", {self.d: "Zurück"})
        self.run_tool("merge", "de", os.path.join(self.dir.name, "answers.json"))
        self.assertEqual(sorted(self.read("de.json")), sorted([self.a, self.d]))

    def test_check_reports_a_stored_translation_that_no_longer_passes(self):
        self.write("de.json", {self.a: "Braucht dich", self.b: "Öffne in Deja Vu1"})
        code, said = self.run_tool("check")
        self.assertEqual(code, 1)
        self.assertIn("de: 1 good, 1 refused", said)

    def test_status_counts_translated_missing_refused_and_stale_and_names_the_files_not_made_yet(self):
        self.write("de.json", {self.a: "Braucht dich", self.b: "kaputt", "gone000000": "Weg"})
        code, said = self.run_tool("status")
        self.assertEqual(code, 0)
        de = next(line for line in said.splitlines() if line.startswith("de "))
        self.assertEqual(de.split()[2:], ["1", "2", "1", "1"])
        self.assertIn("(no file yet)", next(line for line in said.splitlines() if line.startswith("fr ")))

    def test_review_points_a_reviewer_at_untranslated_odd_and_long_texts_and_gives_a_fixed_sample(self):
        self.write("languages.json", {"languages": [{"code": "ru", "name": "Russian", "native": "Русский", "dir": "ltr"},
                                                     {"code": "de", "name": "German", "native": "Deutsch", "dir": "ltr"}]})
        self.write("ru.json", {self.a: "Needs you", self.b: "Откройте {0} в Deja Vu1", self.c: "Нагреватель выключен и больше не греет совсем",
                               self.d: "Heater back"})
        code, said = self.run_tool("review", "ru", "--sample", "2")
        self.assertEqual(code, 0)
        self.assertIn("ru (Russian): 4 of 4 texts translated", said)
        self.assertIn("identical to the English: 1", said)
        self.assertIn("none of the language's own script: 1", said)
        self.assertIn("Back -> Heater back", said)
        self.assertIn("x", said.split("longest compared with the English")[1])
        self.assertEqual(said, self.run_tool("review", "ru", "--sample", "2")[1], "the sample is the same every time")
        self.assertIn("de has no translations yet", self.run_tool("review", "de")[1])

    def test_extract_check_says_whether_the_catalogue_is_up_to_date(self):
        tool.i18n_scan.scan = lambda: {text: [] for text in self.en.values()}
        self.assertEqual(self.run_tool("extract", "--check")[0], 0)
        tool.i18n_scan.scan = lambda: {text: [] for text in list(self.en.values()) + ["A new text"]}
        code, said = self.run_tool("extract", "--check")
        self.assertEqual(code, 1)
        self.assertIn("1 new", said)
        self.run_tool("extract")
        self.assertIn("A new text", self.read("en.json").values())


if __name__ == "__main__":
    unittest.main()
