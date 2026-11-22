# Translating Deja Vu1

Deja Vu1 can show its words in another language. English is the original. Every other language is a
file of translated words that sits next to the English list, and the page puts the translation where
the English text would appear. A text without a translation shows in English, so a language can grow
a round at a time.

This page says how it works, how a round of translation runs, and what to check in the result. No
language is translated yet: the first round has not been made.

## What an owner sees

Settings, Look & layout, Appearance, **Language**. The list shows English and every language whose
file is installed. Choosing one saves the choice in this browser and reloads the page, so every
screen starts again in that language. Dates and times follow the language too. Numbers keep the
decimal point the page already writes.

`?lang=de` opens one visit in German and saves it. `?lang=pseudo` shows every catalogued text accented
and about a third longer. It saves nothing, and it is how text that is missing from the list and
text that does not fit are found.

## The pieces

| File | What it is |
|---|---|
| `frontend/strings/en.json` | Every text on screen, each under a ten-character key made from the words themselves. Written by `tools/i18n.py extract`, never by hand. |
| `frontend/strings/<code>.json` | The same keys, translated. One file per language. |
| `frontend/strings/languages.json` | The languages the picker can offer: 20 now. Arabic and Hebrew wait until the layout can be mirrored right to left. |
| `frontend/strings/meta.json` | How many texts each language has, when it was translated, and the commit it was made from. |
| `frontend/i18n.js` | Loads the English list and the chosen language, then puts translations on the page: text, `title`, `placeholder`, `aria-label`, `alt` and `data-tip`, as they appear and whenever they change. |
| `tools/i18n_scan.py` | Finds the texts in `index.html`, the scripts and the server modules whose sentences reach the screen. |
| `tools/i18n.py` | `extract`, `status`, `todo`, `merge`, `check`, `meta`, `languages`. |
| `tools/translate.py` | Translates a list through the AI connected in Deja Vu1, with every answer checked. |
| `tools/translation-glossary.json` | Names that stay as written (Deja Vu1, Klipper, G-code, PLA) and screen names that are translated once and reused. |

A key is made from the words. The same words always give the same key, so a text that changed gets a
new key and shows up as missing, and a text that is gone drops out of every language at the next merge.

### Sentences made of pieces

A sentence the code builds from pieces (`Couldn't change ${name}: ${why}`) is listed as
`Couldn't change {0}: {1}`. The page matches the finished sentence against that pattern, translates
the sentence, and puts the pieces back where the translation wants them, so a language may reorder
them. A piece that is a whole text of its own ("on", "Sign in") is translated too.

## What is translated

- Every word in `index.html` and in the scripts the page loads.
- The sentences the server sends that people read as written: Confirm Print, maintenance, the colour
  check, slicing and why a slice failed, the engine install, the queue, the fleet, discovery, backups
  and the rest listed in `BACKEND_FILES` in `tools/i18n_scan.py`.
- A message from `alert`, `confirm` and `prompt`.

## What is not translated

- The product page (`welcome.html`), the offline page, and the documents in `docs/`. `translate.py doc`
  translates a document on its own.
- Tester mode's panels, its 22 questions and its report. The report goes to the developer in English.
- Error code guides, which come from Snapmaker's wiki in Snapmaker's words.
- The version history's release notes.
- Names and figures that arrive as data: printer names, file names, spool names, temperatures, dates
  inside a model's own file.
- The marks drawn on the 3D printer and its plate (`snapmaker`, the build volume label).
- Right-to-left languages.
- Texts that the scanner cannot see: a word the code assembles letter by letter, or a sentence that
  reaches the page in two separate pieces with markup between them. The check below lists them.

## A round of translation

A round runs every 5 to 10 merges. `python3 tools/i18n.py status` says how many merges have passed
since the last one and how many texts each language lacks. **The first round is made and left open.
A maintainer reviews it before it merges.**

1. Branch from the latest `main`.
2. Write the English list from the code:

   ```bash
   python3 tools/i18n.py extract
   python3 tools/i18n.py status
   ```

3. For each language in `languages.json` (a first round may start with a few), hand the missing texts
   to a translator and store what comes back.

   If the AI connected in Deja Vu1 is the translator:

   ```bash
   python3 tools/translate.py catalogue frontend/strings/en.json --to de
   python3 tools/i18n.py meta --stamp
   ```

   If another AI is the translator:

   ```bash
   python3 tools/i18n.py todo de --out /tmp/todo-de.json
   # translate every value under "items" as the "instructions" in that file say,
   # write {"chosen": {...screen names...}, "translations": {key: translation}} to /tmp/answers-de.json
   python3 tools/i18n.py merge de /tmp/answers-de.json
   ```

   `todo` sends only the texts the language lacks, with the instructions, the names that stay as
   written and the files each text came from, which tells the translator whether "Open" is a button
   or a state. `merge` checks every answer and stores the good ones. It refuses an answer that loses
   or changes a placeholder (`{0}`, `{name}`, `%s`), an HTML tag, code, a link or a `[[term]]`, that
   translates a kept name, that changes the line breaks, that is empty, or that is far longer than the
   English. A refused text stays English and is listed.

4. Check:

   ```bash
   python3 tools/i18n.py check
   python3 -m unittest tests.test_i18n
   node tools/i18n-check.js
   node tools/text-audit.js --lang de --widths 1366,390
   ```

   `text-audit.js --lang` takes any installed language. Run it for the languages whose words run
   longest and read what it reports. Fix a label that no longer fits in CSS, in its own pull request.
5. Commit the files in `frontend/strings/` and `tools/translation-glossary.json`, nothing else. Open a
   pull request titled for what an owner gets ("Deja Vu1 in German, French and Spanish"). Say in the
   body which languages, how many texts each, how many were refused, and what the checks found.

A first round is large: about 6,200 texts, roughly 61,000 tokens of English per language, so about
1.2 million tokens in and as many out for 20 languages. Later rounds send only what changed.

### Reviewing a round

`python3 tools/i18n.py review de` prints what to read first: texts identical to the English, texts in
a language with its own script that contain none of it, the translations that grew most compared with
the English (the labels that may not fit), and a sample of pairs that is the same each time.

- Open the app in the language: Settings, Language. Walk through Overview, Printer, Files, Slicer,
  Settings and the Confirm Print window.
- Read 30 texts per language with a native speaker or a second translator: five buttons, five
  sentences with pieces in them, five tooltips.
- Look for English left in the middle of a screen. `?i18n=debug` and `I18n.misses()` in the browser
  console list the texts that were seen and not found.
- `status` and `check` show no refused text. The count in `meta.json` equals the keys in the file.

## Writing text in the app

Write English as before. A few habits keep it translatable:

- Write a whole sentence as one template string. Two pieces glued with `+` become two fragments.
- A sentence with words in it that must change with a language goes through
  `I18n.t('Saved {name}', { name })` when it never reaches the page as one text node (a canvas label,
  a `title` set on a non-DOM object).
- Never compare what is on screen with an English word. A heading found by its words, a card sorted
  by its title: use `I18n.same(text, 'Farm history')`, `I18n.source(text)` for one text, or
  `I18n.englishText(element)` for an element. Run `node tools/i18n-check.js`: it opens every screen in
  English and in the pseudo language and reports a screen that is built differently.
- Never compare the DOM with a string you computed to decide whether to redraw. Keep the last string
  you drew (the 3D printer's tags did this: `tags._drawn`).
- Mark text that must never change with `translate="no"` or `data-no-i18n`.

You do not need to run `extract` when you add text. The next round does it.

## What was checked

On 22 November 2026, Chromium on Linux, demo data, with the pseudo language and a two-text German
stand-in. No real translation exists, so no real language has been read.

- 25 loader scenarios: English fetches nothing, text added later and changed in place is translated,
  pieces move in a pattern, code and `translate="no"` stay, attributes and dialogs are translated,
  a missing language file leaves the page in English, the picker lists what is installed.
- All 19 screens and every part of them, in English and in pseudo: no script error, the same cards,
  headings, help buttons and part buttons. Putting the old English-only lookup back made 17 screens differ.
- `text-audit.js --lang pseudo`: 270 screens (1366, 1024 and 390 px, light and dark, very long names).
  One run reported 10 findings on the 3D printer sheet at 1024 px while four other browser runs
  used the computer. The same screens alone found nothing.
- Of the visible texts on those screens, 67 percent are reached by the list. What remains is figures,
  units, file and printer names, the release notes, and a few sentences the code builds in pieces.

Not checked: any real translation, a native speaker's reading, searching the command bar in a
language other than English, a phone, a real printer.
