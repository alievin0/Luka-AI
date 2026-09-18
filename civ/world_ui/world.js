/* Agent World — the window.
   Everything rendered here arrives from /api/*, which reads the world database.
   There is no local state that can outlive a fetch, and nothing is synthesised
   to make the world look busier than it is. */
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clock = (ts) => (ts ? String(ts).slice(11, 19) : "");
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

const GLYPH = {
  "AGT-ORCHESTRATOR": "⬡", "AGT-RESEARCHER": "◈", "AGT-BUILDER": "▦",
  "AGT-REVIEWER": "◎", "AGT-OPERATOR": "⬢",
};
const TONE = {
  REVIEW_REJECT: "fail", ARTIFACT_VERIFICATION_FAILED: "fail", TASK_FAILED: "fail",
  TOOL_DENIED: "fail", TASK_REJECTED: "fail",
  REVIEW_APPROVE: "ok", TASK_ACCEPTED: "ok", ARTIFACT_VERIFIED: "ok",
  TASK_COMPLETED: "ok", TASK_REVIEW: "review",
};

let WORLD = null;

async function get(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(path + " -> " + r.status);
  return r.json();
}

/* ── the world ─────────────────────────────────────────────── */
async function load() {
  WORLD = await get("/api/world");
  renderMeta(); renderAway(); renderAgents(); renderStream();
  renderProjects(); renderTasks();
  requestAnimationFrame(drawWires);
}

function renderMeta() {
  const w = WORLD.world, n = Object.keys(WORLD.agents).length;
  const running = WORLD.running.length;
  $("worldmeta").innerHTML = [
    `mode <b>${esc(w.mode)}</b>`,
    `agents <b>${n}</b>`,
    `projects <b>${WORLD.projects.length}</b>`,
    `tasks <b>${WORLD.tasks.length}</b>`,
    running ? `running <b>${running}</b>` : `<span>quiet — no agent holds a lease</span>`,
  ].join("");
  $("pulse").querySelector("span").textContent = running
    ? running + " agent" + (running > 1 ? "s" : "") + " working"
    : "idle · nothing is running";
}

function renderAway() {
  const a = WORLD.away, el = $("away");
  const bits = [`<span class="lbl">WHILE YOU WERE AWAY</span>`];
  const entries = Object.entries(a.counts || {});
  if (!entries.length && !a.decisions_waiting && !(a.blockers || []).length) {
    bits.push(`<span class="chip quiet">nothing changed</span>`);
  }
  for (const [k, v] of entries) {
    bits.push(`<span class="chip" data-away="${esc(k)}"><b>${v}</b> ${esc(k.replace(/_/g, " "))}</span>`);
  }
  if (a.decisions_waiting) {
    bits.push(`<span class="chip alert" data-away="decisions"><b>${a.decisions_waiting}</b> awaiting owner</span>`);
  }
  for (const b of a.blockers || []) {
    bits.push(`<span class="chip alert" data-task="${b.id}"><b>${esc((b.status || "").toLowerCase())}</b> task #${b.id}</span>`);
  }
  el.innerHTML = bits.join("");
  el.querySelectorAll("[data-away]").forEach((c) =>
    c.addEventListener("click", () => openAway(c.dataset.away)));
  el.querySelectorAll("[data-task]").forEach((c) =>
    c.addEventListener("click", () => openRecord("task", c.dataset.task)));
}

function agentNode(id) {
  const a = WORLD.agents[id];
  if (!a) return "";
  const t = a.current_task;
  return `<div class="node agent" data-agent="${esc(id)}" data-state="${esc(a.state)}">
    <div class="glyph"><span>${GLYPH[id] || "○"}</span></div>
    <div class="nlabel">${esc(a.name.toUpperCase())}</div>
    <div class="nsub">${esc(a.role)}</div>
    <div class="nstate">${esc(a.state)}</div>
    <div class="ncaps">${esc((a.permission_scope || []).join(" · ") || "no tools")}</div>
    ${t ? `<div class="ntask">task #${t.id} · ${esc(short(t.objective, 46))}</div>` : ""}
  </div>`;
}

function renderAgents() {
  const coord = WORLD.structure.find((s) => s.tier === "above");
  $("tier-coord").innerHTML = coord.agents.map(agentNode).join("");
  $("divisions").innerHTML = WORLD.structure
    .filter((s) => s.tier === "work")
    .map((d) => `<div class="division" data-div="${esc(d.id)}">
        <div class="dname">${esc(d.label.toUpperCase())}</div>
        ${d.agents.map(agentNode).join("")}
      </div>`).join("");
  document.querySelectorAll("[data-agent]").forEach((n) =>
    n.addEventListener("click", () => openAgent(n.dataset.agent)));
}

/* Wires are drawn between elements that exist, for relationships the database
   actually holds. Nothing decorative is added to fill space. */
function drawWires() {
  const svg = $("wires"), box = $("canvas").getBoundingClientRect();
  const at = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2,
             top: r.top - box.top, bottom: r.bottom - box.top };
  };
  const owner = $("node-owner"), orch = document.querySelector('[data-agent="AGT-ORCHESTRATOR"]');
  if (!owner || !orch) return;
  const o = at(owner), c = at(orch);
  const parts = [line(o.x, o.bottom, c.x, c.top, true)];
  const delegated = new Set(
    (WORLD.relationships || []).filter((r) => r.kind === "delegates").map((r) => r.to));
  document.querySelectorAll('.division [data-agent]').forEach((n) => {
    const p = at(n);
    parts.push(line(c.x, c.bottom, p.x, p.top, delegated.has(n.dataset.agent)));
  });
  svg.innerHTML = parts.join("");
}
function line(x1, y1, x2, y2, active) {
  const my = y1 + (y2 - y1) / 2;
  return `<path d="M${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}"
    fill="none" stroke="${active ? "rgba(79,214,196,.42)" : "rgba(140,165,190,.15)"}"
    stroke-width="1" ${active ? 'stroke-dasharray="3 4"' : ""}/>`;
}

function renderStream() {
  const el = $("stream"), ev = WORLD.activity || [];
  $("activityhint").textContent = ev.length ? ev.length + " events" : "";
  if (!ev.length) {
    el.innerHTML = `<div class="quietnote">no events yet — the world has not been run</div>`;
    return;
  }
  el.innerHTML = ev.map((e) => `
    <li class="ev ${e.ref ? "ref" : ""}" data-tone="${TONE[e.kind] || ""}"
        ${e.ref ? `data-ref="${e.ref.type}:${e.ref.id}"` : ""}>
      <span class="evt">${clock(e.at)}</span>
      <span><span class="eva">${esc(e.actor || "—")}</span>
        <span class="evk">${label(e)}</span></span>
    </li>`).join("");
  el.querySelectorAll("[data-ref]").forEach((n) => n.addEventListener("click", () => {
    const [t, i] = n.dataset.ref.split(":"); openRecord(t, i);
  }));
}
/* label() returns HTML and escapes its own parts — the caller must not escape
   it again, or the <b> arrives on screen as literal text. */
function label(e) {
  const k = esc(e.kind.replace(/_/g, " ").toLowerCase());
  const s = e.subject ? ` <b>${esc(e.subject)}</b>` : "";
  return k + s;
}

function renderProjects() {
  $("projects").innerHTML = WORLD.projects.length ? WORLD.projects.map((p) => `
    <div class="card" data-project="${p.id}">
      <div class="cardtop"><span class="cid">PROJECT #${p.id}</span>
        <span class="state ${esc(p.stage)}">${esc(p.stage)}</span></div>
      <div class="cobj">${esc(p.mission)}</div>
      <div class="cmeta">${esc(p.name)} · $${(p.usd_spent || 0).toFixed(5)}</div>
    </div>`).join("") : `<div class="empty">no projects</div>`;
  document.querySelectorAll("[data-project]").forEach((n) =>
    n.addEventListener("click", () => openProject(n.dataset.project)));
}

function renderTasks() {
  $("tasks").innerHTML = WORLD.tasks.length ? WORLD.tasks.map((t) => `
    <div class="card" data-taskcard="${t.id}">
      <div class="cardtop"><span class="cid">TASK #${t.id}</span>
        <span class="state ${esc(t.status)}">${esc(t.status)}</span></div>
      <div class="cobj">${esc(short(t.objective, 96))}</div>
      <div class="cmeta">${esc(t.assignee || "unassigned")}${
        t.open_conditions.length ? " · " + t.open_conditions.length + " condition(s) open" : ""}</div>
    </div>`).join("") : `<div class="empty">no tasks</div>`;
  document.querySelectorAll("[data-taskcard]").forEach((n) =>
    n.addEventListener("click", () => openRecord("task", n.dataset.taskcard)));
}

/* ── drawer ────────────────────────────────────────────────── */
function show(title, sub, html) {
  $("dtitle").textContent = title;
  $("dsub").textContent = sub || "";
  $("dbody").innerHTML = html;
  $("drawer").classList.add("on"); $("scrim").classList.add("on");
  $("drawer").setAttribute("aria-hidden", "false");
  $("dbody").querySelectorAll("[data-ref]").forEach((n) =>
    n.addEventListener("click", () => {
      const [t, i] = n.dataset.ref.split(":"); openRecord(t, i);
    }));
  $("dbody").querySelectorAll("[data-agentref]").forEach((n) =>
    n.addEventListener("click", () => openAgent(n.dataset.agentref)));
}
function hide() {
  $("drawer").classList.remove("on"); $("scrim").classList.remove("on");
  $("drawer").setAttribute("aria-hidden", "true");
  if (location.hash) history.replaceState(null, "", location.pathname);
}
$("close").addEventListener("click", hide);
$("scrim").addEventListener("click", hide);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

const sec = (h, body) => `<div class="sec"><h3>${h}</h3>${body}</div>`;
const kv = (pairs) => `<dl class="kv">${pairs.map(([k, v]) =>
  `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
const rows = (items, empty) => items.length
  ? `<div class="rows">${items.join("")}</div>` : `<div class="empty">${empty}</div>`;

async function openAgent(id) {
  const a = await get("/api/agent/" + encodeURIComponent(id));
  history.replaceState(null, "", "#agent/" + encodeURIComponent(id));
  const c = a.contract || {};
  let h = sec("IDENTITY", kv([
    ["agent_id", `<code>${esc(a.agent_id)}</code>`],
    ["role", esc(a.role)],
    ["division", esc(a.division) + " / " + esc(a.department)],
    ["tier", esc(a.tier)],
    ["state", `<span class="state ${esc(a.state)}">${esc(a.state)}</span>`],
    ["lifecycle", esc(a.lifecycle_state)],
    ["autonomy", esc(a.autonomy_level)],
    ["created", esc(a.created_at)],
  ]));
  h += sec("CONTRACT", `<div style="font-size:12px;color:var(--ink)">${esc(c.mission)}</div>`);
  h += sec("CAPABILITIES", `<div class="tags">${
    (a.capabilities || []).map((x) => `<span class="tag">${esc(x)}</span>`).join("") ||
    '<span class="empty">none</span>'}</div>`);
  h += sec("AUTHORISED TOOLS", `<div class="tags">${
    (a.permission_scope || []).map((x) => `<span class="tag on">${esc(x)}</span>`).join("") ||
    '<span class="empty">holds no tool</span>'}</div>`);
  h += sec("CURRENT TASK", a.current_task
    ? `<div class="row" data-ref="task:${a.current_task.id}"><b>#${a.current_task.id}</b>
        ${esc(a.current_task.objective)}<span class="rt">lease to ${clock(a.current_task.expires_at)}</span></div>`
    : `<div class="empty">not holding a lease</div>`);
  h += sec("PROJECT", rows((a.team_of || []).map((t) =>
    `<div class="row" data-ref="project:${t.project_id}"><b>${esc(t.name)}</b>
      <span class="rt">${esc(t.seat)}</span></div>`), "not on a team"));
  h += sec("ARTIFACTS", rows((a.artifacts || []).map((x) =>
    `<div class="row" data-ref="artifact:${x.id}"><b>#${x.id}</b> ${esc(x.name)}
      <span class="rt">${esc(x.source)} · ${esc(x.sha.slice(0, 10))}</span></div>`),
    "produced none"));
  h += sec("REVIEWS", rows((a.reviews || []).map((r) =>
    `<div class="row" data-ref="artifact:${r.artifact_id}">
      <b>${esc(r.verdict)}</b> artifact #${r.artifact_id}<br>${esc(short(r.rationale, 120))}</div>`),
    "wrote none"));
  h += sec("MEMORY", rows((a.memory || []).map((m) =>
    `<div class="row"><b>${esc(m.scope)} · ${esc(m.kind)}</b>
      <span class="rt">${m.evidence_id ? "evidence #" + m.evidence_id : "no evidence"}</span>
      <br>${esc(m.text)}</div>`), "remembers nothing yet"));
  h += sec("EVIDENCE COLLECTED", rows((a.evidence || []).map((e) =>
    `<div class="row"><b>#${e.id}</b> ${esc(e.kind)}<br>${esc(short(e.external_provenance, 90))}</div>`),
    "collected none"));
  h += sec("TIMELINE", rows((a.timeline || []).map((t) =>
    `<div class="row" ${t.ref ? `data-ref="${t.ref.type}:${t.ref.id}"` : ""}>
      <span class="rt">${clock(t.at)}</span><b>${esc(t.kind)}</b> ${esc(t.text)}
      ${t.why ? `<br><span style="color:var(--faint)">${esc(short(t.why, 110))}</span>` : ""}</div>`),
    "has not acted yet"));
  show(a.name.toUpperCase(), a.role + " · " + a.agent_id, h);
}

async function openProject(id) {
  const p = await get("/api/project/" + id);
  history.replaceState(null, "", "#project/" + id);
  let h = sec("PASSPORT", kv([
    ["objective", esc(p.objective)],
    ["owner", esc(p.owner)],
    ["status", `<span class="state ${esc(p.status)}">${esc(p.status)}</span>`],
    ["team", (p.team || []).map((m) =>
      `<span class="tag" data-agentref="${esc(m.agent)}" style="cursor:pointer">${esc(m.agent)}</span>`).join(" ") || "—"],
    ["cost", "$" + (p.costs.usd_spent || 0).toFixed(5) + " · " + p.costs.model_runs + " model runs"],
    ["next action", esc(p.next_required_action)],
  ]));
  h += sec("TASKS", rows((p.tasks || []).map((t) =>
    `<div class="row" data-ref="task:${t.id}"><span class="rt">${esc(t.status)}</span>
      <b>#${t.id}</b> ${esc(t.objective)}
      ${t.open_conditions.length ? `<br><span style="color:var(--block)">open: ${
        esc(t.open_conditions.join("; "))}</span>` : ""}</div>`), "none"));
  h += sec("ARTIFACTS", rows((p.artifacts || []).map((a) =>
    `<div class="row" data-ref="artifact:${a.id}"><b>#${a.id}</b> ${esc(a.name)}
      <span class="rt">${esc(a.by)}</span></div>`), "none"));
  h += sec("EVIDENCE", rows((p.evidence || []).map((e) =>
    `<div class="row"><b>#${e.id}</b> ${esc(e.kind)}<br>${esc(short(e.external_provenance, 90))}</div>`),
    "none"));
  h += sec("CLAIMS", rows((p.claims || []).map((c) =>
    `<div class="row"><span class="rt">${c.evidence_id ? "evidence #" + c.evidence_id : "unbacked"}</span>
      <b>${esc(c.status)}</b><br>${esc(c.text)}</div>`), "none"));
  h += sec("REVIEWS", rows((p.reviews || []).map((r) =>
    `<div class="row" data-ref="artifact:${r.artifact_id}"><b>${esc(r.verdict)}</b>
      by ${esc(r.reviewer)}<br>${esc(short(r.rationale, 130))}</div>`), "none"));
  h += sec("FAILURES", rows((p.failures || []).map((f) =>
    `<div class="row" data-ref="task:${f.id}"><b>#${f.id}</b> ${esc(f.objective)}</div>`),
    "none"));
  h += sec("BLOCKERS", rows((p.blockers || []).map((b) =>
    `<div class="row" data-ref="task:${b.id}"><b>#${b.id}</b> ${esc(b.status)} · ${esc(b.objective)}</div>`),
    "none"));
  h += sec("TIMELINE", `<div class="rows">${(p.activity || []).map((a) =>
    `<div class="chainrow"><span>${clock(a.at)}</span><span>${esc(a.actor)} — ${
      esc(a.kind)} ${esc(a.subject || "")}</span></div>`).join("")}</div>`);
  show("PROJECT #" + p.project_id, p.name, h);
}

async function openRecord(kind, id) {
  const r = await get(`/api/record/${kind}/${id}`);
  history.replaceState(null, "", `#${kind}/${id}`);
  if (r.error) return show(kind.toUpperCase(), "", `<div class="empty">${esc(r.error)}</div>`);
  const row = r.row;
  let h = sec("RECORD", kv(Object.entries(row)
    .filter(([, v]) => v !== null && v !== "" && String(v).length < 400)
    .map(([k, v]) => [k, esc(String(v))])));
  if (r.conditions) {
    h += sec("COMPLETION CONDITIONS", rows(r.conditions.map((c) =>
      `<div class="row"><span class="rt">${c.satisfied ? "met" : "OPEN"}</span>
        <b>${esc(c.kind)}</b> ${esc(c.description)}</div>`), "none declared"));
  }
  if (r.verification && r.verification.length) {
    h += sec("VERIFICATION", r.verification.map((v) => {
      const d = JSON.parse(v.detail || "{}");
      return rows((d.checks || []).map((c) =>
        `<div class="row"><span class="rt">${c.passed ? "pass" : "FAIL"}</span>
          ${esc(c.requirement)}</div>`), "no checks");
    }).join(""));
  }
  if (r.reviews) {
    h += sec("REVIEWS", rows(r.reviews.map((v) =>
      `<div class="row"><b>${esc(v.verdict)}</b> by ${esc(v.reviewer_id)}
        <br>${esc(v.rationale)}</div>`), "not reviewed"));
  }
  if (row.body) h += sec("BODY", `<pre class="body">${esc(row.body)}</pre>`);
  if (r.messages && r.messages.length) {
    h += sec("MESSAGES", rows(r.messages.map((m) =>
      `<div class="row"><span class="rt">${clock(m.at)}</span>
        <b>${esc(m.sender)} → ${esc(m.recipient)}</b> ${esc(m.kind)}
        <br><span style="color:var(--faint)">${esc(m.authority)}</span></div>`), "none"));
  }
  if (r.provenance) {
    h += sec("PROVENANCE CHAIN", `<div>${r.provenance.map((p) => {
      const rest = Object.fromEntries(Object.entries(p).filter(
        ([k]) => !["link", "at", "id"].includes(k)));
      return `<div class="chainrow"><span>${esc(p.link)} #${p.id}</span>
        <span>${esc(short(JSON.stringify(rest), 150))}</span></div>`;
    }).join("")}</div>`);
  }
  show(kind.toUpperCase() + " #" + id, row.name || row.objective || row.cap || "", h);
}

const AWAY_TO_KIND = {
  artifacts_created: "ARTIFACT_CREATED", reviews_written: "REVIEW_",
  reviews_rejected: "REVIEW_REJECT", tasks_completed: "TASK_COMPLETED",
  tasks_accepted: "TASK_ACCEPTED", tasks_failed: "TASK_FAILED",
  tasks_rejected: "TASK_REJECTED", tasks_discovered: "TASK_DISCOVERED",
  messages_sent: "MESSAGE_", evidence_collected: "ARTIFACT_VERIFIED",
  facts_established: "", memories_written: "",
};
async function openAway(key) {
  if (key === "decisions") {
    const open = WORLD.tasks.filter((t) => ["PROPOSED", "REVIEW"].includes(t.status));
    return show("AWAITING OWNER", open.length + " task(s)", rows(open.map((t) =>
      `<div class="row" data-ref="task:${t.id}"><span class="rt">${esc(t.status)}</span>
        <b>#${t.id}</b> ${esc(t.objective)}</div>`), "nothing waiting"));
  }
  const want = AWAY_TO_KIND[key];
  const ev = (WORLD.activity || []).filter((e) => want && e.kind.startsWith(want));
  show(key.replace(/_/g, " ").toUpperCase(), "the underlying events",
    rows(ev.map((e) => `<div class="row" ${e.ref ? `data-ref="${e.ref.type}:${e.ref.id}"` : ""}>
      <span class="rt">${clock(e.at)}</span><b>${esc(e.actor)}</b> ${esc(e.kind)}
      ${e.subject ? " · " + esc(e.subject) : ""}</div>`),
      "these rows are counted from the database; no matching event is in the visible window"));
}

/* Deep links. Every record the world holds is addressable, so a finding can be
   handed to someone as a URL rather than as directions for clicking. */
function route() {
  // ?open=... as well as #...: a fragment is dropped by some capture and embed
  // paths, and a link to a record has to survive being pasted anywhere.
  const q = new URLSearchParams(location.search).get("open");
  const h = q || decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!h) return hide();
  const [kind, id] = h.split("/");
  if (kind === "agent") return openAgent(id);
  if (kind === "project") return openProject(id);
  if (kind) return openRecord(kind, id);
}
window.addEventListener("hashchange", () => route().catch(() => {}));
window.addEventListener("resize", () => requestAnimationFrame(drawWires));
load().then(() => route()).catch((e) => {
  $("stream").innerHTML = `<div class="quietnote">cannot reach the world: ${esc(e.message)}</div>`;
});
/* The world refreshes itself, but never yanks an open inspector out from under
   the reader: a panel that vanishes mid-sentence is worse than a stale one. */
setInterval(() => {
  if ($("drawer").classList.contains("on")) return;
  load().catch(() => {});
}, 5000);
