# BASELINE — Phase 1 freeze

The foundation is frozen here so everything after it is measured against something
fixed. Nothing in this file is a projection.

| | |
|---|---|
| **Baseline commit** | `d6e792afa5bfc3a0972078f85e19e0ce7c161105` |
| **Tag** | `civ-baseline-v1` — **local only; could not be pushed** (see below) |
| **Frozen** | 2026-09-17 |
| **Runtime** | Python 3.11, standard library only. No install. |

## Test results at the freeze

| Suite | Result | Time |
|---|---|---|
| `world/test_world.py` | **16 passed** | 2.60 s |
| `civ/test_civ.py` | **26 passed, 1 skipped** | 3.00 s |
| `civ/test_regressions.py` | **38 passed** | 7.63 s |
| `civ/test_security.py` | **18 passed** | 0.49 s |
| **Total** | **98 passed, 1 skipped** | |

> The regression suite reported 27 for one commit while actually holding 38 tests:
> classes appended after the `__main__` block were never collected. `R14` now
> fails the build if any class is defined after it, or if `__main__` is not last.

The single skip is `test_claude_conforms_live`. It skips **loudly**:

```
skipped 'L10-LIVE SKIPPED: no ANTHROPIC_API_KEY. The live path is UNVERIFIED until this runs.'
```

### A note on the tag

`git push` of a tag ref fails from this build environment with
`send-pack: unexpected disconnect while reading sideband packet`, consistently,
on both annotated and lightweight tags, while branch pushes from the same clone
succeed. The proxy reports no relay failure, so this is an environment limit on
tag refs, not a repository or permissions problem.

**The baseline is therefore pinned by SHA, not by tag.** `d6e792afa5bfc…` is the
authoritative reference and is what the rest of this document means. To create
the tag from a machine without that limitation:

```bash
git tag -a civ-baseline-v1 d6e792afa5bfc3a0972078f85e19e0ce7c161105 \
  -m "Phase 1 baseline: runtime frozen, 69 tests passing, G1 UNVERIFIED"
git push origin civ-baseline-v1
```

Reproduce the whole freeze:

```bash
git checkout d6e792afa5bfc3a0972078f85e19e0ce7c161105
( cd world && python3 test_world.py )
( cd civ   && python3 test_civ.py && python3 test_regressions.py && python3 slice.py )
```

## Component status

| Component | Status | Basis |
|---|---|---|
| World state, hash-chained events | **REAL** | `test_civ.py` L5, `test_regressions.py` R8 |
| Task queue, leases, budgets | **REAL** | L7, R2 — a killed lease requeues its task |
| Tool gateway: identity, capability, **scope, target, rate** | **REAL** | L9 + `test_security.py` — scope resolved canonically by the gateway, then checked, then executed |
| Prompt-injection containment | **REAL** | 18 adversarial tests vs a fully compromised model |
| OS-level sandbox | **NOT IMPLEMENTED** | subprocess, same user — asserted in code, not assumed |
| Providers: MOCK · CLAUDE · LOCAL · COMPROMISED | **REAL** (interface) | `ClaudeProvider`/`LocalProvider` **UNVERIFIED** — neither reachable here |
| Provenance (`run_id` + source match) | **REAL** | L3, R4 — the database refuses forgery |
| Mode purity | **REAL** | L4, R1 — a model run cannot enter a simulation world |
| Evidence with external provenance | **REAL** | a real subprocess, real exit code, real stdout |
| Independent review | **REAL** | L9b — self-review refused by trigger |
| Owner control plane, PAUSE_ALL, ceiling, decisions | **REAL** | L9 — deterministic code, no model reaches it |
| Artifact **content** | **MOCK** | `MockProvider`; labelled in the file body, console and DB |
| `world/` idea engine | **SIMULATED** | Phase 0 world-engine proof; composed from lexicons |
| **Live model execution** | **UNVERIFIED** | `ClaudeProvider` implemented; never executed |
| Agent Factory, Skill Factory, Opportunity Radar, World Map, Time Machine, 1000-agent registry | **NOT IMPLEMENTED** | no code exists |

**The registry holds 5 principals, not 1000.** The 1000-agent allocation in
`civ/00-REALITY-CHECK.md` is a plan, not an implementation.

## The laws, frozen

Changing any of these requires updating `LawsAreFrozen.EXPECTED` in
`test_regressions.py`, which fails the build if the schema and this list disagree.

| Law | Trigger | Closes |
|---|---|---|
| Nothing generated exists without a recorded run whose source it matches | `law_provenance_matches` + `run_id NOT NULL` | F1 |
| A world cannot mix simulated and live content | `law_mode_purity`, `law_mode_purity_live` | F2 |
| A reader may never exceed autonomy 2 | `law_split_brain_insert/update` | — |
| No FACT or RESULT without external evidence | `law_no_unbacked_fact_insert/update` | the QAYD failure |
| No agent reviews its own artifact | `law_independent_review` | — |
| History is append-only | `law_events_no_delete/update` | F5 |
| Agents must differ materially | `law_distinctness` (UNIQUE index) | F4 |

## Regression coverage — every defect ever found

| ID | Defect | Where found | Test |
|---|---|---|---|
| R1 | Mode purity **never fired**: `set_meta` stores JSON so the value was `"simulation"` with quotes | building `civ/` | `R1_ModePurityWasNeverEnforced` |
| R2 | Second-granularity timestamps made a 1s lease **un-expirable** | building `civ/` | `R2_ShortLeaseCouldNotExpire` |
| R3 | Law was over-broad — a run producing nothing must stay recordable | building `civ/` | `R3_LawWasOverBroad` |
| R4 | Provenance computed then discarded (F1) | audit of `world/` | `R4_ProvenanceWasComputedThenDiscarded` |
| R5 | World did not record its own mode (F2) | audit | `R5_WorldDidNotRecordItsMode` |
| R6 | A declared table nothing writes (F3) | audit | `R6_ADeclaredTableNothingWrites` |
| R7 | Distinctness invariant unevaluable (F4) | audit | `R7_DistinctnessWasUnevaluable` |
| R8 | History mutable (F5) | audit | `R8_HistoryWasMutable` |
| R9 | Live path silently unverified (F7) | audit | `R9_LivePathWasSilentlyUnverified` |
| R10 | Wound organ mismatch · duplicate nomination · artifact standing after its organ died | running `world/` | `world/test_world.py`, pinned by `R10_WorldEngineDefectsStayCovered` |
| R11 | **An allowlisted interpreter was arbitrary execution.** `argv0` allowlisting plus substring denial let `python3 -c "…"` straight through | `test_security.py` | `R11_AllowlistedInterpreterWasArbitraryExecution` |
| R12 | **Tool args could shadow gateway parameters.** An argument literally named `cap` collided with the gateway's own — attacker-chosen argument *names* are untrusted input too | `test_security.py` | `R12_ToolArgsCouldShadowGatewayParameters` |
| R13 | Gateway and tool resolved the same relative path against **different roots** — a check passing on one string while the tool acts on another | switching scopes on | `R13_ScopeAndToolMustAgreeOnPaths` |
| R14 | A test suite **silently under-counted**: classes after `__main__` were never collected, and 11 regressions were not running while the suite reported OK | this phase | `R14_TestSuitesMustCollectEveryClass` |
| — | A denial whose own audit write hit a foreign-key constraint **lost the security record** | `R12` | fixed in `Gateway.call`'s logger |

R6 forced a real fix during the freeze: `approvals` was the last empty table, so
**mock content now raises an owner decision instead of silently becoming project
progress.**

## Acceptance gates — G1 to G15

`UNVERIFIED` is never converted to `PASS`.

| Gate | Verdict | Basis |
|---|---|---|
| **G1** Live model execution | **UNVERIFIED** | No provider reachable in the build container. `ClaudeProvider` is written and conformance-tested in shape only. `civ/live_proof.py` settles this in one command on a machine with a key. |
| **G2** Real tool execution | **PASS** | Real `subprocess`, real file writes, cwd allowlist, path-escape refused (L9) |
| **G3** Real artifact creation | **PASS** (mechanism) | A real file at a real path with a real sha. **Its content is MOCK and labelled so.** |
| **G4** Real artifact verification | **PASS** | Independent verifier executed it: `exit=0`, `stdout='17'` — the true count of `.py` files in this repo |
| **G5** Provenance integrity | **PASS** | Enforced by the database, not by code (L3, R4) |
| **G6** Independent review | **PASS** | Reviewer ≠ author enforced by trigger; REJECT is reachable |
| **G7** Security isolation — *containment* | **PASS** | `test_security.py`, 18 tests, run against `CompromisedProvider`: a model that obeys **every** injected instruction. Every pass is the gateway holding, not a model declining. Two real holes were found and closed by this benchmark (R11, R12). |
| **G7** Security isolation — *OS sandbox* | **NOT IMPLEMENTED** | Execution is a subprocess under the **same user**. No container, no seccomp, no uid separation. `test_the_sandbox_is_honestly_labelled` asserts this in code so the limitation cannot drift out of the docs. |
| **G8** Owner observability | **PASS** | 15 `owner.py` commands, every one reading real state; drill-down to artifact, run, evidence, event |
| **G9** Multi-agent benchmark | **NOT IMPLEMENTED** | No benchmark exists. Whether the organization beats one strong agent is **unknown**, and that is the question most likely to sink this design. |
| **G10** Cost measurement | **PASS** (mechanism) | Per-run tokens, USD, latency recorded; daily ceiling blocks new leases. **No real cost observed** — mock runs cost $0. |
| **G11** Failure recovery | **PASS** | Expired lease requeues its task; work under a dead lease is REFUSED (L7) |
| **G12** Pause-all | **PASS** | Blocks leases, model calls and tool calls; enforced in scheduler **and** gateway (L9) |
| **G13** Organizational memory | **NOT IMPLEMENTED** | No similarity search over prior ideas, projects or failures |
| **G14** Cross-project intelligence | **NOT IMPLEMENTED** | One project exists |
| **G15** UI/UX usability | **NOT IMPLEMENTED** | CLI only. No World Map, no usability testing, no World UX team |

**Score: 9 PASS · 1 UNVERIFIED · 6 NOT IMPLEMENTED.** Three passes are
mechanism-only and say so; G7 splits because its two halves have different answers.

**G1 remains UNVERIFIED and is not modified.** No provider is reachable from the
build container, so live model execution is unproven. It is not a failure — it is
simply not yet earned, and nothing here says otherwise.

## What unblocks the next phase

G1 is the gate. Everything from Phase 4 onward assumes a real model can execute
inside this runtime, and that is the one claim not yet earned.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd civ && python3 live_proof.py
```

It founds its own world in `live` mode, runs the identical slice, and prints a
record containing provider, model, tokens, cost, latency, run/task/agent ids, tool
calls, artifact sha, verification, evidence provenance and review verdict. On
failure it prints the failure. It never degrades to mock to produce a green result.

Estimated cost of that first proof: **well under one US dollar.**
