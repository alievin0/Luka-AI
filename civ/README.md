# civ/ — the civilization runtime

The vertical slice, working:

```
OWNER → WORLD → AGENT → TASK → TEAM → PROJECT → ARTIFACT → REVIEW → EVIDENCE → SIGNAL
```

```bash
cd civ
python3 slice.py          # run the whole chain
python3 owner.py status   # what the world is — and what it is not
python3 test_civ.py       # 26 acceptance tests
```

## What is real here, and what is not

| | Status |
|---|---|
| Runtime: leases, budgets, queue, crash recovery | **IMPLEMENTED · TESTED** |
| Tool gateway, capability enforcement, sandbox allowlist | **IMPLEMENTED · TESTED** |
| Provenance on every generated row | **IMPLEMENTED · TESTED** |
| Tamper-evident history | **IMPLEMENTED · TESTED** |
| Evidence with external provenance | **IMPLEMENTED · TESTED** (a real subprocess, a real exit code) |
| Independent review that can reject | **IMPLEMENTED · TESTED** |
| Owner control plane, PAUSE_ALL, ceiling | **IMPLEMENTED · TESTED** |
| **Live model execution** | **IMPLEMENTED · UNVERIFIED — no provider reachable here** |
| Agent Factory, Skill Factory, Opportunity Radar, World Map | **NOT IMPLEMENTED** |
| The 1000-agent registry | **NOT IMPLEMENTED** — 5 principals exist |

`MockProvider` proves the **runtime**. It proves nothing about intelligence, and
says so in the artifact body, in the owner console, and in the database.

## The laws are triggers, not prose

Each one closes a specific finding from `civ/01-AUDIT.md`:

| Law | Enforced by | Closes |
|---|---|---|
| 1 · nothing generated exists without a recorded run, and its source must match | `run_id NOT NULL` + `law_provenance_matches` | F1 |
| 2 · a world cannot silently mix simulated and live content | `law_mode_purity` | F2 |
| 3 · anything reading untrusted input is capped at autonomy 2 | `law_split_brain` | — |
| 4 · no FACT or RESULT without external evidence | `law_no_unbacked_fact` | the QAYD failure |
| 5 · no agent reviews its own artifact | `law_independent_review` | — |
| 6 · history is append-only | `law_events_no_delete/update` | F5 |
| — · agents must differ in tools, permissions, memory scope, metrics, escalation | `law_distinctness` UNIQUE index | F4 |

Try to break one:

```bash
python3 -c "
import sys; sys.path.insert(0,'.')
from core import store
c = store.connect(); c.execute('DELETE FROM events')"
# sqlite3.IntegrityError: LAW 6: history is append-only
```

## Turning it live

Nine of the ten acceptance groups pass with no provider. The tenth skips **loudly**:

```
test_claude_conforms_live ... skipped 'L10-LIVE SKIPPED: no ANTHROPIC_API_KEY.
                                       The live path is UNVERIFIED until this runs.'
```

To verify it on your machine:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python3 test_civ.py                              # L10-LIVE now runs for real
CIV_MODE=live CIV_PROVIDER=claude python3 slice.py
```

The world refuses to mix: a world founded `simulation` rejects a model run, and a
world founded `live` rejects a mock one. Use `hybrid` only when you want both, and
every row still carries its own source.

## Files

```
civ/
  slice.py        the vertical slice, end to end
  owner.py        owner control plane — deterministic, no model reaches it
  test_civ.py     26 acceptance tests
  core/
    schema.sql    16 tables, 10 law triggers
    store.py      state, hash-chained events, owner switches
    provider.py   Provider ABC · NotConfigured · Mock · Claude
    runtime.py    leases, recorded runs, tool gateway
```

Python 3 and its standard library. No install.
