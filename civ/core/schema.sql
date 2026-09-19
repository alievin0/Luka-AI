-- The civilization runtime. The laws are triggers, not documentation.
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ─────────────────────────────────────────────────────────────────────
-- WORLD
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS world_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- mode ∈ simulation | live | hybrid   (set at founding, enforced below)
-- paused ∈ 0 | 1                      (owner kill switch)

-- ─────────────────────────────────────────────────────────────────────
-- RUNS — every model invocation, recorded before and after.
-- Nothing generated may exist without one.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY,
  principal_id  TEXT    NOT NULL REFERENCES principals(id),
  task_id       INTEGER          REFERENCES tasks(id),
  lease_id      INTEGER          REFERENCES leases(id),
  source        TEXT    NOT NULL CHECK (source IN ('model','mock','lexicon','human')),
  provider      TEXT    NOT NULL,
  model         TEXT    NOT NULL,
  prompt_sha    TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN
                  ('STARTED','OK','FAILED','NOT_CONFIGURED','REFUSED','BUDGET','TIMEOUT')),
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  usd           REAL    NOT NULL DEFAULT 0,
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TEXT    NOT NULL,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_runs_task ON runs(task_id);

-- LAW 2 — a world cannot silently mix simulated and live production.
DROP TRIGGER IF EXISTS law_mode_purity;
CREATE TRIGGER law_mode_purity BEFORE INSERT ON runs
WHEN (SELECT json_extract(value,'$') FROM world_meta WHERE key='mode') = 'simulation'
     AND NEW.source = 'model'
     AND NEW.status NOT IN ('NOT_CONFIGURED','REFUSED','FAILED','TIMEOUT','BUDGET')
BEGIN
  SELECT RAISE(ABORT, 'LAW 2: a model run cannot enter a world founded as simulation');
END;
DROP TRIGGER IF EXISTS law_mode_purity_live;
CREATE TRIGGER law_mode_purity_live BEFORE INSERT ON runs
WHEN (SELECT json_extract(value,'$') FROM world_meta WHERE key='mode') = 'live'
     AND NEW.source IN ('mock','lexicon')
     AND NEW.status NOT IN ('NOT_CONFIGURED','REFUSED','FAILED','TIMEOUT','BUDGET')
BEGIN
  SELECT RAISE(ABORT, 'LAW 2: a simulated run cannot enter a world founded as live');
END;

-- ─────────────────────────────────────────────────────────────────────
-- PRINCIPALS — an agent as a security principal, not a character.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS principals (
  id               TEXT PRIMARY KEY,           -- AGT-000001
  name             TEXT NOT NULL,
  role             TEXT NOT NULL,
  division         TEXT NOT NULL,
  department       TEXT NOT NULL,
  tier             TEXT NOT NULL CHECK (tier IN ('reader','actor','judge','owner_plane')),
  mission          TEXT NOT NULL,
  autonomy_level   INTEGER NOT NULL DEFAULT 0 CHECK (autonomy_level BETWEEN 0 AND 5),
  status           TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN
                     ('CREATED','TRAINING','AVAILABLE','ASSIGNED','WORKING','WAITING',
                      'BLOCKED','ESCALATED','UNDER_REVIEW','SUSPENDED','RETIRED')),
  reports_to       TEXT REFERENCES principals(id),
  tools            TEXT NOT NULL DEFAULT '[]',
  permissions      TEXT NOT NULL DEFAULT '[]',
  memory_scope     TEXT NOT NULL DEFAULT '[]',
  success_metrics  TEXT NOT NULL DEFAULT '[]',
  escalation_rules TEXT NOT NULL DEFAULT '[]',
  model_tier       TEXT NOT NULL DEFAULT 'cheap',
  created_at       TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1
);
-- F4 made impossible: two agents may not be identical where it matters.
CREATE UNIQUE INDEX IF NOT EXISTS law_distinctness
  ON principals(tools, permissions, memory_scope, success_metrics, escalation_rules);

-- LAW: anything that reads untrusted input is capped at autonomy 2, forever.
DROP TRIGGER IF EXISTS law_split_brain_insert;
CREATE TRIGGER law_split_brain_insert BEFORE INSERT ON principals
WHEN NEW.tier = 'reader' AND NEW.autonomy_level > 2
BEGIN SELECT RAISE(ABORT, 'LAW 3: a reader may never exceed autonomy level 2'); END;
DROP TRIGGER IF EXISTS law_split_brain_update;
CREATE TRIGGER law_split_brain_update BEFORE UPDATE ON principals
WHEN NEW.tier = 'reader' AND NEW.autonomy_level > 2
BEGIN SELECT RAISE(ABORT, 'LAW 3: a reader may never exceed autonomy level 2'); END;

-- ─────────────────────────────────────────────────────────────────────
-- ORGANISATION
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  mission    TEXT NOT NULL,
  stage      TEXT NOT NULL DEFAULT 'DISCOVERY' CHECK (stage IN
               ('DISCOVERY','RESEARCH','VALIDATION','PROTOTYPE','MVP','TESTING',
                'LAUNCH','OPERATING','GROWING','PIVOT','PAUSED','KILLED','COMPLETED')),
  hypothesis TEXT NOT NULL DEFAULT '',
  origin     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  usd_spent  REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS teams (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name       TEXT NOT NULL,
  purpose    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id      INTEGER NOT NULL REFERENCES teams(id),
  principal_id TEXT    NOT NULL REFERENCES principals(id),
  seat         TEXT    NOT NULL,   -- why this agent was chosen
  PRIMARY KEY (team_id, principal_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- TASKS & LEASES — execution is bounded or it does not happen.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY,
  project_id     INTEGER REFERENCES projects(id),
  parent_id      INTEGER REFERENCES tasks(id),
  objective      TEXT NOT NULL,
  kind           TEXT NOT NULL,
  required_caps  TEXT NOT NULL DEFAULT '[]',
  priority       INTEGER NOT NULL DEFAULT 5,
  -- Two vocabularies, deliberately. QUEUED/LEASED/DONE is the runtime's own
  -- claim-and-release cycle and is untouched. The rest is the AGENT WORLD
  -- lifecycle: a task is DISCOVERED before anyone agrees it matters, APPROVED
  -- before anyone works on it, and REVIEWED before anyone calls it done.
  -- Widening this CHECK is what `_widen_check` exists for; no row moves.
  status         TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN
                   ('QUEUED','LEASED','DONE','FAILED','BLOCKED','CANCELLED',
                    'DISCOVERED','PROPOSED','APPROVED','ASSIGNED','RUNNING',
                    'COMPLETED','REVIEW','ACCEPTED','REJECTED','ARCHIVED')),
  evidence_required INTEGER NOT NULL DEFAULT 1,
  token_budget   INTEGER NOT NULL DEFAULT 20000,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  result         TEXT
);
CREATE INDEX IF NOT EXISTS ix_tasks_queue ON tasks(status, priority DESC, id);

CREATE TABLE IF NOT EXISTS leases (
  id           INTEGER PRIMARY KEY,
  task_id      INTEGER NOT NULL REFERENCES tasks(id),
  principal_id TEXT    NOT NULL REFERENCES principals(id),
  granted_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  token_budget INTEGER NOT NULL,
  caps         TEXT    NOT NULL DEFAULT '[]',
  status       TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN
                 ('ACTIVE','RELEASED','EXPIRED','REVOKED'))
);
CREATE INDEX IF NOT EXISTS ix_leases_active ON leases(status, expires_at);

-- ─────────────────────────────────────────────────────────────────────
-- TOOL GATEWAY — the only holder of credentials. Agents get handles.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tool_calls (
  id           INTEGER PRIMARY KEY,
  lease_id     INTEGER REFERENCES leases(id),
  principal_id TEXT    NOT NULL REFERENCES principals(id),
  tool         TEXT    NOT NULL,
  cap          TEXT    NOT NULL,
  args_sha     TEXT    NOT NULL,
  -- ERROR: the gateway AUTHORISED the call and the bound tool then raised.
  -- Without it such a call left no row at all, so a gateway interaction could
  -- happen with no audit record — and an execution-graph step that pointed at
  -- "the last tool_call" would silently claim a DIFFERENT step's row.
  decision     TEXT    NOT NULL CHECK (decision IN ('ALLOW','DENY','ERROR','PAUSED','NO_LEASE')),
  reason       TEXT,
  result_sha   TEXT,
  at           TEXT    NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────
-- ARTIFACTS — LAW 1: nothing generated exists without a recorded run.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER REFERENCES projects(id),
  task_id      INTEGER REFERENCES tasks(id),
  run_id       INTEGER NOT NULL REFERENCES runs(id),   -- ← the law
  principal_id TEXT    NOT NULL REFERENCES principals(id),
  kind         TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  path         TEXT,
  body         TEXT,
  sha          TEXT    NOT NULL,
  source       TEXT    NOT NULL CHECK (source IN ('model','mock','lexicon','human')),
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL
);
-- The artifact's source must equal the source of the run that made it.
DROP TRIGGER IF EXISTS law_provenance_matches;
CREATE TRIGGER law_provenance_matches BEFORE INSERT ON artifacts
WHEN NEW.source <> (SELECT source FROM runs WHERE id = NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'LAW 1: artifact source must match its run source'); END;

-- ─────────────────────────────────────────────────────────────────────
-- CLAIMS & EVIDENCE — LAW 4: no fact without external provenance.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evidence (
  id                  INTEGER PRIMARY KEY,
  kind                TEXT NOT NULL,   -- test_run | http | db_query | human | tool
  external_provenance TEXT NOT NULL,   -- URL, command, query — outside this system
  detail              TEXT NOT NULL,
  content_sha         TEXT NOT NULL,
  collected_by        TEXT NOT NULL REFERENCES principals(id),
  collected_at        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER REFERENCES projects(id),
  task_id      INTEGER REFERENCES tasks(id),
  principal_id TEXT    NOT NULL REFERENCES principals(id),
  text         TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN
                 ('OPINION','ASSUMPTION','HYPOTHESIS','OBSERVATION','DECISION','RESULT','FACT')),
  evidence_id  INTEGER REFERENCES evidence(id),
  created_at   TEXT    NOT NULL
);
DROP TRIGGER IF EXISTS law_no_unbacked_fact_insert;
CREATE TRIGGER law_no_unbacked_fact_insert BEFORE INSERT ON claims
WHEN NEW.status IN ('FACT','RESULT')
 AND NOT EXISTS (SELECT 1 FROM evidence WHERE id = NEW.evidence_id)
BEGIN SELECT RAISE(ABORT, 'LAW 4: FACT/RESULT requires an evidence row'); END;
DROP TRIGGER IF EXISTS law_no_unbacked_fact_update;
CREATE TRIGGER law_no_unbacked_fact_update BEFORE UPDATE ON claims
WHEN NEW.status IN ('FACT','RESULT')
 AND NOT EXISTS (SELECT 1 FROM evidence WHERE id = NEW.evidence_id)
BEGIN SELECT RAISE(ABORT, 'LAW 4: FACT/RESULT requires an evidence row'); END;

-- ─────────────────────────────────────────────────────────────────────
-- REVIEW — the builder is never the only judge.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id           INTEGER PRIMARY KEY,
  artifact_id  INTEGER NOT NULL REFERENCES artifacts(id),
  reviewer_id  TEXT    NOT NULL REFERENCES principals(id),
  domain       TEXT    NOT NULL,
  verdict      TEXT    NOT NULL CHECK (verdict IN
                 ('APPROVE','REQUEST_CHANGES','REJECT','ESCALATE','NEED_EVIDENCE')),
  rationale    TEXT    NOT NULL,
  evidence_id  INTEGER REFERENCES evidence(id),
  run_id       INTEGER REFERENCES runs(id),
  created_at   TEXT    NOT NULL
);
-- A reviewer may not review their own artifact.
DROP TRIGGER IF EXISTS law_independent_review;
CREATE TRIGGER law_independent_review BEFORE INSERT ON reviews
WHEN NEW.reviewer_id = (SELECT principal_id FROM artifacts WHERE id = NEW.artifact_id)
BEGIN SELECT RAISE(ABORT, 'LAW 5: an agent may not review its own artifact'); END;

-- ─────────────────────────────────────────────────────────────────────
-- EVENTS — LAW 6: history is append-only and tamper-evident.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  kind       TEXT NOT NULL,
  actor      TEXT,
  subject    TEXT,
  payload    TEXT NOT NULL DEFAULT '{}',
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_kind ON events(kind, id DESC);
DROP TRIGGER IF EXISTS law_events_no_delete;
CREATE TRIGGER law_events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'LAW 6: history is append-only'); END;
DROP TRIGGER IF EXISTS law_events_no_update;
CREATE TRIGGER law_events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'LAW 6: history is append-only'); END;

-- ─────────────────────────────────────────────────────────────────────
-- OWNER SURFACE
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signals (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  priority    TEXT NOT NULL CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  headline    TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  event_id    INTEGER REFERENCES events(id),
  project_id  INTEGER REFERENCES projects(id),
  artifact_id INTEGER REFERENCES artifacts(id),
  seen        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS approvals (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  question   TEXT NOT NULL,
  why        TEXT NOT NULL,
  options    TEXT NOT NULL DEFAULT '[]',
  evidence_id INTEGER REFERENCES evidence(id),
  project_id INTEGER REFERENCES projects(id),
  decision   TEXT CHECK (decision IN ('APPROVE','REJECT','NEED_EVIDENCE','PAUSE','REDIRECT')),
  decided_at TEXT
);
