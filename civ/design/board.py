#!/usr/bin/env python3
"""Board wrapper: an SVG concept study with its title, caption and legend.

The caption is part of the deliverable, not decoration — every board has to say
which of its marks would be driven by a row and which are scaffolding."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "boards")

CSS = """
*{box-sizing:border-box}
html,body{margin:0;background:#080b0f;color:#e8ecf1;
  font:13px/1.5 "Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.board{padding:26px 34px 30px}
.head{display:flex;align-items:baseline;gap:16px;margin-bottom:4px}
.kicker{font:9px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  letter-spacing:.3em;color:#e0a44c;border:1px solid rgba(224,164,76,.4);
  border-radius:3px;padding:4px 8px}
h1{font:400 21px/1.2 inherit;letter-spacing:.005em;margin:0;color:#e8ecf1}
.dir{font:9.5px/1 ui-monospace,monospace;letter-spacing:.22em;color:#5fd4c4}
.sub{color:#8d97a4;font-size:12.5px;margin:7px 0 16px;max-width:96ch}
svg{display:block;border-radius:3px}
.lbl{font:9.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  letter-spacing:.11em;fill:#9aa6b4}
.lbl.k{fill:#e8ecf1}
.lbl.a{fill:#5fd4c4}
.lbl.w{fill:#e0a44c}
.lbl.f{fill:#d9736f}
.lbl.g{fill:#7cc48f}
.lbl.v{fill:#a98ce8}
.lbl.big{font-size:13px;letter-spacing:.2em;fill:#cfd8e2}
.lbl.tiny{font-size:8px;letter-spacing:.09em;fill:#68737f}
.legend{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:16px;
  padding-top:14px;border-top:1px solid rgba(150,172,196,.13)}
.leg{display:flex;align-items:center;gap:7px;
  font:10px ui-monospace,monospace;color:#8d97a4;letter-spacing:.04em}
.sw{width:9px;height:9px;border-radius:2px;flex:none}
.tier{margin-top:13px;display:flex;gap:26px;flex-wrap:wrap;
  font:9.5px ui-monospace,monospace;letter-spacing:.05em;color:#68737f}
.tier b{color:#9aa6b4;font-weight:400}
.t1{color:#5fd4c4}.t2{color:#7fa8d4}.t3{color:#68737f}
"""


def write(name, title, kicker, subtitle, svg, legend=(), tiers=None, direction=None):
    leg = "".join('<span class="leg"><span class="sw" style="background:%s"></span>%s</span>'
                  % (c, t) for c, t in legend)
    tr = ""
    if tiers:
        tr = '<div class="tier">%s</div>' % "".join(
            '<span><b class="%s">%s</b> %s</span>' % (k, k.upper().replace("T", "TIER "), v)
            for k, v in tiers)
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>%s</title>"
        "<style>%s</style></head><body><div class='board'>"
        "<div class='head'><span class='kicker'>%s</span><h1>%s</h1>"
        "%s</div><p class='sub'>%s</p>%s"
        "<div class='legend'>%s</div>%s</div></body></html>"
        % (title, CSS, kicker, title,
           "<span class='dir'>%s</span>" % direction if direction else "",
           subtitle, svg, leg, tr))
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name + ".html")
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(html)
    return p
