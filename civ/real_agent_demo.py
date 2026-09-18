#!/usr/bin/env python3
"""THE AGENT LOOP — one objective, and nobody directing the steps.

    python3 real_agent_demo.py --fresh

What this demonstrates is the LOOP: an agent wakes with a briefing assembled
from rows, decides what to do, asks the gateway for a tool, receives the actual
result, decides again on the strength of it, produces an artifact whose content
depends on what it read, hands off to a colleague by name, gets verified and
reviewed by someone else, and — if rejected — comes back with the rejection in
front of it and answers it.

    WAKE → OBSERVE → DECIDE → REQUEST TOOL → GATE → EXECUTE → OBSERVE RESULT
         → DECIDE AGAIN → ARTIFACT → MESSAGE → VERIFY → REVIEW → CORRECT → LEARN

**What drives the decisions here is not a model.** No model is reachable in this
environment: no local runtime answers, and no key is set. `ReactiveWorker` below
is a hand-written policy — it reads its briefing, reacts to what the gateway
actually returns, and branches on it. That makes it an honest exercise of the
RUNTIME and no evidence at all about reasoning. Every line it produces is
labelled as coming from a double.

The distinction that matters: a scripted demo decides the sequence in advance.
Here the sequence is a consequence. Deny the agent a tool and it takes a
different path; give it a rejection and it reads the rejection. Swap this double
for a real provider and nothing around it changes — that is the point of it.
"""
import argparse
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_context as CTX       # noqa: E402
from core import agent_world as W           # noqa: E402
from core import always_on as A             # noqa: E402
from core import provider as P              # noqa: E402
from core import store                      # noqa: E402
from core import world_policy as POL        # noqa: E402
from core import world_space as SPACE       # noqa: E402
from core import world_supervisor as SUP    # noqa: E402

DB = os.path.join(HERE, "real-agent.db")
BAR = "─" * 78
ORCH, RES = "AGT-ORCHESTRATOR", "AGT-RESEARCHER"
BUILD, REV, OPER = "AGT-BUILDER", "AGT-REVIEWER", "AGT-OPERATOR"

BANNER = ("NOT MODEL OUTPUT — produced by ReactiveWorker, a deterministic "
          "double. No inference happened.")


def say(s=""):
    print(s, flush=True)


def head(t):
    say("\n" + BAR)
    say(t)
    say(BAR)


# ── the double ───────────────────────────────────────────────────────
class ReactiveWorker(P.Provider):
    """A policy, not a mind. It decides from what it has actually observed.

    The whole of its intelligence is: read the briefing, notice what tools you
    hold, notice what came back, and do the next thing that is possible. That is
    enough to exercise every branch of the runtime and is not enough to be
    called reasoning, so nothing here claims it is."""

    name = "reactive-double"
    source = "mock"                 # the honest tag: not 'model'

    def __init__(self, agent_id, task_id):
        self.agent_id, self.task_id = agent_id, task_id
        self.calls = 0

    def available(self):
        return True

    def why_unavailable(self):
        return ""

    # what it can see, read off its own briefing and the observations appended
    # to it by the runtime
    @staticmethod
    def _holds(prompt, cap):
        m = re.search(r"TOOLS YOU HOLD:(.*?)(?:\n\n|\Z)", prompt, re.S)
        return bool(m) and cap in m.group(1)

    @staticmethod
    def _source_path(prompt):
        m = re.search(r"source file is at:\s*(\S+)", prompt)
        if m:
            return m.group(1)
        m = re.search(r"(/\S+\.(?:md|txt|py|json))", prompt)
        return m.group(1) if m else None

    @staticmethod
    def _read_result(prompt):
        """What a READ_REPO actually returned, if one did. The runtime appends
        observations to the prompt, so this is the agent seeing its own past."""
        hits = re.findall(r"TOOL RESULT \[READ_REPO\]:\n(.*?)(?=\n\nTOOL RESULT|\Z)",
                          prompt, re.S)
        return hits[-1].strip() if hits else None

    @staticmethod
    def _rejected_for(prompt):
        """The rejection this attempt exists to answer, if there is one."""
        m = re.search(r"review REJECT by \S+: (.+)", prompt)
        return m.group(1).strip() if m else None

    @staticmethod
    def _failed_requirements(prompt):
        """Which checks a previous attempt did not pass.

        Verification runs BEFORE a reviewer reads anything, so a first attempt
        that misses a requirement is stopped by code and never produces a review
        line at all. What it produces is this, in the briefing:

            verification: FAILED — names its source=ok; states its limitations=FAILED

        The agent is not told the requirement list up front. It finds out by
        failing and reading why, which is the whole point of the arm of the loop
        this exercises."""
        out = []
        for line in prompt.splitlines():
            if "verification: FAILED" not in line:
                continue
            for part in line.split("—")[-1].split(";"):
                name, _, verdict = part.partition("=")
                if verdict.strip() == "FAILED":
                    out.append(name.strip())
        return out

    def complete(self, system, prompt, model=None, max_tokens=800):
        self.calls += 1
        t0 = time.time()
        out = self._decide(prompt)
        text = json.dumps(out, ensure_ascii=False)
        return P.Result("OK", "mock", self.name, model or "reactive-1", text=text,
                        tokens_in=len(prompt) // 4, tokens_out=len(text) // 4,
                        usd=0.0, latency_ms=int((time.time() - t0) * 1000))

    def _decide(self, prompt):
        seen = self._read_result(prompt)
        wrote = "TOOL RESULT [WRITE_ARTIFACT]" in prompt
        told = "TOOL RESULT [SEND_MESSAGE]" in prompt
        denied_read = "TOOL RESULT [READ_REPO]: DENIED" in prompt

        # 1. Nothing observed yet: if a source can be reached, reach it.
        if seen is None and not denied_read and self._holds(prompt, "READ_REPO"):
            path = self._source_path(prompt)
            if path:
                return {"tool": "READ_REPO", "args": {"path": path}}

        # 2. Something was read (or reading was refused): produce the artifact,
        #    and make its CONTENT depend on what was actually observed.
        if not wrote and self._holds(prompt, "WRITE_ARTIFACT"):
            body = self._compose(prompt, seen)
            name = "findings_t%s.md" % self.task_id
            return {"tool": "WRITE_ARTIFACT", "args": {"path": name, "body": body}}

        # 3. There is an artifact: tell the colleague who needs it.
        if wrote and not told and self._holds(prompt, "SEND_MESSAGE"):
            return {"tool": "SEND_MESSAGE",
                    "args": {"to": BUILD if self.agent_id == RES else RES,
                             "kind": "HANDOFF",
                             "text": "Artifact for task #%s is written. It cites "
                                     "the source I actually read." % self.task_id}}

        # 4. Done. Declare the file, which resolves only against bytes the
        #    gateway wrote — a name it never wrote resolves to nothing.
        if wrote:
            return {"final": {"artifact": "findings_t%s.md" % self.task_id}}

        # 5. No writing tool at all: answer in words rather than pretend.
        return {"final": {"answer": "%s I hold no writing tool, so there is no "
                                    "artifact to declare." % BANNER}}

    def _compose(self, prompt, seen):
        """The artifact. Its content is a function of what was observed and of
        any rejection this attempt has to answer."""
        rejected = self._rejected_for(prompt)
        lines = ["# Findings for task #%s" % self.task_id, "", BANNER, ""]
        if seen:
            head_lines = [ln for ln in seen.splitlines() if ln.strip()][:3]
            lines += ["## Source",
                      "Read through the gateway under this agent's own lease.",
                      "First lines actually returned:", ""]
            lines += ["    " + ln.strip()[:100] for ln in head_lines]
            lines += ["", "Bytes observed: %d." % len(seen), ""]
        else:
            lines += ["## Source", "",
                      "No source was read: the gateway refused it. This report "
                      "therefore asserts nothing about a file's contents.", ""]
        lines += ["## Recommendation", "",
                  "Proceed on the evidence above and no further.", ""]
        if seen:
            # Evidence is claimed only when there IS some. An artifact that
            # cites evidence it never collected is the single thing this whole
            # system exists to prevent, and the double does not do it either.
            lines += ["## Evidence", "",
                      "The gateway's `tool_calls` row for the read above is the "
                      "evidence for every claim in this document.", ""]
        # Whatever a previous attempt was told it was missing, add — with the
        # section title taken from the failure text itself rather than from a
        # list this double was given in advance.
        for req in self._failed_requirements(prompt):
            title = req.split()[-1].strip().capitalize()
            if ("## " + title) in "\n".join(lines):
                continue
            lines += ["## %s" % title, "",
                      "Added because verification reported %r on a previous "
                      "attempt. This report covers one file and says nothing "
                      "about what that file does not describe." % req, ""]
        if rejected:
            lines += ["## Correction", "",
                      "A previous attempt was rejected: %s" % rejected, ""]
        return "\n".join(lines)


def provider_for(agent, task, attempt):
    return ReactiveWorker(agent, task["id"])


def requirements_for(task):
    """What verification will actually check. Ordinary code, run after the fact,
    which the agent has no way to influence.

    `states its limitations` is deliberately NOT announced in the briefing. A
    first attempt therefore misses it, verification catches that, the reviewer
    rejects with the reason, and the correction attempt — which can see the
    rejection because the correction task names its parent — adds the section.
    That is the CORRECT-IF-REQUIRED arm of the loop, reached by observation
    rather than by a script that knew about it in advance."""
    return [("names its source", lambda b: "## Source" in b),
            ("makes a recommendation", lambda b: "## Recommendation" in b),
            ("cites evidence", lambda b: "## Evidence" in b),
            ("states its limitations", lambda b: "## Limitations" in b)]


def instruction_for(task):
    """What the Owner asked, and what it is about.

    The source travels with the work: a task derived from an objective about a
    document is a task about that document, and an agent that is not told which
    one has nothing to go on."""
    return "%s\n\nThe source file is at: %s" % (
        task["objective"], os.path.join(HERE, "AGENT_WORLD_SERVER.md"))


# ── the run ──────────────────────────────────────────────────────────
def show_chain(con):
    head("THE CAUSAL CHAIN — every link, and the row behind it")
    for t in con.execute("SELECT * FROM tasks ORDER BY id"):
        say("\n  TASK #%d %s — %s" % (t["id"], t["status"], t["objective"][:70]))
        who = W.assignee(con, t["id"])
        if who:
            say("    assigned to %s" % who)
        for c in con.execute("SELECT * FROM tool_calls tc JOIN leases l "
                             "ON l.id=tc.lease_id WHERE l.task_id=? ORDER BY tc.id",
                             (t["id"],)):
            say("    TOOL %-16s %-6s by %s" % (c["cap"], c["decision"],
                                               c["principal_id"]))
        for m in con.execute("SELECT * FROM agent_messages WHERE task_id=? "
                             "ORDER BY id", (t["id"],)):
            p = json.loads(m["payload"] or "{}")
            say("    MSG  %s → %s (%s, authority=%s): %s"
                % (m["sender"], m["recipient"], m["kind"], m["authority"],
                   (p.get("text") or "")[:60]))
        for a in con.execute("SELECT * FROM artifacts WHERE task_id=? ORDER BY id",
                             (t["id"],)):
            say("    ART  #%d %s (%d bytes, sha %s) by %s"
                % (a["id"], a["name"], len(a["body"] or ""), (a["sha"] or "")[:10],
                   a["principal_id"]))
            for e in con.execute(
                    "SELECT * FROM evidence WHERE kind='verification' AND "
                    "external_provenance LIKE ? ORDER BY id", ("artifact:%d@%%" % a["id"],)):
                d = json.loads(e["detail"] or "{}")
                say("    VERIFY %s — %s" % (
                    "PASSED" if d.get("passed") else "FAILED",
                    "; ".join("%s=%s" % (c["requirement"], "ok" if c["passed"] else "no")
                              for c in d.get("checks", []))))
            for r in con.execute("SELECT * FROM reviews WHERE artifact_id=? ORDER BY id",
                                 (a["id"],)):
                say("    REVIEW %s by %s — %s"
                    % (r["verdict"], r["reviewer_id"], (r["rationale"] or "")[:60]))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--max-ticks", type=int, default=200)
    a = ap.parse_args(argv)
    if a.fresh:
        for ext in ("", "-wal", "-shm"):
            if os.path.exists(a.db + ext):
                os.remove(a.db + ext)

    con = store.connect(a.db)
    if not store.meta(con, "founded"):
        store.found(con, mode="simulation")
    W.found_agents(con)
    POL.seed(con)

    head("WHAT IS DRIVING THE DECISIONS")
    live = P.from_env()
    say("  model provider available : %s" % live.available())
    say("  provider that would run  : %s" % live.name)
    if not live.available():
        say("  why not                  : %s" % live.why_unavailable())
    say("")
    say("  This run uses ReactiveWorker, a deterministic double. It reacts to")
    say("  real gateway results and branches on them, which exercises the loop.")
    say("  It is NOT inference and nothing below is evidence about reasoning.")

    gw = W.build_gateway(con)
    w = SUP.World(con, gw, provider_for=provider_for,
                  requirements_for=requirements_for,
                  instruction_for=instruction_for, worker="worker-1")

    source = os.path.join(HERE, "AGENT_WORLD_SERVER.md")
    head("ONE OBJECTIVE, THEN NO FURTHER COMMANDS")
    objective = ("Establish what this world can already prove about itself, "
                 "with evidence.")
    say("  %s" % objective)
    say("  source: %s" % os.path.basename(source))
    A.go_away(con, "running the agent-loop demonstration")
    from core import world_bus as BUS
    BUS.emit(con, "OWNER_OBJECTIVE", "objective:1",
             {"objective": objective, "fixture": source,
              "required_caps": ["research", "build"]}, by="OWNER")

    res = SUP.run(w, max_ticks=a.max_ticks)
    say("\n  the supervisor turned %d times and went quiet: %s"
        % (res["ticks"], res["quiet"]))

    show_chain(con)

    head("WHAT THE AGENTS DECIDED, AND WHAT IT COST THEM")
    calls = [dict(r) for r in con.execute(
        "SELECT principal_id, cap, decision, COUNT(*) n FROM tool_calls "
        "GROUP BY principal_id, cap, decision ORDER BY principal_id")]
    for c in calls:
        say("  %-18s %-16s %-6s ×%d" % (c["principal_id"], c["cap"],
                                        c["decision"], c["n"]))
    say("")
    say("  agent→agent messages : %d" % con.execute(
        "SELECT COUNT(*) c FROM agent_messages WHERE authority='agent'"
    ).fetchone()["c"])
    say("  artifacts            : %d" % con.execute(
        "SELECT COUNT(*) c FROM artifacts").fetchone()["c"])
    say("  reviews              : %d" % con.execute(
        "SELECT COUNT(*) c FROM reviews").fetchone()["c"])
    say("  rejections           : %d" % con.execute(
        "SELECT COUNT(*) c FROM reviews WHERE verdict='REJECT'").fetchone()["c"])
    lessons = con.execute("SELECT COUNT(*) c FROM failures WHERE lesson<>''"
                          ).fetchone()["c"]
    promoted = con.execute("SELECT COUNT(*) c FROM memories WHERE kind='LESSON'"
                           ).fetchone()["c"]
    say("  failures with a lesson: %d  (read by the next attempt on that task)"
        % lessons)
    say("  promoted to org memory: %d  (promotion is an Owner act, by law — an"
        % promoted)
    say("                            unattended run does not promote anything)")
    say("  journeys             : %d" % con.execute(
        "SELECT COUNT(*) c FROM movements WHERE phase='ARRIVED' "
        "AND from_workspace IS NOT NULL").fetchone()["c"])

    head("WHERE EVERYONE ENDED UP")
    for r in con.execute("SELECT * FROM agent_locations ORDER BY principal_id"):
        p = SPACE.place(con, r["workspace"])
        say("  %-18s %-9s %s" % (r["principal_id"].replace("AGT-", ""),
                                 r["movement"], p["label"] if p else "?"))

    head("HONEST SUMMARY")
    say("  REAL          the loop, the gateway decisions, the tool results, the")
    say("                artifacts and their shas, the messages, the verification,")
    say("                the review, the correction, the memory, every row.")
    say("  DETERMINISTIC the DECISIONS. ReactiveWorker is a hand-written policy")
    say("                reacting to real observations. It is not a model.")
    say("  NOT RUN       inference. No model is reachable here, so no reasoning")
    say("                has been demonstrated — only the machinery for it.")
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
