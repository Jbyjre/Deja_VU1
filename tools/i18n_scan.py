"""
Finds the words a person sees in Deja Vu1's page files, so they can be listed in one catalogue.

It reads text, never runs it: frontend/index.html and the scripts it loads. Standard library only.

What counts as a word on screen:
  - a quoted string or a template string in a script that reads like text for people ("Needs you",
    "Couldn't change {0}: {1}"), not a name, a path, a style or a selector;
  - the text between tags and the title, placeholder, aria-label, alt and data-tip words inside any
    HTML written in the page or in a script.
A `${...}` inside a template string becomes {0}, {1} ... in order, so a sentence made of pieces is one
entry. Strings handed to I18n.t('...') are always taken, whatever they look like.

The same text found twice is listed once, with the files it was found in (the translator sees them as
context). Whitespace inside a text is collapsed to single spaces, as the page does when it matches.
"""

import ast
import hashlib
import html
import json
import os
import re
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")

# Scripts that are not the app's words: the recording of the online demo, a generated report, a worker.
SKIP_FILES = {"sw.js", "theme-boot.js", "slicer-gcode-worker.js", "tester.js", "tester-study.js"}
SKIP_DIRS = {"demo", "media", "fonts", "img", "strings"}
PAGES = ("index.html",)                           # the app; welcome.html is the product page and has its own words

# Server modules whose sentences reach the screen as they are written (the page shows what the server says). Only these
# are read; a message that is a name or a code is left out by the same rules as the page's own words.
BACKEND_FILES = (
    "print_gate.py", "maintenance.py", "readiness.py", "printer_control.py", "modules.py", "slicer_working.py", "color_check.py",
    "insights.py", "sandbox.py", "slice_diagnosis.py", "slicer_bridge.py", "slicer_bridge_part1.py", "project_plates.py",
    "engine_installer.py", "engine_support.py", "filament_inventory.py", "tool_setup.py", "notifications.py", "automations.py",
    "app_updates.py", "printer_extras.py", "timelapse.py", "pairing.py", "remote.py", "backup.py", "cost_calculator.py", "logbook.py",
    "spoolman_bridge.py", "print_queue.py", "fleet.py", "discovery.py", "layer_planner.py",
)
BACKEND = os.path.join(ROOT, "backend")

ATTRS = ("title", "placeholder", "aria-label", "alt", "data-tip", "data-title", "label")
MAX_LEN = 1200
KEY_LEN = 10
MAX_SLOTS = 6

_SLOT = re.compile(r"\{\d+\}")
_LETTERS = re.compile(r"[^\W\d_]{2,}")
_IDENT = re.compile(r"^[a-z][a-z0-9_.:\-/#\[\]=@*+~>,()]*$")             # a name, selector or event, all lowercase
_CAMEL = re.compile(r"^[a-z]+(?:[A-Z][a-z0-9]*)+$")
_PATHISH = re.compile(r"^(?:[./#]|[a-z]+://|data:|mailto:|<!--)")
_SVGPATH = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9\s.,\-+eE]+$")
_UPPER_ID = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")                          # CONSTANT_NAMES and HTTP verbs
_STYLE = re.compile(r"^(?:[a-z-]+\s*:\s*[^;]+;?\s*)+$")                  # a style declaration
_FUNC = re.compile(r"^[a-z-]+\([^)]*\)$")                                # rgba(...), translate(...), url(...)
_FONT = re.compile(r"^(?:['\"]?[A-Za-z0-9 \-]+['\"]?,\s*)+(?:sans-serif|serif|monospace|system-ui|ui-[a-z-]+)$")
_NUMERIC = re.compile(r"^[\s\d.,:;%+\-/*xX°·•–—…{}]*$")
_MIME = re.compile(r"^[a-z]+/[a-z0-9.+\-]+$")
_CODEISH = re.compile(r"[A-Z][A-Z0-9_]{2,}=|--[a-z]|^\$|\b[a-z-]+=[\"']|\[[a-z-]+(?:[=\]~^$|*])|:not\(|^\([a-z-]+:[^)]*\)$|^\w+\s*\(.*\)\s*[;{]?$")
_BRACES = re.compile(r"[{}]")
_SELECTOR = re.compile(r"(?:^|[\s,>+~])[.#][a-zA-Z_][\w-]*|\b[a-z]+\.[a-z][\w-]+(?:,|\s*$)")


def key_for(text):
    """A short, steady name for a text: the same words always give the same key."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:KEY_LEN]


def normalise(text):
    return re.sub(r"\s+", " ", text).strip()


def letters_outside_slots(text):
    """How many letters stand outside the {n} pieces: a sentence with 4 or more is worth a pattern."""
    return sum(len(run) for run in _LETTERS.findall(_SLOT.sub(" ", text)))


UNITS = {"mm", "cm", "kg", "kb", "mb", "gb", "ms", "px", "min", "hz", "rpm", "pla", "petg", "abs", "asa", "tpu", "stl", "obj"}
_DOMAIN = re.compile(r"^(?:https?://)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:/\S*)?$")
_BARE = "()[]“”\"'‘’.,:;!?…·•–—"


def looks_like_words(text, relaxed=False):
    """True when a string reads as something written for a person. `relaxed` is for the text between tags in HTML,
    where a lowercase word such as "or" or "paused" is a real piece of a sentence and a leading dot is just punctuation."""
    text = normalise(text)
    if not text or len(text) > MAX_LEN or not _LETTERS.search(_SLOT.sub(" ", text)):
        return False
    if relaxed:
        bare = text.strip(_BARE)
        if " " not in text and re.fullmatch(r"[^\W\d_]{2,}", bare) and bare.lower() not in UNITS:
            return True
        if " " in text and not re.match(r"(?:[a-z]+://|data:|mailto:)", text) and not _CODEISH.search(text):
            text = text.lstrip(_BARE + " ") or text
    if _DOMAIN.match(text) and " " not in text:
        return False
    if " " not in text and text.lower() in UNITS:
        return False
    if _PATHISH.match(text) or (_SVGPATH.match(text) and re.search(r"\d", text)) or _NUMERIC.match(_SLOT.sub("", text)) or _MIME.match(text):
        return False
    if _CODEISH.search(text) or (_SELECTOR.search(text) and not re.search(r"[A-Z]", text)) or _BRACES.search(_SLOT.sub("", text)) or text.count("{") > MAX_SLOTS:
        return False
    if _SLOT.search(text) and letters_outside_slots(text) < 4:
        return False
    if _IDENT.match(text) or _CAMEL.match(text) or _UPPER_ID.match(text) or _FUNC.match(text) or _FONT.match(text):
        return False
    if _STYLE.match(text) and ":" in text:
        return False
    if " " not in text:
        # One word: a label such as "Temperatures" or "Halt" starts with a capital; a lowercase or mixed-case one is a name.
        if not text[0].isupper() and not re.match(r"^[^\x00-\x7f]", text):
            return False
        if re.search(r"[a-z][A-Z]", text) or "_" in text:
            return False
        return len(text) >= 2
    # Several words. A list of class names or ids ("is-open tab-panel", "a.b c.d") has joined or dotted names; plain words are a phrase.
    words = text.split(" ")
    joined = [w for w in words if re.search(r"[-_.]", w) and _IDENT.match(w)]
    if len(joined) * 2 >= len(words) and not re.search(r"[A-Z!?]", text) and not text.endswith("."):
        return False
    return True


# ---- scripts -------------------------------------------------------------------------------------

_ESC = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
_REGEX_AFTER = set("(,=:[!&|?{};+-*%<>~^") | {None}
_KEYWORDS_BEFORE_REGEX = {"return", "typeof", "case", "do", "else", "in", "of", "void", "delete", "throw", "new", "yield", "await"}


def _unescape(raw):
    out, i = [], 0
    while i < len(raw):
        c = raw[i]
        if c != "\\" or i + 1 >= len(raw):
            out.append(c)
            i += 1
            continue
        n = raw[i + 1]
        if n == "u" and raw[i + 2:i + 3] == "{":
            end = raw.find("}", i)
            try:
                out.append(chr(int(raw[i + 3:end], 16)))
                i = end + 1
                continue
            except ValueError:
                pass
        if n == "u" and re.match(r"[0-9a-fA-F]{4}", raw[i + 2:i + 6]):
            out.append(chr(int(raw[i + 2:i + 6], 16)))
            i += 6
            continue
        if n == "x" and re.match(r"[0-9a-fA-F]{2}", raw[i + 2:i + 4]):
            out.append(chr(int(raw[i + 2:i + 4], 16)))
            i += 4
            continue
        if n == "\n":
            i += 2
            continue
        out.append(_ESC.get(n, n))
        i += 2
    return "".join(out)


class Literal:
    __slots__ = ("kind", "text", "line", "call")

    def __init__(self, kind, text, line, call=False):
        self.kind, self.text, self.line, self.call = kind, text, line, call


def lex(source, base_line=1, out=None):
    """Every quoted and template string in a script: [Literal]. Comments and regular expressions are skipped.
    A template string becomes one literal whose `${...}` are {0}, {1}...; strings inside the `${...}` are found too."""
    out = [] if out is None else out
    n, i, line = len(source), 0, base_line
    prev = None                                                   # the last significant token: a character, or a word
    while i < n:
        c = source[i]
        if c == "\n":
            line += 1
            i += 1
            continue
        if c in " \t\r":
            i += 1
            continue
        if c == "/" and source[i + 1:i + 2] == "/":
            j = source.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and source[i + 1:i + 2] == "*":
            j = source.find("*/", i + 2)
            j = n if j < 0 else j + 2
            line += source.count("\n", i, j)
            i = j
            continue
        if c in "'\"":
            j = i + 1
            while j < n and source[j] != c and source[j] != "\n":
                j += 2 if source[j] == "\\" else 1
            k = j + 1
            while k < n and source[k] in " \t\r\n":
                k += 1
            is_key = source[k:k + 1] == ":" and prev in ("{", ",", "case")          # { 'name': ... } and case 'x': are names, not words
            if not is_key or prev == "t(":
                out.append(Literal("str", _unescape(source[i + 1:j]), line, prev == "t("))
            prev = "str"
            i = j + 1
            continue
        if c == "`":
            text, i, line = _template(source, i, line, out, prev == "t(")
            prev = "tpl"
            continue
        if c == "/":
            if prev in _REGEX_AFTER or prev in _KEYWORDS_BEFORE_REGEX:
                j, in_class = i + 1, False
                while j < n and source[j] != "\n":
                    if source[j] == "\\":
                        j += 2
                        continue
                    if source[j] == "[":
                        in_class = True
                    elif source[j] == "]":
                        in_class = False
                    elif source[j] == "/" and not in_class:
                        break
                    j += 1
                i = j + 1
                while i < n and source[i].isalpha():
                    i += 1
                prev = "regex"
                continue
            prev = "/"
            i += 1
            continue
        if c.isalnum() or c in "_$":
            j = i
            while j < n and (source[j].isalnum() or source[j] in "_$"):
                j += 1
            word = source[i:j]
            prev = word
            if word == "t" and source[max(0, i - 5):i] == "I18n." and source[j:j + 1] == "(":
                prev = "t("                                     # I18n.t('...'): the page's own call, always words
                j += 1
            i = j
            continue
        prev = c
        i += 1
    return out


def _template(source, i, line, out, call):
    """source[i] is a backtick. Returns (text, index after the closing backtick, line)."""
    n, j, parts, start, slots = len(source), i + 1, [], i + 1, 0
    start_line = line
    while j < n and source[j] != "`":
        if source[j] == "\\":
            j += 2
            continue
        if source[j] == "$" and source[j + 1:j + 2] == "{":
            parts.append(_unescape(source[start:j]))
            parts.append("{%d}" % slots)
            slots += 1
            depth, k, inner_start = 1, j + 2, j + 2
            while k < n and depth:
                ch = source[k]
                if ch in "'\"":
                    k += 1
                    while k < n and source[k] != ch:
                        k += 2 if source[k] == "\\" else 1
                elif ch == "`":
                    _, k, _ = _template(source, k, line, [], False)
                    continue
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                k += 1
            lex(source[inner_start:k - 1], line + source.count("\n", i, inner_start), out)
            j = k
            start = j
            continue
        j += 1
    parts.append(_unescape(source[start:j]))
    text = "".join(parts)
    line += source.count("\n", i, j)
    out.append(Literal("tpl", text, start_line, call))
    return text, j + 1, line


# ---- html ----------------------------------------------------------------------------------------

NOT_WORDS = ("script", "style", "pre", "code", "samp", "kbd", "textarea")    # code to copy, keys, and what a person types
VOID = {"br", "hr", "img", "input", "meta", "link", "source", "wbr", "path", "circle", "rect", "line", "use", "area", "col"}


class _Words(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found, self._stack = [], []

    def _attrs(self, attrs):
        for name, value in attrs:
            if name in ATTRS and value:
                self.found.append(value)

    def _off(self):
        return any(off for _tag, off in self._stack)

    def handle_starttag(self, tag, attrs):
        if not self._off():
            self._attrs(attrs)
        if tag not in VOID:
            off = tag in NOT_WORDS or dict(attrs).get("translate") == "no" or "data-no-i18n" in dict(attrs)
            self._stack.append((tag, off))

    def handle_startendtag(self, tag, attrs):
        if not self._off():
            self._attrs(attrs)

    def handle_endtag(self, tag):
        for i in range(len(self._stack) - 1, -1, -1):
            if self._stack[i][0] == tag:
                del self._stack[i:]
                break

    def handle_data(self, data):
        if not self._off():
            self.found.append(data)


def html_words(fragment):
    """The texts and the words in title, placeholder, aria-label, alt and data-tip inside a piece of HTML."""
    if not re.search(r"<[A-Za-z/!]", fragment):
        # Only attributes, as in `disabled title="Fix this first"`: the quoted words are the text.
        pairs = re.findall(r"\b(?:%s)=(?:\"([^\"]*)\"|'([^']*)')" % "|".join(ATTRS), fragment)
        return [double if double else single for double, single in pairs]
    parser = _Words()
    try:
        parser.feed(fragment)
        parser.close()
    except Exception:                                              # a fragment cut in the middle of a tag
        pass
    return parser.found


def _is_html(text):
    return bool(re.search(r"<[A-Za-z/!][^>]*>", text)) or bool(re.search(r"\b(?:title|placeholder|aria-label|alt|data-tip)=", text))


_EDGE_LEAD = re.compile(r"^(?:\{\d+\}\s*)+")
_EDGE_TRAIL = re.compile(r"(?:\s*\{\d+\})+$")


def _with_edges_removed(text):
    """In HTML a piece at the start or end of a text is often an icon or a tag the browser turns into an element, so the text
    node is only the words ("${icon}Sync" is the text "Sync"). Both are listed, except that a piece stuck to the word is an element."""
    bare = _EDGE_TRAIL.sub("", _EDGE_LEAD.sub("", text)).strip()
    if bare == text or not _LETTERS.search(bare):
        return [text]
    if not _SLOT.search(text):
        return [text]
    stuck = re.match(r"^\{\d+\}[^\s{]", text) or re.search(r"[^\s}]\{\d+\}$", text)
    return [bare] if stuck else [text, bare]


def _collect(text, accept_all=False):
    """The entries one literal gives: itself, or the words inside its tags."""
    if accept_all:
        return [normalise(text)] if normalise(text) else []
    if _is_html(text):
        out = []
        for w in html_words(text):
            out += [v for v in _with_edges_removed(normalise(w)) if looks_like_words(v, relaxed=True)]
        return out
    if re.search(r"&(?:[a-zA-Z]+|#\d+);", text):                       # "Save &amp; close" is meant for innerHTML
        text = html.unescape(text)
    return [normalise(text)] if looks_like_words(text) else []


# ---- the whole app -------------------------------------------------------------------------------

def source_files(frontend=FRONTEND):
    names = [name for name in PAGES if os.path.exists(os.path.join(frontend, name))]
    for name in sorted(os.listdir(frontend)):
        if name.endswith(".js") and name not in SKIP_FILES:
            names.append(name)
    return names


def scan_file(path):
    """[(text, line)] for one page or script."""
    with open(path, encoding="utf-8") as f:
        source = f.read()
    found = []
    if path.endswith(".html"):
        scripts = []
        page = re.sub(r"<script\b[^>]*>(.*?)</script>", lambda m: scripts.append((m.group(1), source[:m.start()].count("\n") + 1)) or "", source, flags=re.S)
        for text in _collect(re.sub(r"<!--.*?-->", "", page, flags=re.S)):
            found.append((text, 0))
        for code, line in scripts:
            for lit in lex(code, line):
                found += [(t, lit.line) for t in _collect(lit.text, lit.call)]
        return found
    for lit in lex(source):
        found += [(t, lit.line) for t in _collect(lit.text, lit.call)]
    return found


def scan_python(path):
    """[text] for one server module: its strings and f-strings (an f-string's `{...}` become {0}, {1} ...), without docstrings."""
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    skip = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(getattr(first, "value", None), ast.Constant):
                skip.add(id(first.value))
        if isinstance(node, ast.JoinedStr):
            skip.update(id(v) for v in node.values if isinstance(v, ast.Constant))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in skip:
            found.append(node.value)
        elif isinstance(node, ast.JoinedStr):
            parts, n = [], 0
            for value in node.values:
                if isinstance(value, ast.Constant):
                    parts.append(str(value.value))
                else:
                    parts.append("{%d}" % n)
                    n += 1
            found.append("".join(parts))
    return [t for t in (normalise(x) for x in found) if looks_like_words(t)]


def scan(frontend=FRONTEND, backend=BACKEND):
    """{text: [file, ...]} in the order first met, for the whole app: the page first, then the server's own sentences."""
    found = {}
    for name in source_files(frontend):
        for text, _line in scan_file(os.path.join(frontend, name)):
            places = found.setdefault(text, [])
            if name not in places:
                places.append(name)
    for name in BACKEND_FILES:
        path = os.path.join(backend, name)
        if os.path.exists(path):
            for text in scan_python(path):
                places = found.setdefault(text, [])
                if name not in places:
                    places.append(name)
    return found


def catalogue(found):
    """{key: text} with a longer key where two different texts share a short one."""
    out = {}
    for text in found:
        size = KEY_LEN
        key = hashlib.sha1(text.encode("utf-8")).hexdigest()[:size]
        while key in out and out[key] != text:
            size += 2
            key = hashlib.sha1(text.encode("utf-8")).hexdigest()[:size]
        out[key] = text
    return out


def dump(data):
    return json.dumps(data, ensure_ascii=False, indent=1) + "\n"


def unescape_html(text):
    return html.unescape(text)
