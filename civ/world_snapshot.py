#!/usr/bin/env python3
"""Freeze the world into one self-contained HTML file.

    python3 world_snapshot.py --db agent-world.db --out /tmp/world.html

The Owner cannot always reach a localhost port, and the world is worth looking
at from somewhere else. This writes every answer `world_server.py` would give
for a database — the payload, each agent, each project, every reachable record
— into one page, alongside the real `world_ui/` sources, with `fetch` pointed at
the frozen answers instead of at a server.

It is a SNAPSHOT and says so on the page. Nothing here is generated, summarised
or smoothed: each entry is the exact JSON the endpoint returns, captured once.
A snapshot cannot show you a world that is still moving — it can only show you
what was true when it was taken, which is all a screenshot ever did either, with
the difference that this one is still clickable.

Pass --db twice to put two captures in one page (say a finished run and one
stopped mid-flight); the page gets a selector and nothing else changes.

Python standard library only, to match the rest of the runtime.
"""
import argparse
import html
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W        # noqa: E402
import world_server as SRV               # noqa: E402

UI = os.path.join(HERE, "world_ui")


def capture(db):
    """Every answer the server would give for this database, as a dict of
    path → response. The paths are the real ones, so the page's fetch shim is a
    lookup and never a reimplementation of the API."""
    con = SRV.connect(db)
    try:
        payload = SRV.world_payload(con)
        out = {"/api/world": payload,
               "/api/away": W.while_you_were_away(con),
               "/api/activity": SRV.activity(con, 60)}
        for aid in payload["agents"]:
            out["/api/agent/" + aid] = SRV.agent_detail(con, aid)
        for p in payload["projects"]:
            out["/api/project/%d" % p["id"]] = W.project_passport(con, p["id"])
        # every record the UI can reach by a click, so no link is a dead end
        tables = {"task": "tasks", "artifact": "artifacts", "review": "reviews",
                  "evidence": "evidence", "tool_call": "tool_calls",
                  "project": "projects", "memory": "memories",
                  "message": "agent_messages", "event": "events"}
        for kind, table in tables.items():
            for r in con.execute("SELECT id FROM %s" % table):
                out["/api/record/%s/%d" % (kind, r["id"])] = SRV.record(con, kind, r["id"])
        meta = {"db": os.path.basename(db),
                "captured_at": SRV.store.now(),
                "mode": payload["world"]["mode"],
                "running": len(payload["running"]),
                "tasks": len(payload["tasks"]),
                "events": con.execute("SELECT COUNT(*) c FROM events").fetchone()["c"]}
        return {"meta": meta, "responses": out}
    finally:
        con.close()


SHIM = """
/* The world, frozen. `fetch` answers from the capture this page carries
   instead of from a server; every path below is one the server really serves,
   and every answer is the JSON it really returned. Nothing is synthesised: if a
   path is missing the page says so rather than inventing a reply. */
const SNAPSHOTS = __SNAPSHOTS__;
/* ?snap=1 picks a capture, so either one can be linked to directly. */
let SNAP = Math.min(Math.max(0, +(new URLSearchParams(location.search).get("snap") || 0) || 0),
                    SNAPSHOTS.length - 1);
window.fetch = async (path) => {
  const clean = String(path).split("?")[0];
  const hit = SNAPSHOTS[SNAP].responses[clean];
  if (hit === undefined) {
    return { ok: false, status: 404,
             json: async () => ({ error: "not in this snapshot: " + clean }) };
  }
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(hit)) };
};
"""

CHROME = """
/* A snapshot has to admit it is one. */
(() => {
  const bar = document.createElement("div");
  bar.className = "snapbar";
  const opts = SNAPSHOTS.map((s, i) =>
    `<button class="snapb${i === SNAP ? " on" : ""}" data-snap="${i}">${s.meta.label}</button>`
  ).join("");
  bar.innerHTML =
    `<span class="snaptag">SNAPSHOT</span>${SNAPSHOTS.length > 1 ? opts : ""}` +
    `<span class="snapnote" id="snapnote"></span>`;
  document.querySelector(".chrome").appendChild(bar);
  const note = () => {
    const m = SNAPSHOTS[SNAP].meta;
    document.getElementById("snapnote").textContent =
      `${m.db} · captured ${String(m.captured_at).slice(0, 19).replace("T", " ")} UTC` +
      ` · ${m.tasks} tasks · ${m.events} events · not live`;
  };
  bar.querySelectorAll("[data-snap]").forEach((b) =>
    b.addEventListener("click", () => {
      SNAP = +b.dataset.snap;
      history.replaceState(null, "", SNAP ? "?snap=" + SNAP : location.pathname);
      bar.querySelectorAll("[data-snap]").forEach((x) => x.classList.toggle("on", x === b));
      note();
      LAST_PLACEMENT = {};
      load().then(() => fitWorld());
    }));
  note();
})();
"""

STYLE = """
/* The chrome was not built to carry a snapshot's confession as well as its own
   controls; give it room rather than letting either wrap. */
.chrome{gap:16px}
.condition{white-space:nowrap}
.snapbar{display:flex;align-items:center;gap:8px;flex:none}
.snaptag{font-family:var(--mono);font-size:8.5px;letter-spacing:.24em;color:var(--block);
  border:1px solid rgba(224,164,76,.4);border-radius:3px;padding:2px 7px}
.snapb{font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:var(--dim);
  background:transparent;border:1px solid var(--rule);border-radius:5px;
  padding:3px 10px;cursor:pointer}
.snapb.on{color:var(--ground);background:var(--dim);border-color:var(--dim)}
.snapnote{font-family:var(--mono);font-size:9px;color:var(--ghost);letter-spacing:.03em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
@media (max-width:1480px){.snapnote{display:none}}
@media (max-width:1080px){.snapbar .snaptag{display:none}}
/* At phone width the chrome cannot hold every control; the camera keeps the
   world itself usable, so drop the readouts and keep the things you press. */
@media (max-width:620px){
  .chrome{gap:10px;padding:0 14px}
  .rev,.zoomread,.condition{display:none}
  .name{font-size:10px;letter-spacing:.16em}
  .vb{padding:4px 8px;font-size:9.5px}
  .snapb{padding:3px 7px;font-size:9px}
  .ledger{width:min(340px,86vw)}
}
"""


# The Artifact host wraps a published page in its own skeleton, so the page is
# published as a fragment: title, style, content, script — and none of the
# document scaffolding a standalone file needs.
SKELETON = ('<!DOCTYPE html>', '<html lang="en">', "<head>", "</head>",
            "<body>", "</body>", "</html>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">')


def build(snapshots, title="Agent World", fragment=False):
    def read(name):
        with open(os.path.join(UI, name), encoding="utf-8") as fh:
            return fh.read()

    page, css, js = read("index.html"), read("world.css"), read("world.js")
    blob = json.dumps(snapshots, ensure_ascii=False).replace("</", "<\\/")
    head = SHIM.replace("__SNAPSHOTS__", blob)

    page = page.replace('<link rel="stylesheet" href="/world.css">',
                        "<style>\n%s\n%s</style>" % (css, STYLE))
    page = page.replace('<script src="/world.js"></script>',
                        "<script>\n%s\n%s\n%s</script>" % (head, js, CHROME))
    page = page.replace("<title>Agent World</title>",
                        "<title>%s</title>" % html.escape(title))
    if fragment:
        for tag in SKELETON:
            page = page.replace(tag, "")
        page = "\n".join(ln for ln in page.splitlines() if ln.strip())
    return page


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", action="append", required=True,
                    help="a world database; repeat to put several in one page")
    ap.add_argument("--label", action="append", default=[],
                    help="a name for each --db, in the same order")
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="Agent World")
    ap.add_argument("--fragment", action="store_true",
                    help="emit without the document skeleton, for a host that "
                         "supplies its own")
    a = ap.parse_args(argv)

    snaps = []
    for i, db in enumerate(a.db):
        s = capture(db)
        s["meta"]["label"] = (a.label[i] if i < len(a.label)
                              else os.path.basename(db).replace(".db", ""))
        snaps.append(s)
        print("  %-22s %d tasks · %d events · %d running"
              % (s["meta"]["label"], s["meta"]["tasks"], s["meta"]["events"],
                 s["meta"]["running"]))

    with open(a.out, "w", encoding="utf-8") as fh:
        fh.write(build(snaps, a.title, fragment=a.fragment))
    print("  wrote %s (%.0f KB)" % (a.out, os.path.getsize(a.out) / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
