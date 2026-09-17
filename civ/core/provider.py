"""Model providers. The absence of one is a first-class, visible state.

Nothing here invents output. If no provider is configured the call returns
NOT_CONFIGURED and the caller must deal with it — never a fabricated answer.
"""
import json
import os
import time
import urllib.error
import urllib.request
from abc import ABC, abstractmethod

# rough public rates, USD per million tokens; used for the ledger, not for billing
RATES = {
    "claude-opus-5":   (15.0, 75.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-haiku-4-5-20251001": (0.80, 4.0),
}


class Result:
    __slots__ = ("status", "text", "tokens_in", "tokens_out", "usd", "latency_ms",
                 "error", "source", "provider", "model")

    def __init__(self, status, source, provider, model, text="", tokens_in=0,
                 tokens_out=0, usd=0.0, latency_ms=0, error=None):
        self.status, self.source = status, source
        self.provider, self.model = provider, model
        self.text, self.error = text, error
        self.tokens_in, self.tokens_out = tokens_in, tokens_out
        self.usd, self.latency_ms = usd, latency_ms

    @property
    def ok(self):
        return self.status == "OK"


class Provider(ABC):
    name = "abstract"
    source = "model"

    @abstractmethod
    def available(self):
        """True only when a real call can actually be made right now."""

    @abstractmethod
    def why_unavailable(self):
        """Human-readable reason, shown to the owner verbatim."""

    @abstractmethod
    def complete(self, system, prompt, model=None, max_tokens=800):
        """Returns a Result. Must never raise."""


class NotConfigured(Provider):
    """The honest default. Produces no text, ever."""
    name = "none"
    source = "model"

    def __init__(self, reason="no model provider configured"):
        self.reason = reason

    def available(self):
        return False

    def why_unavailable(self):
        return self.reason

    def complete(self, system, prompt, model=None, max_tokens=800):
        return Result("NOT_CONFIGURED", "model", self.name, model or "-", error=self.reason)


class MockProvider(Provider):
    """Deterministic stand-in for testing the RUNTIME, not the intelligence.

    Everything it produces is tagged source='mock' and carries a MOCK banner
    into the artifact body. It is not a model and never claims to be.
    """
    name = "mock"
    source = "mock"

    def __init__(self, seed=0):
        self.seed = seed
        self.calls = 0

    def available(self):
        return True

    def why_unavailable(self):
        return ""

    def complete(self, system, prompt, model=None, max_tokens=800):
        self.calls += 1
        t0 = time.time()
        digest = abs(hash((self.seed, prompt))) % 10000
        text = json.dumps({
            "mock": True,
            "note": "MOCK OUTPUT — produced by MockProvider, not by a model.",
            "echo_len": len(prompt),
            "n": digest,
        }, ensure_ascii=False)
        return Result("OK", "mock", self.name, model or "mock-1", text=text,
                      tokens_in=len(prompt) // 4, tokens_out=len(text) // 4, usd=0.0,
                      latency_ms=int((time.time() - t0) * 1000))


class ClaudeProvider(Provider):
    """UNVERIFIED IN THIS ENVIRONMENT — no ANTHROPIC_API_KEY is reachable here.

    The conformance suite in civ/test_civ.py runs against this class the moment
    a key exists. Until then it reports NOT_CONFIGURED rather than pretending.
    """
    name = "claude"
    source = "model"
    URL = "https://api.anthropic.com/v1/messages"

    def __init__(self, model=None, key=None):
        self.model = model or os.environ.get("CIV_MODEL") or "claude-sonnet-5"
        self.key = key or os.environ.get("ANTHROPIC_API_KEY")

    def available(self):
        return bool(self.key)

    def why_unavailable(self):
        return "ANTHROPIC_API_KEY is not set"

    def complete(self, system, prompt, model=None, max_tokens=800):
        model = model or self.model
        if not self.key:
            return Result("NOT_CONFIGURED", "model", self.name, model,
                          error=self.why_unavailable())
        t0 = time.time()
        body = json.dumps({
            "model": model, "max_tokens": max_tokens, "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.URL, data=body, method="POST", headers={
            "content-type": "application/json", "x-api-key": self.key,
            "anthropic-version": "2023-06-01"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                out = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return Result("FAILED", "model", self.name, model,
                          error="HTTP %s: %s" % (e.code, e.read()[:200].decode("utf-8", "replace")),
                          latency_ms=int((time.time() - t0) * 1000))
        except (urllib.error.URLError, OSError, ValueError) as e:
            return Result("FAILED", "model", self.name, model, error=repr(e),
                          latency_ms=int((time.time() - t0) * 1000))
        usage = out.get("usage") or {}
        ti, to = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
        rin, rout = RATES.get(model, (3.0, 15.0))
        text = "".join(b.get("text", "") for b in out.get("content", [])
                       if b.get("type") == "text").strip()
        return Result("OK" if text else "FAILED", "model", self.name, model, text=text,
                      tokens_in=ti, tokens_out=to,
                      usd=(ti * rin + to * rout) / 1_000_000,
                      latency_ms=int((time.time() - t0) * 1000),
                      error=None if text else "empty completion")


def from_env():
    """Pick a provider from the environment. Never guesses in favour of working."""
    want = (os.environ.get("CIV_PROVIDER") or "").strip().lower()
    if want == "mock":
        return MockProvider()
    if want == "claude" or (not want and os.environ.get("ANTHROPIC_API_KEY")):
        p = ClaudeProvider()
        return p if p.available() else NotConfigured(p.why_unavailable())
    if want:
        return NotConfigured("unknown provider %r" % want)
    return NotConfigured("CIV_PROVIDER unset and no ANTHROPIC_API_KEY")
