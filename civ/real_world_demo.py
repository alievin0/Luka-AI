#!/usr/bin/env python3
"""A REAL MULTI-AGENT WORLD — two agents and a reviewer, all deciding on Gemini.

    CIV_PROVIDER=gemini CIV_ASSUME_FREE=1 CIV_MODEL=gemini-3.1-flash-lite \
        CIV_MAX_CALLS=35 python3 real_world_demo.py

The write-up is MULTI_AGENT.md, including what this does NOT establish.

`real_inference_gate.py` established that ONE agent's turn can be driven by a
real model. This is the different and harder claim: that a **world** of them
runs on one — that the Researcher's real conclusion reaches the Builder as the
Builder's real input, and that a Reviewer which has actually read the work
decides whether it is acceptable.

The Owner says one thing and then stops. Everything after that is
`world_supervisor.run`, turning its own handle. This file does not sequence the
work, does not call an agent, and does not decide anything an agent decides:

  * **No decision is hard-coded.** No tool is named for an agent, no path is
    chosen for it, no message text is written for it, and no verdict is
    pre-selected. Every one of those comes back out of a model.
  * **No double.** The world is founded `live`, so LAW 2's trigger refuses to
    record a `mock` run in it — the database, not this file, is what forbids a
    fallback.
  * **A small hard cap.** `CIV_MAX_CALLS` bounds the whole world, and the cap
    refuses the call that would exceed it rather than reporting it afterwards.

What this file DOES supply is what an owner supplies: the objective, the source
to work from, the bar the work is judged against, and who the work is for. That
is a specification. It is not a decision.
"""
import argparse
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_context as CTX        # noqa: E402
from core import agent_runtime as RT         # noqa: E402
from core import agent_world as W            # noqa: E402
from core import always_on as A              # noqa: E402
from core import provider as P               # noqa: E402
from core import spend as SPEND              # noqa: E402
from core import store                       # noqa: E402
from core import world_bus as BUS            # noqa: E402
from core import world_policy as POL         # noqa: E402
from core import world_supervisor as SUP     # noqa: E402

BAR = "─" * 78
ORCH, RES, BUILD, REV = (SUP.ORCH, SUP.RES, SUP.BUILD, SUP.REV)

# Enough room that adaptive thinking cannot eat the budget and leave no text.
TURN_TOKENS = 2000


class Recorder(P.Provider):
    """Keeps what every agent was shown and what it answered. Decides nothing.

    Every attribute an audit reads passes straight through, so `runs.source`
    still says `model` and a decorator cannot disguise what it wraps. It exists
    because "what did the Builder actually get, and what did it say back" is
    the whole question here, and it should be answerable from the record rather
    than inferred from an outcome."""

    def __init__(self, inner):
        self.inner = inner
        self.log = []
        self._who = None

    def acting(self, who):
        self._who = who
        return self

    name = property(lambda self: self.inner.name)
    source = property(lambda self: self.inner.source)
    model = property(lambda self: getattr(self.inner, "model", None))
    # `free` must be proxied EXPLICITLY, and a `__getattr__` fallback does not
    # do it: `Provider.free = False` is a class attribute, so ordinary lookup
    # finds it on the base class and `__getattr__` is never consulted. The
    # default is deliberately False — "anything that might bill leaves it False
    # and gets refused" — which is right for a provider and wrong for a wrapper
    # that is standing in front of one. Without this line the wrapper silently
    # withdrew the Owner's free-tier assertion, `Budgeted` refused every call in
    # the world as unpriced, and the cap was correct while the wrapper lied by
    # omission.
    free = property(lambda self: getattr(self.inner, "free", False))

    def __getattr__(self, attr):
        """Anything the wrapper does not define, and the base class does not
        supply a default for, belongs to the provider."""
        return getattr(self.inner, attr)

    def available(self):
        return self.inner.available()

    def why_unavailable(self):
        return self.inner.why_unavailable()

    def complete(self, system, prompt, model=None, max_tokens=800):
        res = self.inner.complete(system, prompt, model=model,
                                  max_tokens=max_tokens)
        self.log.append({"who": self._who, "prompt": prompt,
                         "text": res.text, "status": res.status})
        return res


def say(s=""):
    print(s, flush=True)


def head(t):
    say("\n" + BAR)
    say(t)
    say(BAR)


# ── the objective ────────────────────────────────────────────────────
# Real work with a real answer, on a document in this repository that makes a
# checkable claim. AGENT_COGNITION.md is about whether a model can drive this
# world: it used to answer "no model is reachable in this environment", which
# was true when written and false by the time a model was reading it, and it now
# answers with a date and a pointer to where that happened. The agents are told
# neither version. They are told where to look and what to produce, and working
# out what the document actually claims is the first half of the task.
FIXTURE = os.path.join(HERE, "AGENT_COGNITION.md")
OBJECTIVE = ("Establish what AGENT_COGNITION.md claims about whether a model "
             "can drive this world, and whether that claim still holds.")

# The acceptance bar, declared before any work starts and checked afterwards by
# ordinary code the agent cannot reach. Announced to the agent in full: a
# requirement withheld so that the first attempt fails is a rejection this file
# arranged, and an arranged rejection proves nothing about a reviewer.
# Each requirement is WORDED AS THE THING IT CHECKS. The first version said
# "names the source it read" and tested for a literal `## Source` heading — so
# an agent that named its source in a numbered list satisfied the sentence and
# failed the check, twice, and burned its corrections on a bar it had been told
# about only in paraphrase. A condition the agent cannot read precisely is a
# trick question, and these strings are also what the Reviewer is shown.
BAR_RESEARCH = [('has a "## Source" section naming the file it read',
                 lambda b: "## Source" in b),
                ('has a "## Findings" section', lambda b: "## Findings" in b),
                ("is not a stub", lambda b: len(b.strip()) > 120)]
BAR_BUILD = [('has a "## Recommendation" section',
              lambda b: "## Recommendation" in b),
             ('has a "## Basis" section saying what it rests on',
              lambda b: "## Basis" in b),
             ("is not a stub", lambda b: len(b.strip()) > 120)]


def is_research(task):
    return "research" in json.loads(task["required_caps"] or "[]")


def requirements_for(task):
    return BAR_RESEARCH if is_research(task) else BAR_BUILD


def instruction_for(task):
    """What the Owner wants, where to look, and what 'done' means.

    It names no tool. The agent's own briefing lists what it holds and the
    argument shape of each; which to reach for, in what order, with what
    arguments, and every word that goes inside one, stays the agent's.

    The research brief leads with BOTH deliverables because the ordering is a
    real property of the runtime, not a preference: a turn ends on the
    declaration, so an agent that files first and means to talk afterwards
    never gets the chance. Telling it that is telling it how the world works.
    """
    bar = requirements_for(task)
    sections = ", ".join(r for r, _ in bar if r != "is not a stub")
    source_and_bar = (
        "\n\nThe source file is at: %s"
        "\nYour artifact is checked by code you cannot reach, which tests for "
        "exactly this and nothing else: %s. Those headings are matched "
        "literally." % (FIXTURE, sections))
    if is_research(task):
        # The task's own declared CONDITIONS — which the briefing prints above
        # this, and which come from the world's standard plan — mention only
        # the artifact. An agent reading both reasonably treats anything not in
        # the conditions as optional, and the first runs did exactly that. So
        # the second deliverable is stated here as a requirement rather than as
        # context, because that is what it is.
        #
        # It names a recipient and an obligation. It does not name a tool, and
        # it does not contain one word of what gets sent: the agent's briefing
        # lists what it holds, and every word of the message is its own. That
        # the message really carries its own result is not asserted here — it
        # is checked afterwards, against the artifact the agent wrote.
        return ("%s\n\n"
                "TWO deliverables, both required, and the order matters because "
                "your turn ends the moment you declare:\n"
                "  1. A message from you to %s carrying what you found. It "
                "works next and starts from nothing — it cannot see your "
                "artifact, your reasoning, or this task, so anything you do not "
                "send it, it will never have. Send it BEFORE you declare.\n"
                "  2. An artifact, declared by name. An answer in prose does "
                "not satisfy this task's conditions and leaves it unfinished.\n"
                "Doing only the second one leaves this job half done."
                % (task["objective"], BUILD) + source_and_bar)
    # The same fact the Researcher is told, from the other side. The Builder's
    # first run wrote its file SIX times, every write allowed, and never
    # declared — it spent the whole turn re-writing a file that was already on
    # disk. Writing and submitting are two different acts in this world, and an
    # agent that does not know that cannot finish. Saying so is describing the
    # runtime, not choosing the tool: it still picks what to call and writes
    # every word of what it produces.
    return ("%s\n\n"
            "Your inbox carries what %s sent you. Base your recommendation on "
            "what it actually reports.\n\n"
            "Writing a file is NOT submitting it. The artifact counts only once "
            "you declare it by name, and your turn ends the moment you do. Write "
            "it once, then declare it — writing it again submits nothing and "
            "spends the turn you needed in order to declare."
            % (task["objective"], RES) + source_and_bar)


# ── the Reviewer, deciding for itself ────────────────────────────────
VERDICTS = ("APPROVE", "REJECT")

# The two verdicts, plus the past participle a model writes when it is answering
# rather than obeying a format. A closed set, not a prefix rule — the strictness
# that does the work here is positional, and "APPROVED" in first position is not
# ambiguous about anything.
_OPENING = {"APPROVE": "APPROVE", "APPROVED": "APPROVE",
            "REJECT": "REJECT", "REJECTED": "REJECT"}

# What the Reviewer is asked for, and the only thing read back out of its
# answer. The prompt below and `_verdict_in` share this one string, so the
# shape that is asked for and the shape that is parsed cannot drift apart.
VERDICT_RULE = ("The FIRST word of your answer must be APPROVE or REJECT, "
                "followed by your reasons.")

# Decoration a model may open with. Stripping it is not reading the answer for
# meaning: **APPROVE** still puts the verdict first.
_ORNAMENT = "*_`#>-–—\"'“”‘’ \t\r\n"


def _verdict_in(text):
    """The verdict the reviewer OPENED with, or None.

    Only the first word counts, because the first word is the only thing the
    reviewer was asked for. Searching the whole answer for either word looks
    like the more forgiving rule and is in fact a way to be wrong about it:
    "I see no reason to REJECT this work, so: APPROVE" opens with neither word,
    plainly means approval, and a rule that scans the text meets REJECT first
    and records a rejection the reviewer never gave. Reading one word cannot
    make that mistake — the verdict is either the first thing said or it is not
    there at all.

    Nothing here supplies a verdict. An answer in some other shape returns None
    and the supervisor escalates: a reviewer that did not answer the question
    must not be recorded as having decided, and guessing which way it was
    leaning is exactly the decision this file does not get to make."""
    opening = (text or "").lstrip(_ORNAMENT)
    word = ""
    for ch in opening:
        if not ch.isalpha():
            break
        word += ch
    return _OPENING.get(word.upper())


def gemini_review(w, art, task, ver, unmet):
    """A real bounded turn for the Reviewer, on its own execution path.

    Not `h_task_ready`: no assignment, no lease, no workspace claim, no
    artifact. The Reviewer reads through the same gateway as everybody else and
    is read-only because its GRANT is read-only — `WRITE_ARTIFACT` is refused
    to it by the gateway whatever it decides to try.

    It is shown the artifact's path and the bar, and it is shown what
    deterministic verification concluded — because a reviewer kept in the dark
    about the checks is being asked to redo them, not to judge. It is told in
    terms that it may disagree, and REJECT is reachable on either side of that.
    """
    con = w.con
    a = con.execute("SELECT * FROM artifacts WHERE id=?", (art,)).fetchone()
    prov = w.provider_for(REV, task, 1)
    if not prov.available():
        return None, "no model was available to review: %s" % prov.why_unavailable(), None

    checks = json.loads(ver["detail"]).get("checks", []) if ver else []
    verdict_of_code = "\n".join(
        "  - %s: %s" % (c["requirement"], "met" if c["passed"] else "NOT MET")
        for c in checks) or "  (no checks were recorded)"
    instruction = (
        "You are reviewing artifact #%d, written by %s for task #%d.\n"
        "It is on disk at: %s\n\n"
        "Deterministic verification already ran and concluded:\n%s\n\n"
        "Read the artifact yourself and judge whether it is acceptable work "
        "for the task. You may disagree with the checks in either direction: "
        "code can only see whether a heading is present, not whether what is "
        "under it is true, supported, or worth anything.\n\n"
        "When you have read it, finish with your verdict. "
        % (art, a["principal_id"], task["id"], a["path"], verdict_of_code)
        + VERDICT_RULE)

    brief, _ = CTX.briefing(con, REV, task["id"],
                            project_id=task["project_id"],
                            extra={"the owner's instruction": instruction})
    try:
        turn = RT.run_agent_turn(con, w.gw, prov, REV, task["id"],
                                 instruction=brief, lease_id=None,
                                 max_tokens=TURN_TOKENS)
    except Exception as e:                      # noqa: BLE001
        return None, "the reviewer's turn failed: %s" % str(e)[:200], None

    answer = turn.answer or ""
    verdict = _verdict_in(answer)
    run_id = turn.run_ids[-1] if turn.run_ids else None
    REVIEW_LOG.append({"artifact": art, "task": task["id"], "verdict": verdict,
                       "answer": answer, "calls": len(turn.run_ids),
                       "tools": [s.detail.get("tool") for s in turn.steps
                                 if s.kind == "tool"],
                       "run": run_id})
    if verdict is None:
        return None, "the reviewer answered without a verdict: %r" % answer[:160], run_id
    return verdict, answer.strip(), run_id


REVIEW_LOG = []


# ── reading one text against another ─────────────────────────────────
def _distinctive(text):
    """Long words, lowercased and stripped of punctuation.

    Short words are shared by any two texts in the same language and carry no
    signal about whether they came from the same piece of work."""
    return {w.lower().strip(".,:;()[]{}\"'`") for w in (text or "").split()
            if len(w) > 6}


def _verbatim_run(a, b, least=5, most=24):
    """The longest run of consecutive words `a` repeats from `b`, or 0.

    Quoted rather than paraphrased: a phrase this long appearing in both texts
    is not a coincidence of subject matter."""
    wa = (a or "").lower().split()
    wb = " ".join((b or "").lower().split())
    best = 0
    for i in range(len(wa)):
        for n in range(least, min(len(wa) - i, most) + 1):
            if " ".join(wa[i:i + n]) not in wb:
                break
            best = max(best, n)
    return best


# ── did the workflow actually finish? ────────────────────────────────
COMPLETE, INCOMPLETE, FAILED, QUOTA = (
    "COMPLETE", "INCOMPLETE", "FAILED", "QUOTA_EXHAUSTED")

# What a provider writes into `runs.error` when the allowance is gone. Each is
# matched WITH its prefix on purpose: a bare "429" also occurs inside token
# counts, byte counts and shas, and a substring match on a number is exactly how
# a guard ends up reading "$0.50000" as a 500.
_QUOTA_MARKS = ("http 429", "resource_exhausted", "exceeded your current quota",
                "quota exceeded", "rate_limit_exceeded")


def _ids(xs):
    return ", ".join("#%d" % x for x in xs[:6]) + (" …" if len(xs) > 6 else "")


def _quota_failure(con):
    """The first run that died because the allowance ran out, or None."""
    for r in con.execute("SELECT id, error FROM runs WHERE status<>'OK' "
                         "AND error IS NOT NULL ORDER BY id"):
        if any(m in (r["error"] or "").lower() for m in _QUOTA_MARKS):
            return r["id"], " ".join((r["error"] or "").split())[:140]
    return None


def completion_state(con):
    """Did the workflow finish — and if it did not, does the record say why?

    THE INVARIANT: every artifact carries a terminal verification state; every
    artifact whose verification PASSED carries a review outcome; and no task is
    left RUNNING — unless the run terminates explicitly as INCOMPLETE,
    QUOTA_EXHAUSTED or FAILED.

    A review outcome is APPROVE **or** REJECT. A rejection is an outcome and not
    a failure — it is the entrance to the correction path — so a checker that
    demanded APPROVE would be demanding a verdict rather than a review.

    An artifact whose verification FAILED needs no review, and requiring one
    would misread the workflow: verification runs first, and a failure routes to
    correction without a reviewer ever seeing it. Such an artifact is terminal
    through its correction, which is why the superseded first attempts in an
    ordinary run are not counted as unfinished work.

    Returns (state, why, accounted). `accounted` is whether the database itself
    carries a reason for stopping — a failed run, or a signal raised to a
    person. An unfinished run that is accounted for is an honest stop; one that
    is not is a hole, and that is the only thing the graded check fails on.
    This function exists because a tally of passing checks is not a finished
    workflow: a task left RUNNING on a quota error sat behind twenty green
    checks with nothing saying so.
    """
    arts = [dict(a) for a in con.execute(
        "SELECT id, run_id FROM artifacts ORDER BY id")]
    reviewed = {r["artifact_id"] for r in con.execute(
        "SELECT DISTINCT artifact_id FROM reviews "
        "WHERE verdict IN ('APPROVE','REJECT')")}
    # Each artifact's terminal verification state, read back from its evidence
    # row: True when every declared requirement was met, False when one was not.
    verdict_of_code = {}
    for e in con.execute("SELECT external_provenance, detail FROM evidence "
                         "WHERE external_provenance LIKE 'artifact:%' ORDER BY id"):
        try:
            art = int((e["external_provenance"] or "").split("@")[0].split(":")[1])
        except (IndexError, ValueError):
            continue
        checks = json.loads(e["detail"] or "{}").get("checks", [])
        verdict_of_code[art] = bool(checks) and all(c["passed"] for c in checks)

    running = [t["id"] for t in con.execute(
        "SELECT id FROM tasks WHERE status='RUNNING' ORDER BY id")]
    unprovenanced = [a["id"] for a in arts if not a["run_id"]]
    unverified = [a["id"] for a in arts if a["id"] not in verdict_of_code]
    # Only an artifact that PASSED verification is owed a review.
    unreviewed = [a["id"] for a in arts
                  if verdict_of_code.get(a["id"]) and a["id"] not in reviewed]

    quota = _quota_failure(con)
    broke = con.execute("SELECT id, status, error FROM runs WHERE status<>'OK' "
                        "ORDER BY id LIMIT 1").fetchone()
    # HIGH only. A MEDIUM signal is a notification — "Project #1 completed" is
    # one — and letting it count would mean any finished project explained away
    # every hole after it.
    raised = con.execute("SELECT id, priority, headline FROM signals "
                         "WHERE priority='HIGH' ORDER BY id LIMIT 1").fetchone()
    accounted = bool(quota or broke or raised)

    def explained(short):
        """Unfinished, with whatever reason the record itself carries."""
        if quota:
            return (QUOTA, "%s — run #%d ran out of allowance: %s"
                    % (short, quota[0], quota[1]), True)
        if broke:
            return (FAILED, "%s — run #%d ended %s: %s"
                    % (short, broke["id"], broke["status"],
                       " ".join((broke["error"] or "").split())[:120]
                       or "no error recorded"), True)
        if raised:
            return (INCOMPLETE, "%s — raised to a person: %s"
                    % (short, raised["headline"]), True)
        return INCOMPLETE, short, False

    # Provenance is never excused. A quota failure explains a missing review; it
    # explains nothing about an artifact that names no run, because that
    # artifact was untraceable before anything ran out.
    if unprovenanced:
        return (INCOMPLETE, "artifact(s) %s name no run, so nothing ties them to "
                "a decision" % _ids(unprovenanced), False)
    if not arts:
        # A refused opportunity is a terminal outcome, not a hole. The world
        # judged, declined, recorded why and stopped — which is the behaviour
        # the gate exists for, and reporting it as an unexplained silence would
        # punish the system for doing exactly the right thing.
        refused = con.execute(
            "SELECT id, decision_why FROM opportunities WHERE status='REJECTED' "
            "ORDER BY id LIMIT 1").fetchone()
        if refused is not None:
            return (INCOMPLETE, "nothing was produced because opportunity #%d was "
                    "refused: %s" % (refused["id"],
                                     " ".join((refused["decision_why"] or "").split())[:120]
                                     or "no reason recorded"), True)
        return explained("no artifact was produced")
    if unverified:
        return explained("artifact(s) %s carry no verification evidence"
                         % _ids(unverified))
    if unreviewed:
        return explained("artifact(s) %s passed verification and reached no "
                         "review outcome" % _ids(unreviewed))
    if running:
        return explained("task(s) %s were left RUNNING" % _ids(running))
    return (COMPLETE, "every artifact is verified, every artifact that passed "
            "carries a review outcome, and no task was left running", True)


# ── the run ──────────────────────────────────────────────────────────
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=None)
    ap.add_argument("--max-ticks", type=int, default=40)
    a = ap.parse_args(argv)

    head("1. WHAT IS ANSWERING")
    live = P.from_env()
    say("  CIV_PROVIDER      %s" % (os.environ.get("CIV_PROVIDER") or "(unset)"))
    say("  provider          %s" % live.name)
    say("  model             %s" % getattr(live, "model", "-"))
    say("  source            %s" % live.source)
    say("  available         %s" % live.available())
    if not (live.available() and live.source == "model"):
        say("\n  REAL MULTI-AGENT WORLD NOT DEMONSTRATED")
        say("    no provider whose source is 'model' answered: %s"
            % (live.why_unavailable() or "-"))
        return 1

    cap = SPEND.Cap.from_env()
    say("  hard cap          %d model calls for the whole world" % cap.max_calls)

    # LAW 2 both ways: a live world's own trigger refuses to record a mock run,
    # so "no fallback" is enforced below this file rather than promised by it.
    con = store.connect(a.db or os.path.join(tempfile.mkdtemp(), "world.db"))
    store.found(con, mode="live")
    gw = W.build_gateway(con)
    W.found_agents(con)
    POL.seed(con)
    say("  world mode        live  (LAW 2 refuses a mock run in it)")

    rec = Recorder(live)

    def provider_for(agent, task, attempt):
        # One cap for the whole world, shared by every agent in it.
        return SPEND.Budgeted(rec.acting(agent), cap=cap)

    w = SUP.World(con, gw, provider_for=provider_for,
                  requirements_for=requirements_for,
                  instruction_for=instruction_for,
                  review_for=gemini_review, worker="worldd-demo")

    head("2. ONE OBJECTIVE FROM THE OWNER, THEN THE OWNER LEAVES")
    say("  objective   %s" % OBJECTIVE)
    say("  source      %s" % os.path.relpath(FIXTURE, HERE))
    say("  workers     %s (research) → %s (build), reviewed by %s"
        % (RES, BUILD, REV))
    A.go_away(con, "the world runs the objective unattended")
    BUS.emit(con, "OWNER_OBJECTIVE", "objective:1",
             {"objective": OBJECTIVE, "fixture": FIXTURE,
              "required_caps": ["research", "build"]}, by="OWNER")
    say("\n  …the Owner has said everything it is going to say.")

    head("3. THE SUPERVISOR TURNS ITS OWN HANDLE")
    res = SUP.run(w, max_ticks=a.max_ticks)
    for step in res["steps"]:
        r = step.get("result") or {}
        extra = ""
        for k in ("agent", "artifact", "verdict", "passed", "waiting_for_model",
                  "deferred", "escalated", "skill_gap", "next", "unblocked",
                  "error", "no_artifact", "policy_stop", "budget_stop",
                  "corrections", "correction"):
            if k in r and r[k] not in (None, [], ""):
                extra += " %s=%s" % (k, str(r[k])[:48])
        say("  %-20s %s" % (step["kind"], extra.strip()))
    say("\n  %d ticks, quiet=%s, %.1fs" % (res["ticks"], res["quiet"],
                                           res["seconds"]))
    say("  model calls used  %d of %d" % (cap.calls, cap.max_calls))
    if cap.refusals:
        say("  cap refusals      %s" % cap.refusals[0][:70])

    return report(con, cap, res, rec)


def report(con, cap, res, rec=None):  # noqa: C901
    head("4. WHAT EACH AGENT ACTUALLY DID")
    ok = {}

    runs = [dict(r) for r in con.execute(
        "SELECT * FROM runs ORDER BY id")]
    by_agent = {}
    for r in runs:
        by_agent.setdefault(r["principal_id"], []).append(r)
    ok["every run is a model run"] = all(r["source"] == "model" for r in runs)
    say("  runs              %d, all source='model': %s"
        % (len(runs), ok["every run is a model run"]))
    for ag, rs in sorted(by_agent.items()):
        say("    %-18s %d call(s), model %s"
            % (ag, len(rs), rs[0]["model"]))

    say("")
    for c in con.execute("SELECT principal_id, cap, decision, COUNT(*) n "
                         "FROM tool_calls GROUP BY principal_id, cap, decision "
                         "ORDER BY principal_id, cap"):
        say("    TOOL %-18s %-16s %-6s x%d"
            % (c["principal_id"], c["cap"], c["decision"], c["n"]))

    # ── the researcher ───────────────────────────────────────────────
    head("5. RESEARCHER — inference, its own tool, a real observation")
    ok["the researcher ran on the model"] = bool(by_agent.get(RES))
    r_arts = [dict(x) for x in con.execute(
        "SELECT * FROM artifacts WHERE principal_id=? ORDER BY id", (RES,))]
    ok["the researcher produced an artifact"] = bool(r_arts)
    if r_arts:
        art = r_arts[0]
        say("  artifact          #%d %s (%d bytes, sha %s)"
            % (art["id"], art["name"], len(art["body"] or ""), art["sha"][:12]))
        say("  source            %s" % art["source"])
        ok["its artifact is model-sourced"] = art["source"] == "model"
    reads = [dict(x) for x in con.execute(
        "SELECT * FROM tool_calls WHERE principal_id=? AND cap='READ_REPO' "
        "AND decision='ALLOW'", (RES,))]
    ok["it read something through the gateway"] = bool(reads)
    say("  gateway reads     %d allowed" % len(reads))

    # ── the handoff ──────────────────────────────────────────────────
    head("6. THE HANDOFF — the researcher's own words, to the builder")
    msgs = [dict(m) for m in con.execute(
        "SELECT * FROM agent_messages WHERE sender=? AND recipient=? "
        "AND authority='agent' ORDER BY id", (RES, BUILD))]
    ok["the researcher messaged the builder itself"] = bool(msgs)
    text = ""
    if msgs:
        payload = json.loads(msgs[0]["payload"] or "{}")
        text = payload.get("text", "")
        say("  message #%d  %s → %s  (%s)"
            % (msgs[0]["id"], msgs[0]["sender"], msgs[0]["recipient"],
               msgs[0]["kind"]))
        say("  authority         %s  (the gateway set the sender, not the caller)"
            % msgs[0]["authority"])
        for ln in text[:400].splitlines():
            say("    | %s" % ln)
        # Did it carry its OWN result, or just an acknowledgement? The evidence
        # is vocabulary the message shares with the artifact it wrote — and the
        # briefing is SUBTRACTED, which this check used to claim in its comment
        # and not do. That omission mattered: the objective, the conditions and
        # the source's name are all words the agent was handed, so a message
        # that only restates its instructions scored as one that had worked. A
        # word in both the message and the artifact and in neither's input was
        # produced twice by the same agent doing the same work.
        body = (r_arts[0]["body"] if r_arts else "") or ""
        # The FIRST prompt only. Later ones carry observations of its own
        # output, so subtracting those would subtract the evidence itself.
        briefed = next((e["prompt"] for e in (rec.log if rec else [])
                        if e["who"] == RES), "")
        shared = (_distinctive(text) & _distinctive(body)) - _distinctive(briefed)
        ok["the message carries its actual result"] = len(shared) >= 4
        say("  shares %d distinctive words with its own artifact that it was "
            "not given: %s" % (len(shared), ", ".join(sorted(shared)[:8])))
        # Printed, not graded. Repeating a run of the artifact's own words is
        # stronger evidence still, but a handoff that paraphrases its result is
        # a real handoff, and failing it for that would be measuring style.
        say("  longest phrase repeated verbatim from that artifact: %d words"
            % _verbatim_run(text, body))
    else:
        say("  (none — the researcher did not message the builder)")

    # ── the builder ──────────────────────────────────────────────────
    head("7. BUILDER — received it, then decided for itself")
    ok["the builder ran on the model"] = bool(by_agent.get(BUILD))
    inbox = [dict(m) for m in con.execute(
        "SELECT * FROM agent_messages WHERE recipient=? AND authority='agent'",
        (BUILD,))]
    ok["the message reached the builder's inbox"] = bool(inbox)
    b_arts = [dict(x) for x in con.execute(
        "SELECT * FROM artifacts WHERE principal_id=? ORDER BY id", (BUILD,))]
    ok["the builder produced its own artifact"] = bool(b_arts)
    if b_arts:
        art = b_arts[0]
        say("  artifact          #%d %s (%d bytes, sha %s), source=%s"
            % (art["id"], art["name"], len(art["body"] or ""),
               art["sha"][:12], art["source"]))
        if r_arts:
            ok["the two artifacts are different work"] = (
                b_arts[0]["sha"] != r_arts[0]["sha"])
            say("  distinct from the researcher's: %s"
                % ok["the two artifacts are different work"])

    # ── the reviewer ─────────────────────────────────────────────────
    head("8. REVIEWER — a separate path, read-only, its own verdict")
    revs = [dict(x) for x in con.execute("SELECT * FROM reviews ORDER BY id")]
    ok["a review was recorded"] = bool(revs)
    for r in revs:
        run = con.execute("SELECT source, model FROM runs WHERE id=?",
                          (r["run_id"],)).fetchone() if r["run_id"] else None
        say("  review #%d on artifact #%d: %s by %s"
            % (r["id"], r["artifact_id"], r["verdict"], r["reviewer_id"]))
        say("    decided by        %s"
            % ("run #%d, source=%s, model=%s"
               % (r["run_id"], run["source"], run["model"]) if run
               else "NO MODEL RUN — deterministic"))
    ok["every verdict came from a model run"] = bool(revs) and all(
        r["run_id"] is not None for r in revs)
    produced = {x["principal_id"] for x in con.execute(
        "SELECT principal_id FROM artifacts")}
    ok["the reviewer never produced the work"] = REV not in produced
    ok["the reviewer never wrote anything"] = not con.execute(
        "SELECT 1 FROM tool_calls WHERE principal_id=? AND cap='WRITE_ARTIFACT' "
        "AND decision='ALLOW'", (REV,)).fetchone()
    for e in REVIEW_LOG:
        say("")
        say("  the reviewer read  %s" % (" → ".join(t for t in e["tools"] if t)
                                         or "nothing"))
        say("  it answered (%d call(s)):" % e["calls"])
        for ln in (e["answer"] or "").strip()[:500].splitlines():
            say("    | %s" % ln)
    # Independence, measured rather than asserted: for each artifact, what the
    # code concluded and what the reviewer concluded, side by side. A reviewer
    # that agrees is not thereby an echo — but one that CANNOT differ is not a
    # reviewer, and the only honest way to show the difference is to print both.
    say("")
    disagreed = 0
    for r in revs:
        ev = con.execute("SELECT detail FROM evidence WHERE id=?",
                         (r["evidence_id"],)).fetchone() if r["evidence_id"] else None
        checks = json.loads(ev["detail"]).get("checks", []) if ev else []
        code_says = "APPROVE" if checks and all(c["passed"] for c in checks) else (
            "REJECT" if checks else "-")
        if code_says != "-" and code_says != r["verdict"]:
            disagreed += 1
        say("  artifact #%d: code said %-7s reviewer said %-7s %s"
            % (r["artifact_id"], code_says, r["verdict"],
               "← they DIFFER" if code_says not in ("-", r["verdict"]) else ""))
    rejected = [r for r in revs if r["verdict"] == "REJECT"]
    say("")
    say("  rejections this run: %d" % len(rejected))
    if not rejected:
        say("    The REJECT path is armed — the verdict is parsed from the")
        say("    reviewer's own first word and the supervisor routes on it — but")
        say("    it did NOT fire here. Nothing in this run forced a rejection,")
        say("    and nothing was arranged to provoke one. Not exercised is not")
        say("    the same as not reachable, and it is not claimed as passing.")

    # ── the world ────────────────────────────────────────────────────
    head("9. THE WORLD RAN ITSELF")
    owner_cmds = con.execute(
        "SELECT COUNT(*) c FROM world_queue WHERE emitted_by='OWNER'"
    ).fetchone()["c"]
    ok["the owner gave exactly one instruction"] = owner_cmds == 1
    say("  owner events      %d" % owner_cmds)
    say("  supervisor ticks  %d" % res["ticks"])
    say("  queue quiet       %s" % res["quiet"])
    ok["the world went quiet on its own"] = bool(res["quiet"])
    ok["the cap was never exceeded"] = cap.calls <= cap.max_calls
    say("  model calls       %d of %d" % (cap.calls, cap.max_calls))
    tasks = [dict(t) for t in con.execute("SELECT * FROM tasks ORDER BY id")]
    for t in tasks:
        say("  task #%-3d %-10s %s" % (t["id"], t["status"], t["objective"][:56]))
    ok["both workers were used"] = len(
        {r["principal_id"] for r in runs} & {RES, BUILD}) == 2
    ok["only these three agents ran"] = not (
        {r["principal_id"] for r in runs} - {RES, BUILD, REV})

    head("10. EVERY DECISION EVERY AGENT MADE, IN ORDER")
    for i, e in enumerate(rec.log if rec else [], 1):
        say("  %-18s %s" % (e["who"] or "?",
                            (e["text"] or "(%s)" % e["status"]).strip()
                            .replace("\n", " ")[:190]))

    # ── did it finish? ───────────────────────────────────────────────
    head("11. DID THE WORKFLOW ACTUALLY FINISH?")
    state, why, accounted = completion_state(con)
    say("  workflow state    %s" % state)
    say("  because           %s" % why)
    say("  accounted for     %s" % ("yes" if accounted else "NO — nothing in the "
                                    "record explains the stop"))
    # The graded check fails ONLY in the silent case: something unfinished with
    # nothing in the record accounting for it. A run stopped by quota or by a
    # transport failure PASSES it — the reason is recorded — and carries its
    # state into the verdict line below, where no one can quote the verdict
    # without it. What is no longer possible is a full tally standing in for a
    # workflow that never finished.
    ok["nothing is left unfinished without the record saying why"] = (
        state == COMPLETE or accounted)

    head("VERDICT")
    for k, v in ok.items():
        say("  [%s] %s" % ("PASS" if v else "FAIL", k))
    passed = all(ok.values())
    say("")
    if passed:
        say("  REAL MULTI-AGENT WORLD DEMONSTRATED · workflow %s" % state)
        say("    %s and %s each decided on %s; %s judged the result."
            % (RES, BUILD, runs[0]["model"], REV))
        if state != COMPLETE:
            say("    The demonstration stands and the workflow does not: %s." % why)
        # 0 means demonstrated AND finished. 2 means the agents did the work and
        # the workflow stopped before the end — a distinction a script gating on
        # the exit code has to be able to make.
        return 0 if state == COMPLETE else 2
    say("  REAL MULTI-AGENT WORLD NOT DEMONSTRATED · workflow %s" % state)
    for k, v in ok.items():
        if not v:
            say("    failed: %s" % k)
    return 1


if __name__ == "__main__":
    sys.exit(main())
