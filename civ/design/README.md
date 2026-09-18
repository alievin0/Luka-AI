# design/ — concept exploration

**Exploration scaffolding. Not the World UI, and it must never become it.**

These are hand-authored massing studies for
[`../AGENT_WORLD_VISUAL_ARCHITECTURE.md`](../AGENT_WORLD_VISUAL_ARCHITECTURE.md).
Every figure in them is **invented placeholder content** — no board reads a
database, and none of them should. Their whole value is that the spatial
language was tested before anything was built against real state.

```
concept_render.py    axonometric SVG renderer: volumes, contact shadow, cast
                     light, the five entity frames, topological depth sort
board.py             board wrapper — title, caption, legend, reality tiers
b_world.py           board A      the full World
b_rooms.py           boards B C D E G   the Works, the three workspaces, the Owner
b_entities.py        board F      the five entities and the state matrix
b_directions.py      board H      three directions compared, with verdicts
boards/              the HTML sources and their PNG renders
```

Rebuild:

```
python3 b_world.py && python3 b_rooms.py && python3 b_entities.py && python3 b_directions.py
```

Then screenshot `boards/*.html` at ~1760px wide.

Two things here are worth keeping when the real world is built, and both are in
`concept_render.py`:

- **`Scene._order`** — draw order in axonometric is a *partial* order, not a
  depth number. Sorting by centre depth hides a long building behind a short
  one; sorting by near corner makes it cover everything in front of it. Only
  "A is behind B if A ends before B begins on any axis", topologically sorted,
  is correct.
- **`Scene._place_labels`** — hand-tuned label offsets do not survive a change of
  scale. Labels are collected and laid out into the gutters at render time,
  stacked so none overlaps, each tied back to its anchor.
