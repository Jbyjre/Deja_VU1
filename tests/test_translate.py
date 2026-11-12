"""tools/translate.py: translation through the connected AI, with every answer checked before it is used."""

import importlib.util
import io
import json
import os
import unittest
from contextlib import redirect_stdout

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("translate_tool", os.path.join(ROOT, "tools", "translate.py"))
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)


class FakeAI:
    """'Translates' by prefixing each text, keeping every mark. Can be told to break chosen keys."""

    def __init__(self, break_keys=(), break_always=False, prefix="译:"):
        self.break_keys, self.break_always, self.prefix = set(break_keys), break_always, prefix
        self.sent, self.systems = [], []

    def __call__(self, system, text):
        self.systems.append(system)
        batch = json.loads(text)
        self.sent.append(batch)
        out = {}
        for key, value in batch.items():
            if key in self.break_keys and (self.break_always or len(batch) > 1):
                out[key] = self.prefix + tool._TOKEN.sub("", value)        # loses its marks
            else:
                out[key] = self.prefix + value
        return "```json\n" + json.dumps(out, ensure_ascii=False) + "\n```"


def glossary():
    return {"keep": ["Deja Vu1", "G-code"], "fixed": ["Confirm Print"], "terms": {"zh-CN": {"printer": "打印机"}}, "chosen": {}}


class TestTranslate(unittest.TestCase):
    def test_code_placeholders_tags_and_links_are_hidden_from_the_ai_and_come_back_unchanged(self):
        text = "Send `M112` to {name} <b>now</b>, see [the guide](docs/a.md) or https://example.com/x and [[nozzle]]."
        masked, pieces = tool.protect(text)
        for piece in ("`M112`", "{name}", "<b>", "</b>", "](docs/a.md)", "https://example.com/x", "[[nozzle]]"):
            self.assertIn(piece, pieces)
            self.assertNotIn(piece, masked)
        self.assertEqual(tool.restore(masked, pieces), text)

    def test_an_answer_that_drops_a_mark_or_translates_a_kept_name_is_refused(self):
        source, _ = tool.protect("Open {file} in Deja Vu1")
        self.assertEqual(tool.problems(source, source.replace("Open", "打开"), ["Deja Vu1"]), [])
        self.assertTrue(tool.problems(source, "打开 Deja Vu1", ["Deja Vu1"]))
        self.assertTrue(tool.problems(source, source.replace("Deja Vu1", "似曾相识"), ["Deja Vu1"]))
        self.assertTrue(tool.problems(source, "", []))

    def test_a_catalogue_fills_only_what_is_missing_and_keeps_its_shape(self):
        english = {"title": "Your printer", "card": {"go": "Print {file}", "stop": "Stop"}}
        ai = FakeAI()
        out, tr = tool.translate_catalogue(english, {"title": "我的打印机"}, "zh-CN", ai, glossary())
        self.assertEqual(out, {"title": "我的打印机", "card": {"go": "译:Print {file}", "stop": "译:Stop"}})
        self.assertEqual(tr.failed, [])
        self.assertNotIn("title", ai.sent[-1])                              # already there, so not sent
        self.assertIn("printer = 打印机", ai.systems[-1])                    # fixed terms travel with every request
        self.assertIn("Never translate these names: Deja Vu1, G-code", ai.systems[-1])

    def test_a_bad_answer_is_tried_once_on_its_own_and_then_stays_in_english(self):
        english = {"a": "Send {code}", "b": "Plain words"}
        out, tr = tool.translate_catalogue(english, {}, "zh-CN", FakeAI(break_keys={"a"}), glossary())
        self.assertEqual(out["a"], "译:Send {code}")                         # the retry on its own passed
        out, tr = tool.translate_catalogue(english, {}, "zh-CN", FakeAI(break_keys={"a"}, break_always=True), glossary())
        self.assertNotIn("a", out)                                           # the app falls back to English
        self.assertEqual(out["b"], "译:Plain words")
        self.assertEqual([f[0] for f in tr.failed], ["a"])

    def test_a_screen_name_is_translated_once_and_reused(self):
        g = glossary()
        ai = FakeAI()
        tool.translate_catalogue({"x": "Open Confirm Print"}, {}, "zh-CN", ai, g)
        self.assertEqual(g["chosen"]["zh-CN"], {"Confirm Print": "译:Confirm Print"})
        self.assertIn("Confirm Print = 译:Confirm Print", ai.systems[-1])
        ai = FakeAI()
        tool.translate_catalogue({"y": "Confirm Print again"}, {}, "zh-CN", ai, g)
        self.assertEqual(len(ai.sent), 1)                                    # not asked again

    def test_a_document_keeps_its_code_blocks_and_layout(self):
        doc = "# Getting started\n\nInstall it:\n\n```bash\npython3 start.py   # starts it\n```\n\n- Open `localhost`\n\n|a|b|\n"
        text, tr = tool.translate_markdown(doc, "zh-CN", FakeAI(), glossary())
        self.assertIn("```bash\npython3 start.py   # starts it\n```", text)
        self.assertIn("译:# Getting started", text)
        self.assertIn("译:- Open `localhost`", text)
        self.assertEqual(text.count("\n"), doc.count("\n"))
        self.assertEqual(tr.failed, [])
        self.assertEqual(tr.requests, 2)                                     # the fixed names once, then the words

    def test_a_dry_run_counts_and_sends_nothing(self):
        with redirect_stdout(io.StringIO()) as printed:
            self.assertEqual(tool.main(["doc", os.path.join(ROOT, "docs", "getting-started.md"), "--to", "zh-CN", "--dry-run"]), 0)
        self.assertIn("to translate into Simplified Chinese", printed.getvalue())

    def test_the_glossary_file_is_valid_and_keeps_the_product_name(self):
        g = tool.load_glossary()
        self.assertIn("Deja Vu1", g["keep"])
        self.assertIn("Confirm Print", g["fixed"])
        self.assertEqual(g["terms"]["zh-CN"]["nozzle"], "喷嘴")


if __name__ == "__main__":
    unittest.main()
