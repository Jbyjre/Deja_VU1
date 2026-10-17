# 8 · Launch prep

Copy everything below the line into a new Claude Code session on this repository. Run it last.

---

You're working on **Deja Vu1**, a free dashboard for the Snapmaker U1 (a
four-toolhead 3D printer) and farms of them. Read `CLAUDE.md` first; its
rules apply. The owner isn't a programmer: explain what you did in plain
words, verify every fact before you state it, and say plainly what you
couldn't verify.

## What the owner wants

The repository is about to be posted publicly. When it is, everything must
be accurate and working, and it should look as good as the app really is.
Work continues after launch, so this is about getting the public face
right, not adding features.

## The work

- Two folders are temporary: `marketing-library/` (copies of every picture
  plus `MESSAGING.md`, the agreed order and wording) and `build-prompts/`
  (session prompts like this one). Read `MESSAGING.md` first, use it, then
  delete both folders. Ask the owner before deleting if anything in them
  still looks unfinished.
- Regenerate every picture the README and product page use, from the app as
  it is now, following `tools/readme-images/README.md` (screenshots, the
  explainer boards, the GIF and the link-preview card). Update any figure
  the boards quote (test count and the rest) from the code.
- Read the README and `frontend/welcome.html` end to end against the code.
  Every claim true, every number checked, every unverified thing said
  plainly (above all: whether it has run on a real U1 yet). Run the
  `stop-slop` skill over the prose.
- Check every link, serve `frontend/` alone to check the public product
  page, and run the full test suite.
- List for the owner the things only they can do on GitHub, with the exact
  clicks: the repository's About description and topics (suggested text is
  in `MESSAGING.md`), and uploading the 1280 × 640 social preview image.

You decide the order. Finish with a short list of anything that's still
not ready to post, and why.
