-- BENCHMARK. Answers one question: does the organisation beat one strong agent?
-- It is built to be able to say NO, and to say "not enough runs to tell".

CREATE TABLE IF NOT EXISTS bench_tasks (
  id            TEXT PRIMARY KEY,          -- T01-exact-output
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  domain        TEXT NOT NULL,
  difficulty    TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  fixture       TEXT NOT NULL DEFAULT '{}',
  fixture_sha   TEXT NOT NULL,
  expected      TEXT NOT NULL DEFAULT '{}', -- machine-checkable properties
  allowed_tools TEXT NOT NULL DEFAULT '[]', -- IDENTICAL for both conditions
  max_usd       REAL NOT NULL DEFAULT 0.25,
  max_seconds   INTEGER NOT NULL DEFAULT 180,
  seed          INTEGER,
  favours       TEXT NOT NULL DEFAULT 'neutral'
                CHECK (favours IN ('neutral','single_plausible','multi_plausible')),
  rationale     TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bench_campaigns (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  git_commit    TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  config_sha    TEXT NOT NULL,
  repeats       INTEGER NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  conclusion    TEXT CHECK (conclusion IN
                  ('MULTI_AGENT_ADVANTAGE_SUPPORTED','SINGLE_AGENT_ADVANTAGE_SUPPORTED',
                   'NO_MEANINGFUL_DIFFERENCE_DETECTED','INSUFFICIENT_EVIDENCE')),
  conclusion_why TEXT
);

-- One attempt. EVERY attempt is written, including failures, before it is judged.
CREATE TABLE IF NOT EXISTS bench_runs (
  id            INTEGER PRIMARY KEY,
  campaign_id   INTEGER NOT NULL REFERENCES bench_campaigns(id),
  task_id       TEXT NOT NULL REFERENCES bench_tasks(id),
  condition     TEXT NOT NULL CHECK (condition IN ('SINGLE','MULTI')),
  repeat_index  INTEGER NOT NULL,
  order_index   INTEGER NOT NULL,          -- randomised, to blunt ordering effects
  status        TEXT NOT NULL DEFAULT 'STARTED' CHECK (status IN
                  ('STARTED','COMPLETE','FAILED','NOT_CONFIGURED','BUDGET','TIMEOUT')),
  input_sha     TEXT NOT NULL,
  prompt_sha    TEXT,
  output        TEXT,
  output_sha    TEXT,
  artifact_id   INTEGER REFERENCES artifacts(id),
  model_runs    TEXT NOT NULL DEFAULT '[]', -- run ids, the provenance chain
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  tool_denials  INTEGER NOT NULL DEFAULT 0,
  agents_used   TEXT NOT NULL DEFAULT '[]',
  exec_graph    TEXT NOT NULL DEFAULT '[]', -- the complete execution graph
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  usd           REAL NOT NULL DEFAULT 0,
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  retries       INTEGER NOT NULL DEFAULT 0,
  human_interventions INTEGER NOT NULL DEFAULT 0,
  failure_class TEXT,
  failure_note  TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  UNIQUE (campaign_id, task_id, condition, repeat_index)
);
CREATE INDEX IF NOT EXISTS ix_bench_runs ON bench_runs(campaign_id, task_id, condition);

-- The evaluator never learns which condition produced what.
CREATE TABLE IF NOT EXISTS bench_evaluations (
  id            INTEGER PRIMARY KEY,
  bench_run_id  INTEGER NOT NULL UNIQUE REFERENCES bench_runs(id),
  blind_token   TEXT NOT NULL,             -- what the evaluator sees instead of a label
  method        TEXT NOT NULL CHECK (method IN ('OBJECTIVE','MODEL_JUDGED','NONE')),
  correctness   REAL, completeness REAL, evidence_quality REAL,
  unsupported_claims INTEGER NOT NULL DEFAULT 0,
  contradictions     INTEGER NOT NULL DEFAULT 0,
  useful_artifacts   INTEGER NOT NULL DEFAULT 0,
  detail        TEXT NOT NULL DEFAULT '{}',
  evaluator     TEXT NOT NULL,
  evaluated_at  TEXT NOT NULL
);

-- An evaluation may not be authored by anyone who produced the run.
CREATE TRIGGER IF NOT EXISTS law_evaluator_isolation BEFORE INSERT ON bench_evaluations
WHEN EXISTS (SELECT 1 FROM bench_runs r WHERE r.id = NEW.bench_run_id
             AND r.agents_used LIKE '%' || NEW.evaluator || '%')
BEGIN SELECT RAISE(ABORT, 'LAW 10: the evaluator may not have produced the run'); END;

-- Both conditions must be offered exactly the same surface.
CREATE TABLE IF NOT EXISTS bench_fairness (
  campaign_id   INTEGER NOT NULL REFERENCES bench_campaigns(id),
  task_id       TEXT NOT NULL REFERENCES bench_tasks(id),
  single_tools_sha TEXT NOT NULL,
  multi_tools_sha  TEXT NOT NULL,
  single_input_sha TEXT NOT NULL,
  multi_input_sha  TEXT NOT NULL,
  single_budget    REAL NOT NULL,
  multi_budget     REAL NOT NULL,
  fair          INTEGER NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (campaign_id, task_id)
);
-- A campaign cannot record an unfair pairing and then be read as a comparison.
CREATE TRIGGER IF NOT EXISTS law_fair_comparison BEFORE INSERT ON bench_fairness
WHEN NEW.single_tools_sha <> NEW.multi_tools_sha
  OR NEW.single_input_sha <> NEW.multi_input_sha
  OR NEW.single_budget <> NEW.multi_budget
BEGIN SELECT RAISE(ABORT,
  'LAW 11: the two conditions were not offered the same tools, input and budget'); END;

-- ── LAW 12: a closed campaign is history ────────────────────────────────
-- Recalibration exists because the harness was wrong. The temptation it
-- creates is to re-score the campaigns that exposed the fault. A fixed
-- evaluator applied backwards would produce numbers no model ever earned.
-- Campaigns #1 and #2 stand as run, defects and all.
DROP TRIGGER IF EXISTS law_closed_campaign_is_history;
CREATE TRIGGER law_closed_campaign_is_history BEFORE UPDATE ON bench_campaigns
WHEN OLD.finished_at IS NOT NULL AND OLD.finished_at <> ''
BEGIN SELECT RAISE(ABORT,
  'LAW 12: a closed campaign cannot be rewritten; run a new campaign instead'); END;

DROP TRIGGER IF EXISTS law_closed_campaign_runs_are_history;
CREATE TRIGGER law_closed_campaign_runs_are_history BEFORE UPDATE ON bench_runs
WHEN EXISTS (SELECT 1 FROM bench_campaigns c WHERE c.id = OLD.campaign_id
             AND c.finished_at IS NOT NULL AND c.finished_at <> '')
BEGIN SELECT RAISE(ABORT,
  'LAW 12: a run inside a closed campaign cannot be rewritten'); END;

DROP TRIGGER IF EXISTS law_closed_campaign_evals_are_history;
CREATE TRIGGER law_closed_campaign_evals_are_history BEFORE UPDATE ON bench_evaluations
WHEN EXISTS (SELECT 1 FROM bench_runs r JOIN bench_campaigns c ON c.id = r.campaign_id
             WHERE r.id = OLD.bench_run_id
             AND c.finished_at IS NOT NULL AND c.finished_at <> '')
BEGIN SELECT RAISE(ABORT,
  'LAW 12: an evaluation inside a closed campaign cannot be re-scored'); END;

DROP TRIGGER IF EXISTS law_closed_campaign_no_delete;
CREATE TRIGGER law_closed_campaign_no_delete BEFORE DELETE ON bench_campaigns
WHEN OLD.finished_at IS NOT NULL AND OLD.finished_at <> ''
BEGIN SELECT RAISE(ABORT, 'LAW 12: a closed campaign cannot be deleted'); END;
