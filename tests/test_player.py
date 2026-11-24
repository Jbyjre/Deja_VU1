"""The time-lapse player (frontend/player.js, FLOW.5): checks that need no browser.

A time-lapse used to loop for ever and the printer's own videos opened in a new tab. Now one player plays both,
stops at the last frame unless Loop is on, and has frame steps, speed, full screen and a download. The browser walk
(playing to the end, Space, the arrows, Loop at 4x, closing) is recorded in CHANGELOG.md.
"""

import os
import re
import sys
import unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frontend_parts import read_frontend  # noqa: E402

INDEX = read_frontend("index.html")
PLAYER = read_frontend("player.js")
WORKSHOP = read_frontend("workshop.js")          # all five parts and workshop.js


class TestPlayer(unittest.TestCase):
    def test_loaded_after_workshop(self):
        scripts = re.findall(r'<script src="([^"]+)"', INDEX)
        self.assertIn("player.js", scripts)
        self.assertEqual(scripts.index("player.js"), scripts.index("workshop.js") + 1)

    def test_every_control_it_uses_is_on_the_page(self):
        ids = set(re.findall(r"\$\('([a-z0-9-]+)'\)", PLAYER))
        self.assertGreater(len(ids), 10)
        for i in sorted(ids):
            self.assertIn(f'id="{i}"', INDEX, i)

    def test_loop_is_off_and_the_end_stops(self):
        self.assertIn("loopBox.checked = false", PLAYER)
        self.assertIn("video.loop = false", PLAYER)
        self.assertRegex(PLAYER, r"if \(!loopBox\.checked\) \{ stopFrames\(\); return; \}")
        self.assertNotIn('id="pl-loop" checked', INDEX)

    def test_the_old_endless_flipbook_is_gone(self):
        self.assertNotIn("% flip.frames.length", WORKSHOP)
        self.assertRegex(WORKSHOP, r"function playFlipbook\(session, printer, title\) \{\s+if \(window\.Player\)")

    def test_videos_play_inside_and_still_download(self):
        self.assertNotIn('target="_blank" rel="noopener">Play</a>', WORKSHOP)
        self.assertEqual(WORKSHOP.count("data-play-video="), 2)                # the printer's and the kept ones
        self.assertEqual(WORKSHOP.count("data-play-download="), 2)
        self.assertIn("/api/timelapse/printer-video?download=1", WORKSHOP)
        self.assertIn("Player.video(b.dataset.playVideo", WORKSHOP)

    def test_save_as_video_is_reachable(self):
        self.assertRegex(WORKSHOP, r"return \{[^}]*flipbookVideo \};")
        self.assertIn("Workshop.flipbookVideo(st.session", PLAYER)


if __name__ == "__main__":
    unittest.main()
