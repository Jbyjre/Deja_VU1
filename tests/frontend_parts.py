"""The frontend files that were split into parts, and a reader that gives a test the whole file again.

app.js, games.js, theme.css and workshop.css were each split into area-sized parts (18 November 2026) so a session
reads only the part it needs. The parts load in order (index.html for the scripts and styles; GAME_PARTS in
app-extras.js for the arcade) and share one scope, so a test that looks for a piece of code reads the whole family:
it keeps working whichever part the code lives in.
"""

import os

FRONTEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

PARTS = {
    "app.js": ["app.js", "app-demo.js", "app-shell.js", "app-modules.js", "app-print.js", "app-extras.js",
               "app-start.js"],
    "games.js": ["games.js", "games-classic.js", "games-arcade.js", "games-shell.js", "games-puzzle.js", "games-v2.js",
                 "games-world.js"],
    "theme.css": ["theme.css", "theme-screens.css", "theme-shell.css"],
    "workshop.css": ["workshop.css", "workshop-files.css", "workshop-panels.css"],
}


def parts_of(name):
    """The files that make up `name`, in load order (just `name` for a file that was not split)."""
    return PARTS.get(name, [name])


def read_frontend(name):
    """The text of frontend/<name>, with every part of a split file joined in load order."""
    texts = []
    for part in parts_of(name):
        with open(os.path.join(FRONTEND, part), encoding="utf-8") as f:
            texts.append(f.read())
    return "\n".join(texts)
