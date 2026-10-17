# 3 · Make the big features lead, drawn like engineering drawings

Copy everything below the line into a new Claude Code session on this repository.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of up to 12. Read `CLAUDE.md` first: its
rules apply, and its "How to work here" section is the method that has
worked (checklist, primary sources, Playwright screenshots, one commit per
feature, docs updated). The owner isn't a programmer: explain what you did
in plain words, verify every fact before you state it, and say plainly what
you couldn't verify. What the owner wants, in their words: a ton of
features that work all the time, as strong as the dedicated apps and repos
that each do one of these things, not a ton that work a quarter of the
time. You have a lot of freedom in how you get there.

## The goal

The app feels as capable as it is: the strongest features get the most
room, and the screens read like clear technical drawings, not decoration.

## What's known

- The owner said the app "feels too small": some features are too small or
  too irrelevant to be used, and the order of tabs and cards grew feature
  by feature (Fleet, Overview, Control, Files, Photo studio, Automations,
  Care, Settings, Games; over a hundred cards in `frontend/index.html`).
- The public story leads with "One screen for every U1 you run": the live
  fleet, Needs you, safe starts from a phone (Confirm Print), files made
  ready for the U1, skip one object, automations, and the digital twin.
  Don't lead with the dock rings or colour sensor (hardware pending).
- The owner loved the digital twin's new drawing style (`drawTwin` in
  `frontend/workshop.js`): one ink, ISO line weights, hidden edges dashed,
  dimensions with arrowheads, a title block, crisp pixel-snapped lines, and
  click a part for its details. They asked for that style "throughout the
  app": the plate map and the planner's section view have it; fleet cards,
  the G-code viewer, the chamber and history charts, maintenance and the
  converter's plate previews don't yet. They also want it smooth and
  working, not just good-looking.

## Directions, not steps

Use the app as a farm owner would, on a desktop and a phone, with **Demo
data** on (or the online demo, `/?demo` on a static server). Decide what
deserves the most room, what merges, what moves and what isn't worth
keeping as it is, then rework navigation and make Overview a real home
screen. Bring the drawing language to the screens where it makes things
clearer, and make clicking things useful (details, statistics, what to do
next), the way clicking a toolhead in the twin is.

Things that can't regress: the accessibility settings (reduced motion,
reduced transparency, increased contrast; see `CLAUDE.md`), frame rate
(measure before and after), honest empty states, server-enforced module
switches, and every test. Write down what you removed or merged and why,
so the owner can disagree. Screenshots at 1366 and 390 px as you go; skills
`frontend-design` and `liquid-glass-universal` are worth loading. Re-record
the online demo and refresh the README pictures when screens change.
