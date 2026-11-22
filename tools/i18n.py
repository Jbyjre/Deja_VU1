#!/usr/bin/env python3
"""
Deja Vu1's translations: list the words, see what is missing, hand the missing words to a translator, check
and store what comes back. Standard library only; it sends nothing anywhere.

    python3 tools/i18n.py extract                 write frontend/strings/en.json from the page files (every on-screen text)
    python3 tools/i18n.py status                  what is translated, what is missing, and how many merges have passed
    python3 tools/i18n.py todo de [--out f.json]  the English texts German still lacks, with instructions and context
    python3 tools/i18n.py merge de answers.json   check a translator's answers and store the good ones in de.json
    python3 tools/i18n.py check                   check every stored translation again (placeholders, kept names, shape)
    python3 tools/i18n.py review de [--sample 30] what a reviewer should read first: odd lengths, untranslated texts, a sample of pairs
    python3 tools/i18n.py meta                    refresh frontend/strings/meta.json from the files
    python3 tools/i18n.py languages               the languages the picker can offer

The page reads frontend/strings/en.json (the English words, each under a short key made from the words
themselves) and frontend/strings/<code>.json (the same keys, translated). A key is the same for the same words, so a
text that changed gets a new key and shows up as missing; a text that is gone drops out of every language. Every
answer is checked before it is stored: placeholders ({0}, {name}, %s), HTML tags, code and links must come back
as they were, and the names in tools/translation-glossary.json "keep" must stay as written. Anything that fails is
not stored, and the page shows it in English.
"""

import argparse
import importlib.util
import json
import os
import random
import re
import subprocess
import sys
import tempfile
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STRINGS = os.path.join(ROOT, "frontend", "strings")
EN = os.path.join(STRINGS, "en.json")
LANGUAGES = os.path.join(STRINGS, "languages.json")
META = os.path.join(STRINGS, "meta.json")
DUE_AFTER_MERGES = 5            # the owner's rhythm: translate again every 5 to 10 merges

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import i18n_scan  # noqa: E402


def _tool(name):
    spec = importlib.util.spec_from_file_location(name + "_tool", os.path.join(ROOT, "tools", name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


translate = _tool("translate")


# ---- files ---------------------------------------------------------------------------------------

def read_json(path, default=None):
    if not os.path.exists(path):
        return {} if default is None else default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=1) + "\n")


def languages():
    """[{code, name, native, dir}] in the order the picker lists them."""
    return read_json(LANGUAGES, {"languages": []})["languages"]


def language_codes():
    return [item["code"] for item in languages()]


def language_file(code):
    return os.path.join(STRINGS, code + ".json")


def english():
    return read_json(EN)


def known(code):
    if code not in language_codes():
        raise SystemExit(f"{code} is not in frontend/strings/languages.json. Known: {', '.join(language_codes())}")
    return code


# ---- checking a translation ---------------------------------------------------------------------

def pieces(text):
    """The parts that must come back exactly: placeholders, tags, code and links (see tools/translate.py)."""
    return sorted(translate.protect(text)[1])


def why_not(source, result, keep):
    """Why a translation cannot be used, or [] when it can."""
    if not isinstance(result, str) or not result.strip():
        return ["empty"]
    found = []
    if "⟦" in result or "⟧" in result:
        found.append("contains a leftover mark")
    if pieces(source) != pieces(result):
        found.append("a placeholder, tag, code or link changed")
    for name in keep:
        if re.search(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", source) and name not in result:
            found.append(f"{name} was translated but must stay as written")
    if len(result) > 4 * len(source) + 40:
        found.append("far longer than the English")
    if result.count("\n") != source.count("\n"):
        found.append("line breaks differ")
    return found


def check_language(code, en=None, glossary=None):
    """(good count, [(key, english, translation, why)], stale keys) for a stored language file."""
    en = english() if en is None else en
    glossary = glossary or translate.load_glossary(translate.GLOSSARY)
    have = read_json(language_file(code))
    bad = []
    for key, value in have.items():
        if key in en:
            why = why_not(en[key], value, glossary["keep"])
            if why:
                bad.append((key, en[key], value, "; ".join(why)))
    stale = [k for k in have if k not in en]
    return len(have) - len(bad) - len(stale), bad, stale


# ---- commands ------------------------------------------------------------------------------------

def cmd_extract(args):
    found = i18n_scan.scan()
    fresh = i18n_scan.catalogue(found)
    old = english()
    added = [k for k in fresh if k not in old]
    gone = [k for k in old if k not in fresh]
    if args.check:
        if added or gone:
            print(f"frontend/strings/en.json is out of date: {len(added)} new, {len(gone)} gone. Run: python3 tools/i18n.py extract")
            return 1
        print(f"frontend/strings/en.json is up to date ({len(fresh)} texts).")
        return 0
    write_json(EN, fresh)
    print(f"Wrote frontend/strings/en.json: {len(fresh)} texts ({len(added)} new, {len(gone)} gone since the last file).")
    for key in added[:15]:
        print(f"  + {fresh[key][:100]}")
    if len(added) > 15:
        print(f"  ... and {len(added) - 15} more")
    return 0


def merges_since(sha):
    if not sha:
        return None
    try:
        out = subprocess.run(["git", "rev-list", "--merges", "--count", sha + "..HEAD"], cwd=ROOT, capture_output=True,
                             text=True, timeout=20)
        return int(out.stdout.strip()) if out.returncode == 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def head_sha():
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=20)
        return out.stdout.strip() if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def cmd_status(args):
    en = english()
    fresh = i18n_scan.catalogue(i18n_scan.scan())
    new = [k for k in fresh if k not in en]
    gone = [k for k in en if k not in fresh]
    glossary = translate.load_glossary(translate.GLOSSARY)
    meta = read_json(META)
    print(f"English catalogue: {len(en)} texts. Page files now hold {len(fresh)}: {len(new)} not in the catalogue yet, {len(gone)} no longer used."
          + ("  Run `python3 tools/i18n.py extract` first." if new or gone else ""))
    since = merges_since(meta.get("baseline"))
    if since is None:
        print("Merges since the last translation: not known (no baseline recorded, or git is not available).")
    else:
        print(f"Merges since the last translation: {since}" + (f" (a new round is due after {DUE_AFTER_MERGES})." if since >= DUE_AFTER_MERGES else "."))
    print(f"{'code':7} {'language':22} {'translated':>10} {'missing':>8} {'refused':>8} {'stale':>6}")
    for item in languages():
        code = item["code"]
        if not os.path.exists(language_file(code)):
            print(f"{code:7} {item['name']:22} {'-':>10} {len(en):>8} {'-':>8} {'-':>6}   (no file yet)")
            continue
        good, bad, stale = check_language(code, en, glossary)
        print(f"{code:7} {item['name']:22} {good:>10} {len(en) - good - len(bad):>8} {len(bad):>8} {len(stale):>6}")
    return 0


def cmd_todo(args):
    code = known(args.language)
    en = english()
    glossary = translate.load_glossary(translate.GLOSSARY)
    have = read_json(language_file(code))
    where = i18n_scan.scan()
    places = {i18n_scan.key_for(text): files for text, files in where.items()}
    missing = {k: v for k, v in en.items() if k not in have or why_not(v, have[k], glossary["keep"])}
    if args.limit:
        missing = dict(list(missing.items())[:args.limit])
    system = translate._instructions(code, glossary)
    fixed = [name for name in glossary["fixed"] if name not in glossary["chosen"].get(code, {})]
    if fixed:
        system += ("\nThese screen names must read the same everywhere. Translate each once (put them under \"chosen\" in your answers file), "
                   "then use exactly that translation inside every sentence that contains the name: " + "; ".join(fixed) + ".")
    out = {
        "fixed_names": fixed,
        "language": code,
        "language_name": translate.language_name(code),
        "how": ("Translate every value in `items` into the language above, as the instructions say. Answer with one JSON object "
                "{key: translation} for the same keys, then run: python3 tools/i18n.py merge " + code + " <your file>. "
                "Slots such as {0}, {1}, {name}, tags such as <b>, `code`, [[terms]] and links must stay exactly as they are, "
                "and each must appear once. Keep a text short enough for a button when the English is."),
        "instructions": system,
        "context": {k: places.get(k, [])[:3] for k in missing},
        "items": missing,
    }
    path = args.out or os.path.join(tempfile.gettempdir(), f"dejavu1-todo-{code}.json")
    write_json(path, out)
    chars = sum(len(v) for v in missing.values())
    print(f"{len(missing)} text(s) to translate into {translate.language_name(code)} (about {chars // 4:,} tokens of English). Wrote {path}")
    return 0


def cmd_merge(args):
    code = known(args.language)
    en = english()
    glossary = translate.load_glossary(translate.GLOSSARY)
    with open(args.answers, encoding="utf-8") as f:
        answers = json.load(f)
    chosen = {}
    if isinstance(answers, dict) and isinstance(answers.get("translations"), dict):
        chosen = answers.get("chosen") if isinstance(answers.get("chosen"), dict) else {}
        answers = answers["translations"]
    if not isinstance(answers, dict):
        raise SystemExit("The answers file must be one JSON object: {key: translation}.")
    taken_names = 0
    for name, word in chosen.items():
        if name in glossary["fixed"] and isinstance(word, str) and word.strip() and "\n" not in word:
            glossary["chosen"].setdefault(code, {})[name] = word.strip()
            taken_names += 1
    if taken_names:
        with open(translate.GLOSSARY, "w", encoding="utf-8", newline="\n") as f:
            json.dump(glossary, f, ensure_ascii=False, indent=2)
            f.write("\n")
    have = {k: v for k, v in read_json(language_file(code)).items() if k in en}
    taken, refused, unknown = 0, [], 0
    for key, value in answers.items():
        if key not in en:
            unknown += 1
            continue
        why = why_not(en[key], value, glossary["keep"])
        if why:
            refused.append((key, en[key], "; ".join(why)))
        else:
            have[key] = value
            taken += 1
    ordered = {k: have[k] for k in en if k in have}
    write_json(language_file(code), ordered)
    refresh_meta(stamp=True)
    print(f"{code}: stored {taken}, refused {len(refused)}, ignored {unknown} unknown key(s). {len(ordered)} of {len(en)} texts are translated."
          + (f" Saved {taken_names} screen name(s) to the glossary." if taken_names else ""))
    for key, source, why in refused[:25]:
        print(f"  refused {key}: {why}: {source[:80]}")
    if len(refused) > 25:
        print(f"  ... and {len(refused) - 25} more refused")
    return 1 if refused else 0


def cmd_check(args):
    en = english()
    glossary = translate.load_glossary(translate.GLOSSARY)
    bad_total = 0
    for item in languages():
        code = item["code"]
        if not os.path.exists(language_file(code)):
            continue
        good, bad, stale = check_language(code, en, glossary)
        bad_total += len(bad)
        print(f"{code}: {good} good, {len(bad)} refused, {len(stale)} stale")
        for key, source, value, why in bad[:10]:
            print(f"  {key}: {why}: {source[:70]} -> {value[:70]}")
    return 1 if bad_total else 0


# The letters each language is written in. A translation with letters and none of these is probably still English.
SCRIPTS = {
    "ru": "\u0400-\u04ff", "uk": "\u0400-\u04ff", "zh-CN": "\u4e00-\u9fff", "zh-TW": "\u4e00-\u9fff", "ja": "\u3040-\u30ff\u4e00-\u9fff",
    "ko": "\uac00-\ud7af", "th": "\u0e00-\u0e7f", "hi": "\u0900-\u097f",
}


def cmd_review(args):
    code = known(args.language)
    en = english()
    have = read_json(language_file(code))
    pairs = [(k, en[k], v) for k, v in have.items() if k in en and isinstance(v, str)]
    if not pairs:
        print(f"{code} has no translations yet.")
        return 0
    letters = re.compile(r"[^\W\d_]")
    wordy = [p for p in pairs if len(letters.findall(translate.protect(p[1])[0])) >= 3]
    same = [p for p in wordy if p[1] == p[2]]
    ratio = sorted(((len(v) / max(1, len(e)), k, e, v) for k, e, v in wordy if len(e) >= 6), reverse=True)
    print(f"{code} ({translate.language_name(code)}): {len(pairs)} of {len(en)} texts translated.")
    print(f"  identical to the English: {len(same)} (names and units are fine; a sentence is not)")
    for _k, e, _v in same[:8]:
        print(f"    {e[:90]}")
    if code in SCRIPTS:
        script = re.compile("[" + SCRIPTS[code] + "]")
        english_looking = [p for p in wordy if p[1] != p[2] and not script.search(p[2])]
        print(f"  letters but none of the language's own script: {len(english_looking)} (likely still English)")
        for _k, e, v in english_looking[:8]:
            print(f"    {e[:50]} -> {v[:50]}")
    print("  longest compared with the English (these are the labels that may not fit):")
    for r, _k, e, v in ratio[:8]:
        print(f"    x{r:.1f}  {e[:50]} -> {v[:60]}")
    print(f"  a sample of {min(args.sample, len(pairs))} to read (seed {args.seed}, so the same reviewer sees the same ones):")
    for k, e, v in random.Random(args.seed).sample(pairs, min(args.sample, len(pairs))):
        print(f"    {e[:70]}\n      {v[:70]}")
    return 0


def refresh_meta(stamp=False):
    en = english()
    meta = read_json(META)
    meta["strings"] = len(en)
    meta.setdefault("languages", {})
    version = ""
    try:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f:
            version = f.read().strip()
    except OSError:
        pass
    for item in languages():
        code = item["code"]
        path = language_file(code)
        if not os.path.exists(path):
            meta["languages"].pop(code, None)
            continue
        have = read_json(path)
        entry = meta["languages"].get(code, {})
        entry["translated"] = len([k for k in have if k in en])
        if stamp or "updated" not in entry:
            entry["updated"] = date.today().isoformat()
            entry["app_version"] = version
        meta["languages"][code] = entry
    if stamp:
        meta["baseline"] = head_sha()
    write_json(META, meta)
    return meta


def cmd_meta(args):
    meta = refresh_meta(stamp=args.stamp)
    print(f"meta.json: {meta['strings']} texts, languages: {', '.join(sorted(meta['languages'])) or 'none yet'}.")
    return 0


def cmd_languages(args):
    for item in languages():
        mark = "file" if os.path.exists(language_file(item["code"])) else "    "
        print(f"{item['code']:7} {mark}  {item['name']:22} {item['native']}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Deja Vu1's translations.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("extract", help="write frontend/strings/en.json from the page files")
    p.add_argument("--check", action="store_true", help="only say whether the file is up to date")
    sub.add_parser("status", help="what is translated and what is missing")
    p = sub.add_parser("todo", help="the texts a language still lacks")
    p.add_argument("language")
    p.add_argument("--out")
    p.add_argument("--limit", type=int, default=0)
    p = sub.add_parser("merge", help="check answers and store the good ones")
    p.add_argument("language")
    p.add_argument("answers")
    sub.add_parser("check", help="check every stored translation")
    p = sub.add_parser("review", help="what a reviewer should read first")
    p.add_argument("language")
    p.add_argument("--sample", type=int, default=30)
    p.add_argument("--seed", type=int, default=1)
    p = sub.add_parser("meta", help="refresh meta.json")
    p.add_argument("--stamp", action="store_true", help="also record today and the current commit as the baseline")
    sub.add_parser("languages", help="list the languages")
    args = parser.parse_args(argv)
    return {"extract": cmd_extract, "status": cmd_status, "todo": cmd_todo, "merge": cmd_merge, "check": cmd_check,
            "meta": cmd_meta, "languages": cmd_languages, "review": cmd_review}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
