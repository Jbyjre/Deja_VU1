#!/usr/bin/env python3
"""
Translate Deja Vu1's words with the AI you connected in Deja Vu1 (its AI screen).

    python3 tools/translate.py catalogue strings/en.json --to zh-CN            # fills strings/zh-CN.json
    python3 tools/translate.py doc docs/getting-started.md --to zh-CN          # writes docs/zh-CN/getting-started.md
    python3 tools/translate.py doc docs/first-connection.md --to ja --dry-run  # counts only, sends nothing

A catalogue is a JSON file of English strings, flat or nested ({"key": "text"}). Only keys the target
file doesn't have yet are sent, so a second run fills what is new. A document keeps its code blocks,
inline code, link addresses and pictures exactly as they are; only the words are sent.

Every answer is checked before it is written: placeholders ({name}, %s), HTML tags, code and links must
come back unchanged, and names in tools/translation-glossary.json "keep" must stay as written. Anything
that fails twice stays in English and is listed at the end, so nothing broken reaches the app. Screen
names under "fixed" are translated once, saved to the glossary under "chosen", and reused after that.
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLOSSARY = os.path.join(ROOT, "tools", "translation-glossary.json")
BATCH_CHARS = 6000
BATCH_ITEMS = 40
CHARS_PER_TOKEN = 4

LANGUAGES = {"zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese", "ja": "Japanese", "ko": "Korean",
             "de": "German", "fr": "French", "es": "Spanish", "it": "Italian", "pt-BR": "Brazilian Portuguese",
             "pt": "Portuguese", "ru": "Russian", "uk": "Ukrainian", "pl": "Polish", "nl": "Dutch", "tr": "Turkish",
             "sv": "Swedish", "cs": "Czech", "vi": "Vietnamese", "th": "Thai", "id": "Indonesian", "ar": "Arabic",
             "he": "Hebrew", "hi": "Hindi"}

# What must come back exactly as it went: placeholders, printf codes, tags, inline code, glossary links,
# link and picture addresses, bare web addresses.
_PROTECT = re.compile(r"\{[A-Za-z0-9_.]*\}|%\([A-Za-z0-9_]+\)[sd]|%[sdif]|<[^<>\n]{1,200}>|`[^`\n]+`|\[\[[^\]\n]+\]\]"
                      r"|\]\([^)\s]+(?:\s+\"[^\"]*\")?\)|https?://[^\s)<>\"]+")
_TOKEN = re.compile(r"⟦\d+⟧")


def language_name(code):
    return LANGUAGES.get(code, code)


def protect(text):
    """Swap every protected piece for a numbered mark the AI is told to leave alone."""
    pieces = []

    def mark(m):
        pieces.append(m.group(0))
        return f"⟦{len(pieces) - 1}⟧"

    return _PROTECT.sub(mark, text), pieces


def restore(text, pieces):
    return _TOKEN.sub(lambda m: pieces[int(m.group(0)[1:-1])] if int(m.group(0)[1:-1]) < len(pieces) else m.group(0), text)


def problems(source, result, keep):
    """Why a translation can't be used, or [] when it can. Both texts still carry their marks."""
    found = []
    if not isinstance(result, str) or not result.strip():
        return ["came back empty"]
    if sorted(_TOKEN.findall(source)) != sorted(_TOKEN.findall(result)):
        found.append("a placeholder, tag, code or link changed")
    for name in keep:
        if re.search(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", source) and name not in result:
            found.append(f"{name} was translated but must stay as written")
    if result.count("\n") > source.count("\n") + 2:
        found.append("came back with extra lines")
    return found


def load_glossary(path=GLOSSARY):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("keep", [])
    data.setdefault("fixed", [])
    data.setdefault("terms", {})
    data.setdefault("chosen", {})
    return data


def _instructions(lang, glossary):
    terms = dict(glossary["terms"].get(lang, {}))
    terms.update(glossary["chosen"].get(lang, {}))
    lines = [
        f"You translate the words of Deja Vu1, a dashboard for the Snapmaker U1 3D printer, from English into "
        f"{language_name(lang)}. Write as a careful native speaker would for someone using a 3D printer at home: "
        "plain, short, friendly, and consistent.",
        "You receive a JSON object of numbered English texts. Answer with only a JSON object with the same keys and "
        "each value translated. No other words, no code fence.",
        "Marks like ⟦0⟧ stand for code, placeholders or links: copy every mark exactly, once each, where it fits "
        "in the sentence. Keep Markdown markers (#, -, *, |, >, numbered lists) and line breaks where they are.",
        "Never translate these names: " + ", ".join(glossary["keep"]) + ".",
    ]
    if terms:
        lines.append("Use these translations every time: " + "; ".join(f"{en} = {tr}" for en, tr in sorted(terms.items())) + ".")
    return "\n".join(lines)


def _parse(answer):
    text = str(answer or "").strip()
    text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return {}
    try:
        data = json.loads(text[start:end + 1])
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _batches(items):
    batch, size = {}, 0
    for key, text in items.items():
        if batch and (len(batch) >= BATCH_ITEMS or size + len(text) > BATCH_CHARS):
            yield batch
            batch, size = {}, 0
        batch[key] = text
        size += len(text)
    if batch:
        yield batch


class Translator:
    """Sends numbered texts in batches and keeps only answers that pass the checks."""

    def __init__(self, lang, ask, glossary):
        self.lang, self.ask, self.glossary = lang, ask, glossary
        self.sent_chars = 0
        self.requests = 0
        self.failed = []                      # (key, english, why)

    def _send(self, batch):
        text = json.dumps(batch, ensure_ascii=False, indent=0)
        system = _instructions(self.lang, self.glossary)
        self.sent_chars += len(system) + len(text)
        self.requests += 1
        return _parse(self.ask(system, text))

    def choose_fixed(self):
        """Translate each fixed screen name once, so it reads the same everywhere afterwards."""
        chosen = self.glossary["chosen"].setdefault(self.lang, {})
        missing = {str(i): name for i, name in enumerate(self.glossary["fixed"]) if name not in chosen}
        if not missing:
            return False
        answer = self._send(missing)
        for key, name in missing.items():
            value = answer.get(key)
            if isinstance(value, str) and value.strip() and "\n" not in value:
                chosen[name] = value.strip()
        return True

    def run(self, items):
        """items: {key: English}. Returns {key: translation} for those that passed."""
        masked = {key: protect(text) for key, text in items.items()}
        out, retry = {}, {}
        for batch in _batches({k: m[0] for k, m in masked.items()}):
            answer = self._send(batch)
            for key, source in batch.items():
                if problems(source, answer.get(key), self.glossary["keep"]):
                    retry[key] = source
                else:
                    out[key] = restore(answer[key], masked[key][1])
        for key, source in retry.items():                       # once more, on its own
            answer = self._send({key: source})
            why = problems(source, answer.get(key), self.glossary["keep"])
            if why:
                self.failed.append((key, items[key], "; ".join(why)))
            else:
                out[key] = restore(answer[key], masked[key][1])
        return out


# ---- catalogues ----------------------------------------------------------------

def flatten(data, prefix=""):
    out = {}
    for key, value in data.items():
        name = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            out.update(flatten(value, name))
        elif isinstance(value, str):
            out[name] = value
    return out


def unflatten(flat, like):
    """Put dotted keys back in the shape of the English file, in its order."""
    def build(node, prefix):
        out = {}
        for key, value in node.items():
            name = f"{prefix}.{key}" if prefix else str(key)
            if isinstance(value, dict):
                inner = build(value, name)
                if inner:
                    out[key] = inner
            elif name in flat:
                out[key] = flat[name]
        return out
    return build(like, "")


def translate_catalogue(english, existing, lang, ask, glossary, redo=False):
    """Returns (translated catalogue in the English file's shape, Translator with what failed)."""
    source, have = flatten(english), flatten(existing or {})
    todo = {k: v for k, v in source.items() if redo or k not in have}
    tr = Translator(lang, ask, glossary)
    if todo:
        tr.choose_fixed()
    done = {k: v for k, v in have.items() if k in source}
    done.update(tr.run({k: v for k, v in todo.items() if v.strip()}))
    return unflatten(done, english), tr


# ---- documents -----------------------------------------------------------------

_FENCE = re.compile(r"^(```|~~~)")


def _blocks(text):
    """Split Markdown into (kind, text): 'code' for fenced blocks, 'blank', or 'words' paragraphs."""
    blocks, para, fence = [], [], None
    for line in text.split("\n"):
        if fence:
            blocks[-1][1].append(line)
            if line.strip().startswith(fence):
                fence = None
            continue
        m = _FENCE.match(line.strip())
        if m:
            if para:
                blocks.append(("words", para))
                para = []
            fence = m.group(1)
            blocks.append(("code", [line]))
            continue
        if not line.strip():
            if para:
                blocks.append(("words", para))
                para = []
            blocks.append(("blank", [line]))
            continue
        para.append(line)
    if para:
        blocks.append(("words", para))
    return [(kind, "\n".join(lines)) for kind, lines in blocks]


def translate_markdown(text, lang, ask, glossary):
    """Returns (translated document, Translator). Code blocks never leave this computer's copy."""
    blocks = _blocks(text)
    items = {str(i): body for i, (kind, body) in enumerate(blocks)
             if kind == "words" and re.search(r"[A-Za-z]{2}", _TOKEN.sub("", protect(body)[0]))}
    tr = Translator(lang, ask, glossary)
    if items:
        tr.choose_fixed()
    done = tr.run(items)
    return "\n".join(done.get(str(i), body) for i, (kind, body) in enumerate(blocks)), tr


# ---- the connected AI ------------------------------------------------------------

def connected_ask():
    """The AI in use on Deja Vu1's AI screen, with its model. Reads the same data folder as the app."""
    sys.path.insert(0, os.path.join(ROOT, "backend"))
    import ai_assistant
    import ai_providers
    status = ai_assistant.status()
    if not status["ready"]:
        raise SystemExit("Connect an AI in Deja Vu1 first (the AI screen), then run this again.")
    pid, model = status["provider"], status["model"]
    totals = {"in": 0, "out": 0, "cost": 0.0}

    def ask(system, text):
        reply = ai_providers.ask(pid, model, system, [{"role": "user", "text": text}])
        used = getattr(reply, "usage", None) or {}
        totals["in"] += used.get("in") or 0
        totals["out"] += used.get("out") or 0
        totals["cost"] += used.get("cost_usd") or 0.0
        return str(reply)

    name = next((p["name"] for p in status["providers"] if p["id"] == pid), pid)
    ask.totals, ask.name = totals, name + (" · " + model if model else "")
    ask.plan = ai_providers.provider(pid)["kind"] == "cli"
    return ask


def _report(tr, label):
    print(f"{label}: {tr.requests} request(s), about {tr.sent_chars // CHARS_PER_TOKEN:,} tokens sent "
          f"(counted at about {CHARS_PER_TOKEN} characters a token).")
    if tr.failed:
        print(f"{len(tr.failed)} stayed in English because the answer didn't pass the checks:")
        for key, english, why in tr.failed:
            print(f"  {key}: {why}: {english[:80]}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Translate Deja Vu1's words with the AI you connected in Deja Vu1.")
    parser.add_argument("kind", choices=("catalogue", "doc"))
    parser.add_argument("source")
    parser.add_argument("--to", required=True, help="language code, such as zh-CN, ja, de")
    parser.add_argument("--out", help="where to write (default: beside the source, named for the language)")
    parser.add_argument("--redo", action="store_true", help="catalogue: translate every key again")
    parser.add_argument("--dry-run", action="store_true", help="count what would be sent; send nothing")
    args = parser.parse_args(argv)
    glossary = load_glossary()
    with open(args.source, encoding="utf-8") as f:
        raw = f.read()
    if args.kind == "catalogue":
        english = json.loads(raw)
        out = args.out or os.path.join(os.path.dirname(args.source), args.to + ".json")
        existing = {}
        if os.path.exists(out):
            with open(out, encoding="utf-8") as f:
                existing = json.load(f)
        todo = {k: v for k, v in flatten(english).items() if args.redo or k not in flatten(existing)}
        chars = sum(len(v) for v in todo.values())
    else:
        out = args.out or os.path.join(os.path.dirname(args.source), args.to, os.path.basename(args.source))
        todo = [b for k, b in _blocks(raw) if k == "words"]
        chars = sum(len(b) for b in todo)
    print(f"{len(todo)} piece(s) to translate into {language_name(args.to)}, about {chars // CHARS_PER_TOKEN:,} tokens "
          "of English plus the instructions with each request.")
    if args.dry_run or not todo:
        return 0
    ask = connected_ask()
    print(f"Using {ask.name}.")
    if args.kind == "catalogue":
        result, tr = translate_catalogue(english, existing, args.to, ask, glossary, args.redo)
        text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    else:
        text, tr = translate_markdown(raw, args.to, ask, glossary)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    with open(GLOSSARY, "w", encoding="utf-8") as f:
        json.dump(glossary, f, ensure_ascii=False, indent=2)
        f.write("\n")
    _report(tr, f"Wrote {os.path.relpath(out)}")
    t = ask.totals
    if t["in"] or t["out"]:
        cost = f", ${t['cost']:.4f}" + (" at list price, which your plan covers" if ask.plan else "") if t["cost"] else ""
        print(f"The service reported {t['in']:,} tokens in and {t['out']:,} out{cost}."
              + (" A plan's program adds its own instructions to each request." if ask.plan else ""))
    return 1 if tr.failed else 0


if __name__ == "__main__":
    sys.exit(main())
