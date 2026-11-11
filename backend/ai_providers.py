"""
ai_providers.py
===============

The ways Deja Vu1 can reach an AI model, all of them the owner's own:

  * a subscription they already pay for, through the command-line program they are signed in to
    (Claude Code for a Claude plan, Codex for a ChatGPT plan). Deja Vu1 runs that program with its
    own tools switched off and reads the answer; it never sees a password or a key.
  * an API key they paste in, for any service in PROVIDERS;
  * a model running on their own computer (Ollama, LM Studio) or any address that speaks the same
    chat format.

Nothing here knows about printers. `ask()` takes a system prompt and a list of messages and returns
text, so `ai_assistant.py` can work the same way with every provider. Two wire formats cover all of
them: Anthropic's Messages API, and the chat-completions format the others accept.

Keys live in <data>/ai_keys.json (owner-only file permissions), are never sent to the browser, never
written to a log, and are left out of backups (the field is called `api_key`, which backup.py blanks).
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import urllib.error
import urllib.request

import storage

_DATA_DIR = storage.DATA_DIR
_KEYS_PATH = os.path.join(_DATA_DIR, "ai_keys.json")
_lock = threading.Lock()

TIMEOUT = 120            # seconds for one answer from a web service
CLI_TIMEOUT = 180        # seconds for one answer from a command-line program
MAX_TOKENS = 4096
ANTHROPIC_VERSION = "2026-10-21"
# Models that can hand a declined request to another model inside the same call.
_ANTHROPIC_FALLBACK = ("claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5",
                       "claude-sonnet-5-5")


class AIError(Exception):
    """Something the owner can act on: a wrong key, no credit, a program that isn't signed in."""


def _p(pid, name, base, key_url="", fmt="openai", env="", models="models", prefer="", note=""):
    return {"id": pid, "name": name, "kind": "key", "format": fmt, "base": base, "key_url": key_url,
            "env": env, "models": models, "prefer": prefer, "note": note}


# Every base address below answered from this project's test run on 11 November 2026 (most with
# "missing key", which is the proof the address is right). `prefer` is only a search pattern used to
# choose a starting model from the list the service itself returns; no model name is assumed to exist
# except Anthropic's default.
PROVIDERS = [
    {"id": "claude-code", "name": "Claude subscription (Claude Code)", "kind": "cli", "program": "claude",
     "install_url": "https://code.claude.com/docs/en/setup",
     "note": "Uses the Claude plan you are signed in to in Claude Code. No key needed."},
    {"id": "codex", "name": "ChatGPT subscription (Codex)", "kind": "cli", "program": "codex",
     "install_url": "https://developers.openai.com/codex/cli",
     "note": "Uses the ChatGPT plan you are signed in to in Codex. No key needed."},
    _p("anthropic", "Anthropic (Claude API)", "https://api.anthropic.com/v1",
       "https://platform.claude.com/settings/keys", fmt="anthropic", env="ANTHROPIC_API_KEY"),
    _p("openai", "OpenAI (ChatGPT API)", "https://api.openai.com/v1",
       "https://platform.openai.com/api-keys", env="OPENAI_API_KEY", prefer=r"^gpt-\d[\w.]*$"),
    _p("google", "Google AI Studio (Gemini)", "https://generativelanguage.googleapis.com/v1beta/openai",
       "https://aistudio.google.com/apikey", env="GEMINI_API_KEY", prefer=r"gemini.*pro"),
    _p("xai", "xAI (Grok)", "https://api.x.ai/v1", "https://console.x.ai", env="XAI_API_KEY", prefer=r"^grok"),
    _p("mistral", "Mistral", "https://api.mistral.ai/v1", "https://console.mistral.ai/api-keys",
       env="MISTRAL_API_KEY", prefer=r"mistral-large"),
    _p("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "https://platform.deepseek.com/api_keys",
       env="DEEPSEEK_API_KEY", prefer=r"chat"),
    _p("groq", "Groq", "https://api.groq.com/openai/v1", "https://console.groq.com/keys", env="GROQ_API_KEY"),
    _p("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/keys",
       env="OPENROUTER_API_KEY", note="One key for models from many companies."),
    _p("together", "Together AI", "https://api.together.xyz/v1", "https://api.together.ai/settings/api-keys",
       env="TOGETHER_API_KEY"),
    _p("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1", "https://app.fireworks.ai/settings/users/api-keys",
       env="FIREWORKS_API_KEY"),
    _p("perplexity", "Perplexity", "https://api.perplexity.ai", "https://www.perplexity.ai/account/api",
       env="PERPLEXITY_API_KEY", models="",
       note="Perplexity has no list of models to read, so type the model's name from your account."),
    _p("cerebras", "Cerebras", "https://api.cerebras.ai/v1", "https://cloud.cerebras.ai", env="CEREBRAS_API_KEY"),
    _p("sambanova", "SambaNova", "https://api.sambanova.ai/v1", "https://cloud.sambanova.ai/apis",
       env="SAMBANOVA_API_KEY"),
    _p("deepinfra", "DeepInfra", "https://api.deepinfra.com/v1/openai", "https://deepinfra.com/dash/api_keys",
       env="DEEPINFRA_API_KEY"),
    _p("hyperbolic", "Hyperbolic", "https://api.hyperbolic.xyz/v1", "https://app.hyperbolic.ai/settings",
       env="HYPERBOLIC_API_KEY"),
    _p("novita", "Novita AI", "https://api.novita.ai/openai/v1", "https://novita.ai/settings/key-management",
       env="NOVITA_API_KEY"),
    _p("nebius", "Nebius", "https://api.tokenfactory.nebius.com/v1", "https://tokenfactory.nebius.com",
       env="NEBIUS_API_KEY"),
    _p("huggingface", "Hugging Face", "https://router.huggingface.co/v1", "https://huggingface.co/settings/tokens",
       env="HF_TOKEN"),
    _p("github", "GitHub Models", "https://models.github.ai/inference", "https://github.com/settings/tokens",
       env="GITHUB_MODELS_TOKEN", models="https://models.github.ai/catalog/models",
       note="Needs a GitHub token with the Models permission."),
    _p("moonshot", "Moonshot (Kimi)", "https://api.moonshot.ai/v1", "https://platform.moonshot.ai/console/api-keys",
       env="MOONSHOT_API_KEY"),
    _p("alibaba", "Alibaba Cloud (Qwen)", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
       "https://bailian.console.alibabacloud.com", env="DASHSCOPE_API_KEY", prefer=r"qwen.*max"),
    _p("zai", "Z.ai (GLM)", "https://api.z.ai/api/paas/v4", "https://z.ai/manage-apikey/apikey-list",
       env="ZAI_API_KEY"),
    _p("cohere", "Cohere", "https://api.cohere.ai/compatibility/v1", "https://dashboard.cohere.com/api-keys",
       env="COHERE_API_KEY", prefer=r"command"),
    _p("ai21", "AI21", "https://api.ai21.com/studio/v1", "https://studio.ai21.com/account/api-key",
       env="AI21_API_KEY"),
    _p("nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", "https://build.nvidia.com",
       env="NVIDIA_API_KEY"),
    _p("vercel", "Vercel AI Gateway", "https://ai-gateway.vercel.sh/v1", "https://vercel.com/dashboard/ai-gateway",
       env="AI_GATEWAY_API_KEY", note="One key for models from many companies."),
    _p("minimax", "MiniMax", "https://api.minimax.io/v1", "https://platform.minimax.io", env="MINIMAX_API_KEY"),
    _p("venice", "Venice", "https://api.venice.ai/api/v1", "https://venice.ai/settings/api", env="VENICE_API_KEY"),
    _p("chutes", "Chutes", "https://llm.chutes.ai/v1", "https://chutes.ai/app/api", env="CHUTES_API_KEY"),
    _p("featherless", "Featherless", "https://api.featherless.ai/v1", "https://featherless.ai/account/api-keys",
       env="FEATHERLESS_API_KEY"),
    {**_p("ollama", "Ollama (on this computer)", "http://localhost:11434/v1"), "kind": "local",
     "note": "A model running on your own computer. Nothing leaves it."},
    {**_p("lmstudio", "LM Studio (on this computer)", "http://localhost:1234/v1"), "kind": "local",
     "note": "A model running on your own computer. Nothing leaves it."},
    {**_p("custom", "Another address", ""), "kind": "custom",
     "note": "Any service or program that accepts the chat-completions format."},
]
_BY_ID = {p["id"]: p for p in PROVIDERS}
DEFAULT_MODELS = {"anthropic": "claude-opus-5-5"}


def provider(pid):
    if pid not in _BY_ID:
        raise ValueError(f"Unknown AI provider: {pid}")
    return _BY_ID[pid]


# ---- saved keys -------------------------------------------------------------

def _load():
    data = storage.load_json(_KEYS_PATH, {})
    return data if isinstance(data, dict) else {}


def _save(data):
    storage.save_json(_KEYS_PATH, data)
    for path in (_KEYS_PATH, storage.prev_path(_KEYS_PATH)):
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass                       # Windows, or the previous copy doesn't exist yet


def _entry(pid):
    entry = _load().get(pid)
    return entry if isinstance(entry, dict) else {}


def _key(pid):
    return _entry(pid).get("api_key") or os.environ.get(provider(pid).get("env") or "", "")


def _base(pid):
    return (_entry(pid).get("base_url") or provider(pid)["base"]).rstrip("/")


def save_key(pid, api_key=None, base_url=None):
    p = provider(pid)
    if p["kind"] == "cli":
        raise ValueError(f"{p['name']} uses its own sign-in, so there is no key to save")
    api_key = str(api_key or "").strip()
    base_url = str(base_url or "").strip()
    if len(api_key) > 4096 or any(ord(c) < 33 or ord(c) > 126 for c in api_key):
        raise ValueError("That doesn't look like a key: it has spaces or unusual characters")
    if p["kind"] == "key" and not api_key:
        raise ValueError("Paste the key first")
    if p["kind"] in ("local", "custom") and base_url:
        if not re.match(r"^https?://[^\s/]+", base_url) or len(base_url) > 300:
            raise ValueError("The address must start with http:// or https://")
    elif p["kind"] == "custom":
        raise ValueError("Type the service's address, such as http://localhost:8080/v1")
    with _lock:
        data = _load()
        entry = {"api_key": api_key}
        if p["kind"] in ("local", "custom") and base_url:
            entry["base_url"] = base_url
        data[pid] = entry
        _save(data)
    return describe(pid)


def forget(pid):
    provider(pid)
    with _lock:
        data = _load()
        data.pop(pid, None)
        _save(data)
    return describe(pid)


def reset():
    """Forget every key. For tests."""
    with _lock:
        _save({})


# ---- what the browser may know ----------------------------------------------

def _program(p):
    return shutil.which(p["program"])


def describe(pid):
    """One provider as the browser sees it. The key itself never leaves this module."""
    p = provider(pid)
    row = {k: p[k] for k in ("id", "name", "kind", "note", "key_url", "install_url") if p.get(k)}
    if p["kind"] == "cli":
        row["installed"] = bool(_program(p))
        row["ready"] = row["installed"]
        return row
    key = _key(pid)
    row["has_key"] = bool(key)
    row["key_hint"] = ("…" + key[-4:]) if len(key) >= 12 else ""
    row["from_environment"] = bool(key) and not _entry(pid).get("api_key")
    row["lists_models"] = bool(p["models"])
    if p["kind"] in ("local", "custom"):
        row["base_url"] = _base(pid)
        row["ready"] = bool(row["base_url"]) and (p["kind"] == "local" or pid in _load())
    else:
        row["ready"] = bool(key)
    return row


def describe_all():
    return [describe(p["id"]) for p in PROVIDERS]


# ---- talking to a web service -----------------------------------------------

def _scrub(text, pid):
    """An error message must never repeat the key back."""
    key = _key(pid)
    text = str(text)
    return text.replace(key, "[key]") if key else text


def _explain(status, detail, p):
    detail = re.sub(r"\s+", " ", detail)[:300]
    if status in (401, 403):
        return f"{p['name']} refused the key ({status}). Check it was copied whole and is still active. {detail}"
    if status == 402:
        return f"{p['name']} says the account has no credit left (402). {detail}"
    if status == 404:
        return f"{p['name']} doesn't know that model or address (404). Pick a model from the list. {detail}"
    if status == 429:
        return f"{p['name']} says too many requests or the plan's limit is reached (429). Try again shortly. {detail}"
    if status >= 500:
        return f"{p['name']} had a problem on its side ({status}). Try again shortly. {detail}"
    return f"{p['name']} answered {status}. {detail}"


def _http(pid, url, payload=None, headers=None, timeout=TIMEOUT):
    p = provider(pid)
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    request.add_header("Content-Type", "application/json")
    request.add_header("User-Agent", "DejaVu1")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(8 * 1024 * 1024)
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            body = json.loads(error.read(20000) or b"{}")
            node = body[0] if isinstance(body, list) and body else body
            inner = node.get("error", node) if isinstance(node, dict) else node
            detail = inner.get("message") or inner.get("detail") or "" if isinstance(inner, dict) else str(inner)
        except (ValueError, AttributeError):
            pass
        raise AIError(_scrub(_explain(error.code, str(detail), p), pid))
    except (urllib.error.URLError, OSError, ValueError) as error:
        reason = getattr(error, "reason", error)
        where = "Is the program running on this computer?" if p["kind"] in ("local", "custom") else \
            "Check this computer's internet connection."
        raise AIError(_scrub(f"Couldn't reach {p['name']}: {reason}. {where}", pid))
    try:
        return json.loads(raw)
    except ValueError:
        raise AIError(f"{p['name']} sent an answer that isn't JSON. Check the address")


def _auth(pid):
    p, key = provider(pid), _key(pid)
    if p["format"] == "anthropic":
        return {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION}
    return {"Authorization": "Bearer " + key} if key else {}


def _ready(pid):
    p = provider(pid)
    if p["kind"] == "key" and not _key(pid):
        raise AIError(f"No key saved for {p['name']} yet")
    if not _base(pid):
        raise AIError("No address saved for this connection yet")


def list_models(pid):
    """The model names the service itself reports, best starting choice first."""
    p = provider(pid)
    if p["kind"] == "cli":
        return {"models": [], "suggested": "", "note": "Uses the model your plan chooses. You can type another."}
    _ready(pid)
    if not p["models"]:
        return {"models": [], "suggested": "", "note": p["note"]}
    url = p["models"] if p["models"].startswith("http") else _base(pid) + "/" + p["models"]
    body = _http(pid, url, headers=_auth(pid), timeout=30)
    rows = body.get("data") if isinstance(body, dict) else body
    names = sorted({str(r.get("id") or r.get("name")) for r in rows or [] if isinstance(r, dict)
                    and (r.get("id") or r.get("name"))})
    names = [n for n in names if not re.search(r"embed|whisper|tts|image|rerank|moderation|guard|audio|dall", n, re.I)]
    suggested = DEFAULT_MODELS.get(pid, "")
    if suggested not in names and p.get("prefer"):
        hits = [n for n in names if re.search(p["prefer"], n, re.I)]
        suggested = sorted(hits, key=lambda n: (len(n), n))[-1] if hits else ""
    return {"models": names[:400], "suggested": suggested or (DEFAULT_MODELS.get(pid) or (names[0] if names else ""))}


def _ask_anthropic(pid, model, system, messages):
    content = []
    for m in messages:
        parts = [{"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
                 for mime, b64 in m.get("images") or []]
        parts.append({"type": "text", "text": m["text"] or "(nothing)"})
        content.append({"role": m["role"], "content": parts})
    payload = {"model": model, "max_tokens": MAX_TOKENS, "system": system, "messages": content}
    headers = _auth(pid)
    if model in _ANTHROPIC_FALLBACK:
        payload["fallbacks"] = "default"
        headers["anthropic-beta"] = "server-side-fallback-2026-07-01"
    body = _http(pid, _base(pid) + "/messages", payload, headers)
    if body.get("stop_reason") == "refusal":
        raise AIError("The model declined to answer that request")
    text = "".join(b.get("text", "") for b in body.get("content") or [] if b.get("type") == "text")
    if not text.strip():
        raise AIError("The model sent an empty answer. Try again")
    return text


def _ask_openai(pid, model, system, messages):
    rows = [{"role": "system", "content": system}]
    for m in messages:
        if m.get("images"):
            parts = [{"type": "text", "text": m["text"] or "(nothing)"}]
            parts += [{"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
                      for mime, b64 in m["images"]]
            rows.append({"role": m["role"], "content": parts})
        else:
            rows.append({"role": m["role"], "content": m["text"] or "(nothing)"})
    body = _http(pid, _base(pid) + "/chat/completions", {"model": model, "messages": rows}, _auth(pid))
    try:
        message = body["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        raise AIError(f"{provider(pid)['name']} sent an answer in a shape Deja Vu1 doesn't know")
    text = message.get("content")
    if isinstance(text, list):                       # some services answer in parts
        text = "".join(part.get("text", "") for part in text if isinstance(part, dict))
    if not (text or "").strip():
        raise AIError("The model sent an empty answer. Try again")
    return text


# ---- talking to a subscription's own program ---------------------------------

def _transcript(messages):
    lines = []
    for m in messages:
        lines.append(("Owner: " if m["role"] == "user" else "You answered: ") + (m["text"] or ""))
    return "\n\n".join(lines) + "\n\nWrite your next answer."


def _run(p, args, text):
    program = _program(p)
    if not program:
        raise AIError(f"{p['program']} isn't installed on this computer. Install it, sign in, then try again")
    # An empty folder of its own: the program finds no project notes or files there, and Deja Vu1's
    # own folder is never its working directory.
    with tempfile.TemporaryDirectory(prefix="dejavu-ai-") as folder:
        try:
            done = subprocess.run([program] + args, input=text.encode(), capture_output=True, cwd=folder,
                                  timeout=CLI_TIMEOUT)
        except subprocess.TimeoutExpired:
            raise AIError(f"{p['name']} took longer than {CLI_TIMEOUT} seconds, so Deja Vu1 stopped waiting")
        except OSError as error:
            raise AIError(f"Couldn't start {p['program']}: {error}")
        return done, folder


def _ask_claude_code(model, system, messages):
    p = provider("claude-code")
    # `--tools ""` switches off every built-in tool (no shell, no file access); the remaining flags
    # keep the owner's own project settings, commands and connectors out of the answer.
    args = ["-p", "--output-format", "json", "--tools", "", "--system-prompt", system,
            "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config"]
    if model:
        args += ["--model", model]
    done, _ = _run(p, args, _transcript(messages))
    out = done.stdout.decode("utf-8", "replace").strip()
    try:
        body = json.loads(out)
    except ValueError:
        body = {}
    if isinstance(body, list):                      # some versions print every event; the last is the result
        body = next((row for row in reversed(body) if isinstance(row, dict) and row.get("type") == "result"), {})
    text = body.get("result") if isinstance(body, dict) else None
    if done.returncode != 0 or body.get("is_error") or not isinstance(text, str) or not text.strip():
        detail = (text if isinstance(text, str) and text else done.stderr.decode("utf-8", "replace") or out)
        detail = re.sub(r"\s+", " ", detail).strip()[:300]
        raise AIError("Claude Code didn't answer. Open a terminal, run `claude`, sign in with /login, then try "
                      f"again. It said: {detail or 'nothing'}")
    return text


def _ask_codex(model, system, messages):
    p = provider("codex")
    # `codex exec` reads the request from standard input, runs read-only by default and prints only
    # the final answer on standard output.
    args = ["exec", "--skip-git-repo-check", "--ephemeral", "-"]
    done, _ = _run(p, args, "Follow these instructions exactly.\n\n" + system + "\n\n---\n\n" + _transcript(messages))
    text = done.stdout.decode("utf-8", "replace").strip()
    if done.returncode != 0 or not text:
        detail = re.sub(r"\s+", " ", done.stderr.decode("utf-8", "replace")).strip()[-300:]
        raise AIError("Codex didn't answer. Open a terminal, run `codex login`, then try again. "
                      f"It said: {detail or 'nothing'}")
    return text


# ---- one entry point ---------------------------------------------------------

def supports_pictures(pid):
    return provider(pid)["kind"] != "cli"


def ask(pid, model, system, messages):
    """
    One answer as text. `messages` is a list of {"role": "user"|"assistant", "text": str,
    "images": [(mime, base64), ...]} in order, starting with the owner.
    """
    p = provider(pid)
    if p["kind"] == "cli":
        return _ask_claude_code(model, system, messages) if pid == "claude-code" else \
            _ask_codex(model, system, messages)
    _ready(pid)
    model = model or DEFAULT_MODELS.get(pid, "")
    if not model:
        raise AIError(f"Pick a model for {p['name']} first")
    return _ask_anthropic(pid, model, system, messages) if p["format"] == "anthropic" else \
        _ask_openai(pid, model, system, messages)


def test(pid, model=""):
    """Send one tiny request, so a wrong key or a missing sign-in shows up now and in plain words."""
    answer = ask(pid, model, "You are a connection check. Answer with the single word: ready",
                 [{"role": "user", "text": "Are you there?"}])
    return {"ok": True, "answer": re.sub(r"\s+", " ", answer).strip()[:80]}
