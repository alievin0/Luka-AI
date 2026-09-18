"""A hard ceiling on real money, enforced BEFORE the call that would spend it.

The world already had a budget ledger — `budgets`, LAW 23, `world_policy.charge`
— and the supervisor charges it after a turn completes. That is an accounting
record, not a brake: a turn may make up to seven model calls, and nothing is
charged until all seven have been paid for. With a mock provider the difference
is philosophical. With a real paid API it is the difference between a capped
experiment and an open tab.

`Budgeted` wraps any provider and refuses the NEXT call when that call could
take the run past its cap. It is a `Provider`, so nothing above it changes:
`runtime.invoke` records the refusal as an ordinary `runs` row with status
`BUDGET` (a status the schema has always allowed), `agent_runtime` sees a
non-OK result and stops the turn. Fail closed, in the existing shape.

Three properties worth stating because they are easy to get wrong:

**The pre-flight number is an estimate and is never recorded.** Input tokens
cannot be known before the call, so the guard bounds them from the prompt's
length and deliberately over-counts. That ceiling decides whether to call. What
gets recorded afterwards is `Result.usd`, computed from the usage the provider
actually reported. An estimate never reaches a field that means measured.

**A provider that does not price itself is not free.** If `rate_known` is false
the guard cannot bound the cost, so it refuses rather than assuming zero.

**The switch is out of band.** `stop_file` is checked before every call, so an
operator can halt a running world with `touch`, without the database, without
a signal, and without waiting for anything to finish.
"""
import os

from . import provider as P

# How many characters of prompt to assume per token when bounding the input
# cost. Real English is ~4. Three over-counts by roughly a third, which is the
# direction a cap has to err in.
CHARS_PER_TOKEN = 3.0


class Stopped(RuntimeError):
    """The cap, or the switch, said no."""


class Cap:
    """What one run is allowed to spend. Zero means zero, not unlimited."""

    def __init__(self, max_usd=0.25, max_calls=12, max_tokens=0):
        self.max_usd = float(max_usd)
        self.max_calls = int(max_calls)
        self.max_tokens = int(max_tokens)
        self.calls = 0
        self.usd = 0.0
        self.tokens_in = 0
        self.tokens_out = 0
        self.refusals = []

    @classmethod
    def from_env(cls):
        """`CIV_MAX_USD`, `CIV_MAX_CALLS`, `CIV_MAX_TOKENS`.

        The defaults are small on purpose. A gate whose cap has to be raised
        before it will run is a gate somebody read."""
        return cls(max_usd=float(os.environ.get("CIV_MAX_USD") or 0.25),
                   max_calls=int(os.environ.get("CIV_MAX_CALLS") or 12),
                   max_tokens=int(os.environ.get("CIV_MAX_TOKENS") or 0))

    # ── the pre-flight bound ─────────────────────────────────────────
    def ceiling_for(self, model, system, prompt, max_tokens):
        """The most this call could possibly cost, in USD.

        Output is bounded exactly — `max_tokens` is a hard cap the API enforces.
        Input is bounded by over-counting the prompt. Returns (usd, known);
        `known` is False when the model has no published rate, and an unpriced
        call must be refused rather than guessed at."""
        rin, rout, known = P.rate_for(model)
        if not known:
            return 0.0, False
        est_in = (len(system or "") + len(prompt or "")) / CHARS_PER_TOKEN
        return (est_in * rin + int(max_tokens) * rout) / 1_000_000, True

    def refuse_reason(self, model, system, prompt, max_tokens, free=False):
        """Why this call must not be made, or None.

        `free` is the provider declaring that calling it costs no API fee — a
        local runtime, or an endpoint the Owner has asserted is on a free tier.
        It skips the pricing requirement and NOTHING else: the call cap still
        applies, because an unbounded loop against a free endpoint is still an
        unbounded loop."""
        if self.calls >= self.max_calls:
            return "call cap reached: %d of %d" % (self.calls, self.max_calls)
        if self.max_tokens and self.tokens_in + self.tokens_out >= self.max_tokens:
            return ("token cap reached: %d of %d"
                    % (self.tokens_in + self.tokens_out, self.max_tokens))
        if free:
            return None
        ceiling, known = self.ceiling_for(model, system, prompt, max_tokens)
        if not known:
            return ("%s has no published rate here, so this call cannot be "
                    "bounded — refusing rather than assuming it is free" % model)
        if self.usd + ceiling > self.max_usd:
            return ("would reach $%.5f of the $%.5f cap (spent $%.5f, this call "
                    "could cost up to $%.5f)"
                    % (self.usd + ceiling, self.max_usd, self.usd, ceiling))
        return None

    # ── what actually happened ───────────────────────────────────────
    def record(self, res):
        """Count a completed call from what the provider reported, never from
        the estimate that authorised it."""
        self.calls += 1
        self.usd += float(res.usd or 0.0)
        self.tokens_in += int(res.tokens_in or 0)
        self.tokens_out += int(res.tokens_out or 0)

    def report(self):
        return {"calls": self.calls, "max_calls": self.max_calls,
                "usd": round(self.usd, 6), "max_usd": self.max_usd,
                "tokens_in": self.tokens_in, "tokens_out": self.tokens_out,
                "max_tokens": self.max_tokens,
                "refusals": list(self.refusals)}


class Budgeted(P.Provider):
    """Any provider, with a hard cap and a kill switch in front of it.

    It does not disguise what it wraps: `name`, `source` and `model` are the
    inner provider's, so `runs.source` still says `model` for a real model and
    an audit cannot be fooled by the wrapper.
    """

    def __init__(self, inner, cap=None, stop_file=None, on_charge=None):
        self.inner = inner
        self.cap = cap or Cap.from_env()
        self.stop_file = stop_file
        # Called with the completed Result after each call — the hook the world
        # uses to write the spend into the persisted `budgets` ledger.
        self.on_charge = on_charge

    # identity passes straight through
    @property
    def name(self):
        return self.inner.name

    @property
    def source(self):
        return self.inner.source

    @property
    def model(self):
        return getattr(self.inner, "model", None)

    def available(self):
        return self.inner.available()

    def why_unavailable(self):
        return self.inner.why_unavailable()

    def killed(self):
        return bool(self.stop_file) and os.path.exists(self.stop_file)

    def complete(self, system, prompt, model=None, max_tokens=800):
        model = model or getattr(self.inner, "model", None) or "-"
        if self.killed():
            why = "stopped by hand: %s exists" % self.stop_file
            self.cap.refusals.append(why)
            return P.Result("BUDGET", self.inner.source, self.inner.name, model,
                            error=why)
        why = self.cap.refuse_reason(model, system, prompt, max_tokens,
                                     free=getattr(self.inner, "free", False))
        if why:
            self.cap.refusals.append(why)
            return P.Result("BUDGET", self.inner.source, self.inner.name, model,
                            error=why)
        res = self.inner.complete(system, prompt, model=model, max_tokens=max_tokens)
        self.cap.record(res)
        if self.on_charge:
            # The call already happened and the money is already spent, so a
            # ledger that refuses the charge must not also lose the result —
            # that would hide a real cost. Keep the result, record why the
            # ledger disagreed, and make sure the NEXT call is refused.
            try:
                self.on_charge(res)
            except Exception as e:      # noqa: BLE001 — any ledger refusal
                self.cap.refusals.append(
                    "the persisted ledger refused the charge (%s); stopping here"
                    % str(e)[:80])
                self.cap.max_calls = self.cap.calls
        return res
