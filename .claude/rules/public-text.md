---
paths:
  - "README.md"
  - "CHANGELOG.md"
  - "CREDITS.md"
  - "CONTRIBUTING.md"
  - "SECURITY.md"
  - "docs/**"
  - "tools/readme-images/**"
  - "frontend/welcome.html"
---

# Public text and pictures

Judges and forum readers ask three things of a Snapmaker Innovation Fund entry: what did the author
write, is it tested and reproducible, and who gets credit. Write so the answers are easy to find.
Load the stop-slop skill before writing.

## Words

- Say who does what, state the fact, stop. No em dashes, no "not X, it's Y" turns, no stock praise
  (seamless, robust, powerful), no adverbs for emphasis, no lists of three by habit.
- Write for U1 owners: what they can do. PR titles, merge messages, commits and the CHANGELOG
  follow the same rule (PR titles become release notes).
- No personal information: no names, school, location, emails, chat history or "the owner said".
- Never remove or soften the AI-assistance disclosure (README, `CREDITS.md`, commit trailers).
- Never name a studied project as the source of a feature. `CREDITS.md` lists what Deja Vu1 talks
  to, ships and builds on, with each licence.
- Keep the README short: what it is, how to try it, how to install, what was tested, where the
  docs are. History goes in the CHANGELOG; evidence in `docs/testing.md`.

## Claims

- Deja Vu1 has been tested on a real Snapmaker U1 with stock firmware. `docs/testing.md` is the
  dated record of what ran where; change it and every copy of a fact together.
- Hardware that isn't built (the colour checker, the LED dock rings, spool scales) is "in progress"
  or "planned", never working.
- An engine build is "tested" only with a recorded run (`backend/engine_support.py`).
- Quote a test count and date only from a run you made, and update every copy: README,
  `tools/readme-images/boards.html` (re-render), `docs/slicer-workspace-validation.md`,
  `docs/testing.md`.
- The app and product page carry no "untested" notes; demo data stays labelled as demo data.
- `img/brand-loop.png` is AI-generated conceptual artwork, not a print or accessory; captions say so.

## Pictures (`tools/readme-images/`)

- `README.md` there says how each picture was made. The explainer boards and the social card are
  HTML (`boards.html`, `card.html` + `card.css` + `card.js` + `card.json`) rendered by `render.js`
  (Playwright; `--card` for the card only). `sync.py` copies renders into `docs/img/`,
  `frontend/img/` and `tools/readme-images/img/`.
- Boards quote figures from the code (test count, sensor count, Confirm Print checks): update them
  when those change.
- `frontend/img/social-card.png` (1200 × 630) is named by absolute URL on the published worker in
  `index.html` and `welcome.html`.
- `check-marketing.js` checks the product page and the recorded demo.
- Full-page screenshots draw sticky and fixed elements in the wrong place; use viewport shots.
  Screenshots come from the simulated farm and say so.
- `docs/hardware-modules.md` Module 3 is the colour checker design. Keep the README's hardware line,
  `color_check.py`'s docstring, `docs/architecture.md` and the explain.js note in step with it.
