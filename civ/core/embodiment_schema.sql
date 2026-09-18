-- ─────────────────────────────────────────────────────────────────────
-- THE EMBODIMENT LAYER — a persistent body for a persistent identity.
--
-- The agent is the row in `principals`. The intelligence is the runtime. This
-- table is neither: it is the PHYSICAL IDENTITY, and the reason it is a table
-- rather than a function of the agent id is that an identity you can re-derive
-- is an identity you can accidentally change. Adjust the derivation next year
-- and every agent in the organisation would silently become a different-looking
-- entity — which is exactly what "R-01 is still R-01 after a restart" forbids.
--
-- So: derived ONCE from a deterministic seed, then written down and frozen.
--
-- The body is not the intelligence. Nothing in here affects what an agent may
-- do, what it knows, or what it is permitted to touch. It affects what it looks
-- like, and that is deliberately all.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_bodies (
  principal_id    TEXT PRIMARY KEY REFERENCES principals(id),
  body_id         TEXT NOT NULL UNIQUE,          -- BODY-0001
  seed            INTEGER NOT NULL,              -- what the appearance came from

  -- A controlled family. Every agent belongs to the same technological
  -- civilisation; these say which member of it this one is.
  body_variant    TEXT NOT NULL,                 -- A1…A6  proportions/geometry
  head_variant    TEXT NOT NULL,                 -- H1…H5  optical system
  chest_variant   TEXT NOT NULL,                 -- C1…C4  torso plate
  sensor_variant  TEXT NOT NULL,                 -- S1…S4
  equipment       TEXT NOT NULL DEFAULT '',      -- role-specific module
  build           TEXT NOT NULL DEFAULT 'standard'
                    CHECK (build IN ('slim','standard','heavy')),
  height          REAL NOT NULL DEFAULT 1.78 CHECK (height BETWEEN 1.2 AND 2.6),

  -- Colour is IDENTITY, not role. Two researchers do not share a palette.
  palette         TEXT NOT NULL,                 -- the named combination
  primary_color   TEXT NOT NULL,
  secondary_color TEXT NOT NULL,
  accent_color    TEXT NOT NULL,
  material        TEXT NOT NULL DEFAULT 'matte'
                    CHECK (material IN ('matte','satin','ceramic','brushed','carbon')),
  marking         TEXT NOT NULL DEFAULT '',      -- R01 — the badge on the chest
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_bodies_variant ON agent_bodies(body_variant);

-- Where inside a workspace this agent works. A room has numbered stations, and
-- an agent that arrives takes one and keeps it — otherwise "the Researcher is at
-- its workstation" means a different desk every time anybody looks.
CREATE TABLE IF NOT EXISTS workstations (
  id           TEXT PRIMARY KEY,                  -- ws_lab#2
  workspace    TEXT NOT NULL REFERENCES world_places(id),
  seat         INTEGER NOT NULL CHECK (seat >= 0),
  x            REAL NOT NULL,
  y            REAL NOT NULL,
  facing       REAL NOT NULL DEFAULT 0,           -- radians; which way the chair points
  kind         TEXT NOT NULL DEFAULT 'desk',      -- desk, bench, console, frame
  capability   TEXT NOT NULL DEFAULT '',
  occupied_by  TEXT REFERENCES principals(id),
  UNIQUE (workspace, seat)
);
CREATE INDEX IF NOT EXISTS ix_stations_ws ON workstations(workspace, seat);

-- ─────────────────────────────────────────────────────────────────────
-- LAW 43 — a body is not redesigned. R-01 in Verification is the same R-01
-- that was in the Research Hall, and the same one that was there before the
-- process restarted. Without this the appearance is a cache, and a cache is
-- something that can disagree with itself.
-- ─────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS law_a_body_is_not_redesigned;
CREATE TRIGGER law_a_body_is_not_redesigned BEFORE UPDATE ON agent_bodies
WHEN NEW.body_id <> OLD.body_id OR NEW.seed <> OLD.seed
  OR NEW.body_variant <> OLD.body_variant OR NEW.head_variant <> OLD.head_variant
  OR NEW.chest_variant <> OLD.chest_variant OR NEW.sensor_variant <> OLD.sensor_variant
  OR NEW.primary_color <> OLD.primary_color OR NEW.secondary_color <> OLD.secondary_color
  OR NEW.accent_color <> OLD.accent_color OR NEW.material <> OLD.material
  OR NEW.marking <> OLD.marking OR NEW.build <> OLD.build
BEGIN SELECT RAISE(ABORT, 'LAW 43: an agent body is not redesigned'); END;

DROP TRIGGER IF EXISTS law_a_body_is_not_deleted;
CREATE TRIGGER law_a_body_is_not_deleted BEFORE DELETE ON agent_bodies
BEGIN SELECT RAISE(ABORT, 'LAW 43: an agent body is not deleted'); END;

-- LAW 44 — one agent, one seat. A station holding two agents is a station that
-- renders them inside each other, and an agent holding two stations is one the
-- world cannot say the location of.
DROP TRIGGER IF EXISTS law_one_agent_per_station;
CREATE TRIGGER law_one_agent_per_station BEFORE UPDATE OF occupied_by ON workstations
WHEN NEW.occupied_by IS NOT NULL AND EXISTS (
  SELECT 1 FROM workstations WHERE occupied_by = NEW.occupied_by AND id <> NEW.id)
BEGIN SELECT RAISE(ABORT, 'LAW 44: an agent occupies one workstation at a time'); END;
