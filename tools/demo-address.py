#!/usr/bin/env python3
"""
The online demo's web address: one place to read it, one command to change it.

    python3 tools/demo-address.py                       show the address every file uses
    python3 tools/demo-address.py deja-vu1.NAME.workers.dev     use a new address everywhere

The address is made of the Worker's name (deja-vu1, set in wrangler.jsonc) and the Cloudflare account's
own workers.dev name. Renaming the account's name is free: Cloudflare dashboard, Workers & Pages, "Change"
next to "Your subdomain". Run this tool at the same time, so no link in the repository points at the old
name. The social-card links need the full address (https://...), which is why it appears in a few files.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = re.compile(r"https?://((?:[a-z0-9-]+\.)+workers\.dev)", re.I)
VALID = re.compile(r"^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.workers\.dev$")
SUFFIXES = {".md", ".json", ".html", ".py", ".js", ".txt", ".yml", ".yaml", ".jsonc"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", "demo", "data"}
# Past releases keep the address they were published with; this tool and its test name the format only.
SKIP_FILES = {"CHANGELOG.md", "demo-address.py", "test_demo_address.py"}


def files(root=ROOT):
    for path in sorted(Path(root).rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SUFFIXES or path.name in SKIP_FILES:
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        yield path


def found(root=ROOT):
    """{host: [relative paths]} for every workers.dev address in the repository's text files."""
    seen = {}
    for path in files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for host in {h.lower() for h in HOST.findall(text)}:
            seen.setdefault(host, []).append(str(path.relative_to(root)))
    return seen


def rewrite(new_host, root=ROOT):
    """Point every copy at new_host; returns the relative paths changed."""
    new_host = new_host.strip().lower()
    if not VALID.match(new_host):
        raise ValueError("Give the whole address, for example deja-vu1.NAME.workers.dev")
    changed = []
    for path in files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        updated = HOST.sub(lambda m: m.group(0)[:m.start(1) - m.start(0)] + new_host, text)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed.append(str(path.relative_to(root)))
    return changed


def main(argv):
    if len(argv) > 1:
        try:
            changed = rewrite(argv[1])
        except ValueError as exc:
            print(exc)
            return 2
        print(f"Now {argv[1].strip().lower()} in {len(changed)} files:")
        for name in changed:
            print("  " + name)
        return 0
    seen = found()
    for host, names in sorted(seen.items()):
        print(host)
        for name in names:
            print("  " + name)
    if len(seen) > 1:
        print("More than one address is in use: run this tool with the one to keep.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
