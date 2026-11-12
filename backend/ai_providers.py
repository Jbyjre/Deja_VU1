"""
ai_providers.py
===============

The ways Deja Vu1 can reach an AI model, all of them the owner's own:

  * a plan they already pay for, through the program they are signed in to (Claude Code for a Claude
    plan, Codex for a ChatGPT plan). Deja Vu1 runs that program, unmodified, with its own tools
    switched off, and reads the answer. It never sees a password, a sign-in token or a key.
  * a model running on their own computer (Ollama, LM Studio) or any address that speaks the same
    chat format;
  * an API key they paste in, for any service in PROVIDERS. This is the least private choice, so the
    screen offers it last and says how the key is kept (ai_vault.py).

Any number of these can be connected at once; ai_assistant.py remembers which one is in use and
which model each one uses.

Nothing here knows about printers. `ask()` takes a system prompt and a list of messages and returns
text, so `ai_assistant.py` works the same way with every provider. Two wire formats cover all of the
services: Anthropic's Messages API, and the chat-completions format the others accept.

Model names are never written into this file (one fallback aside). Each list is read from the
service or program itself, newest first, so a new model shows up the day its maker lists it.

What protects a key: it is stored by the operating system's keyring where there is one, sent only
to the service's own address over https (or to this computer or home network), never followed
through a redirect, never sent to the browser, never written to a log, cut out of every error
message, and left out of backups.
"""

import base64
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import ai_vault
import storage

_DATA_DIR = storage.DATA_DIR
_KEYS_PATH = os.path.join(_DATA_DIR, "ai_keys.json")
_lock = threading.Lock()

TIMEOUT = 180            # seconds for one answer from a web service
CLI_TIMEOUT = 240        # seconds for one answer from a plan's program
CHECK_TIMEOUT = 25       # seconds for "is it signed in?"
MAX_TOKENS = 16000       # room for the model's own reasoning as well as its answer
MODELS_TTL = 6 * 3600    # a model list is read again after this long, or when asked
ANTHROPIC_VERSION = "2026-10-21"
# Models that can hand a declined request to another model inside the same call.
_ANTHROPIC_FALLBACK = ("claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5",
                       "claude-sonnet-5-5")


class AIError(Exception):
    """Something the owner can act on: a wrong key, no credit, a program that isn't signed in."""


class Reply(str):
    """An answer's text, carrying what the service reported about it (tokens, model, cost)."""
    usage = None


def _p(pid, name, base, key_url="", fmt="openai", env="", models="models", prefer="", note="", prices=False):
    return {"id": pid, "name": name, "kind": "key", "format": fmt, "base": base, "key_url": key_url,
            "env": env, "models": models, "prefer": prefer, "note": note, "prices": prices}


_FLAGSHIPS = r"claude-(opus|fable|sonnet)|gpt-\d|gemini-[\d.]+-pro|grok-\d"

# Every address below was called from tools/check-ai-services.py on 12 November 2026 and answered
# as that service does when no key is sent (most with "missing key", which is the proof the address
# is right). `prefer` is only a search pattern used to choose a starting model from the list the
# service itself returns; no model name is assumed to exist except Anthropic's fallback.
PROVIDERS = [
    {"id": "claude-code", "name": "Claude plan (through Claude Code)", "kind": "cli", "program": "claude",
     "install_url": "https://code.claude.com/docs/en/setup",
     "signin": "claude auth login", "status": ["auth", "status"],
     "note": "Uses the Claude plan you are signed in to in Claude Code, so there is no key and no extra bill. "
             "The Claude desktop app is a separate program: install Claude Code once and sign in with the same account."},
    {"id": "codex", "name": "ChatGPT plan (through Codex)", "kind": "cli", "program": "codex",
     "install_url": "https://developers.openai.com/codex/cli",
     "signin": "codex login", "status": ["login", "status"],
     "note": "Uses the ChatGPT plan you are signed in to in Codex, so there is no key and no extra bill. "
             "The Codex app and the Codex command share one sign-in."},
    _p("anthropic", "Anthropic (Claude API)", "https://api.anthropic.com/v1",
       "https://platform.claude.com/settings/keys", fmt="anthropic", env="ANTHROPIC_API_KEY", prefer=r"claude-opus"),
    _p("openai", "OpenAI (ChatGPT API)", "https://api.openai.com/v1",
       "https://platform.openai.com/api-keys", env="OPENAI_API_KEY", prefer=r"^gpt-\d[\w.-]*$"),
    _p("google", "Google AI Studio (Gemini)", "https://generativelanguage.googleapis.com/v1beta/openai",
       "https://aistudio.google.com/apikey", env="GEMINI_API_KEY", prefer=r"^gemini-",
       models="https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"),
    _p("xai", "xAI (Grok)", "https://api.x.ai/v1", "https://console.x.ai", env="XAI_API_KEY", prefer=r"^grok-\d"),
    _p("mistral", "Mistral", "https://api.mistral.ai/v1", "https://console.mistral.ai/api-keys",
       env="MISTRAL_API_KEY", prefer=r"mistral-(large|medium)"),
    _p("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "https://platform.deepseek.com/api_keys",
       env="DEEPSEEK_API_KEY", prefer=r"chat"),
    _p("groq", "Groq", "https://api.groq.com/openai/v1", "https://console.groq.com/keys", env="GROQ_API_KEY"),
    _p("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/keys",
       env="OPENROUTER_API_KEY", prefer=_FLAGSHIPS, prices=True, note="One key for models from many companies."),
    _p("together", "Together AI", "https://api.together.xyz/v1", "https://api.together.ai/settings/api-keys",
       env="TOGETHER_API_KEY"),
    _p("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1", "https://app.fireworks.ai/settings/users/api-keys",
       env="FIREWORKS_API_KEY"),
    _p("perplexity", "Perplexity", "https://api.perplexity.ai", "https://www.perplexity.ai/account/api",
       env="PERPLEXITY_API_KEY", models="",
       note="Perplexity has no list of chat models to read, so type the model's name from your account."),
    _p("cerebras", "Cerebras", "https://api.cerebras.ai/v1", "https://cloud.cerebras.ai", env="CEREBRAS_API_KEY"),
    _p("sambanova", "SambaNova", "https://api.sambanova.ai/v1", "https://cloud.sambanova.ai/apis",
       env="SAMBANOVA_API_KEY"),
    _p("deepinfra", "DeepInfra", "https://api.deepinfra.com/v1/openai", "https://deepinfra.com/dash/api_keys",
       env="DEEPINFRA_API_KEY"),
    _p("hyperbolic", "Hyperbolic", "https://api.hyperbolic.ai/inference/v1", "https://app.hyperbolic.ai/settings/api-keys",
       env="HYPERBOLIC_API_KEY"),
    _p("novita", "Novita AI", "https://api.novita.ai/openai/v1", "https://novita.ai/settings/key-management",
       env="NOVITA_API_KEY"),
    _p("nebius", "Nebius", "https://api.tokenfactory.nebius.com/v1", "https://tokenfactory.nebius.com",
       env="NEBIUS_API_KEY"),
    _p("huggingface", "Hugging Face", "https://router.huggingface.co/v1", "https://huggingface.co/settings/tokens",
       env="HF_TOKEN"),
    _p("github", "GitHub Models", "https://models.github.ai/inference", "https://github.com/settings/tokens",
       env="GITHUB_MODELS_TOKEN", models="https://models.github.ai/catalog/models", prefer=_FLAGSHIPS,
       note="Needs a GitHub token with the Models permission."),
    _p("moonshot", "Moonshot (Kimi)", "https://api.moonshot.ai/v1", "https://platform.moonshot.ai/console/api-keys",
       env="MOONSHOT_API_KEY", prefer=r"kimi"),
    _p("alibaba", "Alibaba Cloud (Qwen)", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
       "https://bailian.console.alibabacloud.com", env="DASHSCOPE_API_KEY", prefer=r"qwen.*max"),
    _p("zai", "Z.ai (GLM)", "https://api.z.ai/api/paas/v4", "https://z.ai/manage-apikey/apikey-list",
       env="ZAI_API_KEY", prefer=r"^glm-[\d.]+$"),
    _p("cohere", "Cohere", "https://api.cohere.ai/compatibility/v1", "https://dashboard.cohere.com/api-keys",
       env="COHERE_API_KEY", prefer=r"command"),
    _p("ai21", "AI21", "https://api.ai21.com/studio/v1", "https://studio.ai21.com/account/api-key",
       env="AI21_API_KEY", prefer=r"jamba"),
    _p("nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", "https://build.nvidia.com",
       env="NVIDIA_API_KEY"),
    _p("vercel", "Vercel AI Gateway", "https://ai-gateway.vercel.sh/v1", "https://vercel.com/dashboard/ai-gateway",
       env="AI_GATEWAY_API_KEY", prefer=_FLAGSHIPS, prices=True, note="One key for models from many companies."),
    _p("minimax", "MiniMax", "https://api.minimax.io/v1", "https://platform.minimax.io", env="MINIMAX_API_KEY", prefer=r"minimax"),
    _p("venice", "Venice", "https://api.venice.ai/api/v1", "https://venice.ai/settings/api", env="VENICE_API_KEY"),
    _p("chutes", "Chutes", "https://llm.chutes.ai/v1", "https://chutes.ai/app/api", env="CHUTES_API_KEY"),
    _p("featherless", "Featherless", "https://api.featherless.ai/v1", "https://featherless.ai/account/api-keys",
       env="FEATHERLESS_API_KEY"),
    {**_p("ollama", "Ollama (on this computer)", "http://localhost:11434/v1"), "kind": "local",
     "note": "A model running on your own computer. Nothing leaves it, and there is no key."},
    {**_p("lmstudio", "LM Studio (on this computer)", "http://localhost:1234/v1"), "kind": "local",
     "note": "A model running on your own computer. Nothing leaves it, and there is no key."},
    {**_p("custom", "Another address", ""), "kind": "custom",
     "note": "Any service or program that accepts the chat-completions format."},
]
_BY_ID = {p["id"]: p for p in PROVIDERS}
DEFAULT_MODELS = {"anthropic": "claude-opus-5-5"}

# Claude Code's own short names: each always means the newest model of that family (`claude --help`).
CLAUDE_ALIASES = [("fable", "Fable: the most capable, where your plan includes it"), ("opus", "Opus: the newest Opus"),
                  ("sonnet", "Sonnet: quicker, uses less of your plan"), ("haiku", "Haiku: the quickest")]


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
    entry = _entry(pid)
    saved = ai_vault.open_(pid, entry) if entry else ""
    return saved or os.environ.get(provider(pid).get("env") or "", "")


def _base(pid):
    return (_entry(pid).get("base_url") or provider(pid)["base"]).rstrip("/")


def _local_host(host):
    """This computer or the home network: the only places a key may travel without https."""
    host = (host or "").strip("[]").lower()
    if host in ("localhost", "") or host.endswith(".local") or host.endswith(".lan") or "." not in host and ":" not in host:
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_link_local


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
        url = urllib.parse.urlsplit(base_url)
        if api_key and url.scheme != "https" and not _local_host(url.hostname):
            raise ValueError("A key is only sent over https, or to this computer or your home network. "
                             "Use the service's https:// address")
    elif p["kind"] == "custom":
        raise ValueError("Type the service's address, such as http://localhost:8080/v1")
    with _lock:
        data = _load()
        old = data.get(pid) if isinstance(data.get(pid), dict) else {}
        if api_key:
            ai_vault.drop(pid, old)
            entry = ai_vault.seal(pid, api_key)
        else:
            entry = {k: old[k] for k in ("store", "hint", "api_key", "api_key_sealed") if k in old}
        if p["kind"] in ("local", "custom") and base_url:
            entry["base_url"] = base_url
        data[pid] = entry
        _save(data)
        _models.pop(pid, None)
    return describe(pid)


def forget(pid):
    provider(pid)
    with _lock:
        data = _load()
        ai_vault.drop(pid, data.pop(pid, None))
        _save(data)
        _models.pop(pid, None)
    return describe(pid)


def protect_saved_keys():
    """Move keys an earlier version left in the plain file into this computer's protected store."""
    if not ai_vault.describe()["encrypted"]:
        return 0
    moved = 0
    with _lock:
        data = _load()
        for pid, entry in list(data.items()):
            if isinstance(entry, dict) and entry.get("api_key") and (entry.get("store") or "file") == "file":
                sealed = ai_vault.seal(pid, entry["api_key"])
                if sealed.get("store") != "file":
                    data[pid] = {**{k: v for k, v in entry.items() if k != "api_key"}, **sealed}
                    moved += 1
        if moved:
            _save(data)
            try:                           # the safety copy still holds the plain key: replace it too
                with open(_KEYS_PATH, "rb") as now, open(storage.prev_path(_KEYS_PATH), "wb") as previous:
                    previous.write(now.read())
            except OSError:
                pass
    return moved


def reset():
    """Forget every key. For tests."""
    with _lock:
        for pid, entry in _load().items():
            ai_vault.drop(pid, entry)
        _save({})
        _models.clear()
        _checks.clear()
    ai_vault.forget_cache()


# ---- the plans' own programs --------------------------------------------------

def _places():
    """Folders the programs install into that a double-clicked app's PATH often leaves out."""
    home = os.path.expanduser("~")
    places = [os.path.join(home, ".local", "bin"), os.path.join(home, ".claude", "local"),
              os.path.join(home, ".npm-global", "bin"), os.path.join(home, ".bun", "bin"),
              os.path.join(home, ".volta", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]
    if sys.platform == "win32":
        for name in ("APPDATA", "LOCALAPPDATA"):
            if os.environ.get(name):
                places.append(os.path.join(os.environ[name], "npm"))
    return places


def _program(p):
    found = shutil.which(p["program"])
    if found:
        return found
    return shutil.which(p["program"], path=os.pathsep.join(_places()))


_checks = {}                                # pid -> what check() last found


def check(pid):
    """Is the plan's program installed and signed in? Runs the program's own status command."""
    p = provider(pid)
    if p["kind"] != "cli":
        raise ValueError(f"{p['name']} has no program to check")
    program = _program(p)
    found = {"installed": bool(program), "signed_in": None, "version": "", "at": time.time()}
    if program:
        try:
            version = subprocess.run([program, "--version"], capture_output=True, timeout=CHECK_TIMEOUT)
            found["version"] = re.sub(r"\s+", " ", version.stdout.decode("utf-8", "replace")).strip()[:60]
            done = subprocess.run([program] + p["status"], capture_output=True, timeout=CHECK_TIMEOUT,
                                  cwd=tempfile.gettempdir())
            out = done.stdout.decode("utf-8", "replace")
            if pid == "claude-code":
                try:
                    found["signed_in"] = bool(json.loads(out).get("loggedIn"))
                except (ValueError, AttributeError):
                    found["signed_in"] = done.returncode == 0 and "not logged" not in out.lower()
            else:
                found["signed_in"] = done.returncode == 0 and "not logged" not in out.lower()
        except (OSError, subprocess.TimeoutExpired):
            pass                             # installed, sign-in unknown: Connect will find out
    _checks[pid] = found
    return describe(pid)


# ---- what the browser may know ----------------------------------------------

def describe(pid):
    """One provider as the browser sees it. The key itself never leaves this module."""
    p = provider(pid)
    row = {k: p[k] for k in ("id", "name", "kind", "note", "key_url", "install_url", "signin") if p.get(k)}
    if p["kind"] == "cli":
        seen = _checks.get(pid) or {}
        row["installed"] = bool(_program(p))
        row["signed_in"] = seen.get("signed_in") if row["installed"] else None
        row["version"] = seen.get("version", "")
        row["ready"] = row["installed"]
        row["pictures"] = True
        return row
    entry = _entry(pid)
    from_file = bool(entry.get("store"))  or bool(entry.get("api_key"))
    from_environment = not from_file and bool(os.environ.get(p.get("env") or "", ""))
    row["has_key"] = from_file or from_environment
    row["key_hint"] = entry.get("hint") or ""
    row["key_store"] = "environment" if from_environment else (entry.get("store") or "file") if from_file else ""
    row["from_environment"] = from_environment
    row["env"] = p.get("env") or ""
    row["lists_models"] = bool(p["models"])
    row["pictures"] = True
    if p["kind"] in ("local", "custom"):
        row["base_url"] = _base(pid)
        row["ready"] = bool(row["base_url"]) and (p["kind"] == "local" or pid in _load())
    else:
        row["ready"] = row["has_key"]
    return row


def describe_all():
    return [describe(p["id"]) for p in PROVIDERS]


def security():
    """How keys are kept on this computer, for the Connect screen and the docs."""
    vault = ai_vault.describe()
    return {**vault, "rules": [
        "A key is sent only to its own service, over an encrypted (https) connection.",
        "It never reaches this page, a log, an error message or a backup.",
        "Anyone using Deja Vu1 on your network can use the connected AI, but nobody can read the key back.",
    ]}


# ---- talking to a web service -----------------------------------------------

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect could carry the key to another site, so none is followed."""

    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _scrub(text, pid):
    """An error message must never repeat the key back."""
    key = _key(pid)
    text = str(text)
    return text.replace(key, "[key]") if key else text


def _explain(status, detail, p):
    detail = re.sub(r"\s+", " ", detail)[:300]
    if status in (301, 302, 303, 307, 308):
        return (f"{p['name']} tried to send Deja Vu1 to a different address ({status}). It didn't follow, so your "
                "key stays with the address you chose. Check the address")
    if status in (401, 403) or status == 400 and re.search(r"api.?key|credential|authoriz", detail, re.I):
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
    target = urllib.parse.urlsplit(url)
    if headers and target.scheme != "https" and not _local_host(target.hostname):
        raise AIError("A key is only sent over https, or to this computer or your home network")
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    request.add_header("Content-Type", "application/json")
    request.add_header("User-Agent", "DejaVu1")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with _opener.open(request, timeout=timeout) as response:
            raw = response.read(32 * 1024 * 1024)
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
        if _entry(pid):
            raise AIError(f"The saved key for {p['name']} couldn't be read from {ai_vault.describe()['name']}. "
                          "Paste it again")
        raise AIError(f"No key saved for {p['name']} yet")
    if not _base(pid):
        raise AIError("No address saved for this connection yet")


# ---- model lists: read from the service, newest first --------------------------

_models = {}                                 # pid -> {"at": time, "body": {...}}
_NOT_CHAT = re.compile(r"embed|whisper|tts|image|rerank|moderation|guard|audio|dall|speech|transcri|realtime|"
                       r"veo|imagen|aqa|sora|video|ocr|voxtral", re.I)
_NOT_CHAT_TYPES = {"embedding", "embeddings", "image", "video", "audio", "rerank", "moderation", "tts", "stt", "speech"}
# Smaller, older-preview or special-purpose variants: fine to pick, but not the starting suggestion.
_LESSER = re.compile(r"(?<![a-z])(mini|nano|lite|small|tiny|flash|haiku|instant|\d+b|distill|preview|exp|beta|"
                     r"latest|vision|search|research|codex|safeguard|legacy|free|turbo|fast|batch)(?![a-z])", re.I)


def _stamp(value):
    """A model's release moment as a number, from the forms services use (seconds, or an ISO date)."""
    if isinstance(value, (int, float)) and value > 0:
        return float(value if value < 1e11 else value / 1000)
    if isinstance(value, str) and value[:4].isdigit():
        try:
            return time.mktime(time.strptime(value[:10], "%Y-%m-%d"))
        except ValueError:
            return 0.0
    return 0.0


def _version(name):
    return tuple(int(n) for n in re.findall(r"\d+", name)[:4] if len(n) < 6)


def _per_million(value):
    try:
        number = float(value) * 1_000_000
    except (TypeError, ValueError):
        return None
    return round(number, 4) if 0 <= number < 100000 else None


def _model_rows(p, body):
    rows = body
    if isinstance(body, dict):
        rows = body.get("data") if isinstance(body.get("data"), list) else body.get("models")
    out, seen = [], set()
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        name = str(r.get("id") or r.get("name") or "")
        if name.startswith("models/"):
            name = name[len("models/"):]
        if not name or name in seen or len(name) > 200 or _NOT_CHAT.search(name):
            continue
        methods = r.get("supportedGenerationMethods")
        if isinstance(methods, list) and "generateContent" not in methods:
            continue
        if str(r.get("type") or "").lower() in _NOT_CHAT_TYPES:
            continue
        seen.add(name)
        label = r.get("display_name") or r.get("displayName") or (r.get("name") if r.get("id") else "") or ""
        row = {"id": name, "label": str(label)[:80] if label and label != name else "",
               "created": _stamp(r.get("released") or r.get("created") or r.get("created_at"))}
        if p.get("prices") and isinstance(r.get("pricing"), dict):
            price = r["pricing"]
            row["in_per_million"] = _per_million(price.get("prompt", price.get("input")))
            row["out_per_million"] = _per_million(price.get("completion", price.get("output")))
        out.append(row)
    # Dates count only when they tell models apart: some services stamp every row with one moment.
    dated = len({r["created"] for r in out if r["created"]})
    if dated > max(3, len(out) // 4):
        out.sort(key=lambda r: (-r["created"], r["id"]))
    else:
        out.sort(key=lambda r: r["id"])
        out.sort(key=lambda r: _version(r["id"]), reverse=True)      # stable: names stay in order within a version
    return out


def _suggest(p, rows):
    names = [r["id"] for r in rows]
    fixed = DEFAULT_MODELS.get(p["id"], "")
    if fixed in names:
        return fixed
    if not p.get("prefer"):
        return ""                  # a host of many makers' models: the owner picks, nothing is guessed
    pool = [r for r in rows if re.search(p["prefer"], r["id"], re.I)]
    pool = [r for r in pool if not _LESSER.search(r["id"])] or pool
    if not pool:
        return ""
    return max(pool, key=lambda r: (r["created"], _version(r["id"]), -len(r["id"])))["id"]


def _codex_models(p):
    """Codex prints its own catalogue of models; no sign-in is needed to read it."""
    program = _program(p)
    if not program:
        return []
    try:
        done = subprocess.run([program, "debug", "models"], capture_output=True, timeout=CHECK_TIMEOUT,
                              cwd=tempfile.gettempdir())
        body = json.loads(done.stdout.decode("utf-8", "replace"))
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return []
    rows = body.get("models") if isinstance(body, dict) else body
    listed = [r for r in rows or [] if isinstance(r, dict) and r.get("slug") and r.get("visibility", "list") == "list"]
    listed.sort(key=lambda r: r.get("priority") if isinstance(r.get("priority"), (int, float)) else 999)
    return [{"id": str(r["slug"]), "label": re.sub(r"\s+", " ", str(r.get("description") or r.get("display_name") or ""))[:90],
             "created": 0.0} for r in listed]


def list_models(pid, refresh=False):
    """The models the service or program itself reports, newest first, with a starting choice."""
    p = provider(pid)
    cached = _models.get(pid)
    if cached and not refresh and time.time() - cached["at"] < MODELS_TTL:
        return cached["body"]
    if p["kind"] == "cli":
        if pid == "claude-code":
            rows = [{"id": name, "label": label, "created": 0.0} for name, label in CLAUDE_ALIASES]
            note = "Leave it empty for your plan's usual model. A short name always means the newest model of that family."
        else:
            rows = _codex_models(p)
            note = "Leave it empty for your plan's usual model." + ("" if rows else " You can also type a model's name.")
        body = {"models": [r["id"] for r in rows], "rows": rows, "suggested": "", "note": note, "optional": True}
    else:
        _ready(pid)
        if not p["models"]:
            return {"models": [], "rows": [], "suggested": "", "note": p["note"]}
        url = p["models"] if p["models"].startswith("http") else _base(pid) + "/" + p["models"]
        headers = {"x-goog-api-key": _key(pid)} if pid == "google" else _auth(pid)
        rows = _model_rows(p, _http(pid, url, headers=headers, timeout=40))[:600]
        body = {"models": [r["id"] for r in rows], "rows": rows, "suggested": _suggest(p, rows)}
    body["read_at"] = time.time()
    _models[pid] = {"at": time.time(), "body": body}
    return body


# ---- asking ------------------------------------------------------------------

def _reply(text, model="", tokens_in=None, tokens_out=None, cost=None):
    reply = Reply(text)
    reply.usage = {"model": model or "", "in": tokens_in, "out": tokens_out, "cost_usd": cost}
    return reply


def _count(*values):
    numbers = [v for v in values if isinstance(v, (int, float))]
    return int(sum(numbers)) if numbers else None


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
        if body.get("stop_reason") == "max_tokens":
            raise AIError("The model ran out of room before it answered. Ask for something smaller, or pick another model")
        raise AIError("The model sent an empty answer. Try again")
    usage = body.get("usage") or {}
    return _reply(text, body.get("model") or model,
                  _count(usage.get("input_tokens"), usage.get("cache_read_input_tokens"), usage.get("cache_creation_input_tokens")),
                  _count(usage.get("output_tokens")))


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
    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    cost = usage.get("cost") if isinstance(usage.get("cost"), (int, float)) else None
    return _reply(text, body.get("model") or model, _count(usage.get("prompt_tokens")),
                  _count(usage.get("completion_tokens")), cost)


# ---- talking to a plan's own program -------------------------------------------

def _transcript(messages):
    lines = []
    for m in messages:
        lines.append(("Owner: " if m["role"] == "user" else "You answered: ") + (m["text"] or ""))
    return "\n\n".join(lines) + "\n\nWrite your next answer."


def _pictures(messages):
    """The pictures that belong to the newest message (a camera look), as (mime, base64)."""
    return list(messages[-1].get("images") or []) if messages else []


def _run(p, args, text, folder):
    program = _program(p)
    if not program:
        raise AIError(f"{p['program']} isn't installed on this computer. Install it, sign in, then try again")
    try:
        return subprocess.run([program] + args, input=text.encode(), capture_output=True, cwd=folder,
                              timeout=CLI_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise AIError(f"{p['name']} took longer than {CLI_TIMEOUT} seconds, so Deja Vu1 stopped waiting")
    except OSError as error:
        raise AIError(f"Couldn't start {p['program']}: {error}")


def _workspace():
    # An empty folder of its own: the program finds no project notes or files there, and Deja Vu1's
    # own folder is never its working directory.
    return tempfile.TemporaryDirectory(prefix="dejavu-ai-")


def _ask_claude_code(model, system, messages):
    p = provider("claude-code")
    with _workspace() as folder:
        rules = os.path.join(folder, "instructions.txt")
        with open(rules, "w", encoding="utf-8") as handle:
            handle.write(system)
        # `--tools ""` switches off every built-in tool (no shell, no file access); the remaining flags
        # keep the owner's own project settings, commands and connectors out of the answer. The request
        # travels on standard input, never in the command line.
        args = ["-p", "--output-format", "json", "--tools", "", "--system-prompt-file", rules,
                "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config"]
        if model:
            args += ["--model", model]
        sent = _transcript(messages)
        pictures = _pictures(messages)
        if pictures:
            parts = [{"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
                     for mime, b64 in pictures]
            parts.append({"type": "text", "text": sent})
            sent = json.dumps({"type": "user", "message": {"role": "user", "content": parts}}) + "\n"
            args[1:3] = ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
        done = _run(p, args, sent, folder)
    out = done.stdout.decode("utf-8", "replace").strip()
    body = {}
    try:
        body = json.loads(out)
    except ValueError:                              # one JSON object per line: the last result is the answer
        for line in reversed(out.splitlines()):
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and row.get("type") == "result":
                body = row
                break
    if isinstance(body, list):                      # some versions print every event; the last is the result
        body = next((row for row in reversed(body) if isinstance(row, dict) and row.get("type") == "result"), {})
    text = body.get("result") if isinstance(body, dict) else None
    if done.returncode != 0 or body.get("is_error") or not isinstance(text, str) or not text.strip():
        detail = (text if isinstance(text, str) and text else done.stderr.decode("utf-8", "replace") or out)
        detail = re.sub(r"\s+", " ", detail).strip()[:300]
        raise AIError(f"Claude Code didn't answer. Open a terminal, run `{p['signin']}`, then try again. "
                      f"It said: {detail or 'nothing'}")
    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    used = body.get("modelUsage") if isinstance(body.get("modelUsage"), dict) else {}
    cost = body.get("total_cost_usd") if isinstance(body.get("total_cost_usd"), (int, float)) else None
    return _reply(text, next(iter(used), model or ""),
                  _count(usage.get("input_tokens"), usage.get("cache_read_input_tokens"), usage.get("cache_creation_input_tokens")),
                  _count(usage.get("output_tokens")), cost)


def _ask_codex(model, system, messages):
    p = provider("codex")
    with _workspace() as folder:
        answer = os.path.join(folder, "answer.txt")
        # `codex exec` reads the request from standard input and writes its final answer to the file
        # named by -o. `-s read-only` keeps its own shell from changing anything; the folder is empty.
        args = ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "--color", "never", "-o", answer]
        if model:
            args += ["-m", model]
        for index, (mime, b64) in enumerate(_pictures(messages)):
            path = os.path.join(folder, f"picture-{index}." + ("png" if "png" in mime else "jpg"))
            with open(path, "wb") as handle:
                handle.write(base64.b64decode(b64))
            args += ["-i", path]
        done = _run(p, args + ["-"], "Follow these instructions exactly.\n\n" + system + "\n\n---\n\n"
                    + _transcript(messages), folder)
        text = ""
        try:
            with open(answer, encoding="utf-8", errors="replace") as handle:
                text = handle.read().strip()
        except OSError:
            pass
    text = text or done.stdout.decode("utf-8", "replace").strip()
    if done.returncode != 0 or not text:
        detail = re.sub(r"\s+", " ", done.stderr.decode("utf-8", "replace")).strip()[-300:]
        raise AIError(f"Codex didn't answer. Open a terminal, run `{p['signin']}`, then try again. "
                      f"It said: {detail or 'nothing'}")
    return _reply(text, model or "")


# ---- one entry point ---------------------------------------------------------

def supports_pictures(pid):
    provider(pid)
    return True


def ask(pid, model, system, messages):
    """
    One answer as text (a Reply, which also carries `.usage`). `messages` is a list of
    {"role": "user"|"assistant", "text": str, "images": [(mime, base64), ...]} in order, starting
    with the owner.
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
