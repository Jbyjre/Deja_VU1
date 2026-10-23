"""Checks on the October 2026 interface refreshes that can be made without a
browser: the Pac-Man maze is playable, the 3D twin keeps Snapmaker's
published outer size, and the new scripts load where the page expects them.
Behaviour in a browser (frame times, screenshots) is recorded in CHANGELOG.md.
"""

import os
import re
import unittest
from collections import deque

FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")


def read(name):
    with open(os.path.join(FRONTEND, name), encoding="utf-8") as f:
        return f.read()


class TestPacmanMaze(unittest.TestCase):
    def setUp(self):
        src = read("app.js")
        body = re.search(r"function newPacmanArcade\(\)\{(.*?)\n\}\n", src, re.S)
        self.assertIsNotNone(body, "newPacmanArcade not found")
        block = re.search(r"const MAP=\[(.*?)\];", body.group(1), re.S)
        self.rows = re.findall(r"'([^']*)'", block.group(1))
        self.tunnel = int(re.search(r"TUNNEL=(\d+)", body.group(1)).group(1))

    def open_cell(self, c, r):
        if r == self.tunnel:
            c %= len(self.rows[0])
        if not (0 <= r < len(self.rows) and 0 <= c < len(self.rows[0])):
            return False
        return self.rows[r][c] not in "#X-G"

    def test_rectangular(self):
        self.assertEqual(len(self.rows), 21)
        self.assertEqual({len(r) for r in self.rows}, {19})

    def test_every_dot_reachable_from_the_start(self):
        start = next((c, r) for r, row in enumerate(self.rows) for c, ch in enumerate(row) if ch == "P")
        seen, queue = {start}, deque([start])
        while queue:
            c, r = queue.popleft()
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nc, nr = c + dc, r + dr
                if nr == self.tunnel:
                    nc %= len(self.rows[0])
                if self.open_cell(nc, nr) and (nc, nr) not in seen:
                    seen.add((nc, nr))
                    queue.append((nc, nr))
        dots = [(c, r) for r, row in enumerate(self.rows) for c, ch in enumerate(row) if ch in ".o"]
        self.assertGreater(len(dots), 100)
        self.assertEqual([d for d in dots if d not in seen], [])

    def test_no_dead_ends(self):
        for r, row in enumerate(self.rows):
            for c, _ in enumerate(row):
                if not self.open_cell(c, r):
                    continue
                exits = sum(self.open_cell(c + dc, r + dr) for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                self.assertGreaterEqual(exits, 2, f"dead end at column {c}, row {r}")

    def test_ghost_house_has_one_door(self):
        self.assertEqual(sum(row.count("-") for row in self.rows), 1)


class TestTwinModel(unittest.TestCase):
    def test_outer_size_is_the_published_figure(self):
        m = re.search(r"const ENVELOPE = \{ x0: (-?\d+), x1: (-?\d+), y0: (-?\d+), y1: (-?\d+), z0: (-?\d+), z1: (-?\d+) \}",
                      read("twin3d.js"))
        x0, x1, y0, y1, z0, z1 = map(int, m.groups())
        self.assertEqual((x1 - x0, y1 - y0, z1 - z0), (584, 499, 730))

    def test_plate_and_print_height_follow_snapmakers_profile(self):
        # Snapmaker's Orca profile: a 276 x 293 mm plate, 270 mm print height.
        src = read("twin3d.js")
        self.assertIn("const BED = 270, PLATE = { w: 276, d: 293 };", src)

    def test_the_body_fits_inside_the_published_envelope(self):
        src = read("twin3d.js")
        body = dict(re.findall(r"(x0|x1|y0|y1|z0|z1): (-?\d+)", re.search(r"const BODY = \{([^}]*)\}", src).group(1)))
        env = dict(re.findall(r"(x0|x1|y0|y1|z0|z1): (-?\d+)", re.search(r"const ENVELOPE = \{([^}]*)\}", src).group(1)))
        b = {k: int(v) for k, v in body.items()}
        e = {k: int(v) for k, v in env.items()}
        self.assertTrue(e["x0"] <= b["x0"] < b["x1"] <= e["x1"])
        self.assertTrue(e["y0"] <= b["y0"] < b["y1"] <= e["y1"])
        self.assertTrue(e["z0"] <= b["z0"] < b["z1"] <= e["z1"])

    def test_drawing_uses_the_same_outer_size(self):
        m = re.search(r"OUTER: \{ x0: (-?\d+), x1: (-?\d+), y0: (-?\d+), y1: (-?\d+), z0: (-?\d+), z1: (-?\d+) \}",
                      read("workshop.js"))
        x0, x1, y0, y1, z0, z1 = map(int, m.groups())
        self.assertEqual((x1 - x0, y1 - y0, z1 - z0), (584, 499, 730))


class TestPageWiring(unittest.TestCase):
    def test_new_scripts_load_in_order(self):
        scripts = re.findall(r'<script src="([^"]+)"></script>', read("index.html"))
        for name in ("backdrop.js", "twin3d-scene.js", "twin3d.js"):
            self.assertIn(name, scripts)
        self.assertLess(scripts.index("app.js"), scripts.index("backdrop.js"))
        self.assertLess(scripts.index("twin3d-scene.js"), scripts.index("twin3d.js"))
        self.assertLess(scripts.index("twin3d.js"), scripts.index("workshop.js"))

    def test_background_defaults_to_dots_with_surprises_on(self):
        src = read("backdrop.js")
        self.assertIn("const DEFAULT = { style: 'dots', palette: 'glacier', energy: 'lively', surprises: true };", src)
        # Reduced motion switches the background to Still and the surprises off.
        self.assertIn("const effectiveStyle = () => (reducedMotion() ? 'still' : prefs.style);", src)
        self.assertIn("prefs.surprises && !reducedMotion()", src)

    def test_every_tab_has_an_introduction(self):
        tabs = set(re.findall(r'class="navtab[^"]*" data-tab="([a-z]+)"', read("index.html")))
        intros = re.search(r"const TAB_INTROS = \{(.*?)\n\};", read("app.js"), re.S).group(1)
        self.assertEqual(tabs, set(re.findall(r"^\s+([a-z]+):", intros, re.M)))

    def test_game_timers_go_through_the_frame_clock(self):
        src = read("app.js")
        # The three timer helpers the games use; a plain setInterval there
        # brings back the stutter and refresh-rate speed differences.
        for helper in ("function plusTools", "function gameTools", "function gamesToolsV2"):
            start = src.index(helper)
            body = src[start:src.index("\n", start + 200) if helper == "function plusTools" else src.index("\n}\n", start)]
            self.assertIn("frameEvery(", body, helper)
            self.assertNotIn("setInterval(", body, helper)


if __name__ == "__main__":
    unittest.main()
