"""
Signing in to a plan from inside Deja Vu1 (backend/ai_signin.py), against stand-ins:

  * OpenAI's Sign in with ChatGPT for open-source apps: a local server plays the authorize, token, revoke,
    signing-key, model-list and Responses endpoints, with a throwaway RSA key made for these tests only.
  * Claude Code's own sign-in: a small script plays `claude auth login`, printing the page's address and
    waiting for the code on standard input, as the real program does when it has no browser to hand back to.

Nothing here reaches OpenAI or Anthropic.
"""

import base64
import hashlib
import json
import os
import stat
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import ai_providers        # noqa: E402
import ai_signin           # noqa: E402

# A 1024-bit key made with `openssl genrsa` for these tests only. It signs nothing anywhere else.
N = 0xb4a2795b7ddf5ab0cb58d4ba119fd9f6f04cdde68760dbe4e5868ea897748e2e7f5a21de4b38a193f9b399e4178f3e12c34115d5149fb20836b06d8fd722985da2cb0766b88f4ec7606069579dea641dbe22ad43e96eaff843cd8a4a4335ab22cbf17b7ccc50b382a697e70949206548e69be1b4014556ca28af441a72af695d
D = 0x736023abb0a66d42e75f81e0a74936eb67697182c18db86667c49e7248eb05b5e55a28afd7d400408809938e010e59539aab83ca6a35e67d20916829abfc48dcd203df73f1b44a70e94b3ca94c4c222aa80a72e61dd4f961ee2f3b0286d3c025ff09ff25a9492ac44ce68c0364f2eb368fa1dc7a8eac1db179459051e2d1f601
E = 65537


def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def sign(claims, kid="test-key"):
    head = b64(json.dumps({"alg": "RS256", "kid": kid}).encode())
    body = b64(json.dumps(claims).encode())
    digest = ai_signin._SHA256_PREFIX + hashlib.sha256(f"{head}.{body}".encode()).digest()
    size = (N.bit_length() + 7) // 8
    block = b"\x00\x01" + b"\xff" * (size - len(digest) - 3) + b"\x00" + digest
    return f"{head}.{body}." + b64(pow(int.from_bytes(block, "big"), D, N).to_bytes(size, "big"))


JWKS = {"keys": [{"kid": "test-key", "kty": "RSA", "alg": "RS256", "n": b64(N.to_bytes((N.bit_length() + 7) // 8, "big")),
                  "e": b64(E.to_bytes(3, "big"))}]}


class OpenAI(BaseHTTPRequestHandler):
    """Plays OpenAI's sign-in and API for one test."""
    state = {}

    def log_message(self, *args):
        pass

    def reply(self, code, body, kind="application/json"):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def form(self):
        return dict(urllib.parse.parse_qsl(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()))

    def tokens(self, client):
        s = self.state
        s["issued"] = s.get("issued", 0) + 1
        claims = {"iss": "https://auth.openai.com", "aud": client, "sub": "user-123", "email": "owner@example.com",
                  "exp": time.time() + 3600, "nonce": s.get("nonce")}
        claims.update(s.get("claims") or {})
        return {"access_token": f"access-{s['issued']}", "refresh_token": f"refresh-{s['issued']}",
                "id_token": sign(claims), "token_type": "Bearer", "expires_in": s.get("expires_in", 3600),
                "scope": s.get("scope", ai_signin.SCOPES)}

    def do_GET(self):
        if self.path == "/jwks":
            return self.reply(200, JWKS)
        if self.path == "/v1/models":
            self.state["models_auth"] = self.headers.get("Authorization")
            return self.reply(200, {"models": [{"slug": "gpt-plan-1", "display_name": "GPT Plan 1", "visibility": "list"},
                                               {"slug": "hidden", "display_name": "Hidden", "visibility": "hide"}]})
        self.reply(404, {})

    def do_POST(self):
        s = self.state
        if self.path == "/token":
            f = self.form()
            s.setdefault("token_forms", []).append(f)
            if f.get("grant_type") == "authorization_code" and f.get("code") == "good-code" and f.get("code_verifier"):
                return self.reply(200, self.tokens(f.get("client_id")))
            if f.get("grant_type") == "refresh_token" and f.get("refresh_token", "").startswith("refresh-"):
                return self.reply(200, self.tokens(f.get("client_id")))
            return self.reply(400, {"error": "invalid_grant"})
        if self.path == "/revoke":
            s["revoked"] = self.form()
            return self.reply(200, b"", "text/plain")
        if self.path == "/v1/responses":
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
            s["request"] = body
            s["auth"] = self.headers.get("Authorization")
            events = s.get("events") or [
                {"type": "response.output_text.delta", "delta": "Hello"},
                {"type": "response.output_text.delta", "delta": ", world"},
                {"type": "response.completed", "response": {"model": body.get("model"), "usage": {"input_tokens": 12, "output_tokens": 3}}}]
            raw = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()
            return self.reply(200, raw, "text/event-stream")
        self.reply(404, {})


class SignInWithChatGPT(unittest.TestCase):
    def setUp(self):
        ai_signin.reset()
        OpenAI.state = {}
        self.server = HTTPServer(("127.0.0.1", 0), OpenAI)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{self.server.server_address[1]}"
        for name, value in (("TOKEN", base + "/token"), ("REVOKE", base + "/revoke"), ("JWKS", base + "/jwks")):
            p = patch.object(ai_signin, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(ai_providers, "CHATGPT_API", base + "/v1")
        p.start()
        self.addCleanup(p.stop)
        p = patch.dict(os.environ, {"DEJAVU_KEY_STORE": "file"})
        p.start()
        self.addCleanup(p.stop)
        ai_signin._jwks.update(at=0, keys=[])
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(ai_signin.reset)
        self.addCleanup(lambda: ai_providers._models.pop("chatgpt", None))

    def start(self):
        started = ai_signin.start_chatgpt(listen=False)
        OpenAI.state["nonce"] = ai_signin._pending["nonce"]
        query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(started["url"]).query))
        return query

    def back(self, query, **extra):
        params = {"code": "good-code", "state": query["state"], "client_id": "oaiapp_123", **extra}
        return "http://127.0.0.1:1455/auth/callback?" + urllib.parse.urlencode(params)

    def test_the_first_sign_in_registers_deja_vu1_as_an_open_source_app(self):
        q = self.start()
        self.assertTrue(q.pop("code_challenge"))
        for key in ("state", "nonce"):
            self.assertGreater(len(q.pop(key)), 20)
        host = q.pop("ext_agent_host_id")
        self.assertTrue(host.startswith("urn:uuid:"))
        self.assertEqual(q, {"response_type": "code", "redirect_uri": "http://127.0.0.1:1455/auth/callback",
                             "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
                             "resource": "https://api.openai.com/v1", "code_challenge_method": "S256",
                             "client_id": "dynamic_agent_client", "agent_name_hint": "Deja Vu1"})
        self.assertEqual(ai_signin._host_id(), host)        # the same host id every time

    def test_coming_back_signs_in_and_never_shows_a_token(self):
        q = self.start()
        status = ai_signin.finish_chatgpt(self.back(q))
        self.assertEqual((status["signed_in"], status["plan_use"], status["email"]), (True, True, "owner@example.com"))
        form = OpenAI.state["token_forms"][0]
        self.assertEqual((form["client_id"], form["resource"], form["redirect_uri"]),
                         ("oaiapp_123", "https://api.openai.com/v1", q["redirect_uri"]))
        self.assertEqual(hashlib.sha256(form["code_verifier"].encode()).digest(), base64.urlsafe_b64decode(q["code_challenge"] + "=" * (-len(q["code_challenge"]) % 4)))
        if os.name == "posix":                         # the file store is for this account only, like a saved key
            self.assertEqual(stat.S_IMODE(os.stat(ai_signin._PATH).st_mode), 0o600)
        shown = ai_providers.describe("chatgpt")
        self.assertTrue(shown["ready"])
        self.assertNotIn("access-1", json.dumps(shown))                # the browser never sees a token
        self.assertNotIn("refresh-1", json.dumps(ai_signin.status_chatgpt()))
        self.assertEqual(ai_signin.access_token(), "access-1")

    def test_a_returning_sign_in_reuses_the_registration(self):
        ai_signin.finish_chatgpt(self.back(self.start()))
        q = self.start()
        self.assertEqual(q["client_id"], "oaiapp_123")
        self.assertNotIn("agent_name_hint", q)
        self.assertIn("id_token_hint", q)
        self.assertEqual(q["login_hint"], "owner@example.com")

    def test_a_refusal_a_stale_attempt_and_missing_plan_use_are_said_in_words(self):
        q = self.start()
        with self.assertRaises(ai_signin.SignInError) as no:
            ai_signin.finish_chatgpt(self.back(q, error="access_denied"))
        self.assertIn("plan use wasn't allowed", str(no.exception))
        with self.assertRaises(ai_signin.SignInError):
            ai_signin.finish_chatgpt(self.back(q))                  # the attempt is over
        OpenAI.state["scope"] = "openid profile email offline_access"
        status = ai_signin.finish_chatgpt(self.back(self.start()))
        self.assertEqual((status["signed_in"], status["plan_use"]), (True, False))
        self.assertFalse(ai_providers.describe("chatgpt")["ready"])
        with self.assertRaises(ai_signin.SignInError):
            ai_signin.access_token()

    def test_the_identity_is_checked_before_anything_is_kept(self):
        for claims in ({"nonce": "someone-else"}, {"aud": "another-app"}, {"exp": time.time() - 3600},
                       {"iss": "https://example.com"}):
            OpenAI.state["claims"] = claims
            with self.assertRaises(ai_signin.SignInError):
                ai_signin.finish_chatgpt(self.back(self.start()))
            self.assertFalse(ai_signin.status_chatgpt()["signed_in"], claims)
        token = sign({"iss": "https://auth.openai.com", "aud": "c", "exp": time.time() + 60, "nonce": "n"})
        head, body, sig = token.split(".")
        forged = f"{head}.{b64(json.dumps({'iss': 'https://auth.openai.com', 'aud': 'c', 'exp': time.time() + 60, 'nonce': 'n', 'sub': 'x'}).encode())}.{sig}"
        self.assertEqual(ai_signin.check_id_token(token, "c", "n", keys=JWKS["keys"])["aud"], "c")
        with self.assertRaises(ai_signin.SignInError):
            ai_signin.check_id_token(forged, "c", "n", keys=JWKS["keys"])

    def test_the_browser_can_come_back_to_this_computer(self):
        started = ai_signin.start_chatgpt(listen=True)
        OpenAI.state["nonce"] = ai_signin._pending["nonce"]
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(started["url"]).query))
        url = self.back(q).replace("1455", str(started["port"]))
        page = urllib.request.urlopen(url, timeout=10).read().decode()
        self.assertIn("Signed in", page)
        self.assertTrue(ai_signin.status_chatgpt()["signed_in"])

    def test_an_access_token_is_refreshed_before_it_runs_out_and_sign_out_revokes(self):
        OpenAI.state["expires_in"] = 60
        ai_signin.finish_chatgpt(self.back(self.start()))
        self.assertEqual(ai_signin.access_token(), "access-2")          # within five minutes of running out
        self.assertEqual(OpenAI.state["token_forms"][-1]["grant_type"], "refresh_token")
        self.assertEqual(OpenAI.state["token_forms"][-1]["client_id"], "oaiapp_123")
        out = ai_signin.sign_out_chatgpt()
        self.assertEqual((out["signed_in"], out["revoked"]), (False, True))
        self.assertEqual(OpenAI.state["revoked"]["token"], "refresh-2")
        self.assertEqual(ai_signin._load()["client_id"], "oaiapp_123")    # kept for the next sign-in

    def test_answers_come_through_the_responses_api_with_store_off(self):
        ai_signin.finish_chatgpt(self.back(self.start()))
        self.assertEqual(ai_providers.list_models("chatgpt", refresh=True)["models"], ["gpt-plan-1"])
        answer = ai_providers.ask("chatgpt", "", "Be brief.", [{"role": "user", "text": "Hi", "images": [("image/jpeg", "QUJD")]},
                                                               {"role": "assistant", "text": "Hello"},
                                                               {"role": "user", "text": "Again"}])
        self.assertEqual(str(answer), "Hello, world")
        self.assertEqual((answer.usage["in"], answer.usage["out"], answer.usage["model"]), (12, 3, "gpt-plan-1"))
        sent = OpenAI.state["request"]
        self.assertEqual((sent["store"], sent["stream"], sent["model"], sent["instructions"]), (False, True, "gpt-plan-1", "Be brief."))
        self.assertEqual([r["role"] for r in sent["input"]], ["user", "assistant", "user"])
        self.assertEqual(sent["input"][1]["content"][0]["type"], "output_text")
        self.assertNotIn("input_image", json.dumps(sent["input"][0]))       # pictures go with the newest message only
        self.assertEqual(OpenAI.state["auth"], "Bearer access-1")

    def test_a_used_up_plan_says_so(self):
        ai_signin.finish_chatgpt(self.back(self.start()))
        OpenAI.state["events"] = [{"type": "response.failed", "response": {"error": {"code": "subscription_sharing_usage_limit_exceeded"}}}]
        with self.assertRaises(ai_providers.AIError) as no:
            ai_providers.ask("chatgpt", "gpt-plan-1", "x", [{"role": "user", "text": "Hi"}])
        self.assertIn("allowance for apps is used up", str(no.exception))


CLAUDE = """#!/bin/sh
echo "Opening browser to sign in..."
echo "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=abc"
printf "Paste code here if prompted > "
read code
if [ "$code" = "good-code-1234" ]; then echo "Login successful."; exit 0; fi
echo "Invalid code"; exit 1
"""


@unittest.skipIf(sys.platform == "win32", "the stand-in is a shell script")
class ClaudeCodeSignIn(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.program = os.path.join(self.tmp.name, "claude")
        with open(self.program, "w") as fh:
            fh.write(CLAUDE)
        os.chmod(self.program, os.stat(self.program).st_mode | stat.S_IEXEC)
        self.addCleanup(ai_signin.stop_claude)

    def test_the_page_address_is_shown_and_the_code_is_passed_on(self):
        out = ai_signin.start_claude(self.program)
        self.assertTrue(out["running"])
        self.assertTrue(out["url"].startswith("https://claude.com/cai/oauth/authorize"))
        done = ai_signin.code_claude("good-code-1234")
        self.assertTrue(done["done"])

    def test_a_wrong_code_says_what_claude_code_said(self):
        ai_signin.start_claude(self.program)
        out = ai_signin.code_claude("wrong-code-9999")
        self.assertTrue(out["failed"])
        self.assertIn("Invalid code", out["said"])
        with self.assertRaises(ai_signin.SignInError):
            ai_signin.code_claude("good-code-1234")              # nothing is waiting any more
        with self.assertRaises(ai_signin.SignInError):
            ai_signin.start_claude("")


if __name__ == "__main__":
    unittest.main()
