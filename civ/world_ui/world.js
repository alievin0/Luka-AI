/* AGENT WORLD — the window.
   Every mark on this screen traces to a row. The server decides which station
   an agent occupies (`stage.placement`, computed in Python and tested); this
   file decides only where that station sits on the floor. Nothing moves unless
   the placement changed, and nothing is invented to make the world look busy. */
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clock = (t) => (t ? String(t).slice(11, 19) : "");
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

/* ── the five forms ────────────────────────────────────────────────
   Five silhouettes, not five recolours. Each says what the role does:
   a hub that connects, an aperture that looks, a lattice that builds,
   a caliper that measures, a rotor that drives.                      */
const FORM = {
  "AGT-ORCHESTRATOR": `
    <circle class="core" cx="37" cy="37" r="7"/>
    <path class="stroke" d="M37 30V14M37 44v16M30 33 16 24M44 33l14-9M30 41 16 50M44 41l14 9"/>
    <circle class="fillmark" cx="37" cy="12" r="3.2"/>
    <circle class="fillmark" cx="14" cy="22.5" r="3.2"/>
    <circle class="fillmark" cx="60" cy="22.5" r="3.2"/>
    <circle class="fillmark" cx="14" cy="51.5" r="3.2"/>
    <circle class="fillmark" cx="60" cy="51.5" r="3.2"/>
    <path class="stroke" d="M37 62 24 55v-14l13-7 13 7v14z" opacity=".35"/>`,
  "AGT-RESEARCHER": `
    <circle class="stroke" cx="37" cy="37" r="24"/>
    <circle class="stroke" cx="37" cy="37" r="15" opacity=".55"/>
    <circle class="core" cx="37" cy="37" r="6"/>
    <path class="stroke" d="M37 13a24 24 0 0 1 21 12" stroke-width="2.4"/>
    <path class="stroke" d="M54 54 68 68" stroke-width="2"/>
    <circle class="fillmark" cx="37" cy="37" r="2.4"/>`,
  "AGT-BUILDER": `
    <path class="stroke" d="M37 8v58"/>
    <path class="stroke" d="M19 20h36M15 33h44M19 46h36M25 59h24"/>
    <path class="stroke" d="M19 20 15 33l4 13 6 13M55 20l4 13-4 13-6 13" opacity=".4"/>
    <rect class="fillmark" x="33" y="4" width="8" height="8"/>
    <rect class="fillmark" x="11" y="29" width="7" height="7"/>
    <rect class="fillmark" x="56" y="29" width="7" height="7"/>`,
  "AGT-REVIEWER": `
    <path class="stroke" d="M18 12h-8v50h8M56 12h8v50h-8" stroke-width="1.8"/>
    <circle class="stroke" cx="37" cy="37" r="17"/>
    <path class="stroke" d="M37 20v10M37 44v10M20 37h10M44 37h10" opacity=".65"/>
    <circle class="core" cx="37" cy="37" r="5.5"/>
    <circle class="fillmark" cx="37" cy="37" r="2.2"/>`,
  "AGT-OPERATOR": `
    <circle class="stroke" cx="37" cy="37" r="23"/>
    <path class="stroke" d="M37 6v9M37 59v9M6 37h9M59 37h9M15 15l6.5 6.5M52.5 52.5 59 59M59 15l-6.5 6.5M21.5 52.5 15 59" stroke-width="2.2"/>
    <circle class="stroke" cx="37" cy="37" r="12" opacity=".5"/>
    <circle class="fillmark" cx="37" cy="37" r="6"/>`,
};
const OWNER_FORM = `
  <path class="stroke" d="M12 46h50M17 46V28l20-14 20 14v18" stroke-width="1.4"/>
  <circle class="stroke" cx="37" cy="31" r="7"/>
  <circle class="fillmark" cx="37" cy="31" r="2.6"/>`;

const TONE = {
  REVIEW_REJECT: "fail", ARTIFACT_VERIFICATION_FAILED: "fail", TASK_FAILED: "fail",
  TOOL_DENIED: "fail", TASK_REJECTED: "fail", TOOL_ERROR: "fail",
  REVIEW_APPROVE: "ok", TASK_ACCEPTED: "ok", ARTIFACT_VERIFIED: "ok",
  TASK_COMPLETED: "ok", TASK_REVIEW: "review",
};

/* What the owner is told, in words, for each counted thing. */
const SIGNAL = {
  tasks_discovered: ["work noticed", "TASK_DISCOVERED"],
  tasks_completed: ["work completed", "TASK_COMPLETED"],
  tasks_accepted: ["accepted after review", "TASK_ACCEPTED"],
  tasks_rejected: ["rejected", "TASK_REJECTED"],
  tasks_failed: ["failed", "TASK_FAILED"],
  artifacts_created: ["artifacts produced", "ARTIFACT_CREATED"],
  reviews_written: ["reviews written", "REVIEW_"],
  reviews_rejected: ["work sent back", "REVIEW_REJECT"],
  evidence_collected: ["evidence gathered", "ARTIFACT_VERIFIED"],
  facts_established: ["facts established", ""],
  memories_written: ["things remembered", ""],
  messages_sent: ["messages exchanged", "MESSAGE_"],
};

let WORLD = null, LAST_PLACEMENT = {}, SELECTED = null;
const cam = { x: 0, y: 0, k: 1 };
const PLATE_W = 1480, PLATE_H = 880;
/* The scale the plate is ACTUALLY drawn at right now, which is not cam.k while
   the camera is still moving. Every plate-space measurement divides by this. */
const K = () => ($("plate").getBoundingClientRect().width / PLATE_W) || 1;

async function get(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(path + " → " + r.status);
  return r.json();
}

/* ── load and project ──────────────────────────────────────────── */
async function load() {
  WORLD = await get("/api/world");
  renderCondition();
  renderObservatory();
  renderLine();
  renderYards();
  renderAgents();
  renderLedger();
  requestAnimationFrame(drawFlow);
}

function renderCondition() {
  const running = WORLD.running.length;
  const el = $("condition");
  el.className = "condition" + (running ? " live" : "");
  el.innerHTML = `<span class="dot"></span>` + (running
    ? `${running} agent${running > 1 ? "s" : ""} working`
    : `quiet · no agent holds a lease`);
}

function renderObservatory() {
  const a = WORLD.away, w = WORLD.world;
  $("obsmeta").textContent =
    `${w.mode} · ${Object.keys(WORLD.agents).length} agents · ` +
    `${WORLD.projects.length} project${WORLD.projects.length === 1 ? "" : "s"}`;

  const bits = [];
  for (const [k, v] of Object.entries(a.counts || {})) {
    const [phrase] = SIGNAL[k] || [k.replace(/_/g, " ")];
    const bad = k === "tasks_failed" || k === "reviews_rejected" || k === "tasks_rejected";
    bits.push(`<button class="sig ${bad ? "bad" : ""}" data-signal="${esc(k)}">
      <b>${v}</b> ${esc(phrase)}</button>`);
  }
  for (const b of a.blockers || []) {
    bits.push(`<button class="sig needs" data-task="${b.id}">
      <b>${esc((b.status || "").toLowerCase())}</b> task #${b.id} needs a decision</button>`);
  }
  if (a.decisions_waiting) {
    bits.push(`<button class="sig needs" data-signal="decisions">
      <b>${a.decisions_waiting}</b> awaiting the owner</button>`);
  }
  if (!bits.length) {
    bits.push(`<span class="sig quiet">nothing has changed since you last looked</span>`);
  }
  $("signals").innerHTML = bits.join("");

  const st = WORLD.stage;
  const occupied = st.stations.filter((s) => (st.occupancy[s.id] || []).length).length;
  $("obsfoot").innerHTML = [
    `<span>WHILE YOU WERE AWAY — every figure is a <b>COUNT(*)</b> over rows</span>`,
    `<span>line: <b>${occupied} of ${st.stations.length} stations occupied</b></span>`,
    `<span>artifacts: <b>${st.artifacts.length}</b></span>`,
    `<span>verdicts: <b>${st.verdicts.length}</b></span>`,
  ].join("");

  $("signals").querySelectorAll("[data-signal]").forEach((b) =>
    b.addEventListener("click", () => openSignal(b.dataset.signal)));
  $("signals").querySelectorAll("[data-task]").forEach((b) =>
    b.addEventListener("click", () => openRecord("task", b.dataset.task)));
}

function renderLine() {
  const st = WORLD.stage;
  $("line").innerHTML = st.stations.map((s, i) => {
    const work = st.occupancy[s.id] || [];
    const attention = work.some((t) => ["FAILED", "REJECTED", "BLOCKED"].includes(t.status));
    return `<div class="bay ${work.length ? "occupied" : ""} ${attention ? "attention" : ""}"
                 data-bay="${esc(s.id)}" data-num="${String(i + 1).padStart(2, "0")}">
      <div class="baytop"><span class="bayname">${esc(s.label.toUpperCase())}</span>
        <span class="baynum">${String(i + 1).padStart(2, "0")}</span></div>
      <div class="bayabout">${esc(s.about)}</div>
      ${work.length
        ? `<div class="baywork">${work.map((t) => `
            <div class="slot" data-taskslot="${t.task_id}" data-status="${esc(t.status)}">
              <div class="sid"><span>TASK #${t.task_id}</span><span>${esc(t.status)}</span></div>
              <div class="sobj">${esc(t.objective)}</div>
            </div>`).join("")}</div>`
        : `<div class="bayidle">— idle —</div>`}
    </div>`;
  }).join("");
  $("line").insertAdjacentHTML("afterbegin",
    `<div class="linetag">THE LINE <i>· six stations · work moves left to right</i></div>`);
  $("line").querySelectorAll("[data-taskslot]").forEach((n) =>
    n.addEventListener("click", (e) => {
      e.stopPropagation(); openRecord("task", n.dataset.taskslot);
    }));
  $("line").querySelectorAll("[data-bay]").forEach((n) =>
    n.addEventListener("click", () => focusOn(n)));
}

function renderYards() {
  const ps = WORLD.projects;
  if (!ps.length) {
    $("yards").innerHTML =
      `<div class="yardstag">PROJECT YARDS</div>` +
      `<div class="emptyyard">no project has been opened</div>`;
    return;
  }
  $("yards").innerHTML = ps.map((p) => {
    const tasks = WORLD.tasks.filter((t) => t.project_id === p.id);
    const done = tasks.filter((t) => t.status === "ACCEPTED").length;
    const bad = tasks.filter((t) => ["FAILED", "REJECTED"].includes(t.status)).length;
    return `<div class="yard" data-project="${p.id}">
      <div class="yardtop"><span class="yardid">PROJECT #${p.id}</span>
        <span class="tag">${esc(p.stage)}</span></div>
      <div class="yardobj">${esc(p.mission)}</div>
      <div class="yardbar">${tasks.map((t) =>
        `<span class="tick ${t.status === "ACCEPTED" ? "on" :
          (["FAILED", "REJECTED"].includes(t.status) ? "bad" : "")}"></span>`).join("")}</div>
      <div class="yardmeta"><span>${tasks.length} task${tasks.length === 1 ? "" : "s"}</span>
        <span>${done} accepted</span>${bad ? `<span>${bad} failed</span>` : ""}
        <span>$${(p.usd_spent || 0).toFixed(5)}</span></div>
    </div>`;
  }).join("");
  $("yards").insertAdjacentHTML("afterbegin",
    `<div class="yardstag">PROJECT YARDS <i>· a project is a place work is done</i></div>`);
  $("yards").querySelectorAll("[data-project]").forEach((n) =>
    n.addEventListener("click", () => openProject(n.dataset.project)));
}

/* Where a station sits on the floor. Layout only — the server said WHICH
   station; this says where that station is drawn. */
function bayCentre(stationId) {
  const el = document.querySelector(`[data-bay="${stationId}"]`);
  const plate = $("plate").getBoundingClientRect();
  if (!el) return { x: 740, y: 380 };
  const r = el.getBoundingClientRect(), k = K();
  // `top` is the entity's FEET (it is translated -100%), so it stands in the
  // band above the deck and never covers the station it is working at.
  return { x: (r.left - plate.left) / k + r.width / k / 2,
           y: (r.top - plate.top) / k - 30 };
}

/* The owner stands beside its instrument panel, off the line entirely. */
function ownerSpot() {
  const o = $("observatory").getBoundingClientRect();
  const p = $("plate").getBoundingClientRect();
  const k = K();
  return { x: (o.left - p.left) / k - 96, y: (o.bottom - p.top) / k - 4 };
}

function renderAgents() {
  const st = WORLD.stage;
  const host = $("agents");
  const owner = `<div class="entity owner" id="ent-owner" data-entity="owner">
    <div class="vessel"><div class="ring"></div>
      <svg viewBox="0 0 74 74">${OWNER_FORM}</svg></div>
    <div class="ename">OWNER</div>
    <div class="erole">control plane · outside the hierarchy</div>
  </div>`;
  host.innerHTML = owner + Object.entries(st.placement).map(([id, p]) => {
    const a = WORLD.agents[id] || {};
    const tools = (a.permission_scope || []).length;
    const task = p.task_id ? WORLD.tasks.find((t) => t.id === p.task_id) : null;
    return `<div class="entity" data-entity="${esc(id)}" data-state="${esc(p.state)}"
                 data-station="${esc(p.station)}" title="${esc(p.reason)}">
      <div class="vessel"><div class="ring"></div>
        <svg viewBox="0 0 74 74">${FORM[id] || ""}</svg></div>
      <div class="ename">${esc((a.name || id).toUpperCase())}</div>
      <div class="erole">${esc(a.role || "")}</div>
      <div class="estate">${esc(p.state)}</div>
      <div class="pips">${Array.from({ length: tools },
        () => `<span class="pip"></span>`).join("") ||
        `<span class="pip" style="opacity:.25"></span>`}</div>
      ${task ? `<div class="etask">#${task.id} · ${esc(short(task.objective, 42))}</div>` : ""}
    </div>`;
  }).join("");

  // place them, then let CSS move them if the station changed since last load
  requestAnimationFrame(() => {
    const o = ownerSpot(), oe = $("ent-owner");
    if (oe) { oe.classList.add("noanim"); oe.style.left = o.x + "px"; oe.style.top = o.y + "px"; }
    host.querySelectorAll("[data-station]").forEach((n) => {
      const c = bayCentre(n.dataset.station);
      const prev = LAST_PLACEMENT[n.dataset.entity];
      if (prev === undefined || prev === n.dataset.station) n.classList.add("noanim");
      n.style.left = c.x + "px";
      n.style.top = c.y + "px";
      requestAnimationFrame(() => n.classList.remove("noanim"));
      LAST_PLACEMENT[n.dataset.entity] = n.dataset.station;
    });
    drawFlow();
  });

  host.querySelectorAll("[data-entity]").forEach((n) =>
    n.addEventListener("click", () => {
      if (n.dataset.entity === "owner") return focusOn($("observatory"));
      select(n); openAgent(n.dataset.entity);
    }));
}

function select(node) {
  document.querySelectorAll(".entity.selected").forEach((n) =>
    n.classList.remove("selected"));
  if (node) node.classList.add("selected");
  SELECTED = node ? node.dataset.entity : null;
}

/* ── flow lines: only relationships the database holds ─────────── */
function drawFlow() {
  if (!WORLD) return;
  const svg = $("flow"), st = WORLD.stage;
  const parts = [];
  const bay = (id) => {
    const el = document.querySelector(`[data-bay="${id}"]`);
    if (!el) return null;
    const p = $("plate").getBoundingClientRect(), r = el.getBoundingClientRect();
    const k = K();
    return { x: (r.left - p.left) / k + r.width / k / 2,
             y: (r.top - p.top) / k + r.height / k / 2,
             l: (r.left - p.left) / k, rr: (r.right - p.left) / k,
             t: (r.top - p.top) / k, b: (r.bottom - p.top) / k };
  };
  // the conveyor: faint between every adjacent pair, lit where work has passed
  const reached = new Set();
  for (const s of st.stations) if ((st.occupancy[s.id] || []).length) reached.add(s.id);
  for (let i = 0; i < st.stations.length - 1; i++) {
    const a = bay(st.stations[i].id), b = bay(st.stations[i + 1].id);
    if (!a || !b) continue;
    const live = reached.has(st.stations[i].id) && reached.has(st.stations[i + 1].id);
    const col = live ? "rgba(84,216,198,.5)" : "rgba(150,172,196,.15)";
    const m = (a.rr + b.l) / 2;
    parts.push(`<path d="M${a.rr} ${a.y} H${b.l}" fill="none" stroke="${col}"
      stroke-width="${live ? 1.4 : 1}" ${live ? "" : 'stroke-dasharray="2 5"'}/>`);
    // direction: work moves one way down the line
    parts.push(`<path d="M${m - 3} ${a.y - 4} l4 4 -4 4" fill="none" stroke="${col}"
      stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  // owner → the line: authority, drawn because the objective came from there
  const obs = $("observatory").getBoundingClientRect();
  const pl = $("plate").getBoundingClientRect();
  const kk = K();
  const ox = (obs.left - pl.left) / kk + obs.width / kk / 2;
  const oy = (obs.bottom - pl.top) / kk;
  const first = bay(st.stations[0].id);
  if (first) {
    parts.push(`<path d="M${ox} ${oy} V${first.t - 26}" fill="none"
      stroke="rgba(190,212,235,.22)" stroke-width="1" stroke-dasharray="1 5"/>`);
  }
  // artifact → its review: an edge that exists because a row joins them
  for (const v of st.verdicts) {
    const art = st.artifacts.find((x) => x.id === v.artifact_id);
    if (!art) continue;
    const from = bay("verify"), to = bay("review");
    if (!from || !to) continue;
    const ok = v.verdict === "APPROVE";
    parts.push(`<path d="M${from.rr} ${from.y + 14} C ${from.rr + 30} ${from.y + 14},
      ${to.l - 30} ${to.y + 14}, ${to.l} ${to.y + 14}" fill="none"
      stroke="${ok ? "rgba(108,208,144,.4)" : "rgba(226,112,110,.4)"}" stroke-width="1.2"/>`);
  }
  svg.innerHTML = parts.join("");
}

/* ── forensic log ──────────────────────────────────────────────── */
function renderLedger() {
  const ev = WORLD.activity || [];
  $("ledgercount").textContent = ev.length + " rows";
  $("rawlist").innerHTML = ev.length ? ev.map((e) => `
    <li class="raw" data-tone="${TONE[e.kind] || ""}"
        ${e.ref ? `data-ref="${e.ref.type}:${e.ref.id}"` : ""}>
      <span class="rawt">${clock(e.at)}</span>
      <span><span class="rawa">${esc(e.actor || "—")}</span>
        <span class="rawk">${esc(e.kind.replace(/_/g, " ").toLowerCase())}
        ${e.subject ? esc(e.subject) : ""}</span></span>
    </li>`).join("") : `<li class="none">no events — the world has not been run</li>`;
  $("rawlist").querySelectorAll("[data-ref]").forEach((n) =>
    n.addEventListener("click", () => {
      const [t, i] = n.dataset.ref.split(":"); openRecord(t, i);
    }));
}
$("ledgertab").addEventListener("click", () => $("ledger").classList.toggle("on"));

/* ── camera ────────────────────────────────────────────────────── */
function applyCam(instant) {
  const p = $("plate");
  p.classList.toggle("nudge", !!instant);
  p.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
  $("zoomread").textContent = Math.round(cam.k * 100) + "%";
  if (instant) requestAnimationFrame(() => p.classList.remove("nudge"));
}
function frame(el, pad = 90, maxK = 1.5) {
  const view = $("world").getBoundingClientRect();
  const p = $("plate").getBoundingClientRect();
  const r = el.getBoundingClientRect(), k0 = K();
  const w = r.width / k0, h = r.height / k0;
  const k = Math.min((view.width - pad * 2) / w, (view.height - pad * 2) / h, maxK);
  const cx = (r.left - p.left) / k0 + w / 2, cy = (r.top - p.top) / k0 + h / 2;
  cam.k = k;
  cam.x = view.width / 2 - cx * k;
  cam.y = view.height / 2 - cy * k;
  applyCam();
}
function focusOn(el) { if (el) frame(el); }
function fitWorld() {
  const view = $("world").getBoundingClientRect();
  const k = Math.min(view.width / (PLATE_W + 80), view.height / (PLATE_H + 40), 1.25);
  cam.k = k;
  cam.x = (view.width - PLATE_W * k) / 2;
  cam.y = (view.height - PLATE_H * k) / 2;
  applyCam();
}
$("viewbar").addEventListener("click", (e) => {
  const z = e.target.closest("[data-zoom]"), f = e.target.closest("[data-focus]");
  if (z) {
    cam.k = Math.max(0.3, Math.min(2.2, cam.k * (z.dataset.zoom === "1" ? 1.2 : 1 / 1.2)));
    return applyCam();
  }
  if (!f) return;
  document.querySelectorAll(".vb[data-focus]").forEach((b) =>
    b.classList.toggle("on", b === f));
  if (f.dataset.focus === "world") return fitWorld();
  if (f.dataset.focus === "line") return frame($("line"), 110);
  if (f.dataset.focus === "observatory") return frame($("observatory"), 140, 1.1);
});
(() => {
  let drag = null;
  const w = $("world");
  w.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".entity,.slot,.yard,.sig,.ledger")) return;
    drag = { x: e.clientX - cam.x, y: e.clientY - cam.y };
    w.classList.add("dragging"); w.setPointerCapture(e.pointerId);
  });
  w.addEventListener("pointermove", (e) => {
    if (!drag) return;
    cam.x = e.clientX - drag.x; cam.y = e.clientY - drag.y; applyCam(true);
  });
  w.addEventListener("pointerup", () => { drag = null; w.classList.remove("dragging"); });
  w.addEventListener("wheel", (e) => {
    e.preventDefault();
    const view = w.getBoundingClientRect();
    const mx = e.clientX - view.left, my = e.clientY - view.top;
    const k2 = Math.max(0.3, Math.min(2.2, cam.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    cam.x = mx - (mx - cam.x) * (k2 / cam.k);
    cam.y = my - (my - cam.y) * (k2 / cam.k);
    cam.k = k2; applyCam(true);
  }, { passive: false });
})();

/* ── inspector ─────────────────────────────────────────────────── */
function show(formSvg, title, sub, html) {
  $("iform").innerHTML = formSvg ? `<svg viewBox="0 0 74 74">${formSvg}</svg>` : "";
  $("ititle").textContent = title;
  $("isub").textContent = sub || "";
  $("ibody").innerHTML = html;
  $("inspector").classList.add("on"); $("scrim").classList.add("on");
  $("inspector").setAttribute("aria-hidden", "false");
  $("ibody").querySelectorAll("[data-ref]").forEach((n) =>
    n.addEventListener("click", () => {
      const [t, i] = n.dataset.ref.split(":"); openRecord(t, i);
    }));
  $("ibody").querySelectorAll("[data-agentref]").forEach((n) =>
    n.addEventListener("click", () => openAgent(n.dataset.agentref)));
}
function hide() {
  $("inspector").classList.remove("on"); $("scrim").classList.remove("on");
  $("inspector").setAttribute("aria-hidden", "true");
  select(null);
  if (location.hash) history.replaceState(null, "", location.pathname);
}
$("iclose").addEventListener("click", hide);
$("scrim").addEventListener("click", hide);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

const blk = (h, body) => `<div class="blk"><h3>${h}</h3>${body}</div>`;
const kv = (p) => `<dl class="kv">${p.map(([k, v]) =>
  `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
const rows = (items, empty) => items.length
  ? `<div class="rows">${items.join("")}</div>` : `<div class="none">${empty}</div>`;

async function openAgent(id) {
  const a = await get("/api/agent/" + encodeURIComponent(id));
  history.replaceState(null, "", "#agent/" + encodeURIComponent(id));
  const ent = document.querySelector(`.entity[data-entity="${CSS.escape(id)}"]`);
  if (ent) { select(ent); frame(ent, 300, 1.15); }
  const place = (WORLD.stage.placement || {})[id] || {};
  const station = (WORLD.stage.stations.find((s) => s.id === place.station) || {}).label;
  let h = blk("STANDING", kv([
    ["station", `<b>${esc(station || "—")}</b>`],
    ["state", `<span class="tag on">${esc(place.state || "—")}</span>`],
    ["because", esc(place.reason || "")],
  ]));
  h += blk("IDENTITY", kv([
    ["agent_id", `<code>${esc(a.agent_id)}</code>`],
    ["role", esc(a.role)],
    ["division", `${esc(a.division)} / ${esc(a.department)}`],
    ["tier", esc(a.tier)],
    ["lifecycle", esc(a.lifecycle_state)],
    ["autonomy", esc(a.autonomy_level)],
    ["created", esc(a.created_at)],
  ]));
  h += blk("CONTRACT", `<div style="font-size:12px">${esc(a.contract.mission)}</div>`);
  h += blk("CAPABILITIES", `<div class="tags">${(a.capabilities || [])
    .map((c) => `<span class="tag">${esc(c)}</span>`).join("") || '<span class="none">none</span>'}</div>`);
  h += blk("AUTHORISED TOOLS", `<div class="tags">${(a.permission_scope || [])
    .map((c) => `<span class="tag on">${esc(c)}</span>`).join("") ||
    '<span class="none">holds no tool — it can never do the work it delegates</span>'}</div>`);
  h += blk("CURRENT TASK", a.current_task
    ? `<div class="row" data-ref="task:${a.current_task.id}"><b>#${a.current_task.id}</b>
       ${esc(a.current_task.objective)}<span class="rt">lease → ${clock(a.current_task.expires_at)}</span></div>`
    : `<div class="none">not holding a lease</div>`);
  h += blk("PROJECT", rows((a.team_of || []).map((t) =>
    `<div class="row" data-ref="project:${t.project_id}"><b>${esc(t.name)}</b>
     <span class="rt">${esc(t.seat)}</span></div>`), "not on a team"));
  h += blk("ARTIFACTS", rows((a.artifacts || []).map((x) =>
    `<div class="row" data-ref="artifact:${x.id}"><b>#${x.id}</b> ${esc(x.name)}
     <span class="rt">${esc(x.source)} · ${esc(x.sha.slice(0, 10))}</span></div>`),
    "produced none"));
  h += blk("REVIEWS WRITTEN", rows((a.reviews || []).map((r) =>
    `<div class="row" data-ref="artifact:${r.artifact_id}"><b>${esc(r.verdict)}</b>
     artifact #${r.artifact_id}<br>${esc(short(r.rationale, 130))}</div>`), "wrote none"));
  h += blk("MEMORY", rows((a.memory || []).map((m) =>
    `<div class="row"><span class="rt">${m.evidence_id ? "evidence #" + m.evidence_id : "no evidence"}</span>
     <b>${esc(m.scope)} · ${esc(m.kind)}</b><br>${esc(m.text)}</div>`),
    "remembers nothing yet"));
  h += blk("EVIDENCE COLLECTED", rows((a.evidence || []).map((e) =>
    `<div class="row"><b>#${e.id}</b> ${esc(e.kind)}<br>${esc(short(e.external_provenance, 90))}</div>`),
    "collected none"));
  h += blk("PERFORMANCE", kv([
    ["tool calls", esc(a.tool_calls)],
    ["denials", esc(a.tool_denials)],
    ["messages sent", esc(a.messages_sent)],
    ["transitions caused", esc(a.transitions_caused)],
    ["memories", esc(a.memories)],
  ]));
  // The provenance timeline: every knot is one row, and clicking it opens that
  // row. The colour of the knot is the KIND of record, so a reader can see the
  // shape of what an agent did — read, wrote, was judged — before reading a word.
  const tl = a.timeline || [];
  h += blk("PROVENANCE TIMELINE", tl.length
    ? `<div class="spine">${tl.map((t) => {
        const link = t.kind === "tool" ? (t.decision === "ALLOW" ? "tool_call" : "denied")
          : t.kind === "artifact" ? "artifact"
          : t.kind === "review" ? "review" : "transition";
        return `<div class="knot" data-link="${link}"
          ${t.ref ? `data-ref="${t.ref.type}:${t.ref.id}"` : ""}>
          <div class="kl">${clock(t.at)} · ${esc(t.kind)}</div>
          <div class="kt"><b>${esc(t.text)}</b>${t.why
            ? `<br><span style="color:var(--ghost)">${esc(short(t.why, 120))}</span>` : ""}</div>
        </div>`;
      }).join("")}</div>`
    : `<div class="none">has not acted yet</div>`);
  show(FORM[id], (a.name || id).toUpperCase(), a.role + " · " + a.agent_id, h);
}

async function openProject(id) {
  const p = await get("/api/project/" + id);
  history.replaceState(null, "", "#project/" + id);
  let h = blk("PASSPORT", kv([
    ["objective", esc(p.objective)],
    ["owner", esc(p.owner)],
    ["status", `<span class="tag on">${esc(p.status)}</span>`],
    ["team", (p.team || []).map((m) =>
      `<span class="tag" data-agentref="${esc(m.agent)}" style="cursor:pointer">${esc(m.agent)}</span>`
    ).join(" ") || "—"],
    ["cost", `$${(p.costs.usd_spent || 0).toFixed(5)} · ${p.costs.model_runs} model runs`],
    ["next action", esc(p.next_required_action)],
  ]));
  h += blk("TASKS", rows((p.tasks || []).map((t) =>
    `<div class="row" data-ref="task:${t.id}"><span class="rt">${esc(t.status)}</span>
     <b>#${t.id}</b> ${esc(t.objective)}
     ${t.open_conditions.length ? `<br><span style="color:var(--block)">open: ${
       esc(t.open_conditions.join("; "))}</span>` : ""}</div>`), "none"));
  h += blk("ARTIFACTS", rows((p.artifacts || []).map((a) =>
    `<div class="row" data-ref="artifact:${a.id}"><b>#${a.id}</b> ${esc(a.name)}
     <span class="rt">${esc(a.by)}</span></div>`), "none"));
  h += blk("EVIDENCE", rows((p.evidence || []).map((e) =>
    `<div class="row"><b>#${e.id}</b> ${esc(e.kind)}<br>${esc(short(e.external_provenance, 92))}</div>`),
    "none"));
  h += blk("CLAIMS", rows((p.claims || []).map((c) =>
    `<div class="row"><span class="rt">${c.evidence_id ? "evidence #" + c.evidence_id : "unbacked"}</span>
     <b>${esc(c.status)}</b><br>${esc(c.text)}</div>`), "none"));
  h += blk("REVIEWS", rows((p.reviews || []).map((r) =>
    `<div class="row" data-ref="artifact:${r.artifact_id}"><b>${esc(r.verdict)}</b>
     by ${esc(r.reviewer)}<br>${esc(short(r.rationale, 130))}</div>`), "none"));
  h += blk("FAILURES", rows((p.failures || []).map((f) =>
    `<div class="row" data-ref="task:${f.id}"><b>#${f.id}</b> ${esc(f.objective)}</div>`), "none"));
  h += blk("DECISIONS", rows((p.decisions || []).map((d) =>
    `<div class="row"><b>${esc(d.decision || "open")}</b> ${esc(d.question)}</div>`), "none"));
  h += blk("TIMELINE", `<div class="spine">${(p.activity || []).map((a) =>
    `<div class="knot"><div class="kl">${clock(a.at)} · ${esc(a.actor)}</div>
     <div class="kt">${esc(a.kind.replace(/_/g, " ").toLowerCase())}
     ${a.subject ? `<b>${esc(a.subject)}</b>` : ""}</div></div>`).join("")}</div>`);
  show(null, "PROJECT #" + p.project_id, p.name, h);
}

async function openRecord(kind, id) {
  const r = await get(`/api/record/${kind}/${id}`);
  history.replaceState(null, "", `#${kind}/${id}`);
  if (r.error) return show(null, kind.toUpperCase(), "", `<div class="none">${esc(r.error)}</div>`);
  const row = r.row;
  let h = blk("RECORD", kv(Object.entries(row)
    .filter(([, v]) => v !== null && v !== "" && String(v).length < 400)
    .map(([k, v]) => [k, esc(String(v))])));
  if (r.conditions) {
    h += blk("COMPLETION CONDITIONS", rows(r.conditions.map((c) =>
      `<div class="row"><span class="rt">${c.satisfied ? "met" : "OPEN"}</span>
       <b>${esc(c.kind)}</b> ${esc(c.description)}</div>`),
      "none declared — which would mean nothing could be checked"));
  }
  if (r.verification && r.verification.length) {
    h += blk("VERIFICATION", r.verification.map((v) => {
      const d = JSON.parse(v.detail || "{}");
      return rows((d.checks || []).map((c) =>
        `<div class="row"><span class="rt">${c.passed ? "pass" : "FAIL"}</span>
         ${esc(c.requirement)}</div>`), "no checks");
    }).join(""));
  }
  if (r.reviews) {
    h += blk("REVIEWS", rows(r.reviews.map((v) =>
      `<div class="row"><b>${esc(v.verdict)}</b> by ${esc(v.reviewer_id)}
       <br>${esc(v.rationale)}</div>`), "not reviewed"));
  }
  if (row.body) h += blk("BODY", `<pre class="body">${esc(row.body)}</pre>`);
  if (r.messages && r.messages.length) {
    h += blk("MESSAGES", rows(r.messages.map((m) =>
      `<div class="row"><span class="rt">${clock(m.at)}</span>
       <b>${esc(m.sender)} → ${esc(m.recipient)}</b> ${esc(m.kind)}
       <br><span style="color:var(--ghost)">under ${esc(m.authority)}</span></div>`), "none"));
  }
  if (r.provenance) {
    h += blk("PROVENANCE", `<div class="spine">${r.provenance.map((p) => {
      const rest = Object.fromEntries(Object.entries(p)
        .filter(([k]) => !["link", "at", "id"].includes(k)));
      return `<div class="knot" data-link="${esc(p.link)}"
        ${["artifact", "review", "task"].includes(p.link) ? `data-ref="${p.link}:${p.id}"` : ""}>
        <div class="kl">${esc(p.link.replace(/_/g, " ").toUpperCase())} #${p.id}</div>
        <div class="kt">${esc(short(Object.entries(rest)
          .map(([k, v]) => `${k}: ${v}`).join(" · "), 150))}</div></div>`;
    }).join("")}</div>`);
  }
  show(null, kind.toUpperCase() + " #" + id,
       row.name || row.objective || row.cap || "", h);
}

async function openSignal(key) {
  if (key === "decisions") {
    const open = WORLD.tasks.filter((t) => ["PROPOSED", "REVIEW"].includes(t.status));
    return show(null, "AWAITING THE OWNER", open.length + " task(s)",
      rows(open.map((t) => `<div class="row" data-ref="task:${t.id}">
        <span class="rt">${esc(t.status)}</span><b>#${t.id}</b> ${esc(t.objective)}</div>`),
        "nothing is waiting"));
  }
  const [phrase, kind] = SIGNAL[key] || [key, ""];
  const ev = (WORLD.activity || []).filter((e) => kind && e.kind.startsWith(kind));
  show(null, phrase.toUpperCase(), "the events these were counted from",
    rows(ev.map((e) => `<div class="row" ${e.ref ? `data-ref="${e.ref.type}:${e.ref.id}"` : ""}>
      <span class="rt">${clock(e.at)}</span><b>${esc(e.actor)}</b>
      ${esc(e.kind.replace(/_/g, " ").toLowerCase())}
      ${e.subject ? " · " + esc(e.subject) : ""}</div>`),
      "counted from rows outside the visible event window"));
}

/* ── deep links ────────────────────────────────────────────────── */
function route() {
  const qs = new URLSearchParams(location.search);
  // ?focus=line|observatory|world points the camera at a district, so a view
  // of the world can be linked to, captured and compared later.
  const f = qs.get("focus");
  if (f) {
    const btn = document.querySelector(`.vb[data-focus="${CSS.escape(f)}"]`);
    if (btn) btn.click();
  }
  const q = qs.get("open");
  const h = q || decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!h) return;
  const [kind, id] = h.split("/");
  if (kind === "agent") return openAgent(id);
  if (kind === "project") return openProject(id);
  if (kind) return openRecord(kind, id);
}
window.addEventListener("hashchange", () => { try { route(); } catch (e) { /* */ } });
window.addEventListener("resize", () => { fitWorld(); drawFlow(); });

load().then(() => { fitWorld(); return route(); }).catch((e) => {
  $("rawlist").innerHTML =
    `<li class="none">cannot reach the world: ${esc(e.message)}</li>`;
});
/* The world re-reads itself. It does not animate between reads; if an agent
   moves on screen it is because the server placed it somewhere else. */
setInterval(() => {
  if ($("inspector").classList.contains("on")) return;
  load().catch(() => {});
}, 5000);
