-- ─────────────────────────────────────────────────────────────────────
-- AGENT WORLD V0 — five persistent agents inside the existing runtime.
--
-- This file ADDS. It does not redefine principals, tasks, leases, artifacts,
-- evidence, claims, reviews, events, projects, teams, skills or capabilities:
-- those already exist and V0 uses them. What was missing is the connective
-- tissue — how a task really moves, how agents really talk, what an agent
-- really remembers, and how the owner sees any of it.
--
-- The laws here are triggers, like every other law in this system. A rule that
-- lives only in Python is a rule an agent can be talked out of.
-- ─────────────────────────────────────────────────────────────────────

-- ── TASK LIFECYCLE ───────────────────────────────────────────────────
-- Every transition, who caused it, and why. tasks.status is the CURRENT
-- state; this is how it got there, and it is append-only.
CREATE TABLE IF NOT EXISTS task_transitions (
  id          INTEGER PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  from_state  TEXT,
  to_state    TEXT    NOT NULL,
  actor       TEXT    NOT NULL,          -- principal id or OWNER_PLANE
  why         TEXT    NOT NULL DEFAULT '',
  event_id    INTEGER REFERENCES events(id),
  at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_task_transitions ON task_transitions(task_id, id);

DROP TRIGGER IF EXISTS law_transitions_no_update;
CREATE TRIGGER law_transitions_no_update BEFORE UPDATE ON task_transitions
BEGIN SELECT RAISE(ABORT, 'LAW 13: a recorded transition cannot be rewritten'); END;
DROP TRIGGER IF EXISTS law_transitions_no_delete;
CREATE TRIGGER law_transitions_no_delete BEFORE DELETE ON task_transitions
BEGIN SELECT RAISE(ABORT, 'LAW 13: a recorded transition cannot be deleted'); END;

-- ── COMPLETION CONDITIONS ────────────────────────────────────────────
-- What "done" means for THIS task, declared when the task is created and
-- therefore before anyone knows whether it will be met.
CREATE TABLE IF NOT EXISTS task_conditions (
  id           INTEGER PRIMARY KEY,
  task_id      INTEGER NOT NULL REFERENCES tasks(id),
  description  TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('artifact','evidence','review','claim')),
  satisfied    INTEGER NOT NULL DEFAULT 0,
  satisfied_by INTEGER,                  -- the row id that satisfied it
  satisfied_at TEXT,
  created_at   TEXT    NOT NULL,
  UNIQUE (task_id, description)
);

-- LAW 14 — NO FAKE COMPLETION.
-- A task reaches COMPLETED only when every declared condition is satisfied.
-- This is the whole reason conditions are declared up front: an agent that
-- says "done" and an agent that IS done must be distinguishable by the
-- database, not by tone of voice.
DROP TRIGGER IF EXISTS law_no_fake_completion;
CREATE TRIGGER law_no_fake_completion BEFORE UPDATE ON tasks
WHEN NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED'
 AND EXISTS (SELECT 1 FROM task_conditions
             WHERE task_id = NEW.id AND satisfied = 0)
BEGIN SELECT RAISE(ABORT,
  'LAW 14: a task cannot be COMPLETED while a declared condition is unsatisfied'); END;

-- LAW 14b — and only when its evidence requirement is actually met.
DROP TRIGGER IF EXISTS law_completion_needs_evidence;
CREATE TRIGGER law_completion_needs_evidence BEFORE UPDATE ON tasks
WHEN NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED'
 AND NEW.evidence_required > 0
 AND (SELECT COUNT(*) FROM task_conditions
      WHERE task_id = NEW.id AND kind = 'evidence' AND satisfied = 1)
     < NEW.evidence_required
BEGIN SELECT RAISE(ABORT,
  'LAW 14: a task cannot be COMPLETED with fewer evidence conditions met than it requires'); END;

-- LAW 15 — ACCEPTANCE IS NOT SELF-SERVICE.
-- A task moves to ACCEPTED only out of REVIEW, so nothing skips the reviewer.
DROP TRIGGER IF EXISTS law_acceptance_follows_review;
CREATE TRIGGER law_acceptance_follows_review BEFORE UPDATE ON tasks
WHEN NEW.status IN ('ACCEPTED','REJECTED') AND OLD.status <> 'REVIEW'
BEGIN SELECT RAISE(ABORT,
  'LAW 15: a task may only be ACCEPTED or REJECTED out of REVIEW'); END;

-- ── STRUCTURED COMMUNICATION ─────────────────────────────────────────
-- Agents talk in recorded messages, never by mutating each other's state.
-- Every message can be reconstructed: who said what, to whom, why, under
-- which task, on whose authority, based on which evidence.
CREATE TABLE IF NOT EXISTS agent_messages (
  id            INTEGER PRIMARY KEY,
  sender        TEXT    NOT NULL REFERENCES principals(id),
  recipient     TEXT    NOT NULL,        -- a principal id, or a role broadcast
  kind          TEXT    NOT NULL CHECK (kind IN
                  ('ASSIGN','REPORT','REQUEST','ANSWER','HANDOFF','REVIEW_REQUEST',
                   'REVIEW_RESULT','ESCALATE','BLOCKED','NOTIFY')),
  task_id       INTEGER REFERENCES tasks(id),
  project_id    INTEGER REFERENCES projects(id),
  payload       TEXT    NOT NULL DEFAULT '{}',
  evidence_id   INTEGER REFERENCES evidence(id),
  artifact_id   INTEGER REFERENCES artifacts(id),
  authority     TEXT    NOT NULL,        -- the grant or role the sender acted under
  lease_id      INTEGER REFERENCES leases(id),
  event_id      INTEGER REFERENCES events(id),
  idempotency_key TEXT UNIQUE,           -- a redelivered message is not a new one
  at            TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_messages_task ON agent_messages(task_id, id);
CREATE INDEX IF NOT EXISTS ix_messages_to ON agent_messages(recipient, id);

-- LAW 16 — a message is testimony. It is never edited or withdrawn.
DROP TRIGGER IF EXISTS law_messages_no_update;
CREATE TRIGGER law_messages_no_update BEFORE UPDATE ON agent_messages
BEGIN SELECT RAISE(ABORT, 'LAW 16: a sent message cannot be rewritten'); END;
DROP TRIGGER IF EXISTS law_messages_no_delete;
CREATE TRIGGER law_messages_no_delete BEFORE DELETE ON agent_messages
BEGIN SELECT RAISE(ABORT, 'LAW 16: a sent message cannot be deleted'); END;

-- LAW 17 — no agent may send in another's name. The sender is the principal
-- that actually held the lease; a message claiming otherwise is refused.
DROP TRIGGER IF EXISTS law_message_sender_is_the_lease_holder;
CREATE TRIGGER law_message_sender_is_the_lease_holder BEFORE INSERT ON agent_messages
WHEN NEW.lease_id IS NOT NULL
 AND NEW.sender <> (SELECT principal_id FROM leases WHERE id = NEW.lease_id)
BEGIN SELECT RAISE(ABORT,
  'LAW 17: the sender must be the principal holding the cited lease'); END;

-- ── MEMORY, SEPARATED BY SCOPE ───────────────────────────────────────
-- Agent memory, project memory and organisational memory are different
-- things. Mixing them is how one agent's guess becomes the organisation's
-- belief.
CREATE TABLE IF NOT EXISTS memories (
  id           INTEGER PRIMARY KEY,
  scope        TEXT    NOT NULL CHECK (scope IN ('agent','project','org')),
  owner_id     TEXT    NOT NULL,         -- principal id | project:<n> | 'ORG'
  kind         TEXT    NOT NULL CHECK (kind IN
                 ('OBSERVATION','CLAIM','FACT','LESSON','DECISION','PREFERENCE')),
  text         TEXT    NOT NULL,
  claim_id     INTEGER REFERENCES claims(id),
  evidence_id  INTEGER REFERENCES evidence(id),
  task_id      INTEGER REFERENCES tasks(id),
  created_by   TEXT    NOT NULL REFERENCES principals(id),
  created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_memories_scope ON memories(scope, owner_id, id);

-- LAW 18 — a model sentence is not a fact, in memory either.
-- LAW 4 already refuses an unbacked FACT in `claims`. Memory is the other
-- door into the same room, and it is closed the same way.
DROP TRIGGER IF EXISTS law_memory_fact_needs_evidence;
CREATE TRIGGER law_memory_fact_needs_evidence BEFORE INSERT ON memories
WHEN NEW.kind = 'FACT'
 AND NOT EXISTS (SELECT 1 FROM evidence WHERE id = NEW.evidence_id)
BEGIN SELECT RAISE(ABORT,
  'LAW 18: a FACT in memory requires an evidence row, exactly as a claim does'); END;
DROP TRIGGER IF EXISTS law_memory_fact_needs_evidence_update;
CREATE TRIGGER law_memory_fact_needs_evidence_update BEFORE UPDATE ON memories
WHEN NEW.kind = 'FACT'
 AND NOT EXISTS (SELECT 1 FROM evidence WHERE id = NEW.evidence_id)
BEGIN SELECT RAISE(ABORT,
  'LAW 18: a FACT in memory requires an evidence row, exactly as a claim does'); END;

-- LAW 19 — an agent reads its OWN memory. Writing into another agent's
-- private memory is not communication; that is what agent_messages is for.
DROP TRIGGER IF EXISTS law_agent_memory_is_first_person;
CREATE TRIGGER law_agent_memory_is_first_person BEFORE INSERT ON memories
WHEN NEW.scope = 'agent' AND NEW.owner_id <> NEW.created_by
BEGIN SELECT RAISE(ABORT,
  'LAW 19: an agent may not write into another agent''s memory; send a message'); END;
