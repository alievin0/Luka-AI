-- ─────────────────────────────────────────────────────────────────────
-- THE WORLD GROWS ITSELF — but only along a pipeline it cannot skip.
--
-- The ten districts were a seed, not a maximum. When the work will not fit in
-- the space, the organisation is supposed to notice and build more. The danger
-- in that sentence is every word after "notice": an agent that can create
-- geometry can create a thousand buildings from one bad loop, and a model that
-- can authorise its own construction has escaped the control plane entirely.
--
-- So construction is a PIPELINE, and each stage is a row:
--
--   NEED (observed)  → PROPOSAL → DESIGN → VALIDATED → AUTHORISED
--                    → CONSTRUCTED → ACTIVE           → OBSERVED
--
-- Nothing may jump a stage (LAW 36). Nothing may be authorised by the party
-- that proposed it without policy saying so (LAW 39). Nothing may be built that
-- overlaps something already standing (LAW 37). Nothing may be built that the
-- world cannot pay for (LAW 38). And a completed facility cannot be edited into
-- something else afterwards (LAW 41) — it is retired and replaced, so the
-- record of what was built stays true.
-- ─────────────────────────────────────────────────────────────────────

-- WHAT KINDS OF PLACE CAN EXIST. Registered archetypes, not a hardcoded list in
-- a renderer: the 3D world draws a facility from its TYPE, so a type nobody has
-- written a special case for still draws, and a type invented next year draws
-- without touching the renderer.
CREATE TABLE IF NOT EXISTS facility_types (
  id           TEXT PRIMARY KEY,              -- research_lab, simulation_lab…
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('district','facility','workspace')),
  capability   TEXT NOT NULL DEFAULT '',      -- what work it serves
  archetype    TEXT NOT NULL DEFAULT 'block', -- the visual grammar the renderer uses
  default_w    REAL NOT NULL DEFAULT 8 CHECK (default_w > 0),
  default_h    REAL NOT NULL DEFAULT 8 CHECK (default_h > 0),
  default_z    REAL NOT NULL DEFAULT 3 CHECK (default_z >= 0),
  workspaces   INTEGER NOT NULL DEFAULT 1 CHECK (workspaces >= 0),
  equipment    TEXT NOT NULL DEFAULT '[]',    -- what stands inside it
  cost         REAL NOT NULL DEFAULT 1 CHECK (cost >= 0),
  access       TEXT NOT NULL DEFAULT 'OPEN' CHECK (access IN ('OPEN','RESTRICTED')),
  registered_by TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  approved_by  TEXT,                          -- a NEW type needs the owner plane
  notes        TEXT NOT NULL DEFAULT ''
);

-- WHAT THE WORLD CAN AFFORD. Bounded, deliberately. A world with unlimited
-- resources is a world where a runaway loop is indistinguishable from growth.
CREATE TABLE IF NOT EXISTS world_resources (
  id           TEXT PRIMARY KEY,              -- space, construction, budget…
  label        TEXT NOT NULL,
  total        REAL NOT NULL CHECK (total >= 0),
  spent        REAL NOT NULL DEFAULT 0 CHECK (spent >= 0),
  unit         TEXT NOT NULL DEFAULT 'unit',
  -- How many constructions may commit per window. A cap on RATE, not just on
  -- total: a loop that can spend the whole budget in one tick has still
  -- escaped, even if the budget itself was finite.
  per_window   INTEGER NOT NULL DEFAULT 3 CHECK (per_window >= 0),
  window_secs  INTEGER NOT NULL DEFAULT 3600 CHECK (window_secs > 0),
  updated_at   TEXT NOT NULL
);

-- THE NEED, AND THE EVIDENCE FOR IT.
CREATE TABLE IF NOT EXISTS expansion_proposals (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('workspace','facility','district','type')),
  type_id      TEXT REFERENCES facility_types(id),
  parent_id    TEXT REFERENCES world_places(id),   -- where it would go
  label        TEXT NOT NULL,
  cause        TEXT NOT NULL,                      -- WHY, in one line
  -- The numbers behind the cause, as JSON, measured from rows at proposal time.
  -- A proposal whose evidence is a sentence is a proposal nobody can check.
  evidence     TEXT NOT NULL DEFAULT '{}',
  evidence_id  INTEGER REFERENCES evidence(id),
  proposed_by  TEXT NOT NULL REFERENCES principals(id),
  project_id   INTEGER REFERENCES projects(id),
  chain_id     INTEGER REFERENCES chains(id),
  state        TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (state IN
                 ('PROPOSED','DESIGNED','VALIDATED','REJECTED','AUTHORISED',
                  'UNDER_CONSTRUCTION','CONSTRUCTED','ACTIVE','WITHDRAWN')),
  decided_by   TEXT,
  decided_at   TEXT,
  decision_why TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_proposals_state ON expansion_proposals(state, id);

-- THE DESIGN, WHICH IS AN ARTIFACT BEFORE IT IS A BUILDING.
CREATE TABLE IF NOT EXISTS facility_designs (
  id           INTEGER PRIMARY KEY,
  proposal_id  INTEGER NOT NULL REFERENCES expansion_proposals(id),
  place_id     TEXT NOT NULL,                 -- the id it will occupy
  spec         TEXT NOT NULL,                 -- the whole design, as JSON
  design_hash  TEXT NOT NULL,                 -- over the spec, before validation
  x            REAL NOT NULL, y REAL NOT NULL,
  w            REAL NOT NULL CHECK (w > 0), h REAL NOT NULL CHECK (h > 0),
  z            REAL NOT NULL DEFAULT 3,
  capacity     INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 0),
  cost         REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
  designed_by  TEXT NOT NULL REFERENCES principals(id),
  artifact_id  INTEGER REFERENCES artifacts(id),
  validated    INTEGER NOT NULL DEFAULT 0,
  validation   TEXT NOT NULL DEFAULT '[]',    -- every check, and its verdict
  created_at   TEXT NOT NULL,
  UNIQUE (proposal_id)
);

-- WHAT WAS ACTUALLY BUILT, AND BY WHOSE AUTHORITY.
CREATE TABLE IF NOT EXISTS constructions (
  id           INTEGER PRIMARY KEY,
  design_id    INTEGER NOT NULL REFERENCES facility_designs(id),
  proposal_id  INTEGER NOT NULL REFERENCES expansion_proposals(id),
  place_id     TEXT NOT NULL REFERENCES world_places(id),
  built_by     TEXT NOT NULL REFERENCES principals(id),
  authorised_by TEXT NOT NULL,                -- OWNER_PLANE, or a policy id
  authority    TEXT NOT NULL,                 -- 'policy:…' or 'owner'
  cost         REAL NOT NULL DEFAULT 0,
  event_id     INTEGER REFERENCES events(id),
  state        TEXT NOT NULL DEFAULT 'UNDER_CONSTRUCTION' CHECK (state IN
                 ('UNDER_CONSTRUCTION','VALIDATING','READY','ACTIVE','RETIRED')),
  built_at     TEXT NOT NULL,
  activated_at TEXT,
  retired_at   TEXT,
  retired_why  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_constructions_place ON constructions(place_id);

-- WAS IT ANY USE? Measured afterwards, from rows, not asserted by whoever
-- wanted it built.
CREATE TABLE IF NOT EXISTS space_utilization (
  id           INTEGER PRIMARY KEY,
  place_id     TEXT NOT NULL REFERENCES world_places(id),
  construction_id INTEGER REFERENCES constructions(id),
  observed_at  TEXT NOT NULL,
  occupants    INTEGER NOT NULL DEFAULT 0,
  tasks_done   INTEGER NOT NULL DEFAULT 0,
  visits       INTEGER NOT NULL DEFAULT 0,
  utilisation  REAL NOT NULL DEFAULT 0 CHECK (utilisation BETWEEN 0 AND 1),
  verdict      TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (verdict IN
                 ('UNKNOWN','USED','UNDERUSED','UNUSED'))
);

-- ─────────────────────────────────────────────────────────────────────
-- THE CONSTRUCTION LAWS (36–41)
-- ─────────────────────────────────────────────────────────────────────

-- LAW 36 — a proposal cannot skip a stage. This is the whole pipeline in one
-- trigger: without it, "AUTHORISED" is a column an agent could simply write.
DROP TRIGGER IF EXISTS law_expansion_follows_its_pipeline;
CREATE TRIGGER law_expansion_follows_its_pipeline BEFORE UPDATE ON expansion_proposals
WHEN NEW.state <> OLD.state AND NOT (
     (OLD.state = 'PROPOSED'   AND NEW.state IN ('DESIGNED','REJECTED','WITHDRAWN'))
  OR (OLD.state = 'DESIGNED'   AND NEW.state IN ('VALIDATED','REJECTED','WITHDRAWN'))
  OR (OLD.state = 'VALIDATED'  AND NEW.state IN ('AUTHORISED','REJECTED','WITHDRAWN'))
  OR (OLD.state = 'AUTHORISED' AND NEW.state IN ('UNDER_CONSTRUCTION','WITHDRAWN'))
  OR (OLD.state = 'UNDER_CONSTRUCTION' AND NEW.state IN ('CONSTRUCTED','REJECTED'))
  OR (OLD.state = 'CONSTRUCTED' AND NEW.state = 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'LAW 36: an expansion cannot skip a stage'); END;

-- LAW 37 — nothing is built on top of something already standing. Overlap is
-- checked against siblings: two facilities inside one district, two workspaces
-- inside one facility. A world that can build through its own walls is not a
-- place, it is a list of rectangles that happen to have coordinates.
DROP TRIGGER IF EXISTS law_no_building_overlaps_another;
CREATE TRIGGER law_no_building_overlaps_another BEFORE INSERT ON world_places
WHEN EXISTS (
  SELECT 1 FROM world_places o
   WHERE o.id <> NEW.id
     AND o.kind = NEW.kind
     AND (o.parent_id IS NEW.parent_id)
     AND o.status <> 'CLOSED'
     AND NEW.x < o.x + o.w AND o.x < NEW.x + NEW.w
     AND NEW.y < o.y + o.h AND o.y < NEW.y + NEW.h)
BEGIN SELECT RAISE(ABORT, 'LAW 37: that ground is already built on'); END;

-- LAW 38 — the world cannot spend what it does not have.
DROP TRIGGER IF EXISTS law_world_cannot_overspend;
CREATE TRIGGER law_world_cannot_overspend BEFORE UPDATE ON world_resources
WHEN NEW.spent > NEW.total
BEGIN SELECT RAISE(ABORT, 'LAW 38: the world cannot spend what it does not have'); END;

-- LAW 39 — construction requires a design that passed validation, and an
-- authority that is not the empty string. Both are the things a compromised
-- proposer would most like to omit.
DROP TRIGGER IF EXISTS law_construction_needs_a_validated_design;
CREATE TRIGGER law_construction_needs_a_validated_design BEFORE INSERT ON constructions
WHEN (SELECT validated FROM facility_designs WHERE id = NEW.design_id) IS NOT 1
  OR TRIM(COALESCE(NEW.authorised_by,'')) = ''
  OR TRIM(COALESCE(NEW.authority,'')) = ''
BEGIN SELECT RAISE(ABORT,
  'LAW 39: construction needs a validated design and a named authority'); END;

-- LAW 40 — a design cannot be rewritten once it has been validated. The hash in
-- the row is over the spec that was checked; letting the spec change afterwards
-- means the thing built is not the thing that passed.
DROP TRIGGER IF EXISTS law_validated_design_is_frozen;
CREATE TRIGGER law_validated_design_is_frozen BEFORE UPDATE ON facility_designs
WHEN OLD.validated = 1 AND (NEW.spec <> OLD.spec OR NEW.design_hash <> OLD.design_hash
     OR NEW.x <> OLD.x OR NEW.y <> OLD.y OR NEW.w <> OLD.w OR NEW.h <> OLD.h)
BEGIN SELECT RAISE(ABORT, 'LAW 40: a validated design cannot be rewritten'); END;

-- LAW 41 — a construction record is history. It may be retired; it may not be
-- turned into a record of something else.
DROP TRIGGER IF EXISTS law_construction_history_is_not_rewritten;
CREATE TRIGGER law_construction_history_is_not_rewritten BEFORE UPDATE ON constructions
WHEN NEW.design_id <> OLD.design_id OR NEW.place_id <> OLD.place_id
  OR NEW.built_by <> OLD.built_by OR NEW.authorised_by <> OLD.authorised_by
  OR NEW.built_at <> OLD.built_at
BEGIN SELECT RAISE(ABORT, 'LAW 41: what was built, by whom, cannot be rewritten'); END;
DROP TRIGGER IF EXISTS law_construction_no_delete;
CREATE TRIGGER law_construction_no_delete BEFORE DELETE ON constructions
BEGIN SELECT RAISE(ABORT, 'LAW 41: a construction record cannot be deleted'); END;

-- ─────────────────────────────────────────────────────────────────────
-- THE TOOL REGISTRY — a description of every door, not the door itself.
--
-- `runtime.Gateway` decides every call and decided so before this table
-- existed; nothing here can open anything. What a row adds is the SHAPE of the
-- door: its schema, its risk, whether it is switched on. That is what lets the
-- world show its own nervous system, and notice when a capability has become
-- unusable BEFORE an agent walks into the closed door at execution time.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tools (
  id            TEXT PRIMARY KEY,           -- READ_REPO, WRITE_ARTIFACT…
  name          TEXT NOT NULL,
  capability    TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  inputs        TEXT NOT NULL DEFAULT '{}',
  outputs       TEXT NOT NULL DEFAULT '{}',
  needs_perm    TEXT NOT NULL DEFAULT '',
  risk          TEXT NOT NULL DEFAULT 'LOW' CHECK (risk IN ('LOW','MEDIUM','HIGH')),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  version       INTEGER NOT NULL DEFAULT 1,
  scope         TEXT NOT NULL DEFAULT '*',
  registered_by TEXT NOT NULL,
  registered_at TEXT NOT NULL
);

-- LAW 42 — a tool row cannot grant anything. `needs_perm` names the permission
-- the gateway will look for; a registry that could widen a grant would be a
-- second, weaker authority beside the gateway, which is exactly one too many.
DROP TRIGGER IF EXISTS law_tool_registry_grants_nothing;
CREATE TRIGGER law_tool_registry_grants_nothing BEFORE INSERT ON tools
WHEN TRIM(COALESCE(NEW.needs_perm,'')) = ''
BEGIN SELECT RAISE(ABORT,
  'LAW 42: a tool must name the permission it requires'); END;
