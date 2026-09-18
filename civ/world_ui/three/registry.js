/* THE AGENT REGISTRY — every persistent identity, and the body it owns.

   This page exists to answer one question honestly: does the same agent always
   look the same? It builds each body from the stored appearance row and from
   nothing else, on a neutral plinth, with no state colour and no activity. If
   two reloads ever differ, the design system is broken and this page shows it.

   It is deliberately NOT a picture of the world: nobody here is working, and no
   pose on this page means anything. The poses are the registry's own idle
   stance so the geometry can be read. */
import * as THREE from "../vendor/three.module.min.js";
import { buildBody, poseBody, ANIMS } from "./bodies.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const renderer = new THREE.WebGLRenderer({ canvas: $("stage"), antialias: true,
                                           alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.62;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0x7d96ac, 0x141d26, 2.6));
scene.add(new THREE.AmbientLight(0x48606f, 1.05));
const key = new THREE.DirectionalLight(0xe4eef7, 3.3);
key.position.set(2.6, 5.2, 3.4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = key.shadow.camera.bottom = -3;
key.shadow.camera.right = key.shadow.camera.top = 3;
scene.add(key);
const rim = new THREE.DirectionalLight(0x8fc0da, 1.5);
rim.position.set(-3.2, 2.4, -3.0);
scene.add(rim);
// A dark palette against a dark ground is a silhouette, and a silhouette tells
// you nothing about the finish. The catalogue lights the front so brushed,
// ceramic and matte are actually distinguishable.
const front = new THREE.DirectionalLight(0xc9dae8, 1.35);
front.position.set(0.4, 1.2, 4.2);
scene.add(front);

/* A plinth, so a body is standing ON something and casts a shadow onto it —
   a floating figure reads as a sprite. */
const plinth = new THREE.Group();
const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.92, 0.06, 48),
  new THREE.MeshStandardMaterial({ color: 0x1a232b, roughness: 0.82, metalness: 0.1 }));
disc.position.y = -0.03;
disc.receiveShadow = true;
plinth.add(disc);
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.006, 6, 60),
  new THREE.MeshBasicMaterial({ color: 0x37505d }));
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.002;
plinth.add(ring);

const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
const CELLS = [];          // { el, group, body, spin }

function cell(el, app, lod) {
  const g = new THREE.Group();
  g.add(plinth.clone());
  const body = buildBody(THREE, app, { lod });
  g.add(body);
  scene.add(g);
  const c = { el, group: g, body, lod,
              // The turntable is the REGISTRY's own presentation, not the
              // world's: a catalogue entry rotates so you can see the back of
              // it. Nothing in the world does this.
              spin: 0 };
  CELLS.push(c);
  return c;
}

function draw(t) {
  const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
  renderer.setViewport(0, 0, W, H);
  renderer.setScissor(0, 0, W, H);
  renderer.clear();
  for (const c of CELLS) {
    const r = c.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H || r.width < 2) { c.group.visible = false; continue; }
    c.group.visible = true;
    for (const o of CELLS) o.group.visible = (o === c);
    const bottom = H - r.bottom;
    renderer.setViewport(r.left, bottom, r.width, r.height);
    renderer.setScissor(r.left, bottom, r.width, r.height);
    camera.aspect = r.width / r.height;
    const h = c.body.userData.height || 1.78;
    c.group.rotation.y = c.spin + t * 0.16;
    camera.position.set(0, h * 0.60, h * 2.15);
    camera.lookAt(0, h * 0.50, 0);
    camera.updateProjectionMatrix();
    poseBody(c.body, "idle", t, c.spin * 3.0);
    renderer.render(scene, camera);
  }
  for (const o of CELLS) o.group.visible = true;
}

let t0 = performance.now();
function tick(now) {
  draw((now - t0) / 1000);
  requestAnimationFrame(tick);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
}
addEventListener("resize", resize);

const sw = (hex) => `<span class="sw" style="background:${esc(hex)}"></span>`;

async function main() {
  const W = await (await fetch("/api/world3d")).json();
  const bodies = Object.entries(W.bodies || {})
    .sort((a, b) => (a[1].appearance?.body_id || "").localeCompare(
      b[1].appearance?.body_id || ""));
  const out = [];
  for (const [id, e] of bodies) {
    const a = e.appearance;
    if (!a) continue;
    out.push(`<div class="card" data-agent="${esc(id)}">
      <div class="slot"></div>
      <div class="meta">
        <b>${esc((W.agents[id] || {}).name || id)}</b>
        <span class="bid">${esc(a.body_id)} · ${esc(a.marking)}</span>
        <dl>
          <dt>build</dt><dd>${esc(a.build)} · ${(+a.height).toFixed(2)} m</dd>
          <dt>frame</dt><dd>${esc(a.body_variant)} / ${esc(a.head_variant)}
            / ${esc(a.chest_variant)} / ${esc(a.sensor_variant)}</dd>
          <dt>palette</dt><dd>${sw(a.primary_color)}${sw(a.secondary_color)}${sw(a.accent_color)}
            ${esc(a.palette)}</dd>
          <dt>finish</dt><dd>${esc(a.material)}</dd>
          <dt>carries</dt><dd>${esc(a.equipment || "nothing")}</dd>
        </dl>
      </div></div>`);
  }
  $("cards").innerHTML = out.join("") ||
    `<p class="lede">No agent has a body yet. That is a real answer: bodies are
     written when agents are founded, and this world has not founded any.</p>`;
  document.querySelectorAll("#cards .card").forEach((el, i) => {
    const [, e] = bodies[i];
    cell(el.querySelector(".slot"), e.appearance, "near").spin = i * 0.9;
  });

  // the three tiers, on whichever body the registry lists first
  if (bodies.length) {
    const a = bodies[0][1].appearance;
    $("tiers").innerHTML = ["near", "mid", "far"].map((l) =>
      `<div class="card"><div class="lab">${l.toUpperCase()}</div>
       <div class="slot"></div></div>`).join("");
    document.querySelectorAll("#tiers .slot").forEach((el, i) =>
      cell(el, a, ["near", "mid", "far"][i]));
  }

  const combos = 6 * 5 * 4 * 4 * 16 * 3;
  $("note").innerHTML =
    `<b>${bodies.length}</b> persistent identities, each holding one body row. The
     grammar behind them is 6 body frames × 5 optical systems × 4 chest plates ×
     4 sensor fittings × 16 industrial palettes × 3 builds =
     <b>${combos.toLocaleString()}</b> distinct combinations before equipment and
     height, all derived from <code>sha256(agent_id)</code> and then written down.
     Role decides what an agent CARRIES, never what colour it is: two researchers
     get two different palettes. ${ANIMS.length} animations exist and every one of
     them corresponds to a state the database can actually be in — there is no
     animation for looking busy.`;
  resize();
  requestAnimationFrame(tick);
}

main().catch((e) => {
  $("note").textContent = "could not read the world: " + e.message;
});
