"""
The search box (frontend/finder.js): every "Go to" place names a card that
exists, and titles are matched without the ⓘ help button explain.js adds to
them (that button's "i" once made almost every jump land nowhere).
"""

import re
import unittest
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SOURCE = (FRONTEND / "finder.js").read_text(encoding="utf-8")


def _plain(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html).replace("&amp;", "&")).strip()


class SearchPlaces(unittest.TestCase):
    def setUp(self):
        block = SOURCE[SOURCE.index("const PLACES = ["):]
        block = block[:block.index("\n  ];")]
        self.places = re.findall(r"\['([^']+)', '([^']+)', '[^']*', '([^']+)'\]", block)
        pages = (FRONTEND / "index.html").read_text(encoding="utf-8") + "".join(
            p.read_text(encoding="utf-8") for p in FRONTEND.glob("*.js"))
        self.pages = pages
        self.titles = {_plain(t) for t in re.findall(r"<h[23][^>]*>(.*?)</h[23]>", pages, re.S)}

    def test_every_place_names_a_card_that_exists(self):
        self.assertGreater(len(self.places), 50)
        for title, _, target in self.places:
            if target.startswith("tab:"):
                self.assertIn(f'data-tab="{target[4:]}"', self.pages, title)
            elif target.startswith("#"):
                self.assertRegex(self.pages, rf'id="{re.escape(target[1:])}"|\.id = \'{re.escape(target[1:])}\'', title)
            else:
                self.assertIn(target, self.titles, f"search place “{title}” points at a title no card has")

    def test_titles_are_matched_without_the_help_button(self):
        go = SOURCE[SOURCE.index("function go(target)"):SOURCE.index("function focusPanel")]
        self.assertIn(".xp-btn", go)


if __name__ == "__main__":
    unittest.main()
