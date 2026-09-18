-- ALWAYS-ON AGENT WORLD — the tables that let the world continue without the
-- Owner issuing each next step.
--
-- Everything here is CONTROL PLANE. No model writes a row in this file, and no
-- model decides anything it records. The laws at the bottom are the ones that
-- have to hold even when nobody is watching, which is the entire point: an
-- autonomous world's safety cannot depend on someone being awake to check it.

-- ── THE QUEUE ────────────────────────────────────────────────────────
-- Agents do not run continuously. An event puts work here, a worker claims it
-- under a lease, and the agent wakes for exactly that work. Five persistent
-- identities, never five permanent processes.
CREATE TABLE IF NOT EXISTS world_queue (
  id           INTEGER PRIMARY KEY,
  at           TEXT NOT NULL,
  kind         TEXT NOT NULL,
  subject      TEXT,
  payload      TEXT NOT NULL DEFAULT '{}',
  -- The same event delivered twice is one piece of work. Idempotency is a
  -- UNIQUE constraint rather than a convention, because "we check for
  -- duplicates" is exactly the kind of check that stops being true at 3am.
  dedupe_key   TEXT NOT NULL UNIQUE,
  priority     INTEGER NOT NULL DEFAULT 5,
  state        TEXT NOT NULL DEFAULT 'READY' CHECK (state IN
                 ('READY','CLAIMED','DONE','FAILED','DEFERRED','DROPPED')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT NOT NULL,
  worker       TEXT,
  claimed_at   TEXT,
  finished_at  TEXT,
  result       TEXT,
  chain_id     INTEGER REFERENCES chains(id),
  depth        INTEGER NOT NULL DEFAULT 0,
  emitted_by   TEXT NOT NULL DEFAULT 'OWNER_PLANE',
  event_id     INTEGER REFERENCES events(id)
);
CREATE INDEX IF NOT EXISTS ix_queue_ready ON world_queue(state, priority DESC, id);
CREATE INDEX IF NOT EXISTS ix_queue_chain ON world_queue(chain_id);

-- ── AUTONOMOUS CHAINS ────────────────────────────────────────────────
-- One Owner objective may set off a cascade. A chain is that cascade, with its
-- ceilings declared at the start. A chain that hits a ceiling STOPS and says so;
-- it never quietly keeps going.
CREATE TABLE IF NOT EXISTS chains (
  id             INTEGER PRIMARY KEY,
  at             TEXT NOT NULL,
  origin         TEXT NOT NULL,
  objective      TEXT NOT NULL DEFAULT '',
  max_depth      INTEGER NOT NULL DEFAULT 40,
  max_events     INTEGER NOT NULL DEFAULT 200,
  max_tasks      INTEGER NOT NULL DEFAULT 24,
  max_usd        REAL    NOT NULL DEFAULT 1.0,
  max_seconds    INTEGER NOT NULL DEFAULT 900,
  depth_reached  INTEGER NOT NULL DEFAULT 0,
  events_emitted INTEGER NOT NULL DEFAULT 0,
  tasks_created  INTEGER NOT NULL DEFAULT 0,
  usd_spent      REAL    NOT NULL DEFAULT 0,
  state          TEXT NOT NULL DEFAULT 'RUNNING' CHECK (state IN
                   ('RUNNING','QUIET','HALTED','ESCALATED')),
  stop_reason    TEXT NOT NULL DEFAULT '',
  finished_at    TEXT
);

-- ── OWNER POLICY ─────────────────────────────────────────────────────
-- Three classes, no fourth, and no shades between them. A policy row is a
-- decision the Owner already made, written down where code can read it at 3am.
CREATE TABLE IF NOT EXISTS policies (
  action        TEXT PRIMARY KEY,
  klass         TEXT NOT NULL CHECK (klass IN
                  ('AUTO_ALLOWED','APPROVAL_REQUIRED','FORBIDDEN')),
  threshold_usd REAL,                 -- NULL = the class applies unconditionally
  why           TEXT NOT NULL DEFAULT '',
  set_by        TEXT NOT NULL,
  at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_decisions (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  klass      TEXT NOT NULL,
  usd        REAL NOT NULL DEFAULT 0,
  allowed    INTEGER NOT NULL,
  why        TEXT NOT NULL DEFAULT '',
  subject    TEXT,
  chain_id   INTEGER REFERENCES chains(id)
);
CREATE INDEX IF NOT EXISTS ix_polidec_action ON policy_decisions(action, id DESC);

-- ── BUDGETS ──────────────────────────────────────────────────────────
-- A scope with no budget row cannot spend. Absence is not permission.
CREATE TABLE IF NOT EXISTS budgets (
  scope        TEXT NOT NULL CHECK (scope IN ('world','day','project','agent','task','chain')),
  scope_id     TEXT NOT NULL,
  limit_usd    REAL NOT NULL,
  spent_usd    REAL NOT NULL DEFAULT 0,
  limit_tokens INTEGER NOT NULL DEFAULT 0,
  spent_tokens INTEGER NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','EXHAUSTED','FROZEN')),
  at           TEXT NOT NULL,
  PRIMARY KEY (scope, scope_id)
);

-- ── TASK DEPENDENCIES ────────────────────────────────────────────────
-- A real edge, not a naming convention. Research before specification, build
-- before test, test before review, because the graph says so.
CREATE TABLE IF NOT EXISTS task_deps (
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  depends_on INTEGER NOT NULL REFERENCES tasks(id),
  kind       TEXT NOT NULL DEFAULT 'finish_to_start',
  at         TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on)
);
CREATE INDEX IF NOT EXISTS ix_deps_on ON task_deps(depends_on);

-- ── ORGANISATIONAL LEARNING ──────────────────────────────────────────
-- A failure produces a CANDIDATE lesson. It becomes organisational truth only
-- through the owner plane, and only with evidence. One agent's unsupported
-- conclusion is not what the organisation knows.
CREATE TABLE IF NOT EXISTS lessons (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  text        TEXT NOT NULL,
  subject_kind TEXT NOT NULL DEFAULT 'project',
  subject_id  TEXT NOT NULL DEFAULT '',
  project_id  INTEGER REFERENCES projects(id),
  task_id     INTEGER REFERENCES tasks(id),
  failure_id  INTEGER REFERENCES failures(id),
  evidence_id INTEGER REFERENCES evidence(id),
  proposed_by TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (state IN
                ('CANDIDATE','PROMOTED','REJECTED','SUPERSEDED')),
  promoted_by TEXT,
  promoted_at TEXT,
  memory_id   INTEGER REFERENCES memories(id),
  applied     INTEGER NOT NULL DEFAULT 0
);

-- ── OWNER PRESENCE ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS owner_presence (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL,
  state   TEXT NOT NULL CHECK (state IN ('PRESENT','AWAY')),
  note    TEXT NOT NULL DEFAULT '',
  until   TEXT
);

-- ── HEARTBEAT ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS heartbeats (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  reason     TEXT NOT NULL,
  queued     INTEGER NOT NULL DEFAULT 0,
  in_flight  INTEGER NOT NULL DEFAULT 0,
  reaped     INTEGER NOT NULL DEFAULT 0,
  unblocked  INTEGER NOT NULL DEFAULT 0,
  escalated  INTEGER NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT ''
);

-- ═════════════════════════════════════════════════════════════════════
-- THE LAWS THAT HAVE TO HOLD WHILE NOBODY IS WATCHING
-- ═════════════════════════════════════════════════════════════════════

-- LAW 20 — a claimed queue entry is claimed by exactly one worker.
DROP TRIGGER IF EXISTS law_one_claim_per_entry;
CREATE TRIGGER law_one_claim_per_entry BEFORE UPDATE ON world_queue
WHEN OLD.state = 'CLAIMED' AND NEW.state = 'CLAIMED'
     AND IFNULL(NEW.worker,'') <> IFNULL(OLD.worker,'')
BEGIN SELECT RAISE(ABORT, 'LAW 20: a queue entry is claimed once'); END;

-- LAW 21 — the queue is append-only. A delivered event cannot be erased, so a
-- world cannot tidy away the work it decided not to do.
DROP TRIGGER IF EXISTS law_queue_no_delete;
CREATE TRIGGER law_queue_no_delete BEFORE DELETE ON world_queue
BEGIN SELECT RAISE(ABORT, 'LAW 21: the queue is append-only'); END;

-- LAW 22 — an autonomous chain may not exceed the ceilings it declared.
DROP TRIGGER IF EXISTS law_chain_ceilings;
CREATE TRIGGER law_chain_ceilings BEFORE UPDATE ON chains
WHEN NEW.state = 'RUNNING' AND (
       NEW.depth_reached  > NEW.max_depth
    OR NEW.events_emitted > NEW.max_events
    OR NEW.tasks_created  > NEW.max_tasks
    OR NEW.usd_spent      > NEW.max_usd)
BEGIN SELECT RAISE(ABORT, 'LAW 22: an autonomous chain cannot pass its ceiling'); END;

-- LAW 23 — spending past a budget is refused, not logged and continued.
DROP TRIGGER IF EXISTS law_budget_not_exceeded;
CREATE TRIGGER law_budget_not_exceeded BEFORE UPDATE ON budgets
WHEN NEW.spent_usd > NEW.limit_usd + 1e-9
BEGIN SELECT RAISE(ABORT, 'LAW 23: a budget cannot be exceeded'); END;

-- LAW 24 — only the owner plane writes policy. An agent that could edit the
-- policy table would be an agent that grants itself authority.
DROP TRIGGER IF EXISTS law_policy_is_owners_insert;
CREATE TRIGGER law_policy_is_owners_insert BEFORE INSERT ON policies
WHEN NEW.set_by <> 'OWNER_PLANE'
BEGIN SELECT RAISE(ABORT, 'LAW 24: only the owner plane sets policy'); END;
DROP TRIGGER IF EXISTS law_policy_is_owners_update;
CREATE TRIGGER law_policy_is_owners_update BEFORE UPDATE ON policies
WHEN NEW.set_by <> 'OWNER_PLANE'
BEGIN SELECT RAISE(ABORT, 'LAW 24: only the owner plane sets policy'); END;

-- LAW 25 — a task may not run while a dependency of it is unfinished.
DROP TRIGGER IF EXISTS law_dependencies_first;
CREATE TRIGGER law_dependencies_first BEFORE UPDATE ON tasks
WHEN NEW.status = 'RUNNING' AND OLD.status <> 'RUNNING'
     AND EXISTS (SELECT 1 FROM task_deps d JOIN tasks t ON t.id = d.depends_on
                 WHERE d.task_id = NEW.id AND t.status <> 'ACCEPTED')
BEGIN SELECT RAISE(ABORT, 'LAW 25: a dependency is not satisfied'); END;

-- LAW 26 — a lesson becomes organisational truth only through the owner plane,
-- and only with evidence under it.
DROP TRIGGER IF EXISTS law_lesson_promotion;
CREATE TRIGGER law_lesson_promotion BEFORE UPDATE ON lessons
WHEN NEW.state = 'PROMOTED'
     AND (IFNULL(NEW.promoted_by,'') <> 'OWNER_PLANE' OR NEW.evidence_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'LAW 26: a promoted lesson needs the owner plane and evidence'); END;

-- LAW 27 — an opportunity becomes a project only out of APPROVED.
DROP TRIGGER IF EXISTS law_project_follows_approval;
CREATE TRIGGER law_project_follows_approval BEFORE UPDATE ON opportunities
WHEN NEW.status = 'PROJECT' AND OLD.status <> 'APPROVED'
BEGIN SELECT RAISE(ABORT, 'LAW 27: an opportunity becomes a project only from APPROVED'); END;
