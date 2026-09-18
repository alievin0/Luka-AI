-- ORGANIZATIONAL LAYER. Sits on the frozen runtime; changes no existing law.
-- Runtime state (principals.status) and organizational state
-- (principals.lifecycle_state) are two different axes and never merged.

-- ── the five concepts, kept separate on purpose ──────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id            TEXT PRIMARY KEY,            -- SKL-market-analysis
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  prerequisites TEXT NOT NULL DEFAULT '[]',
  training_ref  TEXT NOT NULL DEFAULT '',
  tests         TEXT NOT NULL DEFAULT '[]',  -- benchmark task ids
  eval_method   TEXT NOT NULL DEFAULT 'benchmark',
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skills (
  principal_id TEXT NOT NULL REFERENCES principals(id),
  skill_id     TEXT NOT NULL REFERENCES skills(id),
  proficiency  REAL NOT NULL DEFAULT 0 CHECK (proficiency BETWEEN 0 AND 1),
  acquired_at  TEXT NOT NULL,
  evaluated_at TEXT,
  eval_score   REAL,                          -- NULL = never evaluated
  eval_run_id  INTEGER REFERENCES runs(id),
  PRIMARY KEY (principal_id, skill_id)
);
-- A skill is not held until it has been evaluated. Prompt changes are not skill.
CREATE TRIGGER IF NOT EXISTS law_skill_needs_evaluation BEFORE UPDATE ON agent_skills
WHEN NEW.proficiency > 0.0 AND NEW.eval_score IS NULL
BEGIN SELECT RAISE(ABORT, 'LAW 7: proficiency requires an evaluation score'); END;

CREATE TABLE IF NOT EXISTS capabilities (
  id          TEXT PRIMARY KEY,               -- CAP-research_market
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  needs_skills TEXT NOT NULL DEFAULT '[]',
  needs_tools  TEXT NOT NULL DEFAULT '[]',
  needs_perms  TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  principal_id  TEXT NOT NULL REFERENCES principals(id),
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  PRIMARY KEY (principal_id, capability_id)
);

-- ── permission grants: deterministic, owner-authorised, never self-issued ──
CREATE TABLE IF NOT EXISTS permission_grants (
  id         INTEGER PRIMARY KEY,
  subject    TEXT NOT NULL REFERENCES principals(id),
  capability TEXT NOT NULL,
  resource   TEXT NOT NULL DEFAULT '*',
  scope      TEXT NOT NULL DEFAULT '{}',
  action     TEXT NOT NULL DEFAULT 'use',
  granted_by TEXT NOT NULL,                   -- must be OWNER or OWNER_PLANE
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT
);
-- Only the owner plane may author a grant. No agent, no model, no prompt.
CREATE TRIGGER IF NOT EXISTS law_only_owner_grants BEFORE INSERT ON permission_grants
WHEN NEW.granted_by NOT IN ('OWNER', 'OWNER_PLANE')
BEGIN SELECT RAISE(ABORT, 'LAW 8: only the owner plane may grant a permission'); END;

-- ── agent contract versions + provenance ─────────────────────────────
CREATE TABLE IF NOT EXISTS agent_versions (
  id           INTEGER PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(id),
  version      INTEGER NOT NULL,
  contract     TEXT NOT NULL,                 -- the full machine-readable contract
  contract_sha TEXT NOT NULL,
  reason       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (principal_id, version)
);

CREATE TABLE IF NOT EXISTS agent_lineage (
  principal_id    TEXT PRIMARY KEY REFERENCES principals(id),
  why_created     TEXT NOT NULL,
  capability_gap  TEXT NOT NULL,
  expected_value  TEXT NOT NULL DEFAULT '',
  creator         TEXT NOT NULL,
  factory_job_id  INTEGER,
  required_skills TEXT NOT NULL DEFAULT '[]',
  required_tools  TEXT NOT NULL DEFAULT '[]',
  permissions     TEXT NOT NULL DEFAULT '[]',
  success_metrics TEXT NOT NULL DEFAULT '[]',
  eval_results    TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS factory_jobs (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('AGENT','SKILL','PROJECT')),
  requested_by  TEXT NOT NULL,
  gap           TEXT NOT NULL,
  analysis      TEXT NOT NULL DEFAULT '{}',
  decision      TEXT CHECK (decision IN
                  ('NEW_AGENT','SKILL','WORKFLOW','TOOL','REUSE','REJECT','CREATED')),
  rationale     TEXT NOT NULL DEFAULT '',
  produced_id   TEXT,
  security_ok   INTEGER,
  eval_ok       INTEGER,
  created_at    TEXT NOT NULL,
  decided_at    TEXT
);

-- ── discovery → idea → opportunity → project ─────────────────────────
CREATE TABLE IF NOT EXISTS discoveries (
  id             INTEGER PRIMARY KEY,
  observation    TEXT NOT NULL,               -- what was seen
  interpretation TEXT NOT NULL DEFAULT '',    -- what an agent thinks it means
  confidence     REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  source_agents  TEXT NOT NULL DEFAULT '[]',
  source_projects TEXT NOT NULL DEFAULT '[]',
  evidence_id    INTEGER REFERENCES evidence(id),
  run_id         INTEGER REFERENCES runs(id),
  source         TEXT NOT NULL CHECK (source IN ('model','mock','lexicon','human')),
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ideas (
  id              INTEGER PRIMARY KEY,
  problem         TEXT NOT NULL,
  target_user     TEXT NOT NULL DEFAULT '',
  solution        TEXT NOT NULL DEFAULT '',
  origin_type     TEXT NOT NULL DEFAULT 'AGENT',
  origin_id       TEXT,
  creator_agents  TEXT NOT NULL DEFAULT '[]',
  assumptions     TEXT NOT NULL DEFAULT '[]',
  market          TEXT NOT NULL DEFAULT '',
  competition     TEXT NOT NULL DEFAULT '',
  differentiation TEXT NOT NULL DEFAULT '',
  required_skills TEXT NOT NULL DEFAULT '[]',
  validation_plan TEXT NOT NULL DEFAULT '',
  evidence_id     INTEGER REFERENCES evidence(id),
  run_id          INTEGER REFERENCES runs(id),
  source          TEXT NOT NULL CHECK (source IN ('model','mock','lexicon','human')),
  status          TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN
                    ('NEW','RESEARCHING','VALIDATING','PROMISING','VALIDATED',
                     'PROJECT','BUSINESS','PARKED','REJECTED','KILLED')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id              INTEGER PRIMARY KEY,
  source          TEXT NOT NULL,
  problem         TEXT NOT NULL,
  market          TEXT NOT NULL DEFAULT '',
  potential_value TEXT NOT NULL DEFAULT '',
  risks           TEXT NOT NULL DEFAULT '[]',
  required_caps   TEXT NOT NULL DEFAULT '[]',
  validation_plan TEXT NOT NULL DEFAULT '',
  idea_id         INTEGER REFERENCES ideas(id),
  evidence_id     INTEGER REFERENCES evidence(id),
  status          TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN
                    ('NEW','RESEARCHING','VALIDATING','VALIDATED','PROJECT',
                     'REJECTED','KILLED','EVALUATING','APPROVED','ARCHIVED')),
  created_at      TEXT NOT NULL
);

-- ── experiments, failures, disagreement, signals ─────────────────────
CREATE TABLE IF NOT EXISTS experiments (
  id            INTEGER PRIMARY KEY,
  project_id    INTEGER REFERENCES projects(id),
  hypothesis    TEXT NOT NULL,
  why_it_matters TEXT NOT NULL DEFAULT '',
  method        TEXT NOT NULL,
  success_criteria TEXT NOT NULL,
  failure_criteria TEXT NOT NULL,
  inputs        TEXT NOT NULL DEFAULT '{}',
  agents        TEXT NOT NULL DEFAULT '[]',
  usd_budget    REAL NOT NULL DEFAULT 0,
  outputs       TEXT,
  result        TEXT CHECK (result IN ('VALIDATED','NOT_VALIDATED','INCONCLUSIVE')),
  evidence_id   INTEGER REFERENCES evidence(id),
  conclusion    TEXT,
  next_action   TEXT,
  status        TEXT NOT NULL DEFAULT 'DESIGNED' CHECK (status IN
                  ('DESIGNED','RUNNING','COMPLETE','ABANDONED')),
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);
-- A concluded experiment must point at evidence, like any RESULT claim.
CREATE TRIGGER IF NOT EXISTS law_experiment_needs_evidence BEFORE UPDATE ON experiments
WHEN NEW.status = 'COMPLETE' AND NEW.result IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM evidence WHERE id = NEW.evidence_id)
BEGIN SELECT RAISE(ABORT, 'LAW 9: a completed experiment requires evidence'); END;

CREATE TABLE IF NOT EXISTS failures (
  id            INTEGER PRIMARY KEY,
  subject_kind  TEXT NOT NULL,                -- project | experiment | idea | agent
  subject_id    TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  why           TEXT NOT NULL,
  failed_assumption TEXT NOT NULL DEFAULT '',
  agents        TEXT NOT NULL DEFAULT '[]',
  usd_cost      REAL NOT NULL DEFAULT 0,
  evidence_id   INTEGER REFERENCES evidence(id),
  lesson        TEXT NOT NULL,
  what_would_change TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disagreements (
  id          INTEGER PRIMARY KEY,
  subject_kind TEXT NOT NULL,
  subject_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
  id              INTEGER PRIMARY KEY,
  disagreement_id INTEGER NOT NULL REFERENCES disagreements(id),
  principal_id    TEXT NOT NULL REFERENCES principals(id),
  stance          TEXT NOT NULL,
  claim           TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  evidence_id     INTEGER REFERENCES evidence(id),
  missing_evidence TEXT NOT NULL DEFAULT '',
  resolving_experiment INTEGER REFERENCES experiments(id),
  created_at      TEXT NOT NULL,
  UNIQUE (disagreement_id, principal_id)
);

CREATE TABLE IF NOT EXISTS cross_project_signals (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,                  -- same_problem | same_tech | same_failure ...
  detail      TEXT NOT NULL,
  refs        TEXT NOT NULL DEFAULT '[]',
  strength    REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- what the owner has already seen
CREATE TABLE IF NOT EXISTS owner_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
