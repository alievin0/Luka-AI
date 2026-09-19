"""التخزين — sqlite من المكتبة القياسية، بدون أي تبعية خارجية.

العالم كله ملف واحد على القرص. تقدر تنسخه، ترجّعه، تاخذه معك.
"""
import json
import os
import sqlite3

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS world (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- الساكنة: كل سطر إنسان في هذا العالم
CREATE TABLE IF NOT EXISTS agents (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  house      TEXT NOT NULL,          -- بيته: wound | craft | market
  role       TEXT NOT NULL,          -- عمله اليوم
  born_day   INTEGER NOT NULL,
  died_day   INTEGER,                -- NULL = على قيد الحياة
  energy     REAL NOT NULL DEFAULT 1.0,
  coin       REAL NOT NULL DEFAULT 0,
  skill      REAL NOT NULL DEFAULT 0.25,   -- 0..1
  nerve      REAL NOT NULL DEFAULT 0.5,    -- جرأته على قتل فكرة
  eye        REAL NOT NULL DEFAULT 0.5,    -- حدّة نظره للوجع
  patience   REAL NOT NULL DEFAULT 0.5,
  standing   REAL NOT NULL DEFAULT 0,      -- سمعته: تُكتسب بالنتيجة فقط
  trait      TEXT NOT NULL DEFAULT '',
  mentor_id  INTEGER,
  focus_idea INTEGER                       -- الفكرة اللي شاغلته الآن
);
CREATE INDEX IF NOT EXISTS ix_agents_house ON agents(house, died_day);
CREATE INDEX IF NOT EXISTS ix_agents_focus ON agents(focus_idea);

-- ذاكرة الوكيل: ما عاشه، وما تعلّمه
CREATE TABLE IF NOT EXISTS memories (
  id       INTEGER PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  day      INTEGER NOT NULL,
  kind     TEXT NOT NULL,
  text     TEXT NOT NULL,
  weight   REAL NOT NULL DEFAULT 1.0
);
CREATE INDEX IF NOT EXISTS ix_mem_agent ON memories(agent_id, day DESC);

-- الروابط بينهم: من يثق بمن
CREATE TABLE IF NOT EXISTS relations (
  a    INTEGER NOT NULL,
  b    INTEGER NOT NULL,
  bond REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'زميل',
  PRIMARY KEY (a, b)
);

-- الأفكار: ناتج العالم الوحيد الذي يهم الملك
CREATE TABLE IF NOT EXISTS ideas (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  house      TEXT NOT NULL,
  author_id  INTEGER NOT NULL,
  born_day   INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'جنين',  -- جنين|ينمو|مرفوعة|ممولة|ميتة
  score      REAL NOT NULL DEFAULT 0,
  funding    REAL NOT NULL DEFAULT 0,
  audience   TEXT NOT NULL DEFAULT '',
  sector     TEXT NOT NULL DEFAULT '',
  died_day   INTEGER,
  died_why   TEXT
);
CREATE INDEX IF NOT EXISTS ix_ideas_status ON ideas(status, score DESC);

-- الأعضاء السبعة: الفكرة بلا جسد لا تعيش
CREATE TABLE IF NOT EXISTS organs (
  idea_id  INTEGER NOT NULL,
  organ    TEXT NOT NULL,
  text     TEXT NOT NULL DEFAULT '',
  strength REAL NOT NULL DEFAULT 0,   -- 0..1
  day      INTEGER NOT NULL,
  by_agent INTEGER,
  PRIMARY KEY (idea_id, organ)
);

-- كل ما جرى: هذا هو تاريخ العالم
CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY,
  day      INTEGER NOT NULL,
  kind     TEXT NOT NULL,
  text     TEXT NOT NULL,
  agent_id INTEGER,
  idea_id  INTEGER
);
CREATE INDEX IF NOT EXISTS ix_events_day ON events(day DESC);
CREATE INDEX IF NOT EXISTS ix_events_idea ON events(idea_id, day);

-- خزينة الملك: كل دينار دخل أو خرج
CREATE TABLE IF NOT EXISTS ledger (
  id      INTEGER PRIMARY KEY,
  day     INTEGER NOT NULL,
  amount  REAL NOT NULL,
  note    TEXT NOT NULL,
  idea_id INTEGER
);

-- مراسيم الملك: تغيّر قوانين العالم نفسه
CREATE TABLE IF NOT EXISTS decrees (
  id     INTEGER PRIMARY KEY,
  day    INTEGER NOT NULL,
  text   TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1
);

-- إحاطة كل يوم، مكتوبة للملك
CREATE TABLE IF NOT EXISTS briefs (
  day  INTEGER PRIMARY KEY,
  text TEXT NOT NULL
);
"""

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "world.db")


def connect(path=None):
    path = path or os.environ.get("WORLD_DB") or DEFAULT_PATH
    fresh = not os.path.exists(path)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    if fresh:
        con.commit()
    return con


def get(con, key, default=None):
    row = con.execute("SELECT value FROM world WHERE key=?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["value"])
    except (ValueError, TypeError):
        return row["value"]


def put(con, key, value):
    con.execute(
        "INSERT INTO world(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value, ensure_ascii=False)),
    )


def log(con, day, kind, text, agent_id=None, idea_id=None):
    con.execute(
        "INSERT INTO events(day,kind,text,agent_id,idea_id) VALUES(?,?,?,?,?)",
        (day, kind, text, agent_id, idea_id),
    )
