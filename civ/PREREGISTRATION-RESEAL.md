# Pre-registration — re-seal of 2026-09-18

**Status: SEALED. Authorises nothing.**

Campaign #3's manifest seals the tasks, the reference answers, the evaluators,
the metric definitions and the statistical rule. It does **not** seal the thing
that executes them. So throughout the harness rewrite the pre-flight kept
reporting

```
4. TASK AND EVALUATOR HASHES
   MATCH : no task, reference answer or evaluator has moved
```

and it was telling the exact truth — while the experiment underneath had
materially changed. A condition that *could not reach a tool* became one that
can. A seal that cannot see that is the same defect the campaigns kept finding
in themselves, so the seal now covers the instrument.

Manifest: [`bench_history/harness-reseal-manifest.json`](bench_history/harness-reseal-manifest.json)
· built by [`bench_seal.py`](bench_seal.py) · verified by pre-flight check **4b**.

---

## 1. What did NOT change, and is carried forward byte-identical

`bench_seal.build_reseal_manifest()` does not recompute these independently — it
**copies them from Campaign #3's manifest and refuses to build at all** if the
live code no longer matches. The re-seal cannot be the thing that moves them.

| Sealed | Value |
|---|---|
| Task set | `v2`, 9 tasks |
| Task hashes | all 9, identical to Campaign #3 |
| Reference answers | inside the task hash — `reference_good`, `reference_bad` |
| Evaluator hashes | all 9 checker sources, identical |
| Metric definitions | `8553b9ce2ddd224192cdc6e4c8f84a3134372c8e30767cb5703006ded37c6407` |
| α | `0.05` |
| Statistical test | two-sided exact binomial sign test over per-task QUALITY |
| Decision thresholds | 5 runs per cell · 3 tasks with signal · **6 of 8** decided |
| Campaigns #1–#3 | frozen, LAW 12, raw runs and conclusions untouched |
| Campaign #3's own manifest | untouched — the re-seal is a **separate file** |

## 2. What DID change — the execution model

Commits `8312f3c` (the loop) and `68721df` (the audit).

**Before:** one model call per role, then a single tool call made *after* the
answer was already fixed. `READ_REPO` was granted on four tasks and reachable on
none.

**Now:** `model → tool → observation → model`, bounded, per role turn, through
the same Tool Gateway.

- a role may call a tool and **see the result** before it answers
- the observation re-enters the prompt before the next model call
- a role may act on what it read, including reading again
- a denied or failing call returns an observation it can respond to
- a role sequences its own tool steps within its turn
- submission is explicit and resolves **only against gateway-written bytes**

SINGLE is one `agent_turn`. MULTI is builder → critic → reviser, three
`agent_turn`s.

**Fingerprint:** `c7aa7c7d0dc95dd175a7e2749d0a5005ee235ba82ae506f17724b2b799ae8443`
over 15 components — the loop (`agent_turn`, `run_condition`, `clip`,
`invoke_with_retry`, `is_transport_failure`, `render_observation`, `verify`), the
grant derivation (`bench_crew`, the principal list), the authorisation path
(`Gateway.call`, `_scope_violation`, `_resolve_paths`), every bound the model
cannot talk past (`limits`), what each role is told (`prompts`), and the
per-role token budgets.

Raw source, comments included — exactly as `evaluator_sha` already treats the
checkers. Over-sensitivity is the right failure mode for a seal: a hash that
moves forces a deliberate re-seal, and a hash that does not move must mean the
instrument really did not move.

## 3. Declared confounds

Named **before** any run, because a confound discovered afterwards is
indistinguishable from one discovered in a result's favour. Each carries the
direction it can push — a confound that can only hurt one condition is not the
same object as one that can help it.

| id | what | scope | direction |
|---|---|---|---|
| **C1** | critic turn at `max_tokens=500`; every other turn at 900 | MULTI-internal (SINGLE has no critic) | can only **constrain** multi, never flatter it |
| **C2** | `EXECUTE_SANDBOX` is a subprocess under the same user, not an OS boundary | both equally | neutral between conditions; a real containment limit |
| **C3** | principals are rebuilt and re-granted from the task before every run | both equally | neutral — it is what makes per-task capability parity provable |
| **C4** | no role remembers anything between runs | both equally | removes the mechanism the hypothesis calls *persistent* |
| **C5** | the role sequence is fixed at builder → critic → reviser | MULTI | tests **a** fixed pipeline, not an organisation that forms itself |
| **C6** | role turns and runs are strictly sequential | MULTI | removes any speed advantage; LATENCY is measured as if parallelism does not exist, which it does not |
| **C7** | turns are bounded at `MAX_TOOL_STEPS`; nothing replans | both, asymmetric on step count | the extra steps MULTI gets are already charged in COST and LATENCY |

**C1 is not fixed on purpose.** R23 pins 900/500 as the budgets that produced
real answers across campaigns #1–#2, and nothing measured shows the 500 ever
bound. Raising it would retune a pre-registered parameter on suspicion — the
exact defect R23 exists to prevent. It is measured first, then re-sealed
deliberately.

**C4–C7 are the scope limit on any future result.** After this change the
harness tests *a fixed three-role pipeline with real tool access*. That is worth
measuring and is far more than it could do before. It is still narrower than the
hypothesis as written, and no result may be reported without that attached.

## 4. What this re-seal authorises

```json
"authorises": []
```

**Nothing.** Sealing an instrument is not permission to run it. The pre-flight
prints this as a note on every invocation, and check 4b fails outright if the
harness drifts from the fingerprint above.

Two things stand between here and a comparison campaign:

1. **Owner authorisation**, named in `authorises`.
2. **The first real run is still the first real run.** Every claim in the audit
   comes from scripted providers, `CompromisedProvider`, or direct gateway
   calls. That is the right way to test an architecture — a well-behaved model
   would pass by declining — but it means no model has ever executed this loop.

## 5. What remains untouched

- **Campaigns #1, #2 and #3** — immutable, LAW 12. Defects recorded exactly as
  they occurred; R16 and R17 are **not** applied retroactively.
- **V2-T04** — byte-identical to v1.
- **G1 evidence** — untouched.
- **α, the cell minimums, and the sign test** — Option A, sealed since
  Campaign #3 and unmoved.
