# 6 · Make the big features lead

Copy everything below the line into a new Claude Code session on this repository.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of them. Read `CLAUDE.md` first; its
rules apply. The owner isn't a programmer: explain what you did in plain
words, verify every fact before you state it, and say plainly what you
couldn't verify.

## What the owner wants

In their words, the app is "feeling too small": the features aren't strong
enough, and some are too small or too irrelevant to be used. They want the
priority of features made much better, so the app feels as capable as it
is, with every feature that stays working every time and finished to a
high standard.

## Where things stand

The marketing was re-pointed on 16 October 2026: the README, the product
page (`frontend/welcome.html`) and the link-preview card now lead with
**"One screen for every U1 you run"**: the live fleet, Needs you, safe
starts from a phone (Confirm Print), files made ready for the U1 (pre-flight,
the MakerWorld/NexPrint/Orca converter, skip one object), automations and
alerts, and the digital twin (now a live engineering drawing). The order is
in `marketing-library/MESSAGING.md`.

The dashboard itself hasn't caught up. Its tabs are Fleet, Overview,
Control, Files, Photo studio, Automations, Care, Settings and Games, with
over a hundred cards in `frontend/index.html`, and their order and weight
grew feature by feature, not by what an owner does most.

## The work

Use the app as a farm owner would, on a desktop and on a phone, with
**Demo data** on. Decide what deserves the most room, what should merge,
what should move, and what's too small or not worth keeping as it is. Then
rework the structure: navigation, the Overview as a real home screen, and
the weakest features either strengthened or folded into something bigger.
You decide the design; keep it in the existing "Layer lines" design
language (`frontend/theme.css`) unless you can show something better, and
keep the glass on the navigation and controls layer, not on content.

Things that can't regress: the accessibility settings (reduced motion,
reduced transparency, increased contrast; see `CLAUDE.md`), the 50-60 fps
work (measure before and after the way PR #26 did), honest empty states,
the server-enforced module switches, and every test. Write down what you
removed or merged and why, so the owner can disagree.

Load `frontend-design` and `liquid-glass-universal` before designing, and
`context-efficient` for the session itself. Take screenshots as you go and
check them, at 1366 and 390 px wide.
