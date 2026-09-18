import * as THREE from "three";
import {
  DECK,
  GROUND_D,
  GROUND_W,
  PLACES,
  TONE_HEX,
  anchorOf,
  arcHeight,
  placeFor,
  roads,
  sampleRoute,
  type Look,
  type Place,
  type Vec2,
} from "./city";

/**
 * The board, built out of geometry.
 *
 * Every node, link and travelling message on this page is made here out of
 * discs, rings and tubes — there is not one image in the scene, and no scenery
 * either. The earlier version of this drew the system as a little town, which
 * read as a toy; what a serious operator wants to see is the graph itself, with
 * depth used for the one thing a flat diagram cannot do — separating fifteen
 * crossing routes by lifting each one over the others.
 *
 * The rules that keep it clean are few. One material for every platform, one
 * for every core, one for the wiring. Nothing is coloured unless it is
 * reporting something: a node at rest is the same graphite as its neighbours,
 * and the only saturated colour on the board belongs to an agent that is
 * actually working or a message that is actually crossing.
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
  /** Attach a DOM element to a node, to be carried with it every frame. */
  anchor: (id: string, code: string, lift: number, el: HTMLElement | null) => void;
  onPick: (fn: (code: string | null) => void) => void;
  onHover: (fn: (code: string | null) => void) => void;
  resetView: () => void;
  dispose: () => void;
};

/** Which agent states count as "this thing is doing something right now". */
const BUSY = new Set(["working", "processing", "using_tool", "waiting", "deploying"]);

/**
 * A node at rest lights nothing.
 *
 * A colour that is always on carries no information: lighting every node the
 * moment its agent exists made a system with nothing happening in it look
 * exactly as alive as one under load. A node at rest is graphite, with a small
 * marker to say the agent is there at all.
 */
const RESTING = new Set(["idle", "offline"]);

function toneOf(state: string): string {
  if (state === "escalated" || state === "error") return TONE_HEX.red;
  if (state === "waiting") return TONE_HEX.amber;
  if (state === "using_tool") return TONE_HEX.violet;
  if (BUSY.has(state)) return TONE_HEX.blue;
  return TONE_HEX.green;
}

/* ── textures ───────────────────────────────────────────────────────────── */

/** `#rrggbb` to `rgba(...)`, so a gradient can fade a look's own colour out. */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** The gradient behind the board. A flat fill reads as a screenshot. */
function skyTexture(LOOK: Look): THREE.Texture {
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

/**
 * The floor: a ruled grid that fades out before it ends.
 *
 * A plate with an edge reads as a board sitting on a desk. Fading the floor
 * into the background instead is what makes the graph read as the whole of the
 * view rather than as an object photographed inside it.
 */
function floorTexture(LOOK: Look): THREE.Texture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = LOOK.floor;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = LOOK.grid;
    ctx.lineWidth = 1;
    const step = size / 32;
    for (let i = 0; i <= 32; i += 1) {
      ctx.globalAlpha = i % 4 === 0 ? 0.85 : 0.4;
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }

    // The floor has to end without an edge. A plate with a border reads as a
    // board lying on a desk; erasing the grid outwards instead lets the floor
    // dissolve into the background, so the graph is the whole of the view.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-out";
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.17, size / 2, size / 2, size * 0.5);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.72, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft pool under each node, so it sits on the floor rather than hovering. */
function poolTexture(LOOK: Look): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const tint = LOOK.dark ? "2,5,14" : "26,38,70";
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, `rgba(${tint},${LOOK.dark ? 0.62 : 0.34})`);
    g.addColorStop(0.5, `rgba(${tint},0.18)`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ── geometry helpers ───────────────────────────────────────────────────── */

/**
 * A box with softened edges.
 *
 * Sharp corners are what make an untextured solid look like a debug view: real
 * light catches an edge over a millimetre or two and draws the bright line that
 * tells the eye where one face ends and the next begins.
 */
function roundedBox(side: number, radius: number): THREE.BufferGeometry {
  const half = side / 2;
  const r = Math.min(radius, half * 0.5);
  const shape = new THREE.Shape();
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.quadraticCurveTo(half, -half, half, -half + r);
  shape.lineTo(half, half - r);
  shape.quadraticCurveTo(half, half, half - r, half);
  shape.lineTo(-half + r, half);
  shape.quadraticCurveTo(-half, half, -half, half - r);
  shape.lineTo(-half, -half + r);
  shape.quadraticCurveTo(-half, -half, -half + r, -half);

  const bevel = r * 0.8;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: side - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
    steps: 1,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

/**
 * A link, as a tube arcing over the floor.
 *
 * The points are the route's own curve in plan; the height is added here so
 * that two routes between the same pair of nodes, or two that cross, separate
 * in depth instead of overlapping into one flickering streak.
 */
function arcPoints(points: Vec2[], lift: number, base = 0): THREE.Vector3[] {
  return points.map((p, i) => {
    const t = i / Math.max(1, points.length - 1);
    return new THREE.Vector3(p.x, base + Math.sin(Math.PI * t) * lift, p.z);
  });
}

function tube(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.max(24, points.length), radius, 8, false);
}

/* ── the scene ──────────────────────────────────────────────────────────── */

export function createCity(canvas: HTMLCanvasElement, host: HTMLElement, LOOK: Look): CityHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const sky = skyTexture(LOOK);
  scene.background = sky;
  scene.fog = new THREE.Fog(new THREE.Color(LOOK.fog), LOOK.fogNear, LOOK.fogFar);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 700);
  const target = new THREE.Vector3(0, 2.5, 2);

  // The camera is driven in spherical coordinates rather than by an imported
  // controller: three numbers, clamped, eased — which is all an operator needs
  // and cannot be turned upside down by an enthusiastic drag.
  const view = { radius: 144, theta: -0.24, phi: 0.84 };
  const wanted = { ...view };
  const HOME = { ...view };

  /* ── light ───────────────────────────────────────────────────────────── */

  scene.add(
    new THREE.HemisphereLight(
      new THREE.Color(LOOK.hemiSky),
      new THREE.Color(LOOK.hemiGround),
      LOOK.hemiIntensity,
    ),
  );

  const key = new THREE.DirectionalLight(new THREE.Color(LOOK.keyColor), LOOK.keyIntensity);
  key.position.set(-48, 76, 44);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -80;
  key.shadow.camera.right = 80;
  key.shadow.camera.top = 60;
  key.shadow.camera.bottom = -60;
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 220;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.04;
  scene.add(key);

  const fill = new THREE.DirectionalLight(new THREE.Color(LOOK.fillColor), LOOK.fillIntensity);
  fill.position.set(62, 30, -44);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(new THREE.Color(LOOK.rimColor), LOOK.rimIntensity);
  rim.position.set(4, 20, -76);
  scene.add(rim);

  /* ── shared materials ────────────────────────────────────────────────── */

  const platformMat = new THREE.MeshStandardMaterial({
    color: LOOK.platform,
    roughness: 0.55,
    metalness: 0.18,
  });
  const platformTopMat = new THREE.MeshStandardMaterial({
    color: LOOK.platformTop,
    roughness: 0.42,
    metalness: 0.22,
  });
  // Clearcoat is what separates "a shape" from "an object": the second, tighter
  // highlight over the body is how the eye reads a surface as real.
  const coreMat = new THREE.MeshPhysicalMaterial({
    color: LOOK.core,
    roughness: LOOK.coreRoughness,
    metalness: LOOK.coreMetalness,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
  });
  const linkMat = new THREE.MeshBasicMaterial({
    color: LOOK.link,
    transparent: true,
    opacity: LOOK.dark ? 0.75 : 0.9,
    toneMapped: false,
  });

  const owned: Array<{ dispose: () => void }> = [platformMat, platformTopMat, coreMat, linkMat, sky];
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    owned.push(item);
    return item;
  };

  /* ── floor ───────────────────────────────────────────────────────────── */

  const floor = new THREE.Mesh(
    keep(new THREE.CircleGeometry(Math.max(GROUND_W, GROUND_D) * 0.62, 96)),
    keep(
      new THREE.MeshStandardMaterial({
        map: keep(floorTexture(LOOK)),
        roughness: 0.92,
        metalness: 0.05,
        transparent: true,
      }),
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const poolMat = keep(
    new THREE.MeshBasicMaterial({
      map: keep(poolTexture(LOOK)),
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
    }),
  );
  const poolGeo = keep(new THREE.PlaneGeometry(1, 1));

  /* ── links ───────────────────────────────────────────────────────────── */

  const wiring = new THREE.Group();
  scene.add(wiring);
  for (const road of roads()) {
    const lift = arcHeight(road.points);
    const mesh = new THREE.Mesh(keep(tube(arcPoints(road.points, lift, DECK), 0.13)), linkMat);
    wiring.add(mesh);
  }

  /* ── nodes ───────────────────────────────────────────────────────────── */

  type Built = {
    place: Place;
    group: THREE.Group;
    /** The lit ring around the platform: the node's state, at a glance. */
    rimMat: THREE.MeshBasicMaterial;
    /** The solid standing on it. */
    core: THREE.Mesh;
    coreMat: THREE.MeshStandardMaterial;
    halo: THREE.Mesh;
    haloMat: THREE.MeshBasicMaterial;
    pick: THREE.Mesh;
    busy: boolean;
    resting: boolean;
    seed: number;
  };

  const built = new Map<string, Built>();
  const pickable: THREE.Mesh[] = [];
  const spin: Array<{ mesh: THREE.Object3D; rate: number }> = [];

  function build(place: Place) {
    const group = new THREE.Group();
    const at = anchorOf(place);
    group.position.set(at.x, 0, at.z);
    group.rotation.y = place.rot;

    const r = place.w / 2;

    // the pool it stands in
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.012;
    pool.scale.setScalar(place.w * 2.1);
    group.add(pool);

    // the platform it stands on
    const base = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(r, r * 1.03, DECK, 72)),
      platformMat,
    );
    base.position.y = DECK / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const deck = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.12, 72)),
      platformTopMat,
    );
    deck.position.y = DECK + 0.04;
    deck.receiveShadow = true;
    group.add(deck);

    // the rim: the one part of a node that carries colour
    const rimMat = keep(
      new THREE.MeshBasicMaterial({ color: LOOK.resting, transparent: true, opacity: 0.95, toneMapped: false }),
    );
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(r * 0.97, 0.085, 10, 110)), rimMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = DECK - 0.02;
    group.add(ring);

    // A gate gets a second ring, because every message is screened there; so
    // does the hub, because everything routes through it.
    if (place.kind === "gate" || place.kind === "hub") {
      const outer = new THREE.Mesh(keep(new THREE.TorusGeometry(r * 1.2, 0.05, 8, 110)), rimMat);
      outer.rotation.x = -Math.PI / 2;
      outer.position.y = 0.18;
      group.add(outer);
    }

    /**
     * The solid itself.
     *
     * This is the node, and it has to have weight: a small mark floating over a
     * disc reads as a diagram, and the point of building this in three
     * dimensions is that the thing on screen is an object. Each form says what
     * the node does — a gate is a ring you pass through, a customer is a
     * sphere, a hub is a cut gem — and every one of them is a real volume,
     * sitting on its platform and casting a shadow across it.
     */
    const c = place.core;
    const planned = place.kind === "planned";
    const coreGeo =
      place.kind === "hub"
        ? new THREE.IcosahedronGeometry(c, 1)
        : place.kind === "gate"
          ? new THREE.TorusGeometry(c * 0.74, c * 0.34, 24, 64)
          : place.kind === "channel"
            ? new THREE.CapsuleGeometry(c * 0.6, c * 0.95, 8, 24)
            : place.kind === "source"
              ? new THREE.SphereGeometry(c, 40, 28)
              : place.kind === "sink"
                ? new THREE.SphereGeometry(c, 40, 28)
                : roundedBox(c * 1.62, c * 0.34);

    const coreMaterial = planned
      ? keep(
          new THREE.MeshStandardMaterial({
            color: LOOK.core,
            roughness: 0.5,
            metalness: 0,
            transparent: true,
            opacity: 0.3,
            wireframe: true,
          }),
        )
      : keep(coreMat.clone());
    const core = new THREE.Mesh(keep(coreGeo), coreMaterial);
    core.position.y = place.h;
    core.castShadow = true;
    core.receiveShadow = true;
    if (place.kind === "sink") core.scale.set(1, 0.74, 1);
    if (place.kind === "gate") core.rotation.x = Math.PI / 2;
    group.add(core);

    // Only the two nodes whose whole job is to keep turning actually turn.
    if (place.kind === "hub") spin.push({ mesh: core, rate: 0.22 });

    if (place.kind === "hub") {
      const orbit = new THREE.Mesh(keep(new THREE.TorusGeometry(c * 1.55, 0.085, 10, 96)), rimMat);
      orbit.rotation.x = Math.PI / 2.5;
      orbit.position.y = place.h;
      group.add(orbit);
      spin.push({ mesh: orbit, rate: -0.42 });
    }

    // the pulse a working node gives off
    const haloMat = keep(
      new THREE.MeshBasicMaterial({ color: TONE_HEX.blue, transparent: true, opacity: 0.4, toneMapped: false }),
    );
    const halo = new THREE.Mesh(keep(new THREE.TorusGeometry(r * 0.97, 0.06, 8, 110)), haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = DECK - 0.02;
    halo.visible = false;
    group.add(halo);

    // Picking is done against one honest cylinder rather than the parts: a
    // click near a node should select it, not miss between a ring and a mark.
    const pick = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(r * 1.15, r * 1.15, place.crown, 12)),
      keep(new THREE.MeshBasicMaterial({ visible: false })),
    );
    pick.position.y = place.crown / 2;
    pick.userData.code = place.code;
    group.add(pick);
    pickable.push(pick);

    scene.add(group);

    built.set(place.code, {
      place,
      group,
      rimMat,
      core,
      coreMat: coreMaterial,
      halo,
      haloMat,
      pick,
      busy: false,
      resting: true,
      seed: Math.abs(Math.sin(at.x * 12.9898 + at.z * 78.233)) * 6.28,
    });
  }

  for (const place of PLACES) build(place);

  /* ── traffic ─────────────────────────────────────────────────────────── */

  const trafficGroup = new THREE.Group();
  scene.add(trafficGroup);

  type Runner = {
    mesh: THREE.Mesh;
    points: THREE.Vector3[];
    t: number;
    speed: number;
    loop: boolean;
  };
  const runners: Runner[] = [];
  const dotGeo = keep(new THREE.SphereGeometry(0.42, 14, 10));
  const cometGeo = keep(new THREE.SphereGeometry(0.62, 16, 12));

  function laneFor(from: string, to: string): THREE.Vector3[] {
    const points = sampleRoute(from, to);
    if (points.length < 2) return [];
    return arcPoints(points, arcHeight(points), DECK + 0.2);
  }

  function clearTraffic() {
    for (const child of [...trafficGroup.children]) {
      trafficGroup.remove(child);
      const m = child as THREE.Mesh;
      if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
      else m.material?.dispose();
      if (m.geometry && m.userData.owned) m.geometry.dispose();
    }
    for (let i = runners.length - 1; i >= 0; i -= 1) {
      if (runners[i].loop) runners.splice(i, 1);
    }
  }

  function setEdges(edges: CityState["edges"]) {
    clearTraffic();
    const busiest = Math.max(1, ...edges.map((e) => e.count));

    for (const edge of edges) {
      const points = laneFor(edge.from, edge.to);
      if (!points.length) continue;

      // A link that has carried traffic is drawn over its own wiring, brighter
      // and thicker in proportion to what actually crossed it.
      const hot = edge.count / busiest;
      const geo = tube(points, 0.13 + hot * 0.16);
      geo.userData = {};
      const lane = new THREE.Mesh(
        geo,
        keep(
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(hot > 0.6 ? "#5b8bf5" : "#4a63a8"),
            transparent: true,
            opacity: 0.55 + hot * 0.4,
            toneMapped: false,
          }),
        ),
      );
      lane.userData.owned = true;
      trafficGroup.add(lane);
    }

    // The busiest handful keep a dot running, so the board reads as a system
    // under load rather than a diagram that only twitches on an event.
    for (const edge of [...edges].sort((a, b) => b.count - a.count).slice(0, 6)) {
      const points = laneFor(edge.from, edge.to);
      if (!points.length) continue;
      const m = new THREE.Mesh(
        dotGeo,
        keep(new THREE.MeshBasicMaterial({ color: "#8fb0ff", toneMapped: false })),
      );
      trafficGroup.add(m);
      runners.push({ mesh: m, points, t: Math.random(), speed: 0.11, loop: true });
    }
  }

  function pulse(from: string, to: string, color: string) {
    const points = laneFor(from, to);
    if (!points.length) return;
    const m = new THREE.Mesh(
      cometGeo,
      keep(new THREE.MeshBasicMaterial({ color, toneMapped: false })),
    );
    const halo = new THREE.Mesh(
      keep(new THREE.SphereGeometry(1.7, 14, 10)),
      keep(
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    m.add(halo);
    trafficGroup.add(m);
    runners.push({ mesh: m, points, t: 0, speed: 0.4, loop: false });
  }

  function along(points: THREE.Vector3[], t: number, out: THREE.Vector3) {
    const i = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
    const f = t * (points.length - 1) - i;
    out.copy(points[i]).lerp(points[i + 1], f);
  }

  /* ── live state ──────────────────────────────────────────────────────── */

  let selected: string | null = null;

  function update(state: CityState) {
    selected = state.selected;
    setEdges(state.edges);

    for (const entry of built.values()) {
      entry.busy = false;
      entry.resting = true;
      entry.halo.visible = false;
      entry.rimMat.color.set(LOOK.resting);
      if (entry.place.kind !== "planned") entry.coreMat.color.set(LOOK.core);
      entry.coreMat.emissive?.set("#000000");
    }

    for (const agent of state.agents) {
      // An agent with no code behind it gets nothing lit: an unbuilt agent
      // must never look like it is working. Its node stays a wire outline.
      if (agent.lifecycle === "planned") continue;
      const place = placeFor(agent.code) ?? placeFor(agent.zone);
      if (!place) continue;
      const entry = built.get(place.code);
      if (!entry || entry.place.kind === "planned") continue;

      const hex = toneOf(agent.state);
      const active = !RESTING.has(agent.state);
      entry.busy = entry.busy || BUSY.has(agent.state);
      entry.resting = entry.resting && !active;

      entry.haloMat.color.set(hex);
      entry.halo.visible = entry.halo.visible || BUSY.has(agent.state);

      if (active) {
        entry.rimMat.color.set(hex);
        entry.coreMat.color.set(hex);
        entry.coreMat.emissive?.set(hex);
        entry.coreMat.emissiveIntensity = 0.45;
      } else {
        // Alive but with nothing to report: a quiet green rim, nothing more.
        entry.rimMat.color.set(TONE_HEX.green);
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

  const clamp = (v: number, lo: number, hi: number) =>
    hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));

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

      // A card whose node is near the edge of the frame would hang off it, so
      // the anchor is held inside the panel rather than followed blindly.
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
      wanted.phi = THREE.MathUtils.clamp(wanted.phi - dy * 0.004, 0.2, 1.36);
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
    wanted.radius = THREE.MathUtils.clamp(wanted.radius * Math.exp(e.deltaY * 0.0012), 52, 230);
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
  const cursor3 = new THREE.Vector3();
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

    for (const s of spin) s.mesh.rotation.y += s.rate * dt;

    for (const entry of built.values()) {
      const isSelected = selected === entry.place.code;
      const lift = isSelected ? 0.5 : 0;
      entry.group.position.y += (lift - entry.group.position.y) * Math.min(1, dt * 8);

      // A solid that bobs looks weightless, so only a working node moves, and
      // only enough to be noticed.
      const rise = entry.resting ? 0 : 0.25 + Math.sin(time * 1.9 + entry.seed) * 0.22;
      entry.core.position.y += (entry.place.h + rise - entry.core.position.y) * Math.min(1, dt * 6);
      entry.rimMat.opacity = isSelected ? 1 : entry.resting ? 0.7 : 0.95;

      if (entry.halo.visible) {
        const t = (time * 0.6 + entry.seed) % 1;
        entry.halo.scale.set(1 + t * 0.5, 1 + t * 0.5, 1);
        entry.haloMat.opacity = 0.5 * (1 - t);
      }
    }

    for (let i = runners.length - 1; i >= 0; i -= 1) {
      const r = runners[i];
      r.t += r.speed * dt;
      if (r.t >= 1) {
        if (r.loop) r.t -= 1;
        else {
          trafficGroup.remove(r.mesh);
          (r.mesh.material as THREE.Material).dispose();
          runners.splice(i, 1);
          continue;
        }
      }
      along(r.points, r.t, cursor3);
      r.mesh.position.copy(cursor3);
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
