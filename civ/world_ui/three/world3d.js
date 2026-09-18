/* THE AGENT WORLD, IN THREE DIMENSIONS.

   Every building in this scene is a `world_places` row. Every agent is an
   `agent_locations` row. The renderer is told WHAT EXISTS and WHAT KIND of
   thing each one is; it is never told how to draw a research lab specifically,
   because a world that builds itself will invent facility types nobody wrote a
   special case for. It looks up the archetype and builds from that.

   What this file may NOT do, and does not:
     - move an agent that the server did not move
     - invent a state, a count, a task or an artifact
     - animate work that is not happening

   Interpolation is the one motion it owns: between two server reads an agent
   slides from the position it was at to the position it is at. Both ends come
   from the database. The slide is the picture catching up, never the truth. */
import * as THREE from "../vendor/three.module.min.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

/* ── palette ─────────────────────────────────────────────────────── */
const C = {
  ground: 0x0d1318, plate: 0x141c23, kerb: 0x1d2831,
  wall: 0x27333d, glass: 0x6f93a8, frame: 0x415463,
  live: 0x5fd4c4, warn: 0xe0a44c, bad: 0xd9736f, idle: 0x5a6673,
  moving: 0x8fb9d9, review: 0xa98ce8,
};
const STATE_COL = {
  IDLE: 0x93a4b4, ASSIGNED: 0x7fa8d4, RUNNING: 0x5fd4c4, MOVING: 0x8fb9d9,
  REVIEW: 0xa98ce8, BLOCKED: 0xe0a44c, WAITING: 0x8a94a2, FAILED: 0xd9736f,
  UNPLACED: 0x3c454f,
};

/* ── world units → scene units. y in the data is the ground plane's z. ─ */
const U = 1.0;
const P3 = (x, y, z = 0) => new THREE.Vector3(x * U, z * U, y * U);

let W = null, PREV = null, SEL = null, FOLLOW = null;
let scene, camera, renderer, raycaster, labels;
const GROUP = { districts: null, facilities: null, workspaces: null, agents: null,
                routes: null };
const AGENTS = new Map();          // id -> {root, body, ring, from, to, t}
const PICK = [];                   // meshes that can be clicked
let LEVEL = "campus";

async function get(p) {
  const r = await fetch(p, { cache: "no-store" });
  if (!r.ok) throw new Error(p + " → " + r.status);
  return r.json();
}

/* ══ SCENE ═══════════════════════════════════════════════════════════ */
function boot() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e13);
  scene.fog = new THREE.Fog(0x0b1116, 170, 520);

  camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 900);
  renderer = new THREE.WebGLRenderer({ canvas: $("stage"), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;

    // Enough sky to read the architecture. "Dark and premium" is a palette, not
  // an excuse for buildings that render as black masses.
  scene.add(new THREE.HemisphereLight(0x5c7a92, 0x0d1419, 1.5));
  scene.add(new THREE.AmbientLight(0x35485a, 0.55));
  const key = new THREE.DirectionalLight(0xd7e6f2, 1.9);
  key.position.set(-60, 88, -34);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const d = 96;
  Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d,
                                     near: 1, far: 300 });
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7d9db5, 0.85);
  fill.position.set(78, 44, 76);
  scene.add(fill);
  // A low rim from behind so roofs and parapets separate from the ground
  // instead of merging into one silhouette.
  const rim = new THREE.DirectionalLight(0x9fc0d4, 0.5);
  rim.position.set(30, 16, -90);
  scene.add(rim);

  raycaster = new THREE.Raycaster();
  labels = document.createElement("div");
  labels.id = "labels";
  document.body.appendChild(labels);

  for (const k of Object.keys(GROUP)) {
    GROUP[k] = new THREE.Group();
    scene.add(GROUP[k]);
  }
  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  };
  addEventListener("resize", resize);
  // The first sizing can land before the window has settled, which leaves the
  // scene rendered into a band across the top of a black page. Re-measure once
  // the browser has had a frame to finish laying out.
  requestAnimationFrame(resize);
  setTimeout(resize, 120);
}

/* ══ MATERIALS ═══════════════════════════════════════════════════════ */
const M = {};
function materials() {
  M.ground = new THREE.MeshStandardMaterial({ color: 0x151d24, roughness: .95, metalness: .03 });
  M.plate = new THREE.MeshStandardMaterial({ color: 0x25313b, roughness: .88, metalness: .07 });
  M.plateLive = new THREE.MeshStandardMaterial({ color: 0x27343a, roughness: .85,
    metalness: .08, emissive: C.live, emissiveIntensity: .04 });
  M.kerb = new THREE.MeshStandardMaterial({ color: 0x3a4a57, roughness: .75, metalness: .14 });
  M.wall = new THREE.MeshStandardMaterial({ color: 0x51626f, roughness: .68, metalness: .18 });
  M.roof = new THREE.MeshStandardMaterial({ color: 0x3e4e5b, roughness: .55, metalness: .34 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x5d8ba3, roughness: .14,
    metalness: .55, transparent: true, opacity: .5 });
  M.glassLit = new THREE.MeshStandardMaterial({ color: 0x4d8a8a, roughness: .14,
    metalness: .45, transparent: true, opacity: .62, emissive: C.live,
    emissiveIntensity: .5 });
  M.frame = new THREE.MeshStandardMaterial({ color: 0x7b8f9e, roughness: .42, metalness: .5 });
  M.floor = new THREE.MeshStandardMaterial({ color: 0x33414d, roughness: .85 });
  M.floorLive = new THREE.MeshStandardMaterial({ color: 0x2e4044, roughness: .82,
    emissive: C.live, emissiveIntensity: .1 });
  M.desk = new THREE.MeshStandardMaterial({ color: 0x5a6b78, roughness: .6, metalness: .22 });
  M.screen = new THREE.MeshStandardMaterial({ color: 0x132026, roughness: .28,
    emissive: 0x3f9e93, emissiveIntensity: .9 });
  M.screenOff = new THREE.MeshStandardMaterial({ color: 0x1b2a33, roughness: .35,
    emissive: 0x24383f, emissiveIntensity: .3 });
  M.rack = new THREE.MeshStandardMaterial({ color: 0x465663, roughness: .65, metalness: .33 });
  M.build = new THREE.MeshStandardMaterial({ color: C.warn, roughness: .6,
    emissive: C.warn, emissiveIntensity: .16, transparent: true, opacity: .5 });
  M.line = new THREE.LineBasicMaterial({ color: 0x6d8494, transparent: true, opacity: .7 });
}

/* ══ ARCHETYPES — a facility is drawn from its TYPE, never from its id ══ */
const BOX = new THREE.BoxGeometry(1, 1, 1);
function box(mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/* Every archetype is the same grammar in different proportions: a plinth, a
   shell with openings, a roof, and equipment. Anything unregistered gets
   `block`, which is a real building and not an error state. */
const ARCH = {
  ground: (g, p) => {},
  block:  (g, p) => shell(g, p, { rows: 2, roof: "flat" }),
  hub:    (g, p) => { shell(g, p, { rows: 3, roof: "flat", glassBand: true });
                      mast(g, p, 4.2); },
  lab:    (g, p) => { shell(g, p, { rows: 3, roof: "vault", glassBand: true }); },
  factory:(g, p) => { shell(g, p, { rows: 2, roof: "saw" }); gantry(g, p); },
  chamber:(g, p) => { shell(g, p, { rows: 2, roof: "flat", inset: .9 }); ring(g, p); },
  pad:    (g, p) => { openFrame(g, p); },
  vault:  (g, p) => { shell(g, p, { rows: 1, roof: "flat", solid: true }); },
  stacks: (g, p) => { shell(g, p, { rows: 1, roof: "flat", solid: true }); racks(g, p); },
  room:   (g, p) => {},
};

function shell(g, p, o) {
  const { x, y, w, h } = p, z = p.z || 3;
  const t = 0.16, inset = o.inset || 0;
  const cx = x + w / 2, cy = y + h / 2;
  const iw = w - inset * 2, ih = h - inset * 2;
  // plinth
  g.add(box(M.kerb, iw, 0.24, ih, cx, 0.12, cy));
  // four walls, with a glass band where the archetype wants windows
  const bandY = z * 0.56, bandH = Math.min(1.05, z * 0.3);
  for (const [dx, dz, ww, dd] of [[0, -ih / 2, iw, t], [0, ih / 2, iw, t],
                                  [-iw / 2, 0, t, ih], [iw / 2, 0, t, ih]]) {
    if (o.solid || !o.glassBand) {
      g.add(box(M.wall, ww, z, dd, cx + dx, z / 2 + 0.24, cy + dz));
    } else {
      g.add(box(M.wall, ww, bandY - 0.24, dd, cx + dx, (bandY + 0.24) / 2 + 0.12, cy + dz));
      g.add(box(M.glass, ww, bandH, dd, cx + dx, bandY + bandH / 2 + 0.24, cy + dz));
      g.add(box(M.wall, ww, Math.max(.2, z - bandY - bandH), dd, cx + dx,
                bandY + bandH + (z - bandY - bandH) / 2 + 0.24, cy + dz));
    }
  }
  // roof
  if (o.roof === "vault") {
    const span = Math.min(iw, ih) * .42;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(span, span,
      Math.max(iw, ih) * .96, 20, 1, false, 0, Math.PI), M.roof);
    r.rotation.z = Math.PI / 2;
    if (iw < ih) r.rotation.y = Math.PI / 2;
    r.position.set(cx, z + 0.3, cy);
    r.castShadow = r.receiveShadow = true;
    g.add(r);
  } else if (o.roof === "saw") {
    const n = Math.max(2, Math.round(iw / 3));
    for (let i = 0; i < n; i++) {
      const sw = iw / n;
      g.add(box(M.roof, sw * .94, .5, ih, cx - iw / 2 + sw * (i + .5), z + .48, cy));
      g.add(box(M.glassLit, sw * .5, .62, ih * .96,
                cx - iw / 2 + sw * (i + .72), z + 1.02, cy));
    }
  } else {
    g.add(box(M.roof, iw + .3, .3, ih + .3, cx, z + .38, cy));
  }
  // entrance: a real opening on the side facing the campus centre
  g.add(box(M.frame, 1.5, z * .5, .26, cx, z * .25 + .24, cy - ih / 2 - .02));
}

function mast(g, p, hgt) {
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2, z = (p.z || 3) + .4;
  g.add(box(M.frame, .18, hgt, .18, cx, z + hgt / 2, cy));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.22, 12, 10),
    new THREE.MeshStandardMaterial({ color: C.live, emissive: C.live, emissiveIntensity: 1.1 }));
  beacon.position.set(cx, z + hgt, cy);
  g.add(beacon);
}

function gantry(g, p) {
  const z = (p.z || 4) + .6;
  for (const side of [-1, 1]) {
    g.add(box(M.frame, .22, z, .22, p.x + .9, z / 2, p.y + p.h / 2 + side * (p.h / 2 - .9)));
    g.add(box(M.frame, .22, z, .22, p.x + p.w - .9, z / 2, p.y + p.h / 2 + side * (p.h / 2 - .9)));
  }
  g.add(box(M.frame, p.w - 1.4, .22, .3, p.x + p.w / 2, z, p.y + p.h / 2));
}

function ring(g, p) {
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const r = new THREE.Mesh(new THREE.TorusGeometry(Math.min(p.w, p.h) * .3, .07, 8, 40),
    M.frame);
  r.rotation.x = Math.PI / 2;
  r.position.set(cx, (p.z || 3) + .8, cy);
  g.add(r);
}

function openFrame(g, p) {
  const z = p.z || 2.6, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  g.add(box(M.kerb, p.w, .22, p.h, cx, .11, cy));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    g.add(box(M.frame, .26, z, .26, cx + dx * (p.w / 2 - .5), z / 2, cy + dz * (p.h / 2 - .5)));
  for (const [ax, w_, d_] of [[0, p.w - 1, .2], [1, .2, p.h - 1]]) {
    g.add(box(M.frame, w_, .2, d_, cx, z, cy));
  }
  const hz = new THREE.Mesh(new THREE.RingGeometry(Math.min(p.w, p.h) * .26,
    Math.min(p.w, p.h) * .3, 36),
    new THREE.MeshBasicMaterial({ color: C.warn, transparent: true, opacity: .3,
      side: THREE.DoubleSide }));
  hz.rotation.x = -Math.PI / 2;
  hz.position.set(cx, .26, cy);
  g.add(hz);
}

function racks(g, p) {
  const n = Math.max(2, Math.floor(p.w / 3));
  for (let i = 0; i < n; i++)
    g.add(box(M.rack, 1.5, (p.z || 2) * .7, p.h - 1.4,
              p.x + 1.2 + i * (p.w - 2.4) / Math.max(1, n - 1), (p.z || 2) * .35 + .24,
              p.y + p.h / 2));
}

/* ══ AGENT EMBODIMENTS — one species, five silhouettes ═══════════════
   Same grammar every time: a floating core over a base ring, in the agent's
   state colour. What changes is the superstructure, which says what the
   agent is FOR. No faces: these are machines that do a job, and a face would
   be a claim about an inner life that nothing here supports. */
const AGENT_SCALE = 2.3;
function embodiment(id, col) {
  const g = new THREE.Group();
  g.scale.setScalar(AGENT_SCALE);
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: .34, metalness: .45,
    emissive: col, emissiveIntensity: .75 });
  const thin = new THREE.MeshStandardMaterial({ color: col, roughness: .42, metalness: .38,
    emissive: col, emissiveIntensity: .5, transparent: true, opacity: .92 });
  const put = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  // the base every one of them stands on
  const base = new THREE.Mesh(new THREE.TorusGeometry(.34, .05, 8, 26), thin);
  base.rotation.x = Math.PI / 2;
  base.position.y = .05;
  g.add(base);
  // A pool on the floor. An agent standing in a dark room is otherwise a
  // silhouette against a silhouette.
  const pool = new THREE.Mesh(new THREE.CircleGeometry(.8, 28),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .22,
      side: THREE.DoubleSide, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = .02;
  g.add(pool);
  put(new THREE.CylinderGeometry(.04, .04, .5, 6), thin, 0, .3, 0);

  if (id === "AGT-ORCHESTRATOR") {
    put(new THREE.IcosahedronGeometry(.3, 1), mat, 0, 1.06, 0);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      put(new THREE.CylinderGeometry(.028, .028, .46, 5), thin,
          Math.cos(a) * .42, 1.06, Math.sin(a) * .42, 0, 0, Math.PI / 2 - a * 0);
      put(new THREE.SphereGeometry(.075, 9, 7), mat,
          Math.cos(a) * .64, 1.06, Math.sin(a) * .64);
    }
    put(new THREE.TorusGeometry(.5, .022, 6, 34), thin, 0, 1.06, 0, Math.PI / 2);
  } else if (id === "AGT-RESEARCHER") {
    put(new THREE.CylinderGeometry(.19, .23, .74, 12), mat, 0, .92, 0);
    const lens = put(new THREE.TorusGeometry(.3, .045, 8, 30), mat, 0, 1.38, .06, Math.PI / 2.6);
    put(new THREE.CircleGeometry(.27, 24),
        new THREE.MeshStandardMaterial({ color: col, emissive: col,
          emissiveIntensity: .5, transparent: true, opacity: .34,
          side: THREE.DoubleSide }), 0, 1.38, .06, Math.PI / 2.6);
    put(new THREE.CylinderGeometry(.022, .022, .5, 6), thin, .26, 1.0, -.2, 0, 0, .5);
  } else if (id === "AGT-BUILDER") {
    put(new THREE.BoxGeometry(.42, .78, .34), mat, 0, .94, 0);
    put(new THREE.BoxGeometry(.62, .1, .5), mat, 0, 1.4, 0);
    put(new THREE.CylinderGeometry(.03, .03, .62, 6), thin, .34, 1.14, .1, 0, 0, .55);
    put(new THREE.BoxGeometry(.2, .12, .2), mat, .58, .88, .16);
    put(new THREE.CylinderGeometry(.03, .03, .44, 6), thin, -.3, 1.2, -.08, 0, 0, -.7);
  } else if (id === "AGT-REVIEWER") {
    put(new THREE.SphereGeometry(.24, 16, 12), mat, 0, 1.06, 0);
    for (const s of [-1, 1]) {
      put(new THREE.BoxGeometry(.07, .8, .07), thin, s * .38, 1.06, 0);
      put(new THREE.BoxGeometry(.07, .07, .34), thin, s * .38, 1.44, .14);
      put(new THREE.BoxGeometry(.07, .07, .34), thin, s * .38, .68, .14);
    }
    put(new THREE.TorusGeometry(.32, .028, 6, 30), thin, 0, 1.06, 0, 0, 0, Math.PI / 2);
  } else {                                   // OPERATOR
    put(new THREE.CylinderGeometry(.26, .3, .5, 10), mat, 0, .78, 0);
    put(new THREE.SphereGeometry(.2, 14, 11), mat, 0, 1.18, 0);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      put(new THREE.BoxGeometry(.05, .05, .3), thin,
          Math.cos(a) * .34, 1.18, Math.sin(a) * .34, 0, -a, 0);
    }
    put(new THREE.TorusGeometry(.42, .03, 6, 30), thin, 0, .72, 0, Math.PI / 2);
  }
  return g;
}

/* ══ BUILD THE SCENE FROM ROWS ═══════════════════════════════════════ */
function place(id) { return (W.places || []).find((p) => p.id === id); }

function buildWorld() {
  for (const k of ["districts", "facilities", "workspaces", "routes"]) {
    GROUP[k].clear();
  }
  PICK.length = 0;
  const b = bounds();
  const gw = (b.x1 - b.x0) + 40, gh = (b.y1 - b.y0) + 40;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), M.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.x0 + b.x1) / 2, -0.04, (b.y0 + b.y1) / 2);
  ground.receiveShadow = true;
  GROUP.districts.add(ground);
  const grid = new THREE.GridHelper(Math.max(gw, gh), Math.round(Math.max(gw, gh) / 4),
    0x2c3d49, 0x1b262e);
  grid.position.set((b.x0 + b.x1) / 2, -0.02, (b.y0 + b.y1) / 2);
  GROUP.districts.add(grid);

  const occ = (W.occupancy || {});
  for (const p of W.places) {
    if (p.kind === "district") {
      const live = (occ.district || {})[p.id] > 0;
      const plate = box(live ? M.plateLive : M.plate, p.w, .12, p.h,
                        p.x + p.w / 2, .06, p.y + p.h / 2);
      plate.userData = { kind: "district", id: p.id };
      GROUP.districts.add(plate);
      PICK.push(plate);
      if (p.status === "RESERVED") {
        const e = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(p.w, .3, p.h)), M.line);
        e.position.set(p.x + p.w / 2, .15, p.y + p.h / 2);
        GROUP.districts.add(e);
      }
    } else if (p.kind === "facility") {
      const g = new THREE.Group();
      (ARCH[p.archetype] || ARCH.block)(g, p);
      const c = (W.constructions || {})[p.id];
      if (c && c.state === "UNDER_CONSTRUCTION") {
        g.clear();
        const e = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(p.w, p.z || 3, p.h)),
          new THREE.LineBasicMaterial({ color: C.warn }));
        e.position.set(p.x + p.w / 2, (p.z || 3) / 2, p.y + p.h / 2);
        g.add(e);
      }
      const hit = box(new THREE.MeshBasicMaterial({ visible: false }),
                      p.w, (p.z || 3) + 1, p.h, p.x + p.w / 2, (p.z || 3) / 2, p.y + p.h / 2);
      hit.userData = { kind: "facility", id: p.id };
      g.add(hit);
      PICK.push(hit);
      GROUP.facilities.add(g);
    } else {
      const busy = (occ.workspace || {})[p.id] > 0;
      const f = box(busy ? M.floorLive : M.floor, p.w, .08, p.h,
                    p.x + p.w / 2, .3, p.y + p.h / 2);
      f.userData = { kind: "workspace", id: p.id };
      GROUP.workspaces.add(f);
      PICK.push(f);
      fitOut(GROUP.workspaces, p, busy);
    }
  }
}

/* A workspace shows what actually happens in it: a desk per seat of capacity,
   and a screen that is LIT only where somebody is standing. */
function fitOut(g, p, busy) {
  const seats = Math.min(6, Math.max(1, p.capacity || 1));
  const cols = Math.min(3, seats);
  const rows = Math.ceil(seats / cols);
  for (let i = 0; i < seats; i++) {
    const c = i % cols, r = (i / cols) | 0;
    const x = p.x + p.w * (c + .5) / cols;
    const y = p.y + p.h * (r + .5) / rows;
    g.add(box(M.desk, Math.min(1.5, p.w / cols * .6), .08,
              Math.min(.8, p.h / rows * .4), x, .62, y));
    for (const s of [-1, 1])
      g.add(box(M.desk, .05, .28, .05, x + s * .4, .44, y));
    g.add(box(busy ? M.screen : M.screenOff, Math.min(1.1, p.w / cols * .45), .5, .04,
              x, .92, y - .22));
  }
}

function bounds(builtOnly) {
  const ps = W.places.filter((p) => p.kind === "district"
    && (!builtOnly || (p.status === "ACTIVE" && p.id !== "observatory")));
  return {
    x0: Math.min(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)),
    x1: Math.max(...ps.map((p) => p.x + p.w)), y1: Math.max(...ps.map((p) => p.y + p.h)),
  };
}

/* ══ AGENTS ══════════════════════════════════════════════════════════ */
function syncAgents() {
  const seen = new Set();
  for (const a of Object.values(W.agents || {})) {
    seen.add(a.id);
    let e = AGENTS.get(a.id);
    const col = STATE_COL[a.state] || STATE_COL.IDLE;
    if (!e) {
      const root = new THREE.Group();
      const body = embodiment(a.id, col);
      root.add(body);
      GROUP.agents.add(root);
      const lamp = new THREE.PointLight(col, 0, 9, 2);
      lamp.position.set(0, 2.4, 0);
      root.add(lamp);
      e = { root, body, lamp, col, from: P3(a.x, a.y), to: P3(a.x, a.y), t: 1 };
      AGENTS.set(a.id, e);
      root.position.copy(e.to);
    } else if (col !== e.col) {
      e.root.remove(e.body);
      e.body = embodiment(a.id, col);
      e.root.add(e.body);
      e.col = col;
    }
    // The only motion this file owns: slide from where the server last said it
    // was, to where the server says it is. Both are rows.
    const target = P3(a.x, a.y);
    if (!e.to.equals(target)) {
      e.from = e.root.position.clone();
      e.to = target;
      e.t = 0;
    }
    e.state = a.state;
    e.data = a;
    // A room is lit because somebody is working in it, and goes dark when they
    // stop. The light follows the lease, not the clock.
    if (e.lamp) {
      e.lamp.color.setHex(col);
      e.lamp.intensity = a.state === "RUNNING" ? 8 : a.state === "MOVING" ? 3 : 1.2;
    }
  }
  for (const [id, e] of AGENTS) {
    if (!seen.has(id)) { GROUP.agents.remove(e.root); AGENTS.delete(id); }
  }
  // routes, drawn only for an agent the database says is MOVING
  GROUP.routes.clear();
  for (const a of Object.values(W.agents || {})) {
    if (a.movement !== "MOVING" || a.dest_x == null) continue;
    const pts = [P3(a.x, a.y, .9)];
    for (const wp of (a.path || [])) {
      const q = place(wp);
      if (q) pts.push(P3(q.x + q.w / 2, q.y + q.h / 2, .9));
    }
    pts.push(P3(a.dest_x, a.dest_y, .9));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: STATE_COL.MOVING, dashSize: 1.1,
        gapSize: .8, transparent: true, opacity: .55 }));
    line.computeLineDistances();
    GROUP.routes.add(line);
    const goal = new THREE.Mesh(new THREE.RingGeometry(.5, .62, 24),
      new THREE.MeshBasicMaterial({ color: STATE_COL.MOVING, transparent: true,
        opacity: .5, side: THREE.DoubleSide }));
    goal.rotation.x = -Math.PI / 2;
    goal.position.copy(P3(a.dest_x, a.dest_y, .4));
    GROUP.routes.add(goal);
  }
}

/* ══ CAMERA ══════════════════════════════════════════════════════════ */
const CAM = { target: new THREE.Vector3(44, 0, 30), dist: 108, yaw: -0.72, pitch: 0.82 };
function applyCam() {
  CAM.pitch = Math.max(0.12, Math.min(1.45, CAM.pitch));
  CAM.dist = Math.max(6, Math.min(280, CAM.dist));
  const r = CAM.dist * Math.cos(CAM.pitch);
  camera.position.set(CAM.target.x + r * Math.sin(CAM.yaw),
                      CAM.target.y + CAM.dist * Math.sin(CAM.pitch),
                      CAM.target.z + r * Math.cos(CAM.yaw));
  camera.lookAt(CAM.target);
}

function flyTo(x, y, dist) {
  CAM.target.set(x, 0, y);
  CAM.dist = dist;
  applyCam();
}

function focusPlace(id) {
  const p = place(id);
  if (!p) return;
  flyTo(p.x + p.w / 2, p.y + p.h / 2,
        p.kind === "district" ? 58 : p.kind === "facility" ? 26 : 13);
}

/* LOD is a function of how close the camera is, and the thresholds are the same
   contract the flat world used: what is DRAWN and what is AGGREGATED. */
const LODS = [
  { id: "campus", label: "CAMPUS", above: 150, draws: ["districts"],
    aggregates: ["facilities", "workspaces", "agents"] },
  { id: "district", label: "DISTRICT", above: 74, draws: ["districts", "facilities"],
    aggregates: ["workspaces", "agents"] },
  { id: "facility", label: "FACILITY", above: 30,
    draws: ["districts", "facilities", "workspaces", "agents"], aggregates: [] },
  { id: "workspace", label: "WORKSPACE", above: 0,
    draws: ["districts", "facilities", "workspaces", "agents", "equipment"],
    aggregates: [] },
];
function levelFor(d) { return LODS.find((l) => d > l.above) || LODS[LODS.length - 1]; }

function applyLOD() {
  const l = levelFor(CAM.dist);
  LEVEL = l.id;
  // Close in, the shells become glass. A world where the agents are sealed
  // inside opaque boxes shows you a business park, not an organisation.
  const inside = l.id === "facility" || l.id === "workspace";
  for (const m of [M.wall, M.roof, M.kerb]) {
    m.transparent = inside;
    m.opacity = inside ? (m === M.roof ? .18 : .3) : 1;
    m.depthWrite = !inside;
    m.needsUpdate = true;
  }
  GROUP.facilities.visible = l.draws.includes("facilities");
  GROUP.workspaces.visible = l.draws.includes("workspaces");
  GROUP.agents.visible = l.draws.includes("agents");
  GROUP.routes.visible = l.draws.includes("agents");
  $("lod").innerHTML = `VIEW <b>${l.label}</b> · drawing ${l.draws.join(" · ")}` +
    (l.aggregates.length ? ` · counting ${l.aggregates.join(" · ")}` : "");
  document.querySelectorAll("#views .vb").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === l.id));
}

/* ══ LABELS — HTML over the canvas, positioned by projecting the scene ═ */
function drawLabels() {
  const l = levelFor(CAM.dist);
  const out = [];
  // Two agents in one room put their labels on top of each other, which read as
  // one garbled word. Nudge a label that lands on an occupied line.
  const taken = [];
  const clear = (x, y) => {
    for (let i = 0; i < 6; i++) {
      const yy = y - i * 15;
      if (!taken.some((t) => Math.abs(t.x - x) < 78 && Math.abs(t.y - yy) < 14)) {
        taken.push({ x, y: yy });
        return yy;
      }
    }
    return y;
  };
  const project = (v) => {
    const q = v.clone().project(camera);
    return { x: (q.x * .5 + .5) * innerWidth, y: (-q.y * .5 + .5) * innerHeight,
             vis: q.z < 1 };
  };
  const occ = W.occupancy || {};
  if (!l.draws.includes("facilities")) {
    for (const p of W.places.filter((x) => x.kind === "district")) {
      const n = (occ.district || {})[p.id] || 0;
      const s = project(P3(p.x + p.w / 2, p.y + p.h / 2, 3));
      if (!s.vis) continue;
      out.push(`<div class="lbl" style="left:${s.x}px;top:${s.y}px">
        <b>${esc(p.label.toUpperCase())}</b>${n ? `<span class="n">${n} agents</span>`
          : `<span>${esc(p.status === "RESERVED" ? "reserved ground" : "no one here")}</span>`}</div>`);
    }
  } else {
    for (const p of W.places.filter((x) => x.kind === "facility")) {
      const n = (occ.facility || {})[p.id] || 0;
      const s = project(P3(p.x + p.w / 2, p.y + p.h / 2, (p.z || 3) + 1.6));
      if (!s.vis) continue;
      out.push(`<div class="lbl${n ? "" : " faded"}" style="left:${s.x}px;top:${clear(s.x, s.y)}px">
        <b>${esc(p.label.toUpperCase())}</b>${n ? `<span class="n">${n} here</span>` : ""}</div>`);
    }
    if (l.draws.includes("agents")) {
      for (const [id, e] of AGENTS) {
        const s = project(e.root.position.clone().add(new THREE.Vector3(0, 2.1, 0)));
        if (!s.vis) continue;
        const a = e.data;
        out.push(`<div class="lbl agent" style="left:${s.x}px;top:${clear(s.x, s.y)}px">
          <b>${esc(a.name.toUpperCase())}</b><span>${esc(a.state)}</span></div>`);
      }
    }
  }
  labels.innerHTML = out.join("");
}

/* ══ LOOP ════════════════════════════════════════════════════════════ */
let last = performance.now();
function tick(now) {
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  for (const e of AGENTS.values()) {
    if (e.t < 1) {
      e.t = Math.min(1, e.t + dt * 1.25);
      const k = e.t < .5 ? 2 * e.t * e.t : 1 - Math.pow(-2 * e.t + 2, 2) / 2;
      e.root.position.lerpVectors(e.from, e.to, k);
      const d = e.to.clone().sub(e.from);
      if (d.lengthSq() > .01) e.root.rotation.y = Math.atan2(d.x, d.z);
    }
    // A working agent's core turns slowly. It is the ONLY idle motion in this
    // scene, it happens only while a lease exists, and it says "this one is
    // running" without claiming anything about what it is thinking.
    if (e.state === "RUNNING") e.body.rotation.y += dt * .5;
  }
  if (FOLLOW && AGENTS.has(FOLLOW)) {
    const p = AGENTS.get(FOLLOW).root.position;
    CAM.target.lerp(new THREE.Vector3(p.x, 0, p.z), .07);
    applyCam();
  }
  renderer.render(scene, camera);
  drawLabels();
  requestAnimationFrame(tick);
}

/* ══ PICKING ═════════════════════════════════════════════════════════ */
function pick(ev) {
  const m = new THREE.Vector2((ev.clientX / innerWidth) * 2 - 1,
                              -(ev.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(m, camera);
  const agentHits = raycaster.intersectObjects(
    [...AGENTS.values()].map((e) => e.root), true);
  if (agentHits.length && GROUP.agents.visible) {
    for (const [id, e] of AGENTS) {
      if (agentHits[0].object.parent === e.body || e.body.children.includes(agentHits[0].object)
          || agentHits[0].object.parent?.parent === e.root) return openAgent(id);
    }
  }
  const hits = raycaster.intersectObjects(PICK, false);
  if (!hits.length) return;
  const { kind, id } = hits[0].object.userData;
  if (kind === "facility" || kind === "workspace") return openPlace(id);
  if (kind === "district") return openPlace(id);
}

/* ══ PANEL ═══════════════════════════════════════════════════════════ */
const blk = (h, b) => `<div class="blk"><h3>${h}</h3>${b}</div>`;
const kv = (p) => `<dl class="kv">${p.map(([k, v]) =>
  `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;

function show(title, sub, html, tabs) {
  $("ptitle").textContent = title;
  $("psub").textContent = sub || "";
  $("pbody").innerHTML = html;
  $("ptabs").innerHTML = (tabs || []).map((t, i) =>
    `<button class="tb${i === 0 ? " on" : ""}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`
  ).join("");
  $("panel").classList.add("on");
  $("pbody").querySelectorAll("[data-ref]").forEach((n) =>
    n.addEventListener("click", () => {
      const [t, i] = n.dataset.ref.split(":");
      if (t === "place") { focusPlace(i); openPlace(i); }
      else openRecord(t, i);
    }));
  $("ptabs").querySelectorAll(".tb").forEach((b) =>
    b.addEventListener("click", () => {
      $("ptabs").querySelectorAll(".tb").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      (tabs.find((t) => t.id === b.dataset.tab) || {}).render?.();
    }));
}
function hidePanel() { $("panel").classList.remove("on"); SEL = null; }
$("px").addEventListener("click", hidePanel);
addEventListener("keydown", (e) => { if (e.key === "Escape") { hidePanel(); FOLLOW = null; } });

async function openAgent(id) {
  SEL = id;
  const a = (W.agents || {})[id];
  if (!a) return;
  const detail = await get("/api/agent/" + encodeURIComponent(id));
  const sp = detail.spatial || {};
  const render = (tab) => {
    if (tab === "graph") return renderGraph(id, detail);
    let h = blk("WHERE IT IS", kv([
      ["location", `<b>${esc((sp.place || {}).workspace || a.workspace)}</b>`],
      ["facility", esc((sp.place || {}).facility || "—")],
      ["district", esc((sp.place || {}).district || "—")],
      ["position", sp.x != null ? `${sp.x.toFixed(1)}, ${sp.y.toFixed(1)}` : "—"],
      ["status", `<span class="tag on">${esc(a.state)}</span>`],
      ["movement", `<span class="tag${a.movement === "MOVING" ? " on" : ""}">${esc(a.movement)}</span>`],
    ]));
    h += blk("WHY IS IT HERE", kv([
      ["because", esc(a.why || "—")],
      ["state because", esc(a.because || "—")],
      ["activity", esc(a.activity || "—")],
      ["task", a.task_id ? `<span data-ref="task:${a.task_id}">TASK-${a.task_id}</span>` : "—"],
      ["project", detail.team_of?.[0]?.project_id
        ? `<span data-ref="project:${detail.team_of[0].project_id}">#${detail.team_of[0].project_id}</span>` : "—"],
      ["lease", a.lease_id ? `LEASE-${a.lease_id}` : "—"],
      ["since", esc(sp.moved_at || "—")],
    ]));
    if (a.destination) h += blk("WHERE IT IS GOING", kv([
      ["destination", `<b>${esc(sp.destination_label || a.destination)}</b>`],
      ["remaining", (a.path || []).join(" → ") || "—"],
    ]));
    h += blk("LAST EVENT", (detail.timeline || []).slice(0, 5).map((t) =>
      `<div class="row" ${t.ref ? `data-ref="${t.ref.type}:${t.ref.id}"` : ""}>
        <b>${esc(t.text)}</b>${t.why ? `<br><span style="color:#44505e">${esc(short(t.why, 100))}</span>` : ""}</div>`
    ).join("") || `<div class="none">has not acted yet</div>`);
    h += blk("MOVEMENT", (detail.movements || []).slice(0, 6).map((m) =>
      `<div class="row"><span class="rt">${esc(m.phase)}</span>
        <b>${esc(m.from_workspace || "—")} → ${esc(m.to_workspace)}</b><br>
        <span style="color:#44505e">${esc(short(m.why, 88))}</span></div>`
    ).join("") || `<div class="none">has never moved</div>`);
    $("pbody").innerHTML = h;
    $("pbody").querySelectorAll("[data-ref]").forEach((n) =>
      n.addEventListener("click", () => {
        const [t, i] = n.dataset.ref.split(":");
        openRecord(t, i);
      }));
  };
  show(a.name.toUpperCase(), `${a.role} · ${a.id}`, "", [
    { id: "world", label: "IN THE WORLD", render: () => render("world") },
    { id: "graph", label: "CAPABILITY GRAPH", render: () => render("graph") },
  ]);
  render("world");
  FOLLOW = id;
}

async function renderGraph(id, detail) {
  const g = await get("/api/capability/" + encodeURIComponent(id));
  const node = (cls, label, meta) =>
    `<div class="gnode ${cls}"><span class="gdot"></span><span class="glab">${esc(label)}</span>
      <span class="gmeta">${esc(meta || "")}</span></div>`;
  let h = node(g.executing ? "live" : "", g.name, g.role);
  h += `<div class="gkids">`;
  for (const c of g.capabilities) {
    h += node(c.usable ? "" : "gone dim", c.name, c.usable ? "" : "unusable");
    h += `<div class="gkids">`;
    for (const t of c.tools) {
      h += node(t.active ? "live" : t.granted ? "" : "gone dim", t.id,
                t.active ? "ACTIVE" : t.granted ? `${t.calls} calls` : "not granted");
    }
    h += `</div>`;
  }
  h += `</div>`;
  let body = blk("NERVOUS SYSTEM", `<div class="graph">${h}</div>`);
  body += blk("PERMISSIONS", (g.permissions || []).map((p) =>
    `<span class="tag on">${esc(p)}</span>`).join("") ||
    `<div class="none">holds no tool — it cannot do the work it delegates</div>`);
  if (g.gaps?.length) body += blk("CAPABILITY GAPS", g.gaps.map((x) =>
    `<div class="row"><span class="rt">GAP</span><b>${esc(x)}</b></div>`).join(""));
  body += blk("RECENT EXECUTIONS", (g.executions || []).map((e) =>
    `<div class="row"><span class="rt">${esc(e.decision)}</span><b>${esc(e.cap)}</b>
      ${e.artifact ? `<br><span data-ref="artifact:${e.artifact}">→ artifact #${e.artifact}</span>`
        : ""}</div>`).join("") || `<div class="none">no tool call recorded</div>`);
  $("pbody").innerHTML = body;
  $("pbody").querySelectorAll("[data-ref]").forEach((n) =>
    n.addEventListener("click", () => {
      const [t, i] = n.dataset.ref.split(":");
      openRecord(t, i);
    }));
}

function openPlace(id) {
  const p = place(id);
  if (!p) return;
  const occ = W.occupancy || {};
  // An agent stands in a WORKSPACE, so a facility or district holds whoever is
  // in one of its rooms. Filtering by workspace id at every level reported
  // "occupants 1 / nobody is standing here" on the same panel.
  const here = Object.values(W.agents || {}).filter((a) =>
    p.kind === "workspace" ? a.workspace === id
      : p.kind === "facility" ? a.facility === id : a.district === id);
  const c = (W.constructions || {})[id];
  let h = blk("PLACE", kv([
    ["kind", esc(p.kind)], ["type", esc(p.type || "—")],
    ["archetype", esc(p.archetype)],
    ["capability", esc(p.capability || "—")],
    ["capacity", String(p.capacity || 0)],
    ["status", `<span class="tag${p.status === "ACTIVE" ? " on" : ""}">${esc(p.status)}</span>`],
    ["occupants", String((occ[p.kind] || {})[id] || 0)],
    ["bounds", `${p.x.toFixed(1)}, ${p.y.toFixed(1)} · ${p.w}×${p.h}`],
  ]));
  if (p.about) h += blk("WHY IT IS HERE", `<div class="row">${esc(p.about)}</div>`);
  if (c) h += blk("HOW IT CAME TO EXIST", kv([
    ["built", esc(c.built_at)], ["by", esc(c.built_by)],
    ["authority", esc(c.authority)], ["cost", String(c.cost)],
    ["state", `<span class="tag on">${esc(c.state)}</span>`],
    ["proposal", `<span data-ref="expansion:${c.proposal_id}">#${c.proposal_id}</span>`],
  ]));
  if (p.equipment?.length) h += blk("EQUIPMENT",
    p.equipment.map((e) => `<span class="tag">${esc(e)}</span>`).join(""));
  h += blk("WHO IS HERE", here.map((a) =>
    `<div class="row" data-ref="agent:${a.id}"><span class="rt">${esc(a.state)}</span>
      <b>${esc(a.name)}</b><br><span style="color:#44505e">${esc(short(a.why, 80))}</span></div>`
  ).join("") || `<div class="none">nobody is standing here</div>`);
  show(p.label.toUpperCase(), `${p.kind} · ${p.id}`, h, []);
  $("pbody").querySelectorAll("[data-ref]").forEach((n) =>
    n.addEventListener("click", () => {
      const [t, i] = n.dataset.ref.split(":");
      if (t === "agent") openAgent(i);
    }));
}

async function openRecord(kind, id) {
  if (kind === "agent") return openAgent(id);
  const r = await get(`/api/record/${kind}/${id}`).catch(() => null);
  if (!r || r.error) return;
  let h = blk("RECORD", kv(Object.entries(r.row)
    .filter(([, v]) => v !== null && v !== "" && String(v).length < 300)
    .map(([k, v]) => [k, esc(String(v))])));
  show(`${kind.toUpperCase()} #${id}`, "", h, []);
}

/* ══ OBSERVATORY — part of the world, not a dashboard over it ════════ */
async function openObservatory() {
  const growth = await get("/api/growth");
  const a = W.autonomy || {}, away = W.away || {};
  let h = blk("THE WORLD RIGHT NOW", kv([
    ["agents", String(Object.keys(W.agents || {}).length)],
    ["working", String(Object.values(W.agents || {}).filter((x) => x.state === "RUNNING").length)],
    ["queue", `${(a.queue || {}).READY || 0} ready · ${(a.queue || {}).CLAIMED || 0} in flight`],
    ["opportunities", String(a.opportunities || 0)],
    ["discoveries", String(a.discoveries || 0)],
    ["awaiting you", String(a.awaiting_owner || 0)],
    ["places", String((W.places || []).length)],
  ]));
  h += blk("WHILE YOU WERE AWAY", (away.movements || []).length || Object.keys(away.counts || {}).length
    ? Object.entries(away.counts || {}).map(([k, v]) =>
        `<div class="row"><span class="rt">${v}</span>${esc(k.replace(/_/g, " "))}</div>`).join("")
      + (away.movements || []).map((m) =>
        `<div class="row"><b>${esc(m.agent.replace("AGT-", ""))} → ${esc(m.to)}</b><br>
          <span style="color:#44505e">${esc(short(m.why, 90))}</span></div>`).join("")
    : `<div class="none">nothing has happened since you last looked</div>`);
  h += blk("WORLD RESOURCES", Object.values(growth.resources || {}).map((r) =>
    `<div class="row">${esc(r.label)} <span class="rt">${r.spent.toFixed(1)} / ${r.total.toFixed(1)} ${esc(r.unit)}</span>
      <div class="bar"><i style="width:${Math.min(100, r.spent / r.total * 100)}%"></i></div></div>`
  ).join(""));
  h += blk("WORLD GROWTH", (growth.proposals || []).slice(0, 8).map((p) =>
    `<div class="row"${p.construction ? ` data-ref="place:${p.construction.place_id}"` : ""}>
      <span class="rt">${esc(p.state)}</span><b>${esc(p.label)}</b><br>
      <span style="color:#44505e">${esc(short(p.cause, 96))}</span>
      ${p.needs_owner && p.state === "VALIDATED"
        ? `<br><span class="tag bad">needs your approval</span>` : ""}</div>`
  ).join("") || `<div class="none">the world has not needed to grow</div>`);
  h += blk("PRESSURE", (growth.pressure || []).map((f) =>
    `<div class="row"><span class="rt">×${f.pressure}</span><b>${esc(f.label)}</b><br>
      <span style="color:#44505e">${f.waiting} waiting against ${f.capacity} seats</span></div>`
  ).join("") || `<div class="none">nothing is over capacity</div>`);
  show("OWNER OBSERVATORY", "looking in from outside the world", h, []);
  $("pbody").querySelectorAll("[data-ref]").forEach((n) =>
    n.addEventListener("click", () => {
      const [t, i] = n.dataset.ref.split(":");
      if (t === "place") { focusPlace(i); openPlace(i); }
    }));
}

/* ══ CHROME ══════════════════════════════════════════════════════════ */
function chrome() {
  const a = W.autonomy || {}, q = a.queue || {};
  $("cond").className = "cond" + (W.quiet ? "" : " live");
  $("cond").innerHTML = `<span class="dot"></span>` + (W.quiet
    ? "quiet · no agent holds a lease"
    : `${Object.values(W.agents).filter((x) => x.state === "RUNNING").length} working`);
  const chain = (a.chains || [])[0];
  const bits = [`queue <b>${q.READY || 0}</b>/<b>${q.CLAIMED || 0}</b>`,
    `<b>${(W.places || []).filter((p) => p.kind === "facility").length}</b> facilities`,
    `<b>${a.opportunities || 0}</b> opportunities`];
  if (chain) bits.push(`chain <span class="${["HALTED", "ESCALATED"].includes(chain.state)
    ? "halt" : ""}">${esc(chain.state.toLowerCase())}</span> <b>$${(chain.usd_spent || 0).toFixed(5)}</b>`);
  if (a.awaiting_owner) bits.push(`<span class="away"><b>${a.awaiting_owner}</b> awaiting you</span>`);
  if ((a.owner || {}).state === "AWAY") bits.push(`<span class="away">owner away</span>`);
  $("strip").innerHTML = bits.join(`<span style="opacity:.3">│</span>`);

  const m = a.model || {};
  const off = m.model !== "ONLINE";
  $("model").innerHTML = [["WORLD", m.world || "ONLINE", false],
    ["AGENTS", m.agents || "PERSISTENT", false], ["RUNTIME", m.runtime || "ONLINE", false],
    ["MODEL", m.model || "OFFLINE", off],
    ["WORK", m.work || "IDLE", (m.work || "") === "WAITING_FOR_MODEL"]]
    .map(([k, v, bad]) => `<span class="mrow"><i>${k}</i><b class="${bad ? "bad" : ""}">${esc(v)}</b></span>`)
    .join("") + (m.why ? `<span class="mwhy">${esc(m.why)}</span>` : "");

  if (!$("views").children.length) {
    $("views").innerHTML = LODS.map((l) =>
      `<button class="vb" data-view="${l.id}">${l.label}</button>`).join("")
      + `<button class="vb" data-obs="1">OBSERVATORY</button>`;
    $("views").addEventListener("click", (e) => {
      const v = e.target.closest("[data-view]"), o = e.target.closest("[data-obs]");
      if (o) return openObservatory();
      if (!v) return;
      const l = LODS.find((x) => x.id === v.dataset.view);
      const b = bounds();
      FOLLOW = null;
      flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, l.above + (l.id === "workspace" ? 8 : 14));
      applyLOD();
    });
  }
}

/* ══ INPUT ═══════════════════════════════════════════════════════════ */
function controls() {
  const el = $("stage");
  let drag = null, moved = 0;
  el.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 };
    moved = 0;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const k = CAM.dist * 0.0016;
      const right = new THREE.Vector3(Math.cos(CAM.yaw), 0, -Math.sin(CAM.yaw));
      const fwd = new THREE.Vector3(Math.sin(CAM.yaw), 0, Math.cos(CAM.yaw));
      CAM.target.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k);
      FOLLOW = null;
    } else {
      CAM.yaw -= dx * 0.005;
      CAM.pitch += dy * 0.004;
    }
    applyCam();
  });
  el.addEventListener("pointerup", (e) => {
    if (drag && moved < 6) pick(e);
    drag = null;
  });
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    CAM.dist *= e.deltaY > 0 ? 1.11 : 1 / 1.11;
    applyCam();
    applyLOD();
  }, { passive: false });
}

/* ══ LOAD ════════════════════════════════════════════════════════════ */
async function load(first) {
  PREV = W;
  W = await get("/api/world3d");
  if (first || !PREV || PREV.places.length !== W.places.length) buildWorld();
  syncAgents();
  chrome();
  applyLOD();
}

async function main() {
  boot();
  materials();
  controls();
  await load(true);
  // Frame the districts that are actually built: the Observatory sits off the
  // plate on purpose, and reserved ground is empty, so including them in the
  // opening shot pushes the campus itself out of the frame.
  const b = bounds(true);
  CAM.pitch = 0.95;
  CAM.yaw = -0.66;
  flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 88);
  applyLOD();
  requestAnimationFrame(tick);
  $("boot").classList.add("gone");
  const q = new URLSearchParams(location.search);
  if (q.get("agent")) { openAgent(q.get("agent")); focusPlace(W.agents[q.get("agent")]?.workspace); }
  if (q.get("place")) { focusPlace(q.get("place")); openPlace(q.get("place")); }
  if (q.get("view")) {
    const l = LODS.find((x) => x.id === q.get("view"));
    if (l) { flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, l.above + 12); applyLOD(); }
  }
  if (q.get("observatory")) openObservatory();
  // The world re-reads itself. It does NOT animate between reads: an agent
  // moves only because the server put it somewhere else.
  setInterval(() => { load().catch(() => {}); }, 4000);
}
main().catch((e) => { $("boot").textContent = "cannot reach the world: " + e.message; });
