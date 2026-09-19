-- ─────────────────────────────────────────────────────────────────────
-- THE SPATIAL WORLD — coordinates as rows, not as render-time arithmetic.
--
-- Before this file, an agent's position was computed from its task row every
-- time the screen was drawn. That is a projection: nothing was anywhere, and
-- there was no state to lose, recover, race over, or move through. A world
-- whose positions exist only during a draw call cannot answer "where was it
-- when the process died", which is the question that separates a place from a
-- picture of one.
--
-- Three tables:
--   world_places      the tree — district ⊃ facility ⊃ workspace — with bounds
--   agent_locations   one row per agent: where it is, where it is going, why
--   movements         append-only: every transition, and what caused it
--
-- `agent_locations` is ONE ROW PER AGENT, keyed by principal. Two simultaneous
-- movement commands for one agent are therefore not forbidden by a rule — they
-- are unrepresentable, which is the stronger guarantee. Which of two racing
-- workers wins is settled by `version`, exactly as the queue settles a claim.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS world_places (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('district','facility','workspace')),
  parent_id  TEXT REFERENCES world_places(id),
  label      TEXT NOT NULL,
  -- The coordinate system. x grows right-down, y grows left-down, both in world
  -- units; z is height above the plate. A place owns a rectangle, and its
  -- children are inside it — which is checkable, and is checked.
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  w          REAL NOT NULL CHECK (w > 0),
  h          REAL NOT NULL CHECK (h > 0),
  z          REAL NOT NULL DEFAULT 0,
  -- capacity 0 means "not somewhere an agent can stand" — a district is a
  -- region, not a room. Only workspaces are occupiable.
  capacity   INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  capability TEXT NOT NULL DEFAULT '',   -- what work this place serves
  access     TEXT NOT NULL DEFAULT 'OPEN' CHECK (access IN ('OPEN','RESTRICTED')),
  station    TEXT,                       -- the station map's name for it, if any
  -- WHICH ARCHETYPE this place is an instance of. The renderer draws from the
  -- type, so a facility type invented next year draws without anybody touching
  -- the renderer. Resolving it by guessing from the id instead made the Archive
  -- DISTRICT render as an archive FACILITY, because both were called "archive".
  type_id    TEXT,
  project_id INTEGER REFERENCES projects(id),
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN
               ('ACTIVE','RESERVED','CLOSED')),
  about      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_places_parent ON world_places(parent_id, kind);
CREATE INDEX IF NOT EXISTS ix_places_kind ON world_places(kind);

CREATE TABLE IF NOT EXISTS agent_locations (
  principal_id TEXT PRIMARY KEY REFERENCES principals(id),
  workspace    TEXT NOT NULL REFERENCES world_places(id),
  x            REAL NOT NULL,
  y            REAL NOT NULL,
  -- Where it is going. NULL unless it is going somewhere, which is what makes
  -- "MOVING with no destination" detectable rather than merely unlikely.
  destination  TEXT REFERENCES world_places(id),
  dest_x       REAL,
  dest_y       REAL,
  -- The waypoints not yet reached, as JSON. This is what survives a crash: an
  -- agent killed mid-route reopens still partway along the same route, rather
  -- than at either end of it.
  path         TEXT NOT NULL DEFAULT '[]',
  movement     TEXT NOT NULL DEFAULT 'IDLE' CHECK (movement IN
                 ('IDLE','MOVING','ARRIVED','WORKING','LEAVING','WAITING','BLOCKED')),
  activity     TEXT NOT NULL DEFAULT '',
  task_id      INTEGER REFERENCES tasks(id),
  lease_id     INTEGER REFERENCES leases(id),
  why          TEXT NOT NULL DEFAULT '',
  -- The last time this agent was somewhere else. Not the last write: standing
  -- still for an hour is a fact about the world, and it is this column.
  moved_at     TEXT NOT NULL,
  -- Optimistic concurrency. Every accepted change increments it, so a worker
  -- that read a stale row loses its write instead of overwriting a newer one.
  version      INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_locations_ws ON agent_locations(workspace);
CREATE INDEX IF NOT EXISTS ix_locations_moving ON agent_locations(movement);

CREATE TABLE IF NOT EXISTS movements (
  id             INTEGER PRIMARY KEY,
  principal_id   TEXT    NOT NULL REFERENCES principals(id),
  -- WHO moved, FROM WHERE, TO WHERE, WHY, BECAUSE OF WHICH TASK, WHICH WORKER,
  -- WHEN, and WHAT THE RESULT WAS. All eight, in one row, so the question is
  -- answerable with no process alive to remember.
  from_workspace TEXT,
  from_x         REAL,
  from_y         REAL,
  to_workspace   TEXT    NOT NULL,
  to_x           REAL,
  to_y           REAL,
  distance       REAL    NOT NULL DEFAULT 0 CHECK (distance >= 0),
  phase          TEXT    NOT NULL CHECK (phase IN
                   ('REQUESTED','DEPARTED','WAYPOINT','ARRIVED','REFUSED')),
  why            TEXT    NOT NULL,
  task_id        INTEGER REFERENCES tasks(id),
  lease_id       INTEGER REFERENCES leases(id),
  worker         TEXT,
  queue_id       INTEGER REFERENCES world_queue(id),
  event_id       INTEGER REFERENCES events(id),
  at             TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_movements_agent ON movements(principal_id, id);
CREATE INDEX IF NOT EXISTS ix_movements_task ON movements(task_id);

-- ─────────────────────────────────────────────────────────────────────
-- THE SPATIAL LAWS. Only the ones that must hold when nobody is watching:
-- a rule enforced in Python is a rule that holds until a second worker, a
-- crash, or a future caller with a different WHERE clause.
-- ─────────────────────────────────────────────────────────────────────

-- LAW 30 — a movement state must be coherent with the columns that describe it.
-- MOVING with no destination is the state a half-written update leaves behind,
-- and it renders as an agent walking nowhere forever. IDLE WITH one is the
-- opposite mistake, and it was in this code: a finished journey left its
-- destination in the row, so an agent standing still reported that it was on
-- its way to where it already was.
DROP TRIGGER IF EXISTS law_movement_state_is_coherent_insert;
CREATE TRIGGER law_movement_state_is_coherent_insert BEFORE INSERT ON agent_locations
WHEN (NEW.movement = 'MOVING' AND NEW.destination IS NULL)
  OR (NEW.movement = 'ARRIVED' AND NEW.destination IS NULL)
  OR (NEW.movement = 'WORKING' AND NEW.task_id IS NULL)
  OR (NEW.movement = 'IDLE' AND NEW.destination IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'LAW 30: a movement state must match its own columns'); END;

DROP TRIGGER IF EXISTS law_movement_state_is_coherent_update;
CREATE TRIGGER law_movement_state_is_coherent_update BEFORE UPDATE ON agent_locations
WHEN (NEW.movement = 'MOVING' AND NEW.destination IS NULL)
  OR (NEW.movement = 'ARRIVED' AND NEW.destination IS NULL)
  OR (NEW.movement = 'WORKING' AND NEW.task_id IS NULL)
  OR (NEW.movement = 'IDLE' AND NEW.destination IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'LAW 30: a movement state must match its own columns'); END;

-- LAW 31 — an agent stands in a place that exists and can be stood in.
-- The foreign key already refuses a workspace that is not there. This refuses a
-- district, which IS there and is not a room.
DROP TRIGGER IF EXISTS law_agent_stands_somewhere_real_insert;
CREATE TRIGGER law_agent_stands_somewhere_real_insert BEFORE INSERT ON agent_locations
WHEN (SELECT kind FROM world_places WHERE id = NEW.workspace) <> 'workspace'
BEGIN SELECT RAISE(ABORT, 'LAW 31: an agent can only stand in a workspace'); END;

DROP TRIGGER IF EXISTS law_agent_stands_in_a_workspace;
CREATE TRIGGER law_agent_stands_in_a_workspace BEFORE UPDATE OF workspace ON agent_locations
WHEN (SELECT kind FROM world_places WHERE id = NEW.workspace) <> 'workspace'
BEGIN SELECT RAISE(ABORT, 'LAW 31: an agent can only stand in a workspace'); END;

-- LAW 32 — a workspace cannot hold more agents than it has room for.
-- Occupancy is a fact about a place, not a suggestion; without this, a world
-- under load quietly stacks every agent on one tile and still looks fine.
DROP TRIGGER IF EXISTS law_workspace_capacity_is_real;
CREATE TRIGGER law_workspace_capacity_is_real BEFORE UPDATE OF workspace ON agent_locations
WHEN NEW.workspace <> OLD.workspace
 AND (SELECT kind FROM world_places WHERE id = NEW.workspace) = 'workspace'
 AND (SELECT COUNT(*) FROM agent_locations
      WHERE workspace = NEW.workspace AND principal_id <> NEW.principal_id)
     >= (SELECT capacity FROM world_places WHERE id = NEW.workspace)
BEGIN SELECT RAISE(ABORT, 'LAW 32: that workspace is full'); END;

DROP TRIGGER IF EXISTS law_workspace_capacity_is_real_insert;
CREATE TRIGGER law_workspace_capacity_is_real_insert BEFORE INSERT ON agent_locations
WHEN (SELECT kind FROM world_places WHERE id = NEW.workspace) = 'workspace'
 AND (SELECT COUNT(*) FROM agent_locations
      WHERE workspace = NEW.workspace AND principal_id <> NEW.principal_id)
     >= (SELECT capacity FROM world_places WHERE id = NEW.workspace)
BEGIN SELECT RAISE(ABORT, 'LAW 32: that workspace is full'); END;

-- LAW 33 — recorded movement cannot be rewritten. The same rule the event chain
-- and task transitions already live under: history is evidence or it is nothing.
DROP TRIGGER IF EXISTS law_movements_no_update;
CREATE TRIGGER law_movements_no_update BEFORE UPDATE ON movements
BEGIN SELECT RAISE(ABORT, 'LAW 33: a recorded movement cannot be rewritten'); END;
DROP TRIGGER IF EXISTS law_movements_no_delete;
CREATE TRIGGER law_movements_no_delete BEFORE DELETE ON movements
BEGIN SELECT RAISE(ABORT, 'LAW 33: a recorded movement cannot be deleted'); END;

-- LAW 34 — finished work cannot send anybody anywhere. A task that has been
-- accepted or archived is done, and an agent walking towards it is the world
-- acting on state that no longer exists.
DROP TRIGGER IF EXISTS law_finished_work_causes_no_movement;
CREATE TRIGGER law_finished_work_causes_no_movement BEFORE UPDATE ON agent_locations
WHEN NEW.movement = 'MOVING' AND NEW.task_id IS NOT NULL
 AND (SELECT status FROM tasks WHERE id = NEW.task_id) IN ('ACCEPTED','ARCHIVED')
BEGIN SELECT RAISE(ABORT, 'LAW 34: finished work cannot cause movement'); END;

-- LAW 35 — the spatial version only ever goes forward. This is what makes the
-- guarded UPDATE a real lock: a worker that could rewind the version could
-- replay a movement another worker already won.
DROP TRIGGER IF EXISTS law_spatial_version_moves_forward;
CREATE TRIGGER law_spatial_version_moves_forward BEFORE UPDATE ON agent_locations
WHEN NEW.version <= OLD.version
BEGIN SELECT RAISE(ABORT, 'LAW 35: the spatial version cannot go backwards'); END;
