#!/usr/bin/env python3
"""THE NO-COST INFERENCE PATHS.  python3 test_no_cost.py

Two ways to reach a real model without paying an API bill:

    CIV_PROVIDER=openai-compat   anything speaking the OpenAI chat wire format
                                 — llama-server, vLLM, LM Studio, LocalAI —
                                 on this host or one on the private network
    CIV_PROVIDER=gemini          Google AI Studio, whose free tier needs no
                                 payment method and no credit

Neither is exercised against a live endpoint here, because neither is reachable
from this machine with a credential. What is tested is everything that does not
need one: that they fail closed, what they put on the wire, how they read a
reply, where the credential travels, and that nothing they add can be mistaken
for a measurement.

No test here makes a network call. Several would fail if one did.
"""
import io
import json
import os
import sys
import unittest
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import provider as P               # noqa: E402
from core import spend as SPEND              # noqa: E402

FAKE_KEY = "REDACTED-SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL"
ENV_KEYS = ("CIV_PROVIDER", "CIV_MODEL", "CIV_EFFORT", "CIV_ASSUME_FREE",
            "OPENAI_COMPAT_URL", "OPENAI_COMPAT_KEY", "LOCAL_MODEL_NAME",
            "LOCAL_MODEL_URL", "GEMINI_API_KEY", "GOOGLE_API_KEY",
            "GEMINI_MODEL", "GEMINI_BASE_URL", "ANTHROPIC_API_KEY")


class CleanEnv(unittest.TestCase):
    """Each test starts from an environment with nothing configured."""

    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in ENV_KEYS}
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def wire(self, prov, system="sys", prompt="hi", **kw):
        """What would go on the wire, captured without sending it."""
        import urllib.request
        real, seen = urllib.request.urlopen, {}

        def capture(req, *a, **k):
            seen["url"] = req.full_url
            seen["headers"] = {k.lower(): v for k, v in req.header_items()}
            seen["body"] = json.loads(req.data.decode("utf-8"))
            raise urllib.error.URLError("not sent")
        urllib.request.urlopen = capture
        try:
            prov.complete(system, prompt, **kw)
        finally:
            urllib.request.urlopen = real
        return seen

    def reply(self, prov, payload, status=200):
        """Drive the provider with a canned HTTP body and no socket."""
        import urllib.request
        real = urllib.request.urlopen

        class R:
            def __init__(self, b):
                self._b = b
            def read(self):
                return self._b
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False

        def answer(req, *a, **k):
            return R(json.dumps(payload).encode("utf-8"))
        urllib.request.urlopen = answer
        try:
            return prov.complete("sys", "hi")
        finally:
            urllib.request.urlopen = real


# ═════════════════════════════════════════════════════════════════════
class TheOpenAICompatPathFailsClosed(CleanEnv):
    def test_no_endpoint_means_no_call(self):
        prov = P.OpenAICompatProvider()
        self.assertFalse(prov.available())
        self.assertIn("OPENAI_COMPAT_URL", prov.why_unavailable())
        import urllib.request
        real = urllib.request.urlopen
        urllib.request.urlopen = lambda *a, **k: self.fail("it called out")
        try:
            res = prov.complete("sys", "hi")
        finally:
            urllib.request.urlopen = real
        self.assertEqual(res.status, "NOT_CONFIGURED")
        self.assertEqual(res.text, "")

    def test_an_endpoint_without_a_model_is_still_refused(self):
        """Guessing which model a server is holding, and being wrong, looks
        exactly like a broken world."""
        prov = P.OpenAICompatProvider(url="http://127.0.0.1:8080")
        self.assertFalse(prov.available())
        self.assertIn("LOCAL_MODEL_NAME", prov.why_unavailable())

    def test_there_is_no_default_address(self):
        """A default that reaches the internet would make 'local' a lie."""
        self.assertIsNone(P.OpenAICompatProvider(model="m").url)


class TheOpenAICompatPathSpeaksTheFormat(CleanEnv):
    def prov(self):
        return P.OpenAICompatProvider(model="qwen2.5-1.5b-instruct",
                                      url="http://127.0.0.1:8080")

    def test_it_posts_to_the_chat_completions_endpoint(self):
        seen = self.wire(self.prov())
        self.assertEqual(seen["url"], "http://127.0.0.1:8080/v1/chat/completions")

    def test_the_system_prompt_is_a_system_message(self):
        seen = self.wire(self.prov(), system="you are researcher", prompt="the task")
        roles = [m["role"] for m in seen["body"]["messages"]]
        self.assertEqual(roles, ["system", "user"])
        self.assertEqual(seen["body"]["messages"][0]["content"], "you are researcher")
        self.assertEqual(seen["body"]["messages"][1]["content"], "the task")

    def test_it_asks_for_deterministic_output(self):
        """The runtime needs one JSON object, not creative variety."""
        self.assertEqual(self.wire(self.prov())["body"]["temperature"], 0)

    def test_a_local_server_gets_no_authorization_header(self):
        self.assertNotIn("authorization", self.wire(self.prov())["headers"])

    def test_a_key_is_sent_only_when_one_is_given(self):
        prov = P.OpenAICompatProvider(model="m", url="http://127.0.0.1:8080",
                                      key=FAKE_KEY)
        seen = self.wire(prov)
        self.assertEqual(seen["headers"]["authorization"], "Bearer " + FAKE_KEY)
        self.assertNotIn(FAKE_KEY, json.dumps(seen["body"]))
        self.assertNotIn(FAKE_KEY, seen["url"])

    def test_it_reads_the_reply_and_the_usage(self):
        res = self.reply(self.prov(), {
            "model": "qwen2.5-1.5b-instruct",
            "choices": [{"message": {"role": "assistant", "content":
                                     '{"type":"tool_call","tool":"READ_REPO"}'}}],
            "usage": {"prompt_tokens": 812, "completion_tokens": 24}})
        self.assertEqual(res.status, "OK")
        self.assertIn("READ_REPO", res.text)
        self.assertEqual((res.tokens_in, res.tokens_out), (812, 24))

    def test_a_reply_with_no_text_is_a_failure_not_an_empty_success(self):
        res = self.reply(self.prov(), {"choices": [{"message": {"content": ""}}]})
        self.assertEqual(res.status, "FAILED")
        self.assertEqual(res.error, "empty completion")

    def test_usage_the_server_did_not_report_stays_unknown(self):
        res = self.reply(self.prov(),
                         {"choices": [{"message": {"content": "hello"}}]})
        self.assertIsNone(res.tokens_in)
        self.assertIsNone(res.tokens_out)

    def test_it_charges_nothing_and_says_the_rate_is_unknown(self):
        """A local model has no API fee. That is not the same as free, and
        `rate_known=False` is what keeps the ledger from claiming it is."""
        res = self.reply(self.prov(),
                         {"choices": [{"message": {"content": "x"}}]})
        self.assertEqual(res.usd, 0.0)
        self.assertFalse(res.rate_known)


class TheGeminiPathFailsClosed(CleanEnv):
    def test_no_key_means_no_call(self):
        prov = P.GeminiProvider()
        self.assertFalse(prov.available())
        import urllib.request
        real = urllib.request.urlopen
        urllib.request.urlopen = lambda *a, **k: self.fail("it called out")
        try:
            res = prov.complete("sys", "hi")
        finally:
            urllib.request.urlopen = real
        self.assertEqual(res.status, "NOT_CONFIGURED")
        self.assertEqual(res.text, "")

    def test_it_says_where_a_free_key_comes_from(self):
        why = P.GeminiProvider().why_unavailable()
        self.assertIn("GEMINI_API_KEY", why)
        self.assertIn("no cost", why)
        self.assertIn("cannot create it", why)

    def test_either_environment_name_works(self):
        os.environ["GOOGLE_API_KEY"] = FAKE_KEY
        self.assertTrue(P.GeminiProvider().available())


class TheGeminiPathSpeaksTheFormat(CleanEnv):
    def prov(self):
        return P.GeminiProvider(model="gemini-2.0-flash", key=FAKE_KEY)

    def test_the_key_travels_in_a_header_never_in_the_url(self):
        """A URL reaches logs, proxies and error messages that a header does not."""
        seen = self.wire(self.prov())
        self.assertNotIn(FAKE_KEY, seen["url"])
        self.assertNotIn(FAKE_KEY, json.dumps(seen["body"]))
        self.assertEqual(seen["headers"]["x-goog-api-key"], FAKE_KEY)

    def test_it_posts_to_generate_content_for_the_named_model(self):
        seen = self.wire(self.prov())
        self.assertTrue(seen["url"].endswith(
            "/v1beta/models/gemini-2.0-flash:generateContent"), seen["url"])

    def test_the_system_prompt_is_a_system_instruction(self):
        seen = self.wire(self.prov(), system="you are researcher")
        self.assertEqual(
            seen["body"]["systemInstruction"]["parts"][0]["text"],
            "you are researcher")

    def test_it_reads_candidates_and_usage_metadata(self):
        res = self.reply(self.prov(), {
            "candidates": [{"content": {"parts": [
                {"text": '{"type":"tool_call","tool":"READ_REPO"}'}]}}],
            "usageMetadata": {"promptTokenCount": 640, "candidatesTokenCount": 18}})
        self.assertEqual(res.status, "OK")
        self.assertIn("READ_REPO", res.text)
        self.assertEqual((res.tokens_in, res.tokens_out), (640, 18))

    def test_a_blocked_or_empty_candidate_is_a_failure(self):
        res = self.reply(self.prov(), {"candidates": []})
        self.assertEqual(res.status, "FAILED")
        self.assertEqual(res.error, "empty completion")


class FreeIsAClaimNotAMeasurement(CleanEnv):
    """The spend cap trusts `free`, so what sets it matters."""

    def test_a_local_endpoint_declares_itself_free_of_api_fees(self):
        self.assertTrue(P.OpenAICompatProvider(model="m", url="http://x").free)
        self.assertTrue(P.LocalProvider(model="m").free)

    def test_gemini_is_billable_by_default(self):
        """The same endpoint serves paid tiers and this code cannot tell which
        one a key is on, so it assumes the expensive answer."""
        self.assertFalse(P.GeminiProvider(key=FAKE_KEY).free)

    def test_only_the_owner_can_declare_it_free(self):
        os.environ["CIV_ASSUME_FREE"] = "1"
        self.assertTrue(P.GeminiProvider(key=FAKE_KEY).free)

    def test_a_paid_provider_never_declares_itself_free(self):
        self.assertFalse(P.ClaudeProvider(key=FAKE_KEY).free)

    def test_the_cap_refuses_an_unpriced_billable_provider(self):
        b = SPEND.Budgeted(P.GeminiProvider(key=FAKE_KEY), SPEND.Cap(max_usd=5.0))
        res = b.complete("s", "p")
        self.assertEqual(res.status, "BUDGET")
        self.assertIn("no published rate", res.error)

    def test_the_cap_allows_a_free_provider_but_still_counts_calls(self):
        """Free does not mean unbounded: a runaway loop against a free endpoint
        is still a runaway loop."""
        prov = P.OpenAICompatProvider(model="m", url="http://127.0.0.1:8080")
        b = SPEND.Budgeted(prov, SPEND.Cap(max_usd=0.0, max_calls=2))
        self.assertIsNone(b.cap.refuse_reason("m", "s", "p", 100, free=True))
        b.cap.calls = 2
        self.assertIn("call cap", b.cap.refuse_reason("m", "s", "p", 100, free=True))


class TheSelectorRoutesToThem(CleanEnv):
    def test_openai_compat_is_selectable(self):
        os.environ["CIV_PROVIDER"] = "openai-compat"
        os.environ["OPENAI_COMPAT_URL"] = "http://127.0.0.1:8080"
        os.environ["LOCAL_MODEL_NAME"] = "qwen2.5-1.5b-instruct"
        prov = P.from_env()
        # Nothing is listening here, so the selector must hand back the honest
        # refusal rather than something that produces text.
        self.assertIsInstance(prov, P.NotConfigured)
        self.assertIn("nothing answered", prov.why_unavailable())

    def test_gemini_is_selectable_when_a_key_exists(self):
        os.environ["CIV_PROVIDER"] = "gemini"
        os.environ["GEMINI_API_KEY"] = FAKE_KEY
        prov = P.from_env()
        self.assertEqual(prov.name, "gemini")
        self.assertEqual(prov.source, "model")

    def test_an_unknown_provider_names_the_real_choices(self):
        os.environ["CIV_PROVIDER"] = "banana"
        why = P.from_env().why_unavailable()
        for name in ("claude", "local", "openai-compat", "gemini", "mock"):
            self.assertIn(name, why)

    def test_nothing_configured_still_produces_nothing(self):
        prov = P.from_env()
        self.assertIsInstance(prov, P.NotConfigured)
        self.assertEqual(prov.complete("s", "p").text, "")


class ACredentialIsNeverEchoedBack(CleanEnv):
    def test_an_error_body_carrying_the_key_is_redacted(self):
        os.environ["GEMINI_API_KEY"] = FAKE_KEY
        import urllib.request
        real = urllib.request.urlopen

        def boom(*a, **k):
            raise urllib.error.HTTPError(
                "https://generativelanguage.googleapis.com/v1beta", 400, "Bad", {},
                io.BytesIO(('{"error":{"message":"API key %s is invalid"}}'
                            % FAKE_KEY).encode()))
        urllib.request.urlopen = boom
        try:
            res = P.GeminiProvider(key=FAKE_KEY).complete("s", "p")
        finally:
            urllib.request.urlopen = real
        self.assertEqual(res.status, "FAILED")
        self.assertIn("400", res.error)
        self.assertNotIn(FAKE_KEY, res.error)
        self.assertIn("<redacted>", res.error)


class TheAuditTellsTheTruthAboutThisMachine(unittest.TestCase):
    def test_it_finds_no_runtime_and_no_weights_here(self):
        import no_cost_audit as A
        out, real = io.StringIO(), sys.stdout
        try:
            sys.stdout = out
            found = A.audit(check_network=False)
        finally:
            sys.stdout = real
        self.assertEqual(found["runtimes"], [])
        self.assertEqual(found["ports"], [])
        self.assertEqual(found["weights"], [])

    def test_it_reports_not_available_when_nothing_at_all_is_found(self):
        import no_cost_audit as A
        empty = {"runtimes": [], "packages": [], "weights": [], "ports": [],
                 "weight_hosts": [], "inference_hosts": [], "free_inference": []}
        out, real = io.StringIO(), sys.stdout
        try:
            sys.stdout = out
            rc = A.verdict(empty)
        finally:
            sys.stdout = real
        self.assertEqual(rc, 1)
        self.assertIn("NO-COST REAL INFERENCE NOT AVAILABLE", out.getvalue())

    def test_a_reachable_free_endpoint_is_not_reported_as_unavailable(self):
        """The distinction the whole audit exists to make: 'no key' and
        'no such thing' are different answers."""
        import no_cost_audit as A
        found = {"runtimes": [], "packages": [], "weights": [], "ports": [],
                 "weight_hosts": [], "inference_hosts": [],
                 "free_inference": ["generativelanguage.googleapis.com"]}
        saved = {k: os.environ.pop(k, None) for k in
                 ("GEMINI_API_KEY", "GOOGLE_API_KEY")}
        out, real = io.StringIO(), sys.stdout
        try:
            sys.stdout = out
            rc = A.verdict(found)
        finally:
            sys.stdout = real
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v
        text = out.getvalue()
        self.assertEqual(rc, 1)
        self.assertIn("REACHABLE BUT NOT USABLE", text)
        self.assertNotIn("NO-COST REAL INFERENCE NOT AVAILABLE", text)

    def test_a_listening_server_is_reported_as_available(self):
        import no_cost_audit as A
        found = {"runtimes": [], "packages": [], "weights": [],
                 "ports": [(8080, "llama-server")], "weight_hosts": [],
                 "inference_hosts": [], "free_inference": []}
        out, real = io.StringIO(), sys.stdout
        try:
            sys.stdout = out
            rc = A.verdict(found)
        finally:
            sys.stdout = real
        self.assertEqual(rc, 0)
        self.assertIn("NO-COST REAL INFERENCE AVAILABLE", out.getvalue())
        self.assertIn("openai-compat", out.getvalue())


class TheWorldIsUnchangedByAnyOfThis(unittest.TestCase):
    """Phase 2: no model-specific logic leaks above the provider layer."""

    def test_no_module_above_the_gate_names_the_new_providers(self):
        for mod in ("core/agent_world.py", "core/always_on.py", "core/world_bus.py",
                    "core/world_supervisor.py", "core/world_policy.py",
                    "core/open_world.py", "core/contract.py",
                    "core/agent_runtime.py", "core/world_runtime.py"):
            with open(os.path.join(HERE, mod), encoding="utf-8") as fh:
                code = fh.read().lower()
            for name in ("gemini", "openai", "googleapis", "generativelanguage"):
                self.assertNotIn(name, code, "%s names %r" % (mod, name))

    def test_the_runtime_reaches_them_only_through_from_env(self):
        from core import world_runtime as RUN
        prov = RUN.provider_factory()("AGT-RESEARCHER", None, 1)
        self.assertIsInstance(prov, P.NotConfigured)


if __name__ == "__main__":
    unittest.main(verbosity=2)
