"""
The plain-language help (frontend/explain.js): every note belongs to a card that exists, every
underlined word has a definition, and the wording keeps the house rules (no em dashes).
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
SOURCE = (FRONTEND / "explain.js").read_text(encoding="utf-8")


def _key(text):
    text = re.sub(r"<[^>]+>", " ", text).lower().replace("new version available", "").replace("&amp;", " ")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _block(name):
    start = SOURCE.index(f"const {name} = {{")
    return SOURCE[start:SOURCE.index("\n  };", start)]


HELP_KEYS = re.findall(r"^    '([a-z0-9 ]+)': \[", _block("HELP"), re.M)
GLOSS_KEYS = re.findall(r"^    '([a-z0-9 ]+)': \[", _block("GLOSS"), re.M)


class PlainLanguageHelp(unittest.TestCase):

    def test_every_note_matches_a_card_title(self):
        pages = (FRONTEND / "index.html").read_text(encoding="utf-8") + "".join(
            p.read_text(encoding="utf-8") for p in FRONTEND.glob("*.js") if p.name != "explain.js")
        titles = {_key(t) for t in re.findall(r"<h2[^>]*>(.*?)</h2>", pages, re.S)}
        self.assertGreater(len(HELP_KEYS), 60)
        for key in HELP_KEYS:
            self.assertIn(key, titles, f"explain.js has a note for “{key}”, but no card has that title")

    def test_every_underlined_word_has_a_definition(self):
        for term in re.findall(r"\[\[([^\]|]+)", _block("HELP")):
            self.assertIn(_key(term), GLOSS_KEYS, term)

    def test_house_style(self):
        text = _block("HELP") + _block("GLOSS")
        self.assertNotIn("—", text)
        for word in ("simply", "just", "easily", "seamless", "exactly"):
            self.assertIsNone(re.search(rf"\b{word}\b", text, re.I), f"filler word “{word}” in the help text")

    def test_the_page_loads_it(self):
        html = (FRONTEND / "index.html").read_text(encoding="utf-8")
        self.assertIn('<script src="explain.js"></script>', html)
        self.assertIn("data-glossary", html)


if __name__ == "__main__":
    unittest.main()
