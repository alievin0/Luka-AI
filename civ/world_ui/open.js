/* THE OPEN WORLD.

   Axonometric, because a place is seen FROM somewhere and a plan view is a map.
   Every district, workspace, entity, artifact and light here is drawn from
   `/api/open`, which is computed in Python over rows and tested there. This
   file decides screen geometry and nothing else: it cannot invent a position,
   a state or a piece of work, and there is no code path in it that tries. */
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

/* ── the projection ──────────────────────────────────────────────── */
const YAW = Math.cos(30 * Math.PI / 180), PITCH = Math.sin(24 * Math.PI / 180);
const U = 15;                       // screen px per world unit
const P = (x, y, z = 0) => [(x - y) * YAW * U, ((x + y) * PITCH - z) * U];
const pt = (x, y, z = 0) => P(x, y, z).join(",");

/* ── the five entities: one grammar, five machines ───────────────── */
const FORM = {
  "AGT-ORCHESTRATOR": (c) => `
    <circle cx="0" cy="0" r="6" fill="none" stroke="${c}" stroke-width="1.4"/>
    ${[0,1,2,3,4].map(i=>{const a=(-90+i*72)*Math.PI/180;
      return `<line x1="${Math.cos(a)*7}" y1="${Math.sin(a)*7}" x2="${Math.cos(a)*15}"
        y2="${Math.sin(a)*15}" stroke="${c}" stroke-width="1.3"/>
        <circle cx="${Math.cos(a)*16.5}" cy="${Math.sin(a)*16.5}" r="2.4" fill="${c}"/>`;
      }).join("")}`,
  "AGT-RESEARCHER": (c, open) => `
    <circle cx="0" cy="0" r="15" fill="none" stroke="${c}" stroke-width="1.4"/>
    ${[0,1,2,3,4,5,6].map(i=>{const a=i*2*Math.PI/7, r0=5+open*5;
      return `<line x1="${Math.cos(a)*r0}" y1="${Math.sin(a)*r0}"
        x2="${Math.cos(a+.6)*13.5}" y2="${Math.sin(a+.6)*13.5}"
        stroke="${c}" stroke-width="1.2"/>`;}).join("")}
    <line x1="11" y1="11" x2="21" y2="21" stroke="${c}" stroke-width="1.6"/>`,
  "AGT-BUILDER": (c, open) => `
    <line x1="0" y1="-17" x2="0" y2="17" stroke="${c}" stroke-width="1.5"/>
    ${[0,1,2,3].map(i=>{const y=(-1.5+i)*(5+open*4.5), w=[9,15,15,9][i];
      return `<line x1="${-w}" y1="${y}" x2="${w}" y2="${y}" stroke="${c}"
        stroke-width="1.4"/>`;}).join("")}
    <rect x="-3" y="-21" width="6" height="6" fill="${c}"/>`,
  "AGT-REVIEWER": (c, open) => {
    const d = 15 - open * 3;
    return `<path d="M ${-d} -14 h -5 v 28 h 5" fill="none" stroke="${c}" stroke-width="1.5"/>
    <path d="M ${d} -14 h 5 v 28 h -5" fill="none" stroke="${c}" stroke-width="1.5"/>
    <circle cx="0" cy="0" r="8" fill="none" stroke="${c}" stroke-width="1.3"/>
    <line x1="-12" y1="0" x2="-4" y2="0" stroke="${c}" stroke-width="1.2"/>
    <line x1="4" y1="0" x2="12" y2="0" stroke="${c}" stroke-width="1.2"/>
    <line x1="0" y1="-12" x2="0" y2="-4" stroke="${c}" stroke-width="1.2"/>
    <line x1="0" y1="4" x2="0" y2="12" stroke="${c}" stroke-width="1.2"/>`;},
  "AGT-OPERATOR": (c, open) => `
    <circle cx="0" cy="0" r="14" fill="none" stroke="${c}" stroke-width="1.4"/>
    <circle cx="0" cy="0" r="7" fill="none" stroke="${c}" stroke-width="1.2"/>
    <circle cx="0" cy="0" r="3.5" fill="${c}"/>
    ${[0,1,2,3,4,5,6,7].map(i=>{const a=(i*45+open*20)*Math.PI/180;
      return `<line x1="${Math.cos(a)*14}" y1="${Math.sin(a)*14}"
        x2="${Math.cos(a)*19}" y2="${Math.sin(a)*19}" stroke="${c}" stroke-width="1.5"
        opacity=".7"/>`;}).join("")}`,
};
const STATE_COL = { IDLE: "#5a6673", ASSIGNED: "#7fa8d4", RUNNING: "#5fd4c4",
                    REVIEW: "#a98ce8", BLOCKED: "#e0a44c", FAILED: "#d9736f",
                    MOVING: "#8fb9d9", WAITING: "#8a94a2", UNPLACED: "#4a5460" };

let W = null, CAM = { x: 0, y: 0, k: 1 }, SEL = null, LAST = {};

async function get(p) {
  const r = await fetch(p, { cache: "no-store" });
  if (!r.ok) throw new Error(p + " → " + r.status);
  return r.json();
}

/* ── draw ────────────────────────────────────────────────────────── */
function prism(x, y, w, h, z, top, left, right) {
  const T = `${pt(x,y,z)} ${pt(x+w,y,z)} ${pt(x+w,y+h,z)} ${pt(x,y+h,z)}`;
  const L = `${pt(x,y+h,z)} ${pt(x+w,y+h,z)} ${pt(x+w,y+h,0)} ${pt(x,y+h,0)}`;
  const R = `${pt(x+w,y,z)} ${pt(x+w,y+h,z)} ${pt(x+w,y+h,0)} ${pt(x+w,y,0)}`;
  return `<polygon class="face-l" points="${L}" fill="${left}"/>
          <polygon class="face-r" points="${R}" fill="${right}"/>
          <polygon class="face-top" points="${T}" fill="${top}"/>`;
}
const quad = (x, y, w, h, cls, extra = "") =>
  `<polygon class="${cls}" points="${pt(x,y)} ${pt(x+w,y)} ${pt(x+w,y+h)} ${pt(x,y+h)}"
    ${extra}/>`;

function pool(x, y, r, col, op) {
  const [px, py] = P(x, y);
  return `<ellipse class="pool" cx="${px}" cy="${py}" rx="${r*U*1.15}" ry="${r*U*.58}"
    fill="${col}" opacity="${op}"/>`;
}

function render() {
  const draws = W.lod.draws, out = [];
  const b = W.bounds;
  out.push(`<defs>
    <filter id="soft" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="9"/></filter>
    <filter id="shad" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="4"/></filter></defs>`);
  out.push(quad(b.x0 - 4, b.y0 - 4, (b.x1 - b.x0) + 8, (b.y1 - b.y0) + 8, "gnd"));

  const items = [];        // {depth, svg} — painter's order, far first
  const push = (d, s) => items.push({ d, s });

  for (const d of W.districts) {
    const empty = !d.facilities.length && d.kind !== "projects";
    const hot = d.active > 0;
    const cls = "dist" + (d.sunken ? " sunk" : "") + (hot ? " hot" : "")
      + (empty ? " empty" : "");
    push(d.x + d.y - 0.1, quad(d.x, d.y, d.w, d.h, cls,
      `data-district="${esc(d.id)}"`));
    const [lx, ly] = P(d.x + 0.6, d.y + 0.6);
    push(d.x + d.y + d.w + d.h,
      `<text class="dlabel" x="${lx}" y="${ly - 8}">${esc(d.label.toUpperCase())}</text>
       <text class="dsub" x="${lx}" y="${ly + 4}">${esc(d.about || "")}</text>` +
      (draws.includes("facilities") || !d.facilities.length ? "" :
        `<text class="dcount" x="${lx}" y="${ly + 17}">${d.facilities.length} facilities ·
          ${d.tasks} tasks · ${d.agents.length} agents</text>`));

    if (!draws.includes("facilities")) {
      const n = d.occupants != null ? d.occupants : d.agents.length;
      if (n) {                        // ORBIT: a cluster, never N sprites
        const [cx, cy] = P(d.x + d.w / 2, d.y + d.h / 2);
        push(d.x + d.y + d.w / 2 + d.h / 2 + 2,
          `<circle class="cluster" cx="${cx}" cy="${cy - 14}" r="15"/>
           <text class="cnum" x="${cx}" y="${cy - 10}">${n}</text>`);
        if (hot) push(d.x + d.y, pool(d.x + d.w / 2, d.y + d.h / 2, 4, "#5fd4c4", .18));
      }
      continue;
    }

    for (const f of d.facilities) {
      const z = d.sunken ? -0.5 : 1.5;
      push(f.x + f.y + f.w + f.h,
        prism(f.x, f.y, f.w, f.h, z, "rgba(178,196,216,.20)",
              "rgba(120,140,164,.15)", "rgba(80,96,116,.15)"));
      if (!draws.includes("workspaces")) continue;
      for (const ws of (f.workspaces || [])) {
        const o = f.occupancy[ws.id] || { tasks: [], artifacts: [] };
        const att = o.tasks.some((t) => ["FAILED", "REJECTED", "BLOCKED"].includes(t.status));
        const busy = o.tasks.some((t) => t.status === "RUNNING");
        push(ws.x + ws.y + 0.2, quad(ws.x, ws.y, ws.w, ws.h,
          "ws" + (busy ? " hot" : att ? " att" : ""), `data-ws="${esc(ws.id)}"`));
        const [wx, wy] = P(ws.x + 0.3, ws.y + 0.3);
        push(ws.x + ws.y + 0.3,
          `<text class="wslabel" x="${wx}" y="${wy + 1}">${esc(ws.label)}</text>`);
        if (draws.includes("artifacts")) {
          o.artifacts.forEach((a, i) => {
            const ax = ws.x + 0.5 + (i % 3) * 0.9, ay = ws.y + ws.h - 1.4;
            const col = a.verdict === "APPROVE" ? "#7cc48f"
              : a.verdict === "REJECT" ? "#d9736f" : "#9fbcc9";
            push(ax + ay + 0.6, prism(ax, ay, 0.75, 0.55, 0.28, col,
              "rgba(0,0,0,.35)", "rgba(0,0,0,.5)")
              .replace(/class="face-top"/, `class="face-top slab" data-art="${a.id}"`));
          });
        }
        if (o.evidence) {
          for (let i = 0; i < Math.min(o.evidence, 9); i++) {
            const [ex, ey] = P(ws.x + 0.5 + (i % 3) * 0.8, ws.y + 0.6 + ((i / 3) | 0) * 0.7, 0.5);
            push(ws.x + ws.y + 0.7,
              `<circle cx="${ex}" cy="${ey}" r="3" fill="#bcd6de" opacity=".8"/>`);
          }
        }
      }
    }
  }

  for (const p of W.projects) {
    const cls = "plot" + (p.state === "RUNNING" ? " run"
      : p.state === "COMPLETED" ? " done"
      : (p.state === "FAILED" || p.failed) ? " fail" : "");
    push(p.x + p.y - 0.05, quad(p.x, p.y, p.w, p.h, cls, `data-project="${p.id}"`));
    const [px, py] = P(p.x + 0.5, p.y + 0.6);
    push(p.x + p.y + p.w + p.h,
      `<text class="plabel" x="${px}" y="${py}">PROJECT #${p.id} · ${esc(p.state)}</text>
       <text class="wslabel" x="${px}" y="${py + 11}">${esc(short(p.mission, 34))}</text>
       <text class="wslabel" x="${px}" y="${py + 21}">${p.tasks} tasks ·
         ${p.accepted} accepted${p.failed ? " · " + p.failed + " failed" : ""}</text>`);
  }

  if (draws.includes("agents")) {
    for (const a of Object.values(W.agents)) {
      const col = STATE_COL[a.state] || STATE_COL.IDLE;
      const work = a.state === "RUNNING";
      /* A travelling agent gets its route drawn: destination from the agent's
         own row, not inferred here. The line exists because `destination` is a
         column with something in it. */
      if (a.state === "MOVING" && a.destination && W.places
          && W.places[a.destination]) {
        const d = W.places[a.destination];
        const [gx, gy] = P(d.x + d.w / 2, d.y + d.h / 2);
        const [ax, ay] = P(a.x, a.y);
        push(a.x + a.y - 0.05,
          `<line class="route" x1="${ax}" y1="${ay}" x2="${gx}" y2="${gy}"
             stroke="${col}" stroke-width="1.1" stroke-dasharray="5 6"
             opacity=".55"/>
           <circle class="routegoal" cx="${gx}" cy="${gy}" r="4" fill="none"
             stroke="${col}" stroke-width="1.2" opacity=".7"/>`);
      }
      const [sx, sy] = P(a.x, a.y);
      const [ex, ey] = P(a.x, a.y, work ? 2.3 : 1.7);
      if (work) push(a.x + a.y - 0.02, pool(a.x, a.y, 2.6, col, .24));
      push(a.x + a.y + 0.9,
        `<ellipse cx="${sx}" cy="${sy}" rx="${U*.8}" ry="${U*.4}" fill="#000"
           opacity=".45" filter="url(#shad)"/>
         <g class="ent" data-agent="${esc(a.id)}" transform="translate(${ex},${ey})">
           <circle class="hit" cx="0" cy="0" r="30"/>
           ${work ? `<circle cx="0" cy="0" r="26" fill="${col}" opacity=".10"
             filter="url(#soft)"/>` : ""}
           <circle cx="0" cy="0" r="23" fill="none" stroke="${col}"
             stroke-width="${work ? 1.5 : 1}" opacity="${a.state === "IDLE" ? .3 : .85}"
             ${a.state === "FAILED" ? 'stroke-dasharray="80 40"' : ""}/>
           ${FORM[a.id](col, work ? 1 : 0)}
           <text class="wslabel" x="0" y="40" text-anchor="middle"
             fill="${a.state === "IDLE" ? "#6d7986" : col}">
             ${esc(a.name.toUpperCase())}</text>
           <text class="wslabel" x="0" y="50" text-anchor="middle">${esc(a.state)}</text>
         </g>`);
    }
  }

  items.sort((p, q) => p.d - q.d);
  const body = out.join("") + items.map((i) => i.s).join("");
  const svg = $("scene");
  svg.innerHTML = body;
  const [minx, miny] = P(b.x0 - 4, b.y1 + 4);
  const [maxx] = P(b.x1 + 4, b.y0 - 4);
  const [, topy] = P(b.x0 - 4, b.y0 - 4);
  const [, boty] = P(b.x1 + 4, b.y1 + 4);
  svg.setAttribute("viewBox", `${minx} ${topy - 60} ${maxx - minx} ${boty - topy + 130}`);
  svg.setAttribute("width", maxx - minx);
  svg.setAttribute("height", boty - topy + 130);

  svg.querySelectorAll("[data-agent]").forEach((n) =>
    n.addEventListener("click", (e) => { e.stopPropagation(); openAgent(n.dataset.agent); }));
  svg.querySelectorAll("[data-project]").forEach((n) =>
    n.addEventListener("click", (e) => { e.stopPropagation(); openProject(n.dataset.project); }));
  svg.querySelectorAll("[data-district]").forEach((n) =>
    n.addEventListener("click", () => openDistrict(n.dataset.district)));
  svg.querySelectorAll("[data-art]").forEach((n) =>
    n.addEventListener("click", (e) => { e.stopPropagation(); openRecord("artifact", n.dataset.art); }));
}

/* ── chrome ──────────────────────────────────────────────────────── */
function renderChrome() {
  const a = W.autonomy || {}, q = a.queue || {};
  $("cond").className = "cond" + (W.quiet ? "" : " live");
  $("cond").innerHTML = `<span class="dot"></span>` + (W.quiet
    ? "quiet · no agent holds a lease"
    : `${Object.values(W.agents).filter((x) => x.state === "RUNNING").length} working`);
  const chain = (a.chains || [])[0];
  const bits = [`queue <b>${q.READY || 0}</b>/<b>${q.CLAIMED || 0}</b>`,
    `<b>${a.opportunities || 0}</b> opportunities`,
    `<b>${a.discoveries || 0}</b> discoveries`];
  if (chain) bits.push(`chain <span class="${
    ["HALTED","ESCALATED"].includes(chain.state) ? "halt" : ""}">${
    esc(chain.state.toLowerCase())}</span> <b>$${(chain.usd_spent||0).toFixed(5)}</b>`);
  if (a.awaiting_owner) bits.push(`<span class="away"><b>${a.awaiting_owner}</b> awaiting you</span>`);
  if ((a.owner || {}).state === "AWAY") bits.push(`<span class="away">owner away</span>`);
  $("strip").innerHTML = bits.join(`<span style="opacity:.3">│</span>`);
  renderModel(a.model || {});
  $("lodtag").innerHTML = `ZOOM <b>${esc(W.lod.label)}</b> · drawing ${
    W.lod.draws.join(" · ")}${W.lod.aggregates.length
      ? ` · aggregating ${W.lod.aggregates.join(" · ")}` : ""}`;
  if (!$("zooms").children.length) {
    $("zooms").innerHTML = W.zooms.map((z) =>
      `<button class="zb" data-zoom="${esc(z.id)}">${esc(z.label)}</button>`).join("")
      + `<button class="zb" data-home="1">OBSERVATORY</button>`;
    $("zooms").addEventListener("click", (e) => {
      const z = e.target.closest("[data-zoom]"), h = e.target.closest("[data-home]");
      if (h) return focusDistrict("observatory");
      if (z) setZoom(z.dataset.zoom);
    });
  }
  $("zooms").querySelectorAll("[data-zoom]").forEach((b) =>
    b.classList.toggle("on", b.dataset.zoom === W.lod.id));
}

/* The four honest lines. An agent that did not run did not run, and this says
   so rather than letting an idle world read as a working one. */
function renderModel(m) {
  const el = $("model");
  if (!el) return;
  const off = m.model !== "ONLINE";
  el.className = "model" + (off ? " off" : "");
  el.innerHTML = [
    ["WORLD", m.world || "ONLINE", false],
    ["AGENTS", m.agents || "PERSISTENT", false],
    ["RUNTIME", m.runtime || "ONLINE", false],
    ["MODEL", m.model || "OFFLINE", off],
    ["WORK", m.work || "IDLE", (m.work || "") === "WAITING_FOR_MODEL"],
  ].map(([k, v, bad]) =>
    `<span class="mrow"><i>${k}</i><b class="${bad ? "bad" : "ok"}">${esc(v)}</b></span>`
  ).join("") + (m.why ? `<span class="mwhy">${esc(m.why)}</span>` : "")
  + (m.waiting ? `<span class="mwhy">${m.waiting} item(s) parked, not lost</span>` : "");
}

const ZOOM_K = { orbit: 0.34, district: 0.62, facility: 1.1, workspace: 1.9 };
function setZoom(id) { CAM.k = ZOOM_K[id] || 1; apply(); load(); }

function apply(instant) {
  const s = $("scene");
  s.classList.toggle("now", !!instant);
  s.style.transform = `translate(${CAM.x}px,${CAM.y}px) scale(${CAM.k})`;
  if (instant) requestAnimationFrame(() => s.classList.remove("now"));
}

function fit() {
  const v = $("world").getBoundingClientRect(), s = $("scene");
  const w = +s.getAttribute("width"), h = +s.getAttribute("height");
  CAM.k = Math.min((v.width - 80) / w, (v.height - 80) / h, 2);
  CAM.x = (v.width - w * CAM.k) / 2;
  CAM.y = (v.height - h * CAM.k) / 2;
  apply();
}

function focusDistrict(id) {
  const d = W.districts.find((x) => x.id === id);
  if (!d) return;
  const v = $("world").getBoundingClientRect(), s = $("scene");
  const vb = s.getAttribute("viewBox").split(" ").map(Number);
  const [cx, cy] = P(d.x + d.w / 2, d.y + d.h / 2);
  CAM.k = 1.25;
  CAM.x = v.width / 2 - (cx - vb[0]) * CAM.k;
  CAM.y = v.height / 2 - (cy - vb[1]) * CAM.k;
  apply();
}

/* ── inspector ───────────────────────────────────────────────────── */
const blk = (h, b) => `<div class="blk"><h3>${h}</h3>${b}</div>`;
const kv = (p) => `<dl class="kv">${p.map(([k, v]) =>
  `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;

function show(glyph, title, sub, html) {
  $("iglyph").innerHTML = glyph || "";
  $("ititle").textContent = title;
  $("isub").textContent = sub || "";
  $("ibody").innerHTML = html;
  $("insp").classList.add("on"); $("scrim").classList.add("on");
  $("ibody").querySelectorAll("[data-ref]").forEach((n) =>
    n.addEventListener("click", () => {
      const [t, i] = n.dataset.ref.split(":"); openRecord(t, i);
    }));
}
function hide() {
  $("insp").classList.remove("on"); $("scrim").classList.remove("on");
  if (location.hash) history.replaceState(null, "", location.pathname);
}
$("ix").addEventListener("click", hide);
$("scrim").addEventListener("click", hide);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

async function openAgent(id) {
  const a = await get("/api/agent/" + encodeURIComponent(id));
  history.replaceState(null, "", "#agent/" + encodeURIComponent(id));
  const here = W.agents[id] || {};
  const sp = a.spatial || {};
  const pl = sp.place || {};
  const lm = sp.last_move;
  /* Every line below is a column or a row id. There is no field here that
     could say something other than what the world recorded. */
  let h = blk("WHERE IT IS", kv([
    ["district", esc(pl.district || here.district || "—")],
    ["facility", esc(pl.facility || "—")],
    [sp.movement === "MOVING" ? "last workspace" : "workspace",
      `<b>${esc(pl.workspace || here.workspace || "—")}</b>`],
    ["position", sp.x != null ? `${sp.x.toFixed(1)}, ${sp.y.toFixed(1)}` : "—"],
    ["state", `<span class="tag on">${esc(here.state || "—")}</span>`],
    ["movement", `<span class="tag${sp.movement === "MOVING" ? " on" : ""}">${
      esc(sp.movement || "—")}</span>`],
  ]));
  h += blk("WHY IT IS THERE", kv([
    ["because", esc(sp.why || here.reason || "—")],
    ["state because", esc(here.because || "—")],
    ["activity", esc(sp.activity || "—")],
    ["task", sp.task_id ? `<span data-ref="task:${sp.task_id}">#${sp.task_id}</span>` : "—"],
    ["lease", sp.lease_id ? `#${sp.lease_id}` : "—"],
    ["since", esc(sp.moved_at || "—")],
  ]));
  if (sp.destination) h += blk("WHERE IT IS GOING", kv([
    ["destination", `<b>${esc(sp.destination_label || sp.destination)}</b>`],
    ["remaining", (sp.path || []).join(" → ") || "—"],
  ]));
  h += blk("MOVEMENT", kv([
    ["journeys", String(sp.moves == null ? "—" : sp.moves)],
    ["distance", sp.distance_travelled == null ? "—"
      : sp.distance_travelled + " units"],
    ["last move", lm ? `${esc(lm.from_workspace || "—")} → ${esc(lm.to_workspace)}` : "—"],
  ]) + (a.movements || []).slice(0, 8).map((m) =>
    `<div class="row" data-ref="movement:${m.id}"><span class="rt">${esc(m.phase)}</span>
     <b>${esc(m.from_workspace || "—")} → ${esc(m.to_workspace)}</b><br>
     <span style="color:#44505e">${esc(short(m.why, 90))}</span></div>`).join("")
    || `<div class="none">has never moved</div>`);
  h += blk("IDENTITY", kv([["agent_id", `<code>${esc(a.agent_id)}</code>`],
    ["role", esc(a.role)], ["division", esc(a.division)],
    ["lifecycle", esc(a.lifecycle_state)], ["created", esc(a.created_at)]]));
  h += blk("CONTRACT", `<div style="font-size:12px">${esc(a.contract.mission)}</div>`);
  h += blk("AUTHORISED TOOLS", (a.permission_scope || []).map((c) =>
    `<span class="tag on">${esc(c)}</span>`).join("")
    || `<span class="none">holds no tool — it can never do the work it delegates</span>`);
  h += blk("ARTIFACTS", (a.artifacts || []).map((x) =>
    `<div class="row" data-ref="artifact:${x.id}"><b>#${x.id}</b> ${esc(x.name)}
     <span class="rt">${esc((x.sha || "").slice(0, 10))}</span></div>`).join("")
    || `<div class="none">produced none</div>`);
  h += blk("MEMORY", (a.memory || []).map((m) =>
    `<div class="row"><span class="rt">${m.evidence_id ? "evidence #" + m.evidence_id
      : "no evidence"}</span><b>${esc(m.kind)}</b><br>${esc(m.text)}</div>`).join("")
    || `<div class="none">remembers nothing yet</div>`);
  h += blk("TIMELINE", (a.timeline || []).slice(0, 14).map((t) =>
    `<div class="row" ${t.ref ? `data-ref="${t.ref.type}:${t.ref.id}"` : ""}>
     <b>${esc(t.text)}</b>${t.why ? `<br><span style="color:#44505e">${
       esc(short(t.why, 110))}</span>` : ""}</div>`).join("")
    || `<div class="none">has not acted yet</div>`);
  show(`<g transform="translate(37,37) scale(1.1)">${
    FORM[id](STATE_COL[here.state] || "#5fd4c4", 1)}</g>`,
    (a.name || id).toUpperCase(), a.role + " · " + a.agent_id, h);
}

async function openProject(id) {
  const p = await get("/api/project/" + id);
  history.replaceState(null, "", "#project/" + id);
  let h = blk("PASSPORT", kv([["objective", esc(p.objective)], ["owner", esc(p.owner)],
    ["status", `<span class="tag on">${esc(p.status)}</span>`],
    ["team", (p.team || []).map((m) => `<span class="tag">${esc(m.agent)}</span>`).join("") || "—"],
    ["cost", `$${(p.costs.usd_spent || 0).toFixed(5)} · ${p.costs.model_runs} model runs`],
    ["next action", esc(p.next_required_action)]]));
  for (const [label, rows, fmt] of [
    ["TASKS", p.tasks, (t) => `<div class="row" data-ref="task:${t.id}">
      <span class="rt">${esc(t.status)}</span><b>#${t.id}</b> ${esc(t.objective)}</div>`],
    ["ARTIFACTS", p.artifacts, (a) => `<div class="row" data-ref="artifact:${a.id}">
      <b>#${a.id}</b> ${esc(a.name)}<span class="rt">${esc(a.by)}</span></div>`],
    ["REVIEWS", p.reviews, (r) => `<div class="row"><b>${esc(r.verdict)}</b> by
      ${esc(r.reviewer)}<br>${esc(short(r.rationale, 120))}</div>`],
    ["FAILURES", p.failures, (f) => `<div class="row" data-ref="task:${f.id}">
      <b>#${f.id}</b> ${esc(f.objective)}</div>`]])
    h += blk(label, (rows || []).map(fmt).join("") || `<div class="none">none</div>`);
  show("", "PROJECT #" + p.project_id, p.name, h);
}

function openDistrict(id) {
  const d = W.districts.find((x) => x.id === id);
  if (!d) return;
  let h = blk("DISTRICT", kv([["kind", esc(d.kind)], ["about", esc(d.about || "")],
    ["facilities", String(d.facilities.length)], ["agents", String(d.agents.length)],
    ["active", String(d.active)], ["tasks", String(d.tasks)],
    ["artifacts", String(d.artifacts)]]));
  h += blk("FACILITIES", d.facilities.map((f) =>
    `<div class="row"><b>${esc(f.label)}</b><br>${
      (f.workspaces || []).map((w) => esc(w.label)).join(" · ")}</div>`).join("")
    || `<div class="none">ground reserved; nothing built here yet</div>`);
  show("", d.label.toUpperCase(), d.about || "", h);
}

async function openRecord(kind, id) {
  const r = await get(`/api/record/${kind}/${id}`);
  history.replaceState(null, "", `#${kind}/${id}`);
  if (r.error) return show("", kind.toUpperCase(), "", `<div class="none">${esc(r.error)}</div>`);
  let h = blk("RECORD", kv(Object.entries(r.row)
    .filter(([, v]) => v !== null && v !== "" && String(v).length < 300)
    .map(([k, v]) => [k, esc(String(v))])));
  if (r.reviews) h += blk("REVIEWS", r.reviews.map((v) =>
    `<div class="row"><b>${esc(v.verdict)}</b> by ${esc(v.reviewer_id)}<br>${
      esc(v.rationale)}</div>`).join("") || `<div class="none">not reviewed</div>`);
  if (r.row.body) h += blk("BODY",
    `<pre style="font:10.5px var(--mono);color:#9caaba;background:#06080b;
      border:1px solid var(--rule);border-radius:4px;padding:11px;white-space:pre-wrap;
      max-height:300px;overflow:auto">${esc(r.row.body)}</pre>`);
  show("", `${kind.toUpperCase()} #${id}`, "", h);
}

/* ── camera ──────────────────────────────────────────────────────── */
(() => {
  let drag = null;
  const w = $("world");
  w.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".ent,[data-project],[data-art]")) return;
    drag = { x: e.clientX - CAM.x, y: e.clientY - CAM.y };
    w.classList.add("drag"); w.setPointerCapture(e.pointerId);
  });
  w.addEventListener("pointermove", (e) => {
    if (!drag) return;
    CAM.x = e.clientX - drag.x; CAM.y = e.clientY - drag.y; apply(true);
  });
  w.addEventListener("pointerup", () => { drag = null; w.classList.remove("drag"); });
  w.addEventListener("wheel", (e) => {
    e.preventDefault();
    const v = w.getBoundingClientRect();
    const mx = e.clientX - v.left, my = e.clientY - v.top;
    const k2 = Math.max(0.2, Math.min(2.6, CAM.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    CAM.x = mx - (mx - CAM.x) * (k2 / CAM.k);
    CAM.y = my - (my - CAM.y) * (k2 / CAM.k);
    CAM.k = k2; apply(true);
    clearTimeout(w._t); w._t = setTimeout(load, 220);   // LOD follows the camera
  }, { passive: false });
})();

/* ── load ────────────────────────────────────────────────────────── */
async function load(firstTime) {
  W = await get("/api/open?scale=" + CAM.k.toFixed(3));
  renderChrome();
  render();
  if (firstTime) fit();
}

/* The first view is the one that has to say "this is a place someone works in",
   so it opens at FACILITY detail framed on the built districts — the Observatory
   and the reserved expansion ground are out there, and ORBIT goes and finds them. */
function openingView() {
  const built = W.districts.filter((d) => !d.off_plate && d.kind !== "expansion");
  const x0 = Math.min(...built.map((d) => d.x)), y0 = Math.min(...built.map((d) => d.y));
  const x1 = Math.max(...built.map((d) => d.x + d.w));
  const y1 = Math.max(...built.map((d) => d.y + d.h));
  const v = $("world").getBoundingClientRect(), s = $("scene");
  const vb = s.getAttribute("viewBox").split(" ").map(Number);
  const corners = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  const sx0 = Math.min(...corners.map((c) => c[0])), sx1 = Math.max(...corners.map((c) => c[0]));
  const sy0 = Math.min(...corners.map((c) => c[1])), sy1 = Math.max(...corners.map((c) => c[1]));
  CAM.k = Math.min((v.width - 120) / (sx1 - sx0), (v.height - 150) / (sy1 - sy0), 1.5);
  CAM.x = v.width / 2 - ((sx0 + sx1) / 2 - vb[0]) * CAM.k;
  CAM.y = v.height / 2 - ((sy0 + sy1) / 2 - vb[1]) * CAM.k;
  apply();
}

function route() {
  const q = new URLSearchParams(location.search).get("open");
  const h = q || decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!h) return;
  const [kind, id] = h.split("/");
  if (kind === "agent") return openAgent(id);
  if (kind === "project") return openProject(id);
  if (kind === "district") return openDistrict(id);
  if (kind) return openRecord(kind, id);
}
window.addEventListener("hashchange", () => { try { route(); } catch (e) { /* */ } });
window.addEventListener("resize", () => fit());

load(true)
  .then(() => load())            // re-read at the opening scale, so LOD matches
  .then(() => { openingView(); return load(); })
  .then(route).catch((e) => {
  $("lodtag").textContent = "cannot reach the world: " + e.message;
});
/* The world re-reads itself. It does not animate between reads: an entity moves
   only because the server placed it somewhere else. */
setInterval(() => {
  if ($("insp").classList.contains("on")) return;
  load().catch(() => {});
}, 5000);
