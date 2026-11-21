"""
wiki_page.py
============

Turns the HTML of one page of Snapmaker's public wiki into a short list of plain blocks, so the dashboard
can show a troubleshooting guide in its own style without ever handing the browser someone else's HTML.

What comes out is data only:

    {"title": "U1 homing anomaly", "codes": ["0002-0528-0000-0000", ...],
     "blocks": [{"t": "h", "l": 1, "x": "Procedure"},
                {"t": "p", "r": [{"x": "Turn the printer off.", "b": True}]},
                {"t": "list", "o": False, "i": [{"d": 0, "r": [...]}]},
                {"t": "note", "k": "warning", "p": [[...runs...]]},
                {"t": "img", "src": "https://wiki.snapmaker.com/u1/a.jpg", "alt": "..."},
                {"t": "video", "src": "https://wiki.snapmaker.com/u1/a.mp4"},
                {"t": "table", "rows": [[[...runs...], ...], ...]}],
     "videos": [{"id": "agm4H0GITqE", "title": "...", "start": 615}]}

A run is {"x": text} plus, where they apply, "b" (bold), "u" (a link) and "yt" / "start" (a YouTube video the
link points to). Every link, picture and clip is checked: only https addresses are kept, pictures and clips only
from the wiki's own host, YouTube only by its 11-character video id. Nothing in the page can reach the browser
as markup, so the page that shows it only has to escape the text, as it does everywhere else.

Standard library only.
"""

import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

WIKI_HOST = "wiki.snapmaker.com"
WIKI_ORIGIN = "https://" + WIKI_HOST
CODE_RE = re.compile(r"(?<![\d-])\d{4}-\d{4}-\d{4}-\d{4}(?![\d-])")

MAX_BLOCKS = 700
MAX_TEXT = 3000                  # characters in one block of text
MEDIA_EXTENSIONS = {"image": (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"), "video": (".mp4", ".webm")}

_YT = re.compile(r"(?:youtube(?:-nocookie)?\.com/(?:watch\?(?:[^\s\"'<>#]*?&)?v=|embed/|shorts/)|youtu\.be/)"
                 r"([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])([^\s\"'<>#]*)", re.I)
_NOTE = {"is-info": "info", "is-warning": "warning", "is-danger": "danger", "is-success": "success"}
_BLOCK_TEXT = {"p", "div", "section", "article", "center"}
_SKIP = {"script", "style", "noscript", "svg", "iframe", "head", "nav", "button", "form", "select", "textarea"}
_INVISIBLE = dict.fromkeys(map(ord, "⁠​‌‍﻿­"), None)


def youtube_in(url):
    """(video id, start second) for a YouTube address, else None."""
    found = _YT.search(str(url or ""))
    if not found:
        return None
    start = 0
    stamp = re.search(r"[?&](?:t|start)=(?:(\d+)h)?(?:(\d+)m)?(\d+)?s?(?:&|$)", "?" + found.group(2).lstrip("?&"))
    if stamp and any(stamp.groups()):
        h, m, s = (int(x) if x else 0 for x in stamp.groups())
        start = h * 3600 + m * 60 + s
    return found.group(1), start if 0 <= start < 86400 else 0


def safe_link(url, base=WIKI_ORIGIN):
    """An https address worth following, or None. Wiki-relative addresses are completed; anchors are dropped."""
    url = str(url or "").strip()
    if not url or url.startswith("#"):
        return None
    full = urljoin(base + "/", url)
    parts = urlsplit(full)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return None
    return full[:600]


def media_source(url, kind):
    """The wiki's own picture or clip as a full https address, else None (nothing from anywhere else is shown)."""
    url = str(url or "").strip()
    if not url or url.startswith("//"):
        return None
    full = urljoin(WIKI_ORIGIN + "/", url)
    parts = urlsplit(full)
    if parts.scheme != "https" or (parts.hostname or "").lower() != WIKI_HOST or parts.port not in (None, 443):
        return None
    if not parts.path.lower().endswith(MEDIA_EXTENSIONS[kind]):
        return None
    return full[:600]


def _clean(text):
    text = str(text or "").translate(_INVISIBLE).replace("\xa0", " ")
    return re.sub(r"[ \t\r\f\v]+", " ", text)


def plain(runs):
    """The words of a list of runs as one string."""
    return "".join(r.get("x", "") for r in runs or []).strip()


def _tidy(runs):
    """Merge neighbouring runs that look the same and trim the ends. Empty in, empty out."""
    merged = []
    for run in runs:
        text = run["x"]
        if not text:
            continue
        look = {k: v for k, v in run.items() if k != "x"}
        if merged and {k: v for k, v in merged[-1].items() if k != "x"} == look:
            merged[-1]["x"] += text
        else:
            merged.append(dict(run))
    while merged and not merged[0]["x"].strip():
        merged.pop(0)
    while merged and not merged[-1]["x"].strip():
        merged.pop()
    if not merged:
        return []
    merged[0]["x"] = re.sub(r"^[ \n]+", "", merged[0]["x"])
    merged[-1]["x"] = re.sub(r"[ \n]+$", "", merged[-1]["x"])
    for run in merged:
        run["x"] = re.sub(r" *\n *", "\n", re.sub(r"\n{3,}", "\n\n", run["x"]))
    total, kept = 0, []
    for run in merged:
        if total >= MAX_TEXT:
            break
        run["x"] = run["x"][:MAX_TEXT - total]
        total += len(run["x"])
        kept.append(run)
    return kept


class _Reader(HTMLParser):
    def __init__(self, max_table_rows=60):
        super().__init__(convert_charrefs=True)
        self.max_table_rows = max_table_rows
        self.title = ""
        self.blocks = []
        self.videos = []
        self.codes_in_text = []
        self._in_title = False
        self._in_contents = False
        self._template_depth = 0
        self._skip = 0
        self._runs = []
        self._bold = 0
        self._link = None            # {"u": ..., "yt": ..., "start": ...} while inside a link
        self._heading = None
        self._lists = []             # open lists, innermost last: {"o": ordered}
        self._list_items = None      # the outermost list's items while it is open
        self._item = None            # the list item being read: {"d": depth}
        self._note = None            # {"k": kind, "p": [runs, ...]} while inside a blockquote
        self._table = None           # {"rows": [...], "row": [...] or None, "cell": runs or None}
        self._pre = None
        self._video_open = False

    # -- helpers ------------------------------------------------------------------------------------------

    def _full(self):
        return len(self.blocks) >= MAX_BLOCKS

    def _push(self, block):
        if not self._full():
            self.blocks.append(block)

    def _target(self):
        """Where inline text goes right now."""
        if self._table is not None and self._table["cell"] is not None:
            return self._table["cell"]
        return self._runs

    def _flush_text(self):
        """The text read so far becomes a paragraph, a list item, a note paragraph or part of a table cell."""
        runs = _tidy(self._runs)
        self._runs = []
        if not runs:
            return
        if self._item is not None:
            self._item.setdefault("r", [])
            self._item["r"] = _tidy(self._item["r"] + ([{"x": "\n"}] if self._item["r"] else []) + runs)
        elif self._note is not None:
            self._note["p"].append(runs)
        else:
            self._push({"t": "p", "r": runs})

    def _add_text(self, text):
        text = _clean(text)
        if not text:
            return
        run = {"x": text}
        if self._bold:
            run["b"] = True
        if self._link:
            run.update(self._link)
        self._target().append(run)
        for code in CODE_RE.findall(text):
            if code not in self.codes_in_text:
                self.codes_in_text.append(code)
        # An address written out in the text still names a video worth showing.
        for found in _YT.finditer(text):
            self._note_video(found.group(1), youtube_in(found.group(0))[1], "")

    def _note_video(self, vid, start, title):
        for known in self.videos:
            if known["id"] == vid:
                if title and not known["title"]:
                    known["title"] = title
                return
        if len(self.videos) < 24:
            self.videos.append({"id": vid, "title": title, "start": start})

    def _media(self, kind, src, alt=""):
        self._flush_text()
        good = media_source(src, kind)
        if good:
            block = {"t": "img" if kind == "image" else "video", "src": good}
            if kind == "image":
                block["alt"] = _clean(alt).strip()[:200]
            self._push(block)

    # -- the tags -----------------------------------------------------------------------------------------

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        if tag == "template":
            if a.get("slot") == "contents" and not self._in_contents:
                self._in_contents, self._template_depth = True, 1
            elif self._in_contents:
                self._template_depth += 1
            return
        if not self._in_contents:
            return
        if tag in _SKIP:
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "iframe":
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush_text()
            self._heading = {"l": min(int(tag[1]), 3), "id": a.get("id", "")[:80]}
        elif tag in _BLOCK_TEXT or tag in ("blockquote", "tr"):
            self._flush_text()
            if tag == "blockquote":
                kind = next((v for k, v in _NOTE.items() if k in a.get("class", "").split()), "info")
                if self._note is None:
                    self._note = {"k": kind, "p": []}
            if tag == "tr" and self._table is not None:
                self._table["row"] = []
        elif tag in ("ul", "ol"):
            self._flush_text()
            if not self._lists:
                self._list_items = []
            self._lists.append({"o": tag == "ol"})
        elif tag == "li":
            self._flush_text()
            self._end_item()
            self._item = {"d": max(0, len(self._lists) - 1), "r": []}
        elif tag == "table":
            self._flush_text()
            self._table = {"rows": [], "row": None, "cell": None}
        elif tag in ("td", "th") and self._table is not None:
            if self._table["row"] is None:
                self._table["row"] = []
            self._table["cell"] = []
        elif tag == "br":
            self._target().append({"x": "\n"})
        elif tag in ("strong", "b"):
            self._bold += 1
        elif tag == "a":
            link = safe_link(a.get("href"))
            self._link = None
            if link:
                self._link = {"u": link}
                video = youtube_in(link)
                if video:
                    self._link.update({"yt": video[0], "start": video[1]})
        elif tag == "img":
            self._media("image", a.get("src") or a.get("data-src"), a.get("alt", ""))
        elif tag == "video":
            self._video_open = True
            if a.get("src"):
                self._media("video", a["src"])
        elif tag == "source" and self._video_open and a.get("src"):
            self._media("video", a["src"])
        elif tag == "pre":
            self._flush_text()
            self._pre = []

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag == "template" and self._in_contents:
            self._template_depth -= 1
            if self._template_depth <= 0:
                self._flush_all()
                self._in_contents = False
            return
        if not self._in_contents:
            return
        if tag in _SKIP:
            if self._skip:
                self._skip -= 1
            return
        if self._skip:
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self._heading is not None:
            text = plain(_tidy(self._runs)).replace("\n", " ").replace("¶", "").strip()
            self._runs = []
            if text:
                self._push({"t": "h", "l": self._heading["l"], "x": text[:200], "id": self._heading["id"]})
            self._heading = None
        elif tag in _BLOCK_TEXT:
            self._flush_text()
        elif tag == "blockquote":
            self._flush_text()
            if self._note is not None:
                if self._note["p"]:
                    self._push({"t": "note", "k": self._note["k"], "p": self._note["p"][:12]})
                self._note = None
        elif tag == "li":
            self._flush_text()
            self._end_item()
        elif tag in ("ul", "ol"):
            self._flush_text()
            self._end_item()
            if self._lists:
                closed = self._lists.pop()
                if not self._lists and self._list_items:
                    self._push({"t": "list", "o": closed["o"], "i": self._list_items[:80]})
                    self._list_items = None
        elif tag in ("td", "th") and self._table is not None and self._table["cell"] is not None:
            row = self._table["row"] if self._table["row"] is not None else []
            row.append(_tidy(self._table["cell"]))
            self._table["row"], self._table["cell"] = row, None
        elif tag == "tr" and self._table is not None:
            if self._table["row"]:
                self._table["rows"].append(self._table["row"])
            self._table["row"] = None
        elif tag == "table" and self._table is not None:
            rows = [r for r in self._table["rows"] if any(c for c in r)]
            if rows:
                self._push({"t": "table", "rows": rows[:self.max_table_rows]})
            self._table = None
        elif tag in ("strong", "b") and self._bold:
            self._bold -= 1
        elif tag == "a":
            if self._link and self._link.get("yt"):
                title = plain([r for r in self._target()[-12:] if r.get("yt") == self._link["yt"]])
                self._note_video(self._link["yt"], self._link.get("start", 0), _video_title(title))
            self._link = None
        elif tag == "video":
            self._video_open = False
        elif tag == "pre" and self._pre is not None:
            text = "".join(self._pre).strip("\n")
            self._pre = None
            if text:
                self._push({"t": "code", "x": text[:MAX_TEXT]})

    def handle_data(self, data):
        if self._in_title:
            self.title += data
            return
        if not self._in_contents or self._skip:
            return
        if self._pre is not None:
            self._pre.append(data)
            return
        self._add_text(data)

    # -- finishing ----------------------------------------------------------------------------------------

    def _end_item(self):
        if self._item is None:
            return
        runs = _tidy(self._item.get("r", []))
        if runs and self._list_items is not None:
            self._list_items.append({"d": self._item["d"], "r": runs})
        self._item = None

    def _flush_all(self):
        self._flush_text()
        self._end_item()
        if self._list_items:
            self._push({"t": "list", "o": False, "i": self._list_items[:80]})
        self._list_items, self._lists = None, []


def _video_title(text):
    """A link's words without the minute marks the wiki adds after them ("... Troubleshooting 10:15-11:11")."""
    text = re.sub(r"\s*\b\d{1,2}:\d{2}\s*[-–—]+\s*\d{1,2}:\d{2}\s*$", "", str(text or "").strip())
    text = re.sub(r"\s*\b\d{1,2}:\d{2}\s*$", "", text)
    return text.strip(" :⁠")[:160]


def parse(html, max_table_rows=60):
    """One wiki page's HTML to {"title", "codes", "blocks", "videos"}. Never raises on odd HTML."""
    reader = _Reader(max_table_rows)
    try:
        reader.feed(str(html or ""))
        reader.close()
    except Exception:                           # noqa: BLE001 - a page that breaks the parser is shown as far as it got
        reader._flush_all()
    title = re.sub(r"\s*\|\s*Snapmaker Wiki\s*$", "", _clean(reader.title)).strip()
    in_title = []
    for code in CODE_RE.findall(title):
        if code not in in_title:
            in_title.append(code)
    return {"title": title[:240], "codes": in_title, "mentions": reader.codes_in_text[:200],
            "blocks": reader.blocks, "videos": reader.videos}
