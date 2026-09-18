import * as THREE from "three";
import {
  GREENERY,
  GROUND_D,
  GROUND_W,
  LOOK,
  PAVING,
  POND,
  PLACES,
  TONE_HEX,
  anchorOf,
  placeFor,
  roads,
  sampleRoute,
  type Place,
  type Vec2,
} from "./city";

/**
 * The city, built out of geometry.
 *
 * Every wall, roof, pane of glass and little standing figure on this page is
 * made here out of boxes, cylinders and extrusions — there is not one image in
 * the scene. That is the point: a picture of a building can only ever be
 * photographed from the angle it was drawn at, and it cannot light up. A model
 * can be walked around, and a wall that means "the policy gate is busy" can
 * actually glow.
 *
 * The rules that keep it from looking like a toy are few and strict. One white
 * for every wall, one blue for every pane, one dark plate for every sign, and a
 * single accent per building — so the only saturated colour in the frame is the
 * one carrying live state. Everything stands on a plinth of the same height and
 * every corner is rounded by the same radius, which is what makes fifteen
 * different shapes read as one model rather than fifteen objects. And the sun
 * is a single key light with a soft shadow: a model without a contact shadow
 * reads as a decal printed on the floor rather than an object standing on it.
 */

export type CityAgent = {
  code: string;
  zone: string;
  name: string;
  state: string;
  lifecycle: string;
};

export type CityState = {
  agents: CityAgent[];
  edges: Array<{ from: string; to: string; count: number }>;
  selected: string | null;
};

export type CityHandle = {
  update: (state: CityState) => void;
  pulse: (from: string, to: string, color: string) => void;
  /** Attach a DOM element to a place, to be carried with it every frame. */
  anchor: (id: string, code: string, lift: number, el: HTMLElement | null) => void;
  onPick: (fn: (code: string | null) => void) => void;
  onHover: (fn: (code: string | null) => void) => void;
  resetView: () => void;
  dispose: () => void;
};

/** Which agent states count as "this thing is doing something right now". */
const BUSY = new Set(["working", "processing", "using_tool", "waiting", "deploying"]);

/**
 * An idle agent lights nothing.
 *
 * The first pass lit every building green the moment its agent existed, which
 * meant a system with nothing happening in it looked exactly as alive as one
 * under load — and a colour that is always on carries no information. A
 * building at rest is white now; a small beacon over it says the agent is
 * there at all, and the walls only light when there is something to report.
 */
const RESTING = new Set(["idle", "offline"]);

function toneOf(state: string): string {
  if (state === "escalated" || state === "error") return TONE_HEX.red;
  if (state === "waiting") return TONE_HEX.amber;
  if (state === "using_tool") return TONE_HEX.violet;
  if (BUSY.has(state)) return TONE_HEX.blue;
  return TONE_HEX.green;
}

/* ── geometry helpers ───────────────────────────────────────────────────── */

const RADIUS = 0.4;
const BEVEL = 0.12;

function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hd = d / 2;
  const c = Math.min(r, hw - 0.01, hd - 0.01);
  s.moveTo(-hw + c, -hd);
  s.lineTo(hw - c, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + c);
  s.lineTo(hw, hd - c);
  s.quadraticCurveTo(hw, hd, hw - c, hd);
  s.lineTo(-hw + c, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - c);
  s.lineTo(-hw, -hd + c);
  s.quadraticCurveTo(-hw, -hd, -hw + c, -hd);
  return s;
}

/**
 * A box with softened edges, standing with its base on y = 0.
 *
 * Sharp corners are what make an untextured model look like a debug view: real
 * light catches an edge over a millimetre or two and draws the bright line that
 * tells the eye where one face ends. Everything here is built from this.
 */
function box(w: number, h: number, d: number, r = RADIUS): THREE.BufferGeometry {
  const bevel = Math.min(BEVEL, h / 2.4);
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, d, r), {
    depth: Math.max(0.02, h - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 5,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  geo.computeVertexNormals();
  return geo;
}

function wedge(w: number, h: number, d: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -d / 2);
  return geo;
}

/** A soft dark blob, dropped under everything that stands up. */
function shadowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // On a dark ground a dark blob is invisible, so the contact shadow there
    // is a thin pool rather than the deep one a white model needs.
    const tint = LOOK.dark ? "4,8,20" : "24,36,66";
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, `rgba(${tint},${LOOK.dark ? 0.55 : 0.52})`);
    g.addColorStop(0.55, `rgba(${tint},0.16)`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** `#rrggbb` to `rgba(...)`, so a gradient can fade a look's own colour out. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** The sky behind the model. A flat fill reads as a screenshot; a graded one
 *  reads as a photograph of an object. */
function skyTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, LOOK.skyTop);
    g.addColorStop(1, LOOK.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The ground's own falloff, so the plate is not one flat fill. */
function groundTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = LOOK.ground;
    ctx.fillRect(0, 0, size, size);
    const g = ctx.createRadialGradient(size / 2, size * 0.46, size * 0.04, size / 2, size * 0.46, size * 0.66);
    g.addColorStop(0, LOOK.groundInner);
    g.addColorStop(1, hexToRgba(LOOK.groundInner, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A flat strip following a path on the ground.
 *
 * The roads are the same curves the pipeline's pulses travel, laid down as
 * geometry rather than drawn again by hand, so a road can never lead somewhere
 * a message cannot go.
 */
function ribbon(points: Vec2[], width: number, y: number): THREE.BufferGeometry {
  const half = width / 2;
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];

  let run = 0;
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;
    if (i > 0) run += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);

    position.push(points[i].x + nx * half, y, points[i].z + nz * half);
    position.push(points[i].x - nx * half, y, points[i].z - nz * half);
    uv.push(run, 1, run, 0);

    if (i < points.length - 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/* ── the scene ──────────────────────────────────────────────────────────── */

export function createCity(canvas: HTMLCanvasElement, host: HTMLElement): CityHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const sky = skyTexture();
  scene.background = sky;
  scene.fog = new THREE.Fog(new THREE.Color(LOOK.fog), LOOK.fogNear, LOOK.fogFar);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 600);
  const target = new THREE.Vector3(0, 4.5, 6);

  // The camera is driven in spherical coordinates rather than by an imported
  // controller: three numbers, clamped, eased — which is all an operator needs
  // and cannot be turned upside down by an enthusiastic drag.
  const view = { radius: 148, theta: -0.26, phi: 0.87 };
  const wanted = { ...view };
  const HOME = { ...view };

  /* ── light ───────────────────────────────────────────────────────────── */

  scene.add(new THREE.HemisphereLight(new THREE.Color(LOOK.hemiSky), new THREE.Color(LOOK.hemiGround), LOOK.hemiIntensity));

  const key = new THREE.DirectionalLight(new THREE.Color(LOOK.keyColor), LOOK.keyIntensity);
  key.position.set(-52, 78, 46);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -82;
  key.shadow.camera.right = 82;
  key.shadow.camera.top = 62;
  key.shadow.camera.bottom = -62;
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 220;
  key.shadow.bias = -0.0007;
  key.shadow.normalBias = 0.05;
  scene.add(key);

  const fill = new THREE.DirectionalLight(new THREE.Color(LOOK.fillColor), LOOK.fillIntensity);
  fill.position.set(64, 34, -46);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(new THREE.Color(LOOK.rimColor), LOOK.rimIntensity);
  rim.position.set(6, 22, -78);
  scene.add(rim);

  /* ── materials, shared by everything ─────────────────────────────────── */

  const wallMat = new THREE.MeshStandardMaterial({ color: LOOK.wall, roughness: 0.82, metalness: 0 });
  const shadeMat = new THREE.MeshStandardMaterial({ color: LOOK.wallShade, roughness: 0.86, metalness: 0 });
  const plinthMat = new THREE.MeshStandardMaterial({ color: LOOK.plinth, roughness: 0.92, metalness: 0 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: LOOK.glass,
    roughness: 0.16,
    metalness: 0.06,
    transparent: true,
    opacity: 0.86,
    emissive: new THREE.Color(LOOK.glassEmissive),
    emissiveIntensity: LOOK.glassEmissiveIntensity,
  });
  const plateMat = new THREE.MeshStandardMaterial({ color: LOOK.sign, roughness: 0.62, metalness: 0.05 });
  const skinMat = new THREE.MeshStandardMaterial({ color: LOOK.skin, roughness: 0.75 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: LOOK.trunk, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: LOOK.tree, roughness: 0.85, flatShading: true });
  const roadMat = new THREE.MeshStandardMaterial({ color: LOOK.road, roughness: 0.95, metalness: 0 });

  const owned: Array<{ dispose: () => void }> = [
    wallMat, shadeMat, plinthMat, glassMat, plateMat, skinMat, trunkMat, leafMat, roadMat,
  ];
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    owned.push(item);
    return item;
  };

  const accentMat = (hex: string) =>
    keep(
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: new THREE.Color(hex),
        emissiveIntensity: 0.45,
        roughness: 0.45,
        metalness: 0,
      }),
    );

  /* ── ground ──────────────────────────────────────────────────────────── */

  const groundTex = keep(groundTexture());
  const plate = new THREE.Mesh(
    keep(box(GROUND_W, 2.2, GROUND_D, 4)),
    keep(new THREE.MeshStandardMaterial({ color: LOOK.plateSide, roughness: 0.95 })),
  );
  plate.position.y = -2.2;
  plate.receiveShadow = true;
  scene.add(plate);

  const lawn = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(GROUND_W - 1.2, GROUND_D - 1.2)),
    keep(new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.96, metalness: 0 })),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = 0.002;
  lawn.receiveShadow = true;
  scene.add(lawn);

  const blobTex = keep(shadowTexture());
  const blobMat = keep(
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.9 }),
  );
  const blobGeo = keep(new THREE.PlaneGeometry(1, 1));

  function dropShadow(x: number, z: number, size: number) {
    const m = new THREE.Mesh(blobGeo, blobMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    m.scale.setScalar(size);
    scene.add(m);
  }

  /* ── paving and roads ────────────────────────────────────────────────── */

  const pavingMat = keep(new THREE.MeshStandardMaterial({ color: LOOK.paving, roughness: 0.94 }));
  for (const pad of PAVING) {
    const disc = new THREE.Mesh(keep(new THREE.CircleGeometry(pad.r, 48)), pavingMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(pad.x, 0.012, pad.z);
    disc.receiveShadow = true;
    scene.add(disc);
  }

  const water = new THREE.Mesh(
    keep(new THREE.CircleGeometry(1, 56)),
    keep(new THREE.MeshStandardMaterial({ color: LOOK.water, roughness: 0.22, metalness: 0.1 })),
  );
  water.rotation.x = -Math.PI / 2;
  water.scale.set(POND.rx, POND.rz, 1);
  water.position.set(POND.x, 0.03, POND.z);
  scene.add(water);

  const bank = new THREE.Mesh(keep(new THREE.RingGeometry(1, 1.09, 56)), pavingMat);
  bank.rotation.x = -Math.PI / 2;
  bank.scale.set(POND.rx + 1.2, POND.rz + 1.2, 1);
  bank.position.set(POND.x, 0.022, POND.z);
  scene.add(bank);

  for (const road of roads()) {
    const mesh = new THREE.Mesh(keep(ribbon(road.points, 1.8, 0.05)), roadMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  /* ── buildings ───────────────────────────────────────────────────────── */

  type Built = {
    place: Place;
    group: THREE.Group;
    ring: THREE.Mesh;
    halo: THREE.Mesh;
    beacon: THREE.Mesh;
    beaconMat: THREE.MeshBasicMaterial;
    stateMat: THREE.MeshStandardMaterial;
    ringMat: THREE.MeshBasicMaterial;
    haloMat: THREE.MeshBasicMaterial;
    people: Array<{ group: THREE.Group; mat: THREE.MeshStandardMaterial }>;
    pick: THREE.Mesh;
    lit: boolean;
    busy: boolean;
    resting: boolean;
    seed: number;
  };

  const built = new Map<string, Built>();
  const pickable: THREE.Mesh[] = [];
  const spin: Array<{ mesh: THREE.Object3D; rate: number }> = [];

  function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
    const m = new THREE.Mesh(keep(geo), mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }

  function person(color: string) {
    const group = new THREE.Group();
    const mat = keep(new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));

    const legs = mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.75, 10), plateMat);
    legs.position.y = 0.37;
    group.add(legs);

    const body = mesh(new THREE.CapsuleGeometry(0.33, 0.62, 4, 12), mat);
    body.position.y = 1.16;
    group.add(body);

    const head = mesh(new THREE.SphereGeometry(0.31, 16, 12), skinMat);
    head.position.y = 1.92;
    group.add(head);

    const cap = mesh(new THREE.SphereGeometry(0.325, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    cap.position.y = 1.93;
    group.add(cap);

    return { group, mat };
  }

  function tree(x: number, z: number, r: number) {
    const g = new THREE.Group();
    const trunk = mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.1, 8), trunkMat);
    trunk.position.y = 0.55;
    g.add(trunk);
    const crown = mesh(new THREE.IcosahedronGeometry(r, 1), leafMat);
    crown.position.y = 1.1 + r * 0.72;
    crown.scale.set(1, 1.12, 1);
    g.add(crown);
    g.position.set(x, 0, z);
    scene.add(g);
    dropShadow(x, z, r * 3.1);
  }

  /**
   * The body every building shares: a plinth, a light strip, a dark sign.
   *
   * The strip is the building's status light. Giving each building a
   * decorative colour of its own and *then* a status colour was the thing that
   * made the first pass read as a toy — twelve saturated rings competing with
   * the one piece of colour that actually means something. There is one lit
   * edge per building now, and it is lit by the agent standing in it.
   */
  function base(place: Place, group: THREE.Group, strip: THREE.Material) {
    const pw = place.w + 3.2;
    const pd = place.d + 3.2;

    const plinth = mesh(box(pw, 0.62, pd, 0.9), plinthMat);
    plinth.castShadow = false;
    group.add(plinth);

    // The strip is a thin slab the building stands on top of: what stays
    // visible is the margin around the walls, which reads as a lit edge.
    const edge = new THREE.Mesh(keep(box(pw - 0.5, 0.12, pd - 0.5, 0.8)), strip);
    edge.position.y = 0.6;
    group.add(edge);

    const deck = mesh(box(place.w + 1.4, 0.24, place.d + 1.4, 0.7), shadeMat);
    deck.position.y = 0.66;
    deck.castShadow = false;
    group.add(deck);

    return 0.9;
  }

  function sign(place: Place, group: THREE.Group, y: number) {
    const s = mesh(box(Math.min(place.w * 0.3, 3.8), 0.78, 0.26, 0.18), plateMat);
    s.position.set(0, y, place.d / 2 + 0.16);
    group.add(s);
  }

  function build(place: Place) {
    const group = new THREE.Group();
    const anchor = anchorOf(place);
    group.position.set(anchor.x, 0, anchor.z);
    group.rotation.y = place.rot;

    const accent = accentMat(place.accent);
    // With colour turned on, a building wears its own on its roof; with it off
    // every roof is the same white and the only colour is the status light.
    const trim = LOOK.colouredRoofs
      ? keep(new THREE.MeshStandardMaterial({ color: place.accent, roughness: 0.66, metalness: 0 }))
      : shadeMat;
    // Unlit until an agent reports for work there.
    const stateMat = keep(
      new THREE.MeshStandardMaterial({
        color: LOOK.resting,
        emissive: new THREE.Color(LOOK.resting),
        emissiveIntensity: 0.1,
        roughness: 0.6,
      }),
    );
    const floor = base(place, group, stateMat);
    const h = place.h;
    const { w, d } = place;

    if (place.kind === "pavilion") {
      const body = mesh(box(w, h * 0.62, d), wallMat);
      body.position.y = floor;
      group.add(body);

      const band = mesh(box(w * 0.99, h * 0.3, d * 0.99, 0.4), glassMat);
      band.position.y = floor + h * 0.24;
      group.add(band);

      const roof = mesh(box(w * 0.84, 0.55, d * 0.84, 0.6), trim);
      roof.position.y = floor + h * 0.62;
      group.add(roof);

      const canopy = mesh(box(w * 0.5, 0.3, 4.2, 0.4), trim);
      canopy.position.set(0, floor + h * 0.52, d / 2 + 1.6);
      group.add(canopy);

      for (const sx of [-1, 1]) {
        const post = mesh(new THREE.CylinderGeometry(0.16, 0.16, h * 0.52, 8), shadeMat);
        post.position.set(sx * w * 0.2, floor + h * 0.26, d / 2 + 3.4);
        group.add(post);
      }
      sign(place, group, floor + h * 0.44);
    }

    if (place.kind === "archive") {
      const tiers = [
        { s: 1, y: 0, hh: h * 0.34 },
        { s: 0.82, y: h * 0.36, hh: h * 0.3 },
        { s: 0.62, y: h * 0.68, hh: h * 0.26 },
      ];
      for (const t of tiers) {
        const slab = mesh(box(w * t.s, t.hh, d * t.s), wallMat);
        slab.position.y = floor + t.y;
        group.add(slab);
        const pane = mesh(box(w * t.s * 1.01, t.hh * 0.34, d * t.s * 1.01, 0.3), glassMat);
        pane.position.y = floor + t.y + t.hh * 0.52;
        group.add(pane);
      }
      const lid = mesh(box(w * 0.64, 0.42, d * 0.64, 0.5), trim);
      lid.position.y = floor + h * 0.94;
      group.add(lid);
      sign(place, group, floor + h * 0.2);
    }

    if (place.kind === "hub") {
      const dais = mesh(new THREE.CylinderGeometry(w * 0.62, w * 0.66, 0.5, 48), shadeMat);
      dais.position.y = floor;
      group.add(dais);

      const shaft = mesh(box(w * 0.54, h * 0.86, d * 0.54, 0.6), wallMat);
      shaft.position.y = floor + 0.5;
      group.add(shaft);

      for (let i = 0; i < 3; i += 1) {
        const pane = mesh(box(w * 0.56, h * 0.14, d * 0.56, 0.5), glassMat);
        pane.position.y = floor + 0.5 + h * (0.16 + i * 0.24);
        group.add(pane);
      }

      const cap = mesh(box(w * 0.66, 0.6, d * 0.66, 0.5), trim);
      cap.position.y = floor + 0.5 + h * 0.86;
      group.add(cap);

      // The ring turns because this is the one building that never stops
      // working: everything the pipeline does passes through it.
      const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(w * 0.72, 0.17, 10, 64)), accent);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = floor + h * 0.68;
      group.add(ring);
      spin.push({ mesh: ring, rate: 0.28 });
      sign(place, group, floor + h * 0.34);
    }

    if (place.kind === "hall") {
      const body = mesh(box(w, h * 0.72, d), wallMat);
      body.position.y = floor;
      group.add(body);

      const vault = mesh(new THREE.CylinderGeometry(d * 0.46, d * 0.46, w * 0.92, 24, 1, false, 0, Math.PI), trim);
      vault.rotation.z = Math.PI / 2;
      vault.position.y = floor + h * 0.72;
      group.add(vault);

      // A grid of windows, which is what tells the eye how big the hall is.
      for (let row = 0; row < 2; row += 1) {
        for (let col = -2; col <= 2; col += 1) {
          const win = mesh(box(1.5, 1.5, 0.3, 0.25), glassMat);
          win.position.set(col * 2.5, floor + h * 0.22 + row * 2.4, d / 2 + 0.04);
          group.add(win);
        }
      }
      sign(place, group, floor + h * 0.58);
    }

    if (place.kind === "workshop") {
      const body = mesh(box(w, h * 0.66, d), wallMat);
      body.position.y = floor;
      group.add(body);

      const roof = mesh(box(w * 1.04, 0.5, d * 1.04, 0.5), trim);
      roof.position.y = floor + h * 0.66;
      group.add(roof);

      // Skylights, because a workshop is where the light is let in.
      for (let i = -1; i <= 1; i += 1) {
        const light = mesh(box(w / 4.6, 0.34, d * 0.62, 0.2), glassMat);
        light.position.set(i * (w / 3.4), floor + h * 0.72, 0);
        group.add(light);
      }

      const band = mesh(box(w * 1.01, h * 0.2, d * 1.01, 0.4), glassMat);
      band.position.y = floor + h * 0.34;
      group.add(band);

      const pipe = mesh(new THREE.CylinderGeometry(0.4, 0.46, h * 0.55, 12), wallMat);
      pipe.position.set(w * 0.32, floor + h * 0.78, -d * 0.28);
      group.add(pipe);
      sign(place, group, floor + h * 0.4);
    }

    if (place.kind === "gate") {
      for (const sx of [-1, 1]) {
        const pylon = mesh(box(3, h, d * 0.9), wallMat);
        pylon.position.set(sx * (w / 2 - 1.5), floor, 0);
        group.add(pylon);
        const lamp = new THREE.Mesh(keep(box(2.2, 0.18, d * 0.8, 0.2)), accent);
        lamp.position.set(sx * (w / 2 - 1.5), floor + h + 0.1, 0);
        group.add(lamp);
      }

      const lintel = mesh(box(w, 1.5, d * 0.7), trim);
      lintel.position.y = floor + h;
      group.add(lintel);

      // The screen every message passes through before the model sees it.
      const screenMat = keep(
        new THREE.MeshBasicMaterial({
          color: place.accent,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(w - 3.4, h * 0.82)), screenMat);
      screen.position.y = floor + h * 0.44;
      group.add(screen);
      sign(place, group, floor + h + 0.9);
    }

    if (place.kind === "house") {
      const body = mesh(box(w, h * 0.62, d), wallMat);
      body.position.y = floor;
      group.add(body);

      const roof = mesh(wedge(w * 1.06, h * 0.42, d * 1.04), trim);
      roof.position.y = floor + h * 0.62;
      group.add(roof);

      const door = mesh(box(2.1, 2.6, 0.26, 0.3), plateMat);
      door.position.set(-w * 0.2, floor + 1.3, d / 2 + 0.02);
      group.add(door);

      const win = mesh(box(2.4, 1.7, 0.26, 0.3), glassMat);
      win.position.set(w * 0.22, floor + h * 0.36, d / 2 + 0.02);
      group.add(win);

      // A porch lamp: the human is the one place on the campus that is warm.
      const lamp = new THREE.Mesh(keep(new THREE.SphereGeometry(0.36, 14, 10)), accent);
      lamp.position.set(-w * 0.2 + 1.6, floor + 3.1, d / 2 + 0.3);
      group.add(lamp);
      sign(place, group, floor + h * 0.52);
    }

    if (place.kind === "shop") {
      const body = mesh(box(w, h * 0.7, d), wallMat);
      body.position.y = floor;
      group.add(body);
      const front = mesh(box(w * 0.78, h * 0.34, 0.3, 0.3), glassMat);
      front.position.set(0, floor + h * 0.26, d / 2 + 0.02);
      group.add(front);
      const awning = new THREE.Mesh(keep(box(w * 0.9, 0.24, 2.4, 0.3)), accent);
      awning.position.set(0, floor + h * 0.52, d / 2 + 1);
      awning.rotation.x = 0.22;
      group.add(awning);
      const roof = mesh(box(w * 0.7, 0.5, d * 0.7, 0.4), trim);
      roof.position.y = floor + h * 0.7;
      group.add(roof);
      sign(place, group, floor + h * 0.56);
    }

    if (place.kind === "tower") {
      const shaft = mesh(box(w * 0.52, h * 0.82, d * 0.52, 0.4), wallMat);
      shaft.position.y = floor;
      group.add(shaft);
      const head = mesh(box(w, h * 0.16, d, 0.5), trim);
      head.position.y = floor + h * 0.82;
      group.add(head);
      const glassBand = mesh(box(w * 1.01, h * 0.1, d * 1.01, 0.5), glassMat);
      head.position.y = floor + h * 0.82;
      glassBand.position.y = floor + h * 0.85;
      group.add(glassBand);
      const cap = new THREE.Mesh(keep(new THREE.ConeGeometry(w * 0.4, 1.6, 16)), accent);
      cap.position.y = floor + h * 0.98 + 0.8;
      group.add(cap);
      sign(place, group, floor + h * 0.3);
    }

    if (place.kind === "scaffold") {
      // Where the agents that are designed but not built stand. It is a frame
      // with nothing inside it on purpose.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const post = mesh(box(0.42, h, 0.42, 0.1), shadeMat);
          post.position.set(sx * (w / 2 - 0.6), floor, sz * (d / 2 - 0.6));
          group.add(post);
        }
      }
      for (const level of [0.45, 0.95]) {
        const beam = mesh(box(w, 0.28, d, 0.1), shadeMat);
        beam.position.y = floor + h * level;
        beam.castShadow = false;
        group.add(beam);
      }
      const arm = mesh(box(w * 1.5, 0.34, 0.5, 0.1), shadeMat);
      arm.position.set(w * 0.4, floor + h + 1.2, 0);
      group.add(arm);
      const mast = mesh(box(0.5, h * 0.45, 0.5, 0.1), shadeMat);
      mast.position.set(-w * 0.2, floor + h, 0);
      group.add(mast);
    }

    if (place.kind === "mast") {
      const pole = mesh(new THREE.CylinderGeometry(0.28, 0.34, h, 12), shadeMat);
      pole.position.y = floor + h / 2;
      group.add(pole);
      for (let i = 0; i < 3; i += 1) {
        const cone = new THREE.Mesh(keep(new THREE.ConeGeometry(1.5 - i * 0.25, 1.1, 18, 1, true)), accent);
        cone.rotation.z = -Math.PI / 2;
        cone.position.set(1.1, floor + h - 0.6 - i * 1.5, 0);
        group.add(cone);
      }
    }

    if (place.kind === "plaza") {
      const dais = mesh(new THREE.CylinderGeometry(w * 0.52, w * 0.56, 0.45, 40), shadeMat);
      dais.position.y = floor - 0.2;
      group.add(dais);
      for (const a of [0.7, 2.3, 4.1]) {
        const bench = mesh(box(3.4, 0.4, 1.1, 0.2), wallMat);
        bench.position.set(Math.cos(a) * w * 0.38, floor + 0.15, Math.sin(a) * w * 0.38);
        bench.rotation.y = -a;
        group.add(bench);
      }
    }

    if (place.kind === "kiosk") {
      const post = mesh(box(0.7, h * 0.55, 0.7, 0.2), shadeMat);
      post.position.y = floor;
      group.add(post);
      const board = new THREE.Mesh(keep(box(w, h * 0.5, 0.55, 0.7)), accent);
      board.position.y = floor + h * 0.62;
      board.castShadow = true;
      group.add(board);
      const lip = mesh(box(w * 0.7, 0.22, 0.7, 0.2), wallMat);
      lip.position.y = floor + h * 0.88;
      group.add(lip);
    }

    /* the live parts: a ring on the ground, a halo, a beacon overhead */

    const ringR = Math.max(w, d) * 0.62 + 1.6;
    const ringMat = keep(new THREE.MeshBasicMaterial({ color: TONE_HEX.green, transparent: true, opacity: 0.45, toneMapped: false }));
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(ringR, 0.16, 8, 72)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    ring.visible = false;
    group.add(ring);

    const haloMat = keep(new THREE.MeshBasicMaterial({ color: TONE_HEX.blue, transparent: true, opacity: 0.4, toneMapped: false }));
    const halo = new THREE.Mesh(keep(new THREE.TorusGeometry(ringR, 0.1, 8, 72)), haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.12;
    halo.visible = false;
    group.add(halo);

    const beaconMat = keep(new THREE.MeshBasicMaterial({ color: TONE_HEX.green, toneMapped: false }));
    const beacon = new THREE.Mesh(keep(new THREE.SphereGeometry(0.52, 16, 12)), beaconMat);
    beacon.position.y = place.crown - 1.1;
    beacon.visible = false;
    group.add(beacon);

    // Picking is done against one honest box rather than the walls: a click
    // near a building should select it, not miss between two panes of glass.
    const pick = new THREE.Mesh(
      keep(new THREE.BoxGeometry(Math.max(w, 6) + 3, place.crown, Math.max(d, 6) + 3)),
      keep(new THREE.MeshBasicMaterial({ visible: false })),
    );
    pick.position.y = place.crown / 2;
    pick.userData.code = place.code;
    group.add(pick);
    pickable.push(pick);

    scene.add(group);
    dropShadow(anchor.x, anchor.z, Math.max(w, d) + 7);

    built.set(place.code, {
      place,
      group,
      ring,
      halo,
      beacon,
      beaconMat,
      stateMat,
      ringMat,
      haloMat,
      people: [],
      pick,
      lit: false,
      busy: false,
      resting: true,
      seed: Math.abs(Math.sin(place.w * 12.9898 + place.h * 78.233)) * 6.28,
    });
  }

  for (const place of PLACES) build(place);
  for (const g of GREENERY) tree(g.x, g.z, g.r);

  // Three people waiting on the customer's plaza: the campus should not look
  // abandoned before anyone has written in.
  const plaza = built.get("customer");
  if (plaza) {
    const seats: Array<[number, number, number, string]> = [
      [-1.9, 1.4, 0.5, "#4f6bd8"],
      [1.7, 0.4, -0.7, "#d98b4f"],
      [0.2, -2, 2.6, "#4fa88b"],
    ];
    for (const [x, z, ry, color] of seats) {
      const p = person(color);
      p.group.position.set(x, 0.9, z);
      p.group.rotation.y = ry;
      p.group.scale.setScalar(1.45);
      plaza.group.add(p.group);
    }
  }

  /* ── traffic ─────────────────────────────────────────────────────────── */

  const trafficGroup = new THREE.Group();
  scene.add(trafficGroup);

  type Runner = { mesh: THREE.Mesh; points: Vec2[]; t: number; speed: number; loop: boolean; lift: number };
  const runners: Runner[] = [];
  const dotGeo = keep(new THREE.SphereGeometry(0.55, 14, 10));
  const cometGeo = keep(new THREE.SphereGeometry(1, 16, 12));

  function sampleFor(from: string, to: string): Vec2[] {
    const points = sampleRoute(from, to);
    return points.length > 1 ? points : [];
  }

  function clearTraffic() {
    for (const child of [...trafficGroup.children]) {
      trafficGroup.remove(child);
      const m = child as THREE.Mesh;
      if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
      else m.material?.dispose();
    }
    for (let i = runners.length - 1; i >= 0; i -= 1) {
      if (runners[i].loop) runners.splice(i, 1);
    }
  }

  function setEdges(edges: CityState["edges"]) {
    clearTraffic();
    const busiest = Math.max(1, ...edges.map((e) => e.count));

    for (const edge of edges) {
      const points = sampleFor(edge.from, edge.to);
      if (!points.length) continue;

      // A road is the wiring; a lit lane on top of it is the traffic. It has
      // to be wider than the road it covers, or the only thing that shows is
      // the grey underneath.
      const hot = edge.count / busiest;
      const color = new THREE.Color(hot > 0.6 ? "#3f74f4" : "#7e9df5");
      const lane = new THREE.Mesh(
        keep(ribbon(points, 1.1 + hot * 1.5, 0.14)),
        keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72 + hot * 0.25, toneMapped: false })),
      );
      trafficGroup.add(lane);
    }

    // The handful of busiest routes keep a dot running, so the city reads as a
    // system under load rather than a diagram that only twitches on an event.
    for (const edge of [...edges].sort((a, b) => b.count - a.count).slice(0, 6)) {
      const points = sampleFor(edge.from, edge.to);
      if (!points.length) continue;
      const m = new THREE.Mesh(dotGeo, keep(new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false })));
      const glow = new THREE.Mesh(
        keep(new THREE.SphereGeometry(1.25, 12, 10)),
        keep(new THREE.MeshBasicMaterial({ color: "#4b7ef8", transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false })),
      );
      m.add(glow);
      trafficGroup.add(m);
      runners.push({ mesh: m, points, t: Math.random(), speed: 0.1, loop: true, lift: 0.7 });
    }
  }

  function pulse(from: string, to: string, color: string) {
    const points = sampleFor(from, to);
    if (!points.length) return;
    const m = new THREE.Mesh(cometGeo, keep(new THREE.MeshBasicMaterial({ color, toneMapped: false })));
    const halo = new THREE.Mesh(
      keep(new THREE.SphereGeometry(2.3, 14, 10)),
      keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false })),
    );
    m.add(halo);
    trafficGroup.add(m);
    runners.push({ mesh: m, points, t: 0, speed: 0.42, loop: false, lift: 1.6 });
  }

  function along(points: Vec2[], t: number): Vec2 {
    const i = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
    const f = t * (points.length - 1) - i;
    const a = points[i];
    const b = points[i + 1];
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  }

  /* ── live state ──────────────────────────────────────────────────────── */

  let selected: string | null = null;

  function update(state: CityState) {
    selected = state.selected;
    setEdges(state.edges);

    for (const entry of built.values()) {
      entry.lit = false;
      entry.busy = false;
      entry.resting = true;
      for (const p of entry.people) entry.group.remove(p.group);
      entry.people = [];
      entry.ring.visible = false;
      entry.halo.visible = false;
      entry.beacon.visible = false;
      entry.stateMat.color.set(LOOK.resting);
      entry.stateMat.emissive.set(LOOK.resting);
      entry.stateMat.emissiveIntensity = 0.1;
    }

    for (const agent of state.agents) {
      // An agent with no code behind it gets nothing on the map: an unbuilt
      // agent must never look like it is standing somewhere working.
      if (agent.lifecycle === "planned") continue;
      const place = placeFor(agent.code) ?? placeFor(agent.zone);
      if (!place) continue;
      const entry = built.get(place.code);
      if (!entry) continue;

      const hex = toneOf(agent.state);
      const active = !RESTING.has(agent.state);
      entry.lit = true;
      entry.busy = entry.busy || BUSY.has(agent.state);
      entry.resting = entry.resting && !active;

      entry.ringMat.color.set(hex);
      entry.haloMat.color.set(hex);
      entry.beaconMat.color.set(active ? hex : TONE_HEX.green);
      entry.beacon.visible = true;
      entry.ring.visible = entry.ring.visible || active;
      entry.halo.visible = entry.halo.visible || BUSY.has(agent.state);

      if (active) {
        entry.stateMat.color.set(hex);
        entry.stateMat.emissive.set(hex);
        entry.stateMat.emissiveIntensity = 0.8;
      }

      // Somebody stands in front of the building, wearing the colour of the
      // state it is in — or a plain uniform while there is nothing to report.
      if (place.kind !== "plaza" && place.kind !== "kiosk") {
        const p = person(active ? hex : LOOK.wallShade);
        const slot = entry.people.length;
        p.group.position.set((slot - 0.5) * 2.4, 0.9, place.d / 2 + 2.9);
        p.group.rotation.y = 0.25 - slot * 0.4;
        p.group.scale.setScalar(1.45);
        entry.group.add(p.group);
        entry.people.push(p);
      }
    }
  }

  /* ── DOM anchors ─────────────────────────────────────────────────────── */

  /** How much room each overlay needs to stay whole inside the panel. */
  const PAD: Record<string, { x: number; top: number }> = {
    label: { x: 52, top: 14 },
    "card:agent": { x: 120, top: 196 },
    "card:inbound": { x: 96, top: 128 },
    "card:escalation": { x: 96, top: 92 },
  };

  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

  type Anchor = { id: string; code: string; lift: number; el: HTMLElement };
  const anchors = new Map<string, Anchor>();
  const projected = new THREE.Vector3();

  function anchor(id: string, code: string, lift: number, el: HTMLElement | null) {
    if (!el) anchors.delete(id);
    else anchors.set(id, { id, code, lift, el });
  }

  function placeAnchors(width: number, height: number) {
    for (const a of anchors.values()) {
      const place = placeFor(a.code);
      if (!place) {
        a.el.style.opacity = "0";
        continue;
      }
      const at = anchorOf(place);
      projected.set(at.x, a.lift, at.z).project(camera);

      // A card whose building is near the edge of the frame would hang off it,
      // so the anchor is held inside the panel rather than followed blindly.
      // Each overlay declares the room it actually needs: an agent card is
      // much taller than a name pill and would be clipped by the same margin.
      const room = PAD[a.id] ?? PAD.label;
      const x = clamp((projected.x * 0.5 + 0.5) * width, room.x, width - room.x);
      const y = clamp((-projected.y * 0.5 + 0.5) * height, room.top, height - 14);
      a.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      a.el.style.opacity = projected.z < 1 ? "1" : "0";
      a.el.style.zIndex = String(Math.max(1, Math.round((2 - projected.z) * 500)));
    }
  }

  /* ── input ───────────────────────────────────────────────────────────── */

  let pickFn: (code: string | null) => void = () => {};
  let hoverFn: (code: string | null) => void = () => {};
  let dragging = false;
  let moved = 0;
  let last = { x: 0, y: 0 };
  const pointer = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  let hovered: string | null = null;

  function codeAt(clientX: number, clientY: number): string | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pickable, false)[0];
    return hit ? ((hit.object.userData.code as string) ?? null) : null;
  }

  const onDown = (e: PointerEvent) => {
    dragging = true;
    moved = 0;
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (dragging) {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      last = { x: e.clientX, y: e.clientY };
      wanted.theta -= dx * 0.005;
      wanted.phi = THREE.MathUtils.clamp(wanted.phi - dy * 0.004, 0.22, 1.35);
      return;
    }
    const code = codeAt(e.clientX, e.clientY);
    if (code !== hovered) {
      hovered = code;
      canvas.style.cursor = code ? "pointer" : "grab";
      hoverFn(code);
    }
  };

  const onUp = (e: PointerEvent) => {
    if (dragging && moved < 5) pickFn(codeAt(e.clientX, e.clientY));
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    wanted.radius = THREE.MathUtils.clamp(wanted.radius * Math.exp(e.deltaY * 0.0012), 52, 210);
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";

  /* ── the loop ────────────────────────────────────────────────────────── */

  let width = 1;
  let height = 1;

  function resize() {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const clock = new THREE.Clock();
  let frame = 0;

  function tick() {
    frame = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;

    view.radius += (wanted.radius - view.radius) * Math.min(1, dt * 7);
    view.theta += (wanted.theta - view.theta) * Math.min(1, dt * 9);
    view.phi += (wanted.phi - view.phi) * Math.min(1, dt * 9);

    camera.position.set(
      target.x + view.radius * Math.sin(view.phi) * Math.sin(view.theta),
      target.y + view.radius * Math.cos(view.phi),
      target.z + view.radius * Math.sin(view.phi) * Math.cos(view.theta),
    );
    camera.lookAt(target);

    for (const s of spin) s.mesh.rotation.z += s.rate * dt;

    for (const entry of built.values()) {
      const isSelected = selected === entry.place.code;
      const lift = isSelected ? 0.6 : 0;
      entry.group.position.y += (lift - entry.group.position.y) * Math.min(1, dt * 8);

      if (entry.beacon.visible) {
        entry.beacon.position.y =
          entry.place.crown - 1.1 + Math.sin(time * 1.7 + entry.seed) * 0.28;
        const rest = entry.resting ? 0.6 : 1;
        entry.beacon.scale.setScalar(isSelected ? rest * 1.45 : rest);
      }
      if (entry.halo.visible) {
        const t = (time * 0.55 + entry.seed) % 1;
        entry.halo.scale.setScalar(1 + t * 0.55);
        entry.haloMat.opacity = 0.45 * (1 - t);
      }
      entry.ringMat.opacity = isSelected ? 0.95 : 0.42;

      for (let i = 0; i < entry.people.length; i += 1) {
        const p = entry.people[i];
        p.group.position.y = 0.9 + (entry.busy ? Math.abs(Math.sin(time * 2.4 + i)) * 0.16 : 0);
      }
    }

    for (let i = runners.length - 1; i >= 0; i -= 1) {
      const r = runners[i];
      r.t += r.speed * dt;
      if (r.t >= 1) {
        if (r.loop) r.t -= 1;
        else {
          trafficGroup.remove(r.mesh);
          const mat = r.mesh.material as THREE.Material;
          mat.dispose();
          runners.splice(i, 1);
          continue;
        }
      }
      const at = along(r.points, r.t);
      r.mesh.position.set(at.x, r.lift + Math.sin(Math.PI * r.t) * (r.loop ? 0.3 : 1.1), at.z);
    }

    placeAnchors(width, height);
    renderer.render(scene, camera);
  }

  tick();

  /* ── teardown ────────────────────────────────────────────────────────── */

  function dispose() {
    cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
    canvas.removeEventListener("wheel", onWheel);
    for (const item of owned) item.dispose();
    sky.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    renderer.dispose();
  }

  return {
    update,
    pulse,
    anchor,
    onPick: (fn) => {
      pickFn = fn;
    },
    onHover: (fn) => {
      hoverFn = fn;
    },
    resetView: () => {
      wanted.radius = HOME.radius;
      wanted.theta = HOME.theta;
      wanted.phi = HOME.phi;
    },
    dispose,
  };
}
