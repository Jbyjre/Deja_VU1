"""
ai_signin.py
============

Signing in to a plan from inside Deja Vu1, so nobody needs a terminal.

Two plans, two ways in:

  * A ChatGPT plan, through OpenAI's own "Sign in with ChatGPT" for open-source apps
    (developers.openai.com/siwc, read on 12 November 2026). Deja Vu1 registers itself with the owner's
    ChatGPT account the first time (client_id=dynamic_agent_client, no secret and no partner key), the
    owner approves it in their browser, and the requests then count against their plan through OpenAI's
    Responses API. No Codex and no other program is involved. The tokens are kept by the computer's
    keyring (ai_vault.py), refreshed before they run out and revoked at OpenAI on sign-out.

  * A Claude plan, through Claude Code's own sign-in (`claude auth login`). Deja Vu1 starts it, shows
    the page it opens, and passes on the code if the page shows one. Claude Code keeps its own sign-in;
    Deja Vu1 never sees it.

The browser has to come back to 127.0.0.1 after the ChatGPT approval, which only works on the computer
that runs Deja Vu1. From a phone or another computer the owner pastes the address the browser ended on
instead (finish_chatgpt), which carries the same one-time code.
"""

import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

import ai_vault
import storage

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, "ai_chatgpt.json")
_VAULT_NAME = "chatgpt-account"
_lock = threading.Lock()
_refresh_lock = threading.Lock()

AUTHORIZE = "https://auth.openai.com/api/accounts/authorize"
TOKEN = "https://auth.openai.com/api/accounts/oauth/token"
REVOKE = "https://auth.openai.com/api/accounts/oauth/revoke"
JWKS = "https://auth.openai.com/.well-known/jwks.json"
ISSUER = "https://auth.openai.com"
RESOURCE = "https://api.openai.com/v1"
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
PLAN_SCOPE = "chatgpt.tokens.use.direct"
APP_NAME = "Deja Vu1"
CALLBACK_PATH = "/auth/callback"
PORT = 1455                       # the port OpenAI's guide uses; any free port works if it is taken
SIGNIN_WAIT_S = 600               # a sign-in left open longer than this is dropped
REFRESH_EARLY_S = 300             # refresh an access token this long before it runs out


class SignInError(Exception):
    """Something the owner can act on, in words."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64url(text):
    text = str(text or "")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ---- the saved account ---------------------------------------------------------

def _load():
    data = storage.load_json(_PATH, {})
    return data if isinstance(data, dict) else {}


def _save(data):
    storage.save_json(_PATH, data)
    for path in (_PATH, storage.prev_path(_PATH)):
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def _host_id():
    """One stable id for this computer's Deja Vu1, made once (OpenAI's ext_agent_host_id)."""
    with _lock:
        data = _load()
        if not str(data.get("host_id") or "").startswith("urn:uuid:"):
            data["host_id"] = "urn:uuid:" + str(uuid.uuid4())
            _save(data)
        return data["host_id"]


def _tokens():
    data = _load()
    sealed = data.get("sealed")
    if not isinstance(sealed, dict):
        return {}
    try:
        tokens = json.loads(ai_vault.open_(_VAULT_NAME, sealed) or "{}")
    except ValueError:
        return {}
    return tokens if isinstance(tokens, dict) else {}


def _keep_tokens(tokens, identity=None):
    with _lock:
        data = _load()
        ai_vault.drop(_VAULT_NAME, data.get("sealed"))
        record = ai_vault.seal(_VAULT_NAME, json.dumps(tokens))
        record.pop("hint", None)
        data["sealed"] = record
        data["expires_at"] = tokens.get("expires_at")
        data["scopes"] = tokens.get("scopes") or []
        if identity:
            data.update(identity)
        _save(data)


# ---- the ID token: RS256 checked against OpenAI's published keys -----------------

_jwks = {"at": 0, "keys": []}
# DER prefix of a SHA-256 DigestInfo (RFC 8017, section 9.2)
_SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


def _post_form(url, fields, timeout=30):
    request = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", "DejaVu1")
    try:
        with _opener.open(request, timeout=timeout) as response:
            raw = response.read(1024 * 1024)
            return response.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read(20000) or b"{}")
        except ValueError:
            body = {}
        return error.code, body if isinstance(body, dict) else {}
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise SignInError(f"Couldn't reach OpenAI's sign-in ({getattr(error, 'reason', error)}). Check this computer's "
                          "internet connection.")


def _keys(refresh=False):
    if refresh or not _jwks["keys"] or time.time() - _jwks["at"] > 6 * 3600:
        try:
            with _opener.open(urllib.request.Request(JWKS, headers={"User-Agent": "DejaVu1"}), timeout=20) as response:
                _jwks["keys"] = json.loads(response.read(512 * 1024)).get("keys") or []
                _jwks["at"] = time.time()
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise SignInError(f"Couldn't read OpenAI's signing keys ({getattr(error, 'reason', error)}). Try again.")
    return _jwks["keys"]


def _rs256_ok(signed, signature, key):
    n = int.from_bytes(_unb64url(key.get("n")), "big")
    e = int.from_bytes(_unb64url(key.get("e")), "big")
    size = (n.bit_length() + 7) // 8
    if len(signature) != size:
        return False
    block = pow(int.from_bytes(signature, "big"), e, n).to_bytes(size, "big")
    digest = _SHA256_PREFIX + hashlib.sha256(signed).digest()
    expected = b"\x00\x01" + b"\xff" * (size - len(digest) - 3) + b"\x00" + digest
    return secrets.compare_digest(block, expected)


def check_id_token(token, client_id, nonce, now=None, keys=None):
    """The claims of an ID token once its signature, issuer, audience, time and nonce all check out."""
    try:
        head64, body64, sig64 = str(token).split(".")
        head = json.loads(_unb64url(head64))
        claims = json.loads(_unb64url(body64))
        signature = _unb64url(sig64)
    except (ValueError, TypeError):
        raise SignInError("OpenAI sent an identity that couldn't be read. Try signing in again.")
    if head.get("alg") != "RS256":
        raise SignInError("OpenAI's identity was signed in an unexpected way, so it was not accepted.")
    for attempt in (False, True):
        pool = keys if keys is not None else _keys(refresh=attempt)
        key = next((k for k in pool if k.get("kid") == head.get("kid") and k.get("kty") == "RSA"), None)
        if key or keys is not None:
            break
    if not key or not _rs256_ok(f"{head64}.{body64}".encode(), signature, key):
        raise SignInError("OpenAI's identity didn't match its published signature, so it was not accepted.")
    now = time.time() if now is None else now
    audience = claims.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    if claims.get("iss") != ISSUER or client_id not in audiences:
        raise SignInError("That sign-in was meant for another app, so it was not accepted.")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now - 60:
        raise SignInError("That sign-in had already run out. Sign in again.")
    if not nonce or claims.get("nonce") != nonce:
        raise SignInError("That sign-in didn't belong to this attempt. Sign in again.")
    return claims


# ---- ChatGPT: start, come back, refresh, sign out --------------------------------

_pending = {}                       # the one sign-in in progress: state, nonce, verifier, redirect, server
_last = {"error": "", "done_at": 0}


class _Callback(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path != CALLBACK_PATH:
            self.send_response(404)
            self.end_headers()
            return
        try:
            _complete(dict(urllib.parse.parse_qsl(url.query)))
            title, words = "Signed in", "Deja Vu1 can use your ChatGPT plan now. Close this tab and go back to Deja Vu1."
        except SignInError as error:
            title, words = "Not signed in", str(error)
        page = (f"<!doctype html><meta charset=utf-8><title>{title}</title>"
                "<body style=\"font:16px system-ui;margin:12vh auto;max-width:34em;padding:0 16px;color:#16202a\">"
                f"<h1 style=\"font-size:22px\">{title}</h1><p>{_html(words)}</p></body>").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(page)
        threading.Thread(target=_stop_listener, daemon=True).start()


def _html(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _stop_listener():
    server = _pending.get("server")
    if server:
        _pending["server"] = None
        try:
            server.shutdown()
            server.server_close()
        except OSError:
            pass


def _listen():
    for port in (PORT, 0):
        try:
            server = HTTPServer(("127.0.0.1", port), _Callback)
            break
        except OSError:
            continue
    else:
        raise SignInError("Deja Vu1 couldn't open a port on this computer for the sign-in to come back to.")
    threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.5}, daemon=True,
                     name="chatgpt-signin").start()
    return server


def start_chatgpt(listen=True):
    """Begin a sign-in. Returns the address to open in the browser."""
    _stop_listener()
    data = _load()
    verifier = _b64url(secrets.token_bytes(48))
    state, nonce = _b64url(secrets.token_bytes(24)), _b64url(secrets.token_bytes(24))
    server = _listen() if listen else None
    port = server.server_address[1] if server else PORT
    redirect = f"http://127.0.0.1:{port}{CALLBACK_PATH}"
    client = data.get("client_id") or ""
    query = {"response_type": "code", "redirect_uri": redirect, "scope": SCOPES, "resource": RESOURCE,
             "state": state, "nonce": nonce, "code_challenge_method": "S256",
             "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()),
             "ext_agent_host_id": _host_id()}
    if client:
        query["client_id"] = client
        id_token = _tokens().get("id_token")
        if id_token:
            query["id_token_hint"] = id_token
        if data.get("email"):
            query["login_hint"] = data["email"]
    else:
        query.update(client_id="dynamic_agent_client", agent_name_hint=APP_NAME)
    _pending.clear()
    _pending.update(state=state, nonce=nonce, verifier=verifier, redirect=redirect, client=client, server=server,
                    started=time.time())
    _last.update(error="", done_at=0)
    _timer(lambda s=state: _expire(s))
    return {"url": AUTHORIZE + "?" + urllib.parse.urlencode(query, quote_via=urllib.parse.quote), "port": port}


def _timer(fn):
    """A sign-in left open is dropped after SIGNIN_WAIT_S. The timer never keeps Deja Vu1 from closing."""
    t = threading.Timer(SIGNIN_WAIT_S, fn)
    t.daemon = True
    t.start()


def _expire(state):
    if _pending.get("state") == state:
        _stop_listener()
        _pending.clear()


def finish_chatgpt(pasted):
    """The address the browser ended on after approving, pasted in from another device."""
    text = str(pasted or "").strip()
    query = urllib.parse.urlsplit(text).query if "?" in text else text
    params = dict(urllib.parse.parse_qsl(query))
    if not params.get("code") and not params.get("error"):
        raise SignInError("That address has no sign-in code in it. Copy the whole address from the browser's bar.")
    _complete(params)
    _stop_listener()
    return status_chatgpt()


def _complete(params):
    if not _pending or params.get("state") != _pending.get("state"):
        raise SignInError("That sign-in isn't the one Deja Vu1 started, or it ran out. Press Continue with ChatGPT again.")
    try:
        if params.get("error"):
            reason = params.get("error_description") or params["error"]
            raise SignInError("ChatGPT plan use wasn't allowed, so nothing changed. You can allow it later from Deja Vu1."
                              if params["error"] == "access_denied" else f"ChatGPT said: {reason}")
        client = params.get("client_id") or _pending.get("client")
        if not client or client == "dynamic_agent_client":
            raise SignInError("The registration didn't finish. Press Continue with ChatGPT again.")
        if _pending.get("client") and client != _pending["client"]:
            raise SignInError("ChatGPT answered for a different registration, so it was not accepted.")
        status_code, body = _post_form(TOKEN, {"grant_type": "authorization_code", "client_id": client,
                                               "code": params.get("code") or "", "code_verifier": _pending["verifier"],
                                               "redirect_uri": _pending["redirect"], "resource": RESOURCE})
        if status_code != 200 or not body.get("access_token"):
            raise SignInError("OpenAI didn't accept the sign-in code" + (f" ({body.get('error')})" if body.get("error") else "")
                              + ". Press Continue with ChatGPT again.")
        claims = check_id_token(body.get("id_token"), client, _pending["nonce"])
        old = _load()
        if old.get("subject") and old.get("client_id") == client and old["subject"] != claims.get("sub"):
            raise SignInError("That was a different ChatGPT account from the one saved here. Sign out first to switch.")
        scopes = str(body.get("scope") or "").split()
        tokens = {"access_token": body["access_token"], "refresh_token": body.get("refresh_token") or "",
                  "id_token": body.get("id_token") or "", "scopes": scopes,
                  "expires_at": time.time() + int(body.get("expires_in") or 3600)}
        _keep_tokens(tokens, {"client_id": client, "subject": claims.get("sub"), "email": claims.get("email") or "",
                              "name": claims.get("name") or "", "signed_in_at": time.time()})
        _last.update(error="" if PLAN_SCOPE in scopes else "Signed in, but ChatGPT plan use wasn't allowed.",
                     done_at=time.time())
    except SignInError as error:
        _last.update(error=str(error), done_at=time.time())
        raise
    finally:
        _pending.pop("state", None)


def access_token():
    """A current access token for the Responses API, refreshed first when it is about to run out."""
    with _refresh_lock:
        tokens, data = _tokens(), _load()
        if not tokens.get("access_token"):
            raise SignInError("Sign in with ChatGPT first.")
        if PLAN_SCOPE not in (tokens.get("scopes") or []):
            raise SignInError("ChatGPT plan use isn't allowed for Deja Vu1 yet. Press Continue with ChatGPT and allow it.")
        if (tokens.get("expires_at") or 0) - time.time() > REFRESH_EARLY_S:
            return tokens["access_token"]
        if not tokens.get("refresh_token"):
            raise SignInError("Your ChatGPT sign-in ran out. Press Continue with ChatGPT to sign in again.")
        status_code, body = _post_form(TOKEN, {"grant_type": "refresh_token", "client_id": data.get("client_id") or "",
                                               "refresh_token": tokens["refresh_token"], "resource": RESOURCE})
        if status_code != 200 or not body.get("access_token"):
            raise SignInError("Your ChatGPT sign-in ran out (it lasts 30 days between uses). Press Continue with "
                              "ChatGPT to sign in again.")
        tokens.update(access_token=body["access_token"], refresh_token=body.get("refresh_token") or tokens["refresh_token"],
                      expires_at=time.time() + int(body.get("expires_in") or 3600))
        if body.get("scope"):
            tokens["scopes"] = str(body["scope"]).split()
        if body.get("id_token"):
            tokens["id_token"] = body["id_token"]
        _keep_tokens(tokens)
        return tokens["access_token"]


def sign_out_chatgpt():
    """Revoke the renewable session at OpenAI, then forget the tokens. The registration is kept for next time."""
    tokens, data = _tokens(), _load()
    revoked = True
    if tokens.get("refresh_token"):
        try:
            code, _ = _post_form(REVOKE, {"token": tokens["refresh_token"], "token_type_hint": "refresh_token",
                                          "client_id": data.get("client_id") or ""}, timeout=15)
            revoked = code == 200
        except SignInError:
            revoked = False
    with _lock:
        data = _load()
        ai_vault.drop(_VAULT_NAME, data.pop("sealed", None))
        data.pop("expires_at", None)
        data.pop("scopes", None)
        _save(data)
    return {**status_chatgpt(), "revoked": revoked}


def status_chatgpt():
    data, tokens = _load(), _tokens()
    signed = bool(tokens.get("access_token"))
    return {"signed_in": signed, "plan_use": signed and PLAN_SCOPE in (tokens.get("scopes") or []),
            "email": data.get("email") if signed else "", "waiting": bool(_pending.get("state")),
            "error": _last["error"], "finished_at": _last["done_at"]}


def reset():
    _stop_listener()
    _pending.clear()
    _last.update(error="", done_at=0)
    ai_vault.drop(_VAULT_NAME, _load().get("sealed"))
    storage.save_json(_PATH, {})


# ---- Claude Code: run its own sign-in ------------------------------------------

_claude = {"proc": None, "url": "", "out": "", "started": 0, "code_sent": False}
_URL = re.compile(r"https://[^\s\"'<>]+")


def start_claude(program):
    """Start `claude auth login --claudeai`. It opens the sign-in page itself; the address is shown as well."""
    stop_claude()
    if not program:
        raise SignInError("Claude Code isn't installed on this computer yet.")
    try:
        proc = subprocess.Popen([program, "auth", "login", "--claudeai"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, cwd=tempfile.gettempdir())
    except OSError as error:
        raise SignInError(f"Couldn't start Claude Code's sign-in: {error}")
    _claude.update(proc=proc, url="", out="", started=time.time(), code_sent=False)

    def read():
        while True:
            chunk = proc.stdout.read1(4096) if hasattr(proc.stdout, "read1") else proc.stdout.read(1)
            if not chunk:
                break
            _claude["out"] = (_claude["out"] + chunk.decode("utf-8", "replace"))[-6000:]
            found = _URL.search(_claude["out"])
            if found and not _claude["url"]:
                _claude["url"] = found.group(0)

    threading.Thread(target=read, daemon=True, name="claude-signin").start()
    _timer(lambda p=proc: _kill(p))
    for _ in range(80):                                  # up to 8 seconds for the address to appear
        if _claude["url"] or proc.poll() is not None:
            break
        time.sleep(0.1)
    return status_claude()


def code_claude(code):
    """The code the sign-in page shows when it can't hand back to Claude Code by itself."""
    proc = _claude["proc"]
    code = str(code or "").strip()
    if not proc or proc.poll() is not None:
        raise SignInError("The sign-in isn't waiting any more. Press Sign in again.")
    if not re.match(r"^[A-Za-z0-9#_.~-]{8,600}$", code):
        raise SignInError("That doesn't look like the code from the sign-in page. Copy it whole.")
    try:
        proc.stdin.write((code + "\n").encode())
        proc.stdin.flush()
    except OSError:
        raise SignInError("Claude Code's sign-in stopped before the code arrived. Press Sign in again.")
    _claude["code_sent"] = True
    for _ in range(150):
        if proc.poll() is not None:
            break
        time.sleep(0.1)
    return status_claude()


def status_claude():
    proc = _claude["proc"]
    running = bool(proc) and proc.poll() is None
    done = bool(proc) and proc.poll() == 0
    failed = bool(proc) and proc.poll() not in (None, 0)
    tail = re.sub(r"\s+", " ", _URL.sub("", _claude["out"])).strip()[-200:]
    return {"running": running, "done": done, "failed": failed, "url": _claude["url"],
            "said": tail if failed else "", "code_sent": _claude["code_sent"]}


def _kill(proc):
    if proc and proc.poll() is None:
        try:
            proc.kill()
        except OSError:
            pass


def stop_claude():
    _kill(_claude["proc"])
    _claude.update(proc=None, url="", out="", code_sent=False)


def which_claude():
    return shutil.which("claude")
