#!/usr/bin/env python3
"""
Check that every AI service address in backend/ai_providers.py still answers.

No key is sent. A live address answers a request without a key with "missing key" (401 or 403), or
with a public list of models (200). An address that has moved or closed answers 404 on both its
model list and its chat address, times out, or fails to resolve, and is reported as a problem.

    python3 tools/check-ai-services.py          # every service
    python3 tools/check-ai-services.py mistral  # one

Run it before a release that touches the list, and put the date in the comment above PROVIDERS.
It needs the internet and nothing else.
"""

import concurrent.futures
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import ai_providers  # noqa: E402

ALIVE = {200, 400, 401, 402, 403, 405, 422, 429}


def call(url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "DejaVu1"})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return response.status, ""
    except urllib.error.HTTPError as error:
        return error.code, error.read(160).decode("utf-8", "replace").strip().replace("\n", " ")
    except Exception as error:
        return 0, str(error)[:120]


def check(p):
    base = p["base"]
    chat = base + ("/messages" if p["format"] == "anthropic" else "/chat/completions")
    chat_code, chat_words = call(chat, {"model": "check", "messages": [{"role": "user", "content": "hi"}]})
    models_code, models_words = (None, "")
    if p["models"]:
        models_code, models_words = call(p["models"] if p["models"].startswith("http") else base + "/" + p["models"])
    gone = "decommission" in (chat_words + models_words).lower()
    # A chat address that says "no such model" (404) is alive when the model list beside it answers.
    ok = not gone and (chat_code in ALIVE or (chat_code == 404 and models_code in ALIVE))
    return p["id"], ok, chat_code, models_code, (chat_words or models_words)[:90]


def main():
    wanted = set(sys.argv[1:])
    services = [p for p in ai_providers.PROVIDERS if p["kind"] == "key" and (not wanted or p["id"] in wanted)]
    with concurrent.futures.ThreadPoolExecutor(12) as pool:
        rows = list(pool.map(check, services))
    bad = 0
    for pid, ok, chat_code, models_code, words in rows:
        bad += not ok
        listed = "no list" if models_code is None else f"list {models_code}"
        print(f"{'ok ' if ok else 'BAD'} {pid:<12} chat {chat_code:<3} {listed:<9} {words}")
    print(f"{len(rows) - bad} of {len(rows)} answered" + ("" if not bad else f"; {bad} need a look"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
