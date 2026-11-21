#!/usr/bin/env python3
"""
Rebuild backend/reference/u1_error_codes.json from Snapmaker's public wiki.

The file holds what the wiki's "U1 error code reference table" says, word for word: each code's title and
details, the severity levels and module names, and which wiki guide and video belongs to which code. The
dashboard shows these words as they are and always names the page they came from, so refresh it before a
release and whenever Snapmaker publishes new codes.

    python3 tools/update-error-codes.py                # fetch, check and write the file
    python3 tools/update-error-codes.py --dry-run      # fetch and check, print the summary, write nothing
    python3 tools/update-error-codes.py --from-dir DIR # read earlier downloads (codes.html and pages/*.html)
    python3 tools/update-error-codes.py --no-videos    # skip YouTube's embed check

It needs the internet (or --from-dir) and nothing else. It waits between requests so the wiki is not
hurried: about a minute in all.
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import wiki_page  # noqa: E402

OUT = os.path.join(ROOT, "backend", "reference", "u1_error_codes.json")
ORIGIN = wiki_page.WIKI_ORIGIN
CODES_PATH = "/en/snapmaker_u1/troubleshooting/u1_error_codes"
HUB_PATH = "/en/snapmaker_u1/troubleshooting"
U1_ROOT = "/en/snapmaker_u1/"
DELAY = 0.4
MAX_MENTIONS = 6          # a page naming more codes than this is a list, not the guide for one of them
TABLE_ROWS = 1000         # the reference page has tables of nearly 200 rows; a guide shown in the app keeps 60


def get(url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers=dict({"User-Agent": "DejaVu1"}, **(headers or {})))
    try:
        with urllib.request.urlopen(request, timeout=40) as reply:
            return reply.status, reply.read(8 * 1024 * 1024).decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, ""
    finally:
        time.sleep(DELAY)


def page(path, cache_dir=None):
    """(status, parsed page) for a wiki path; a page that is missing or private parses to no blocks."""
    if cache_dir:
        name = os.path.join(cache_dir, "pages", re.sub(r"[^A-Za-z0-9_.-]", "_", path.strip("/")) + ".html")
        if not os.path.exists(name):
            return 404, wiki_page.parse("")
        return 200, wiki_page.parse(open(name, encoding="utf-8").read(), TABLE_ROWS)
    status, html = get(ORIGIN + path)
    parsed = wiki_page.parse(html, TABLE_ROWS) if status == 200 else wiki_page.parse("")
    if status == 200 and not parsed["blocks"]:
        status = 404
    return status, parsed


def table_rows(block):
    return [[wiki_page.plain(cell) for cell in row] for row in block["rows"]]


def cell_link(cell):
    """The first link in a table cell: (address, words), or (None, "")."""
    for run in cell:
        if run.get("u"):
            return run["u"], run["x"].strip()
    return None, ""


def read_table(parsed):
    """Levels, module names, the codes and the wiki's own explanations, from the reference page."""
    blocks = parsed["blocks"]
    tables = [b for b in blocks if b["t"] == "table"]
    if len(tables) < 11:
        raise SystemExit("The reference page has %d tables where 11 were expected; the wiki's layout changed, "
                         "so read it and update this tool." % len(tables))
    levels = {}
    for row in table_rows(tables[0])[1:]:
        levels[str(int(row[0]))] = {"name": row[1], "safety_risk": row[2], "fire_risk": row[3],
                                    "print_effect": row[4], "user_action": row[6]}
    modules = dict(zip(table_rows(tables[1])[1], table_rows(tables[1])[0]))
    names = {}
    for block in blocks:
        found = re.match(r"^(\d{4}) (.+)$", block.get("x", "")) if block["t"] == "h" else None
        if found:
            names[found.group(1)] = found.group(2).strip()
    for code, name in names.items():
        modules.setdefault(code, name)
    codes = []
    for table in tables[2:]:
        for raw in table["rows"][1:]:
            text = [wiki_page.plain(c) for c in raw]
            if not re.fullmatch(r"\d{4}-\d{4}-\d{4}-\d{4}", text[0]):
                raise SystemExit("An unexpected code cell in the table: %r" % text[0])
            link, words = cell_link(raw[3]) if len(raw) > 3 else (None, "")
            codes.append({"code": text[0], "title": text[1], "details": text[2], "link": link, "link_words": words})
    explain = {}
    last = None
    for block in blocks:
        if block["t"] == "h":
            last = block["x"]
        elif block["t"] == "p" and last:
            explain.setdefault(last, []).append(wiki_page.plain(block["r"]))
    structure = [{"name": n, "text": " ".join(explain.get(h, []))}
                 for n, h in (("Severity level", "1. Severity level"), ("Main module", "2. Main module code"),
                              ("Sub-module", "3. Sub-module code"), ("Issue", "4. Issue code")) if h in explain]
    notes = []
    for block in blocks:
        text = [wiki_page.plain(r) for r in block["p"]] if block["t"] == "note" else []
        if text and text[0].lower().startswith("important notes"):
            notes = [part.strip() for para in text[1:] for part in para.split("\n\n") if part.strip()]
            break
    return levels, modules, codes, structure, notes


def candidates(hub, cache_dir):
    """Wiki paths worth reading: every U1 page the hub links to, plus U1 pages the wiki's own list names."""
    paths = {}
    for block in hub["blocks"]:
        runs = []
        if block["t"] in ("p",):
            runs = block["r"]
        elif block["t"] == "list":
            runs = [r for item in block["i"] for r in item["r"]]
        elif block["t"] == "table":
            runs = [r for row in block["rows"] for cell in row for r in cell]
        for run in runs:
            if run.get("u", "").startswith(ORIGIN + U1_ROOT):
                paths[urllib.parse.urlsplit(run["u"]).path] = run["x"].strip()
    if not cache_dir:
        query = {"query": '{pages{list(locale:"en",limit:1000,orderBy:TITLE){id path title}}}'}
        status, body = get(ORIGIN + "/graphql", json.dumps(query).encode(), {"Content-Type": "application/json"})
        if status == 200:
            try:
                for item in json.loads(body)["data"]["pages"]["list"]:
                    if item["path"].lower().startswith("snapmaker_u1/"):
                        paths.setdefault("/en/" + item["path"], item["title"])
            except (ValueError, KeyError, TypeError):
                pass
    paths.pop(HUB_PATH, None)
    paths.pop(CODES_PATH, None)
    return paths


def search_paths(words, cache_dir):
    """U1 pages the wiki's own search finds for each phrase: what an owner typing the error's title would see."""
    found = {}
    if cache_dir:
        return found
    ask = 'query($q:String!){pages{search(query:$q,locale:"en"){results{path title}}}}'
    for phrase in words:
        status, body = get(ORIGIN + "/graphql", json.dumps({"query": ask, "variables": {"q": phrase}}).encode(),
                           {"Content-Type": "application/json"})
        if status != 200:
            continue
        try:
            for item in json.loads(body)["data"]["pages"]["search"]["results"]:
                path = "/en/" + item["path"]
                if path.startswith(U1_ROOT) and "backup" not in path:
                    found.setdefault(path, item["title"])
        except (ValueError, KeyError, TypeError):
            continue
    return found


def slug_of(path):
    return path[len(U1_ROOT):]


def embeddable(video_id):
    """(title, channel) when YouTube's own check says the video exists and may be embedded, else None."""
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote("https://www.youtube.com/watch?v=" + video_id)
    status, body = get(url)
    if status != 200:
        return None
    try:
        data = json.loads(body)
        return str(data.get("title", ""))[:160], str(data.get("author_name", ""))[:80]
    except ValueError:
        return None


def build(cache_dir, check_videos):
    status, codes_page = page(CODES_PATH, cache_dir)
    if status != 200:
        raise SystemExit("Could not read the wiki's error code page (status %s)" % status)
    levels, modules, rows, structure, notes = read_table(codes_page)
    _, hub = page(HUB_PATH, cache_dir)
    wanted = candidates(hub, cache_dir)
    for row in rows:
        if row["link"] and row["link"].startswith(ORIGIN + U1_ROOT):
            target = urllib.parse.urlsplit(row["link"]).path
            wanted.setdefault(target, row["link_words"])
            # The wiki renames pages; a link that still carries the code after its name often has a plainer twin.
            wanted.setdefault(re.sub(r"_\d{4}-\d{4}-\d{4}-\d{4}$", "", target), row["link_words"])
    phrases = []
    for title in sorted({r["title"] for r in rows}):
        phrases.append(title)
        if title.startswith("Toolhead "):
            phrases += ["toolhead %d %s" % (n, title[9:].lower()) for n in (1, 2, 3, 4)]
    for path, words in search_paths(phrases, cache_dir).items():
        wanted.setdefault(path, words)
    articles = {}
    for path, words in sorted(wanted.items()):
        got, parsed = page(path, cache_dir)
        if got == 200 and not re.search(r"(?i)^(page not found|unauthorized)$", parsed["title"]):
            articles[path] = {"title": parsed["title"] or words, "codes": parsed["codes"],
                              "mentions": parsed["mentions"],
                              "videos": [{"id": v["id"], "start": v["start"]} for v in parsed["videos"]]}
        print("  %-3s %s" % (got, path), file=sys.stderr)
    by_code = {}
    for path, info in articles.items():
        for code in info["codes"]:
            by_code.setdefault(code, path)
    mention = {}
    for path, info in sorted(articles.items()):
        if "/troubleshooting/" in path and len(set(info["mentions"])) <= MAX_MENTIONS:
            for code in info["mentions"]:
                mention.setdefault(code, path)
    by_title = {}
    for path, info in sorted(articles.items()):
        if "/troubleshooting/" in path:
            by_title.setdefault(info["title"].strip().lower(), path)
    out_codes, videos_wanted = {}, {}
    for row in sorted(rows, key=lambda r: r["code"]):
        path, video = None, None
        link = row["link"]
        if link:
            yt = wiki_page.youtube_in(link)
            if yt:
                video = yt[0]
                videos_wanted.setdefault(video, row["link_words"])
            else:
                target = urllib.parse.urlsplit(link).path
                for guess in (target, re.sub(r"_\d{4}-\d{4}-\d{4}-\d{4}$", "", target)):
                    if guess in articles:
                        path = guess
                        break
        path = by_code.get(row["code"]) or path or mention.get(row["code"])
        related = None
        if not path:
            related = by_title.get(row["title"].strip().lower())
        entry = {"title": row["title"], "details": row["details"]}
        if path or related:
            entry["article"] = slug_of(path or related)
        if related:
            entry["match"] = "title"     # a guide with the same name as the error, not one that names this code
        if video:
            entry["video"] = video
        out_codes[row["code"]] = entry
    slugs = {}
    for path, info in sorted(articles.items()):
        if info["codes"] or any(e.get("article") == slug_of(path) for e in out_codes.values()):
            slugs[slug_of(path)] = {"title": info["title"], "codes": info["codes"], "videos": info["videos"]}
            for vid in info["videos"]:
                videos_wanted.setdefault(vid["id"], "")
    videos = {}
    for vid, words in sorted(videos_wanted.items()):
        found = embeddable(vid) if check_videos else None
        if found:
            videos[vid] = {"title": found[0], "channel": found[1]}
        elif not check_videos:
            videos[vid] = {"title": wiki_page._video_title(words), "channel": ""}
        else:
            print("  video %s did not pass YouTube's embed check; left out" % vid, file=sys.stderr)
    for entry in out_codes.values():
        if entry.get("video") and entry["video"] not in videos:
            del entry["video"]
    for info in slugs.values():
        info["videos"] = [v for v in info["videos"] if v["id"] in videos]      # only videos that passed the embed check
    return {
        "schema": 1,
        "source": {"name": "Snapmaker Wiki, U1 error code reference table", "url": ORIGIN + CODES_PATH,
                   "guides": ORIGIN + HUB_PATH, "language": "en",
                   "retrieved": datetime.date.today().isoformat()},
        "levels": levels, "modules": dict(sorted(modules.items())), "structure": structure, "notes": notes,
        "codes": out_codes, "articles": slugs, "videos": videos,
    }


def dump(data):
    """The file as text: the small parts indented, each code on a line of its own so a search shows a whole entry."""
    codes = data["codes"]
    head = json.dumps({k: v for k, v in data.items() if k != "codes"}, ensure_ascii=False, indent=1)
    lines = ['  "%s": %s' % (code, json.dumps(entry, ensure_ascii=False)) for code, entry in codes.items()]
    return head[:-2] + ',\n "codes": {\n' + ",\n".join(lines) + "\n }\n}\n"


def summary(data):
    codes = data["codes"]
    by_level = {name["name"]: sum(1 for c in codes if str(int(c[:4])) == lv) for lv, name in data["levels"].items()}
    lines = ["%d codes (%s)" % (len(codes), ", ".join("%d %s" % (n, k.lower()) for k, n in by_level.items() if n)),
             "%d with a guide, %d with a video, %d guides, %d videos" % (
                 sum(1 for e in codes.values() if e.get("article")), sum(1 for e in codes.values() if e.get("video")),
                 len(data["articles"]), len(data["videos"]))]
    return "\n".join(lines)


def main():
    ask = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ask.add_argument("--dry-run", action="store_true")
    ask.add_argument("--from-dir")
    ask.add_argument("--no-videos", action="store_true")
    args = ask.parse_args()
    data = build(args.from_dir, not args.no_videos and not args.from_dir)
    print(summary(data), file=sys.stderr)
    if args.dry_run:
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    text = dump(data)
    with open(OUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    print("Wrote %s (%d KB)" % (os.path.relpath(OUT, ROOT), len(text) // 1024), file=sys.stderr)


if __name__ == "__main__":
    main()
