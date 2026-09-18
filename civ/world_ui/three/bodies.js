/* AGENT BODIES — a persistent physical identity for a persistent agent.

   The body is NOT the intelligence. Nothing in this file reads a task, decides
   an activity or moves anybody: it is handed an appearance row from
   `agent_bodies` and an animation name derived from real state, and it builds
   and poses geometry. That is deliberately all it does.

   Two rules it exists to keep:

   1. ONE AGENT, ONE IDENTITY. Every proportion, panel and colour comes from the
      stored appearance — never from a random number, never from the role alone.
      The same row always builds the same body, so R-01 walking into Verification
      is visibly the R-01 that left the Research Hall.

   2. ROLE IS EQUIPMENT, NOT COLOUR. Two researchers do not share a palette.
      What their role changes is the module they carry.

   The family: one technological civilisation, six body geometries, five optical
   systems, four chest plates, four sensor fittings, sixteen industrial palettes
   and three builds — 23,040 combinations before equipment, from one grammar. */

const M = (hex, kind, emissive) => {
  /* Materials are the difference between "premium industrial" and "painted
     plastic". The finish comes from the appearance row, so an agent's surface
     is part of its identity rather than a global look. */
  const p = {
    matte:   { roughness: 0.82, metalness: 0.06 },
    satin:   { roughness: 0.46, metalness: 0.28 },
    ceramic: { roughness: 0.28, metalness: 0.04 },
    brushed: { roughness: 0.38, metalness: 0.72 },
    carbon:  { roughness: 0.56, metalness: 0.34 },
  }[kind] || { roughness: 0.6, metalness: 0.2 };
  return { color: hex, ...p, ...(emissive ? { emissive: hex, emissiveIntensity: emissive } : {}) };
};

export const ANIMS = ["idle", "walk", "work", "read", "assemble", "inspect",
                      "operate", "direct", "wait", "blocked", "rework", "type",
                      "confer"];

/* ── the grammar ─────────────────────────────────────────────────── */
const BODY = {
  A1: { shoulder: 0.46, chest: 0.25, waist: 0.30, limb: 0.085, legs: "straight", h: 1.00 },
  A2: { shoulder: 0.52, chest: 0.29, waist: 0.33, limb: 0.098, legs: "straight", h: 1.04 },
  A3: { shoulder: 0.42, chest: 0.22, waist: 0.27, limb: 0.074, legs: "digitigrade", h: 0.97 },
  A4: { shoulder: 0.56, chest: 0.32, waist: 0.36, limb: 0.112, legs: "braced", h: 1.08 },
  A5: { shoulder: 0.44, chest: 0.24, waist: 0.28, limb: 0.080, legs: "digitigrade", h: 1.02 },
  A6: { shoulder: 0.49, chest: 0.27, waist: 0.31, limb: 0.090, legs: "braced", h: 0.99 },
};
const BUILD = { slim: 0.88, standard: 1.0, heavy: 1.16 };

/* ── geometry primitives ──────────────────────────────────────────────
   Nothing in a body is a bare box or a bare cylinder. Every visible part is a
   chamfered slab, a capsule, a ball joint or a curved shell, because that is
   the whole difference between machined hardware and a stack of blocks. The
   chamfer is doing most of the work: a bevelled edge catches a highlight, and
   a highlight is what tells the eye "metal". */
function primitives(THREE, lod) {
  const seg = lod === "far" ? 1 : 2;           // bevel segments
  const cs = lod === "far" ? 1 : 2;            // curve segments on the rounding
  const rad = lod === "far" ? 6 : lod === "mid" ? 8 : 14;
  const CACHE = new Map();
  const key = (...a) => a.map((n) => (+n).toFixed(4)).join(",");

  function roundedRect(w, h, r) {
    r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
    const sh = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    sh.moveTo(x + r, y);
    sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r);
    sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r);
    sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
    return sh;
  }

  /* A chamfered slab: rounded in the XY plane, bevelled on the Z faces, and
     centred on its own origin so it can be positioned like a box. */
  function slabGeo(w, h, d, r, bev) {
    bev = Math.min(bev, d / 2 - 1e-4, w / 4, h / 4);
    r = Math.max(r, bev * 1.05);
    const k = "S" + key(w, h, d, r, bev) + seg;
    if (CACHE.has(k)) return CACHE.get(k);
    const g = new THREE.ExtrudeGeometry(roundedRect(w, h, r), {
      depth: d - bev * 2, bevelEnabled: true, bevelThickness: bev,
      bevelSize: bev, bevelSegments: seg, curveSegments: cs, steps: 1 });
    g.translate(0, 0, -d / 2 + bev);
    g.computeVertexNormals();
    CACHE.set(k, g);
    return g;
  }
  /* A capsule: a limb segment with real ends, so a joint reads as a joint
     instead of as the flat lid of a tube. */
  function capGeo(r, len) {
    const k = "C" + key(r, len) + rad;
    if (!CACHE.has(k))
      CACHE.set(k, new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2),
                                             lod === "far" ? 2 : 4, rad));
    return CACHE.get(k);
  }
  function ballGeo(r) {
    const k = "B" + key(r) + rad;
    if (!CACHE.has(k)) CACHE.set(k, new THREE.SphereGeometry(r, rad, Math.max(4, rad - 4)));
    return CACHE.get(k);
  }
  /* A curved shell — a section of a sphere. Pauldrons, skull caps and back
     plates are all this, and it is what keeps the family looking moulded. */
  function shellGeo(r, phi, theta) {
    const k = "H" + key(r, phi, theta) + rad;
    if (!CACHE.has(k))
      CACHE.set(k, new THREE.SphereGeometry(r, rad, Math.max(4, rad - 5),
                                            -phi / 2, phi, 0, theta));
    return CACHE.get(k);
  }
  /* A wrapping band — an open cylinder section. Visors and collars. */
  function bandGeo(r, h, phi) {
    const k = "N" + key(r, h, phi) + rad;
    if (!CACHE.has(k))
      CACHE.set(k, new THREE.CylinderGeometry(r, r, h, rad, 1, true, -phi / 2, phi));
    return CACHE.get(k);
  }
  return { slabGeo, capGeo, ballGeo, shellGeo, bandGeo,
           ringGeo: (r, t) => new THREE.TorusGeometry(r, t, lod === "far" ? 4 : 8,
                                                      lod === "far" ? 8 : 20) };
}

/* ── merging ──────────────────────────────────────────────────────────
   A body is about fifty parts, and fifty parts is fifty draw calls. Parts that
   move together never need to be separate meshes, so each rig group is welded
   into one mesh per material once the body is built. Nothing about the shape
   changes — the same triangles are submitted, in far fewer calls.

   The welding stops at the rig boundary, because a welded shoulder could not
   bend. A FAR body is welded whole: at sixty metres an arm swing is under a
   pixel, and a body that cannot articulate is the correct thing to draw there. */
function bake(THREE, geo, m) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(m);
  return g;
}

function weld(THREE, group, deep) {
  const buckets = new Map();
  const keep = [];
  const visit = (o, m) => {
    const mm = m.clone().multiply(o.matrix);
    if (o.isMesh) {
      const k = o.material.uuid;
      if (!buckets.has(k)) buckets.set(k, { mat: o.material, geos: [] });
      buckets.get(k).geos.push(bake(THREE, o.geometry, mm));
      return true;
    }
    if (o.isGroup && (deep || !o.userData.rigJoint)) {
      for (const c of [...o.children]) visit(c, mm);
      if (!deep) return false;
      return true;
    }
    return false;
  };
  for (const c of [...group.children]) {
    c.updateMatrix();
    if (c.isGroup && !deep) { keep.push(c); continue; }
    c.updateMatrix();
    if (!visit(c, new THREE.Matrix4())) keep.push(c);
  }
  group.clear();
  for (const c of keep) group.add(c);
  for (const { mat, geos } of buckets.values()) {
    const merged = concat(THREE, geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    group.add(mesh);
  }
}

/* Concatenate non-indexed geometries that share an attribute set. Written here
   rather than pulled from three/examples, because the vendored three is the
   core module only and this world boots with the network switched off. */
function concat(THREE, geos) {
  geos = geos.filter((g) => g.attributes.position);
  if (!geos.length) return null;
  const names = ["position", "normal", "uv"].filter(
    (n) => geos.every((g) => g.attributes[n]));
  const total = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = geos[0].attributes[n].itemSize;
    const arr = new Float32Array(total * size);
    let at = 0;
    for (const g of geos) {
      const a = g.attributes[n];
      for (let i = 0; i < a.count * size; i++) arr[at + i] = a.array[i];
      at += a.count * size;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  for (const g of geos) g.dispose();
  return out;
}

export function buildBody(THREE, a, opts = {}) {
  const v = BODY[a.body_variant] || BODY.A1;
  const k = BUILD[a.build] || 1;
  const H = (a.height || 1.78) * v.h;          // metres, and the world is metres
  const S = H / 1.78;                          // everything below is in 1.78-units
  const lod = opts.lod || "near";
  // Three reading distances, and each one has a job. FAR: a silhouette — build,
  // height and palette, nothing smaller. MID: the role becomes readable, so the
  // carried equipment stays but the geometry coarsens. NEAR: everything.
  const detail = lod !== "far";
  const P = primitives(THREE, lod);

  const prim = new THREE.MeshStandardMaterial(M(a.primary_color, a.material));
  const sec = new THREE.MeshStandardMaterial(M(a.secondary_color, a.material));
  const acc = new THREE.MeshStandardMaterial(M(a.accent_color, a.material));
  const lit = new THREE.MeshStandardMaterial(
    M(a.secondary_color, a.material, 0.85));
  // Shells are open surfaces, so they must be lit from both sides or they
  // vanish the moment the camera goes round the back.
  const dark = new THREE.MeshStandardMaterial(
    { color: 0x14181c, roughness: 0.42, metalness: 0.58 });
  // Every distinct material is a draw call per body, and at sixty metres a
  // double-sided shell, a lit strip and a polished joint are all the same few
  // pixels. A far body therefore shares materials rather than carrying nine.
  const primS = detail ? Object.assign(prim.clone(), { side: THREE.DoubleSide }) : prim;
  const secS = detail ? Object.assign(sec.clone(), { side: THREE.DoubleSide }) : sec;
  const litS = detail ? Object.assign(lit.clone(), { side: THREE.DoubleSide }) : sec;
  const joint = detail
    ? new THREE.MeshStandardMaterial({ color: 0x8a939d, roughness: 0.30, metalness: 0.90 })
    : dark;

  const g = new THREE.Group();
  g.userData.materials = [...new Set([prim, sec, acc, lit, primS, secS, litS,
                                      dark, joint])];
  const put = (parent, geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = lod !== "far";
    parent.add(mesh);
    return mesh;
  };
  // the four shorthands the rest of this function is written in
  const slab = (p, m, w, h, d, x, y, z, r = 0.022 * S) =>
    put(p, P.slabGeo(w, h, d, r, Math.min(0.016 * S, d * 0.3)), m, x, y, z);
  const limb = (p, m, r, len, x, y, z) => put(p, P.capGeo(r, len), m, x, y, z);
  const ball = (p, m, r, x, y, z) => put(p, P.ballGeo(r), m, x, y, z);
  const shell = (p, m, r, phi, th, x, y, z) => put(p, P.shellGeo(r, phi, th), m, x, y, z);

  /* ── the rig. Named groups, because the animation poses these and nothing
        else — no mesh in this body is moved directly. ── */
  const root = new THREE.Group();          g.add(root);
  const hips = new THREE.Group();          root.add(hips);
  const torso = new THREE.Group();         hips.add(torso);
  const neck = new THREE.Group();          torso.add(neck);
  const armL = new THREE.Group();          torso.add(armL);
  const armR = new THREE.Group();          torso.add(armR);
  const foreL = new THREE.Group();         armL.add(foreL);
  const foreR = new THREE.Group();         armR.add(foreR);
  const legL = new THREE.Group();          hips.add(legL);
  const legR = new THREE.Group();          hips.add(legR);
  const shinL = new THREE.Group();         legL.add(shinL);
  const shinR = new THREE.Group();         legR.add(shinR);

  /* The vertical layout, once, in one place. Every number below is an offset
     from the group above it, so the parts CONNECT — a gap between the neck and
     the chest is the difference between a robot and a stack of shapes. */
  const hipY = 0.92 * S;                   // hip pivot height above the floor
  const shoulderY = 0.44 * S;              // above the hip pivot
  hips.position.y = hipY;
  neck.position.y = 0.58 * S;
  armL.position.set(-v.shoulder * k * S * 0.5 - 0.035 * S, shoulderY, 0);
  armR.position.set(v.shoulder * k * S * 0.5 + 0.035 * S, shoulderY, 0);
  foreL.position.y = -0.32 * S;
  foreR.position.y = -0.32 * S;
  legL.position.set(-0.115 * k * S, -0.04 * S, 0);
  legR.position.set(0.115 * k * S, -0.04 * S, 0);
  shinL.position.y = -0.42 * S;
  shinR.position.y = -0.42 * S;

  const armR_ = v.limb * 0.62 * k * S;     // limb radius, tuned to read at 1.78m
  const legR_ = v.limb * 0.86 * k * S;
  const chestW = v.shoulder * k * S;
  const chestD = v.chest * k * S;
  const waistW = v.waist * k * S;

  /* ── pelvis: a chamfered block with a visible spine column above it ── */
  slab(hips, prim, waistW, 0.17 * S, chestD * 0.86, 0, -0.045 * S, 0, 0.035 * S);
  slab(hips, dark, waistW * 0.92, 0.055 * S, chestD * 0.90, 0, 0.035 * S, 0, 0.022 * S);
  for (const s of [-1, 1]) ball(hips, joint, 0.055 * S, s * 0.115 * k * S, -0.04 * S, 0);

  /* ── torso: three stacked sections that taper, plus a shoulder yoke, so the
        silhouette has a waist and the chest sits ON something ── */
  slab(torso, prim, waistW * 0.94, 0.14 * S, chestD * 0.80, 0, 0.10 * S, 0, 0.03 * S);
  slab(torso, prim, chestW * 0.86, 0.20 * S, chestD * 0.94, 0, 0.26 * S, 0, 0.04 * S);
  slab(torso, prim, chestW * 0.97, 0.19 * S, chestD, 0, 0.43 * S, 0, 0.045 * S);
  // shoulder yoke — bridges the chest to both arms, which is what stops the
  // arms looking bolted onto thin air
  slab(torso, sec, chestW * 1.02 + 0.03 * S, 0.075 * S, chestD * 0.78,
       0, shoulderY + 0.055 * S, 0, 0.03 * S);
  // dorsal shell and the spine seam
  shell(torso, primS, chestD * 0.62, Math.PI * 1.02, Math.PI * 0.62,
        0, 0.34 * S, -chestD * 0.16).rotation.set(Math.PI / 2, 0, 0);
  slab(torso, dark, 0.05 * S, 0.40 * S, 0.03 * S, 0, 0.30 * S, -chestD / 2 - 0.012 * S,
       0.014 * S);
  // collar: the neck has to come out of something
  slab(torso, dark, chestW * 0.34, 0.07 * S, chestD * 0.55, 0, 0.53 * S, 0, 0.026 * S);

  /* ── chest plate: the agent's badge, and one of its identity marks ── */
  const plateZ = chestD / 2 + 0.006 * S;
  if (!detail) { /* a badge is sub-pixel at this range */
  } else if (a.chest_variant === "C1") {                     // recessed panel
    slab(torso, dark, chestW * 0.56, 0.20 * S, 0.022 * S, 0, 0.36 * S, plateZ, 0.02 * S);
    slab(torso, lit, chestW * 0.44, 0.10 * S, 0.012 * S, 0, 0.36 * S,
         plateZ + 0.016 * S, 0.012 * S);
  } else if (a.chest_variant === "C2") {              // louvred grille
    for (let i = 0; i < 4; i++)
      slab(torso, dark, chestW * 0.54, 0.024 * S, 0.026 * S,
           0, (0.46 - i * 0.048) * S, plateZ, 0.008 * S);
    slab(torso, acc, chestW * 0.15, 0.055 * S, 0.022 * S,
         -chestW * 0.30, 0.27 * S, plateZ, 0.012 * S);
  } else if (a.chest_variant === "C3") {              // pressed disc badge
    const d = put(torso, P.ringGeo(0.072 * S, 0.016 * S), acc, 0, 0.38 * S, plateZ);
    d.rotation.x = Math.PI / 2;
    slab(torso, dark, 0.10 * S, 0.10 * S, 0.02 * S, 0, 0.38 * S, plateZ, 0.02 * S);
    slab(torso, lit, chestW * 0.30, 0.022 * S, 0.014 * S, 0, 0.23 * S, plateZ, 0.01 * S);
  } else {                                            // layered armour
    slab(torso, sec, chestW * 0.76, 0.15 * S, 0.034 * S, 0, 0.45 * S, plateZ, 0.026 * S);
    slab(torso, dark, chestW * 0.60, 0.12 * S, 0.026 * S, 0, 0.29 * S, plateZ, 0.022 * S);
    slab(torso, lit, chestW * 0.32, 0.018 * S, 0.014 * S, 0, 0.29 * S,
         plateZ + 0.014 * S, 0.008 * S);
  }
  // the identification strip every member of this civilisation carries
  if (detail)
    slab(torso, acc, 0.028 * S, 0.24 * S, 0.014 * S,
         chestW * 0.44, 0.34 * S, plateZ, 0.012 * S);

  /* ── shoulders and arms: ball joint, curved pauldron, capsule limb ── */
  for (const [grp, fore, side] of [[armL, foreL, -1], [armR, foreR, 1]]) {
    ball(grp, joint, armR_ * 1.34, 0, 0, 0);
    const pad = shell(grp, secS, armR_ * 1.95, Math.PI * 1.15, Math.PI * 0.56,
                      side * 0.012 * S, 0.012 * S, 0);
    pad.rotation.set(0, 0, side * 0.30);
    limb(grp, prim, armR_, 0.30 * S, 0, -0.17 * S, 0);
    slab(grp, dark, armR_ * 0.5, 0.09 * S, armR_ * 1.7, side * armR_ * 0.85,
         -0.17 * S, 0, 0.012 * S);
    ball(fore, joint, armR_ * 1.06, 0, 0, 0);
    limb(fore, sec, armR_ * 0.92, 0.28 * S, 0, -0.16 * S, 0);
    // hand: a chamfered palm with a two-finger gripper, not a cube
    const palm = slab(fore, dark, armR_ * 1.5, 0.085 * S, armR_ * 1.1,
                      0, -0.325 * S, 0, 0.018 * S);
    if (detail)
      for (const f of [-1, 1])
        slab(fore, joint, armR_ * 0.38, 0.055 * S, armR_ * 0.5,
             f * armR_ * 0.5, -0.385 * S, 0.006 * S, 0.012 * S);
    palm.rotation.x = 0.06;
    if (detail)
      slab(grp, acc, 0.016 * S, 0.075 * S, 0.02 * S,
           side * armR_ * 1.05, -0.05 * S, armR_ * 0.7, 0.007 * S);
  }

  /* ── legs: three gaits in the family, every joint visible ── */
  for (const [thigh, shin, side] of [[legL, shinL, -1], [legR, shinR, 1]]) {
    limb(thigh, prim, legR_, 0.40 * S, 0, -0.20 * S, 0);
    slab(thigh, sec, legR_ * 1.5, 0.16 * S, legR_ * 0.7,
         side * legR_ * 0.55, -0.16 * S, 0, 0.02 * S);
    ball(shin, joint, legR_ * 1.02, 0, 0, 0);
    limb(shin, sec, legR_ * 0.86, 0.38 * S, 0, -0.19 * S, 0);
    ball(shin, joint, legR_ * 0.72, 0, -0.38 * S, 0);
    const foot = (fwd, lift) => {
      const f = slab(shin, dark, legR_ * 2.0, 0.055 * S, 0.24 * S,
                     0, -0.415 * S + lift, fwd, 0.024 * S);
      slab(shin, joint, legR_ * 1.5, 0.035 * S, 0.07 * S,
           0, -0.40 * S + lift, fwd + 0.10 * S, 0.016 * S);
      return f;
    };
    if (v.legs === "digitigrade") {
      shin.rotation.x = 0.24;
      foot(0.055 * S, 0).rotation.x = -0.24;
      shin.children[shin.children.length - 1].rotation.x = -0.24;
    } else if (v.legs === "braced") {
      slab(shin, sec, 0.05 * S, 0.30 * S, 0.04 * S, side * legR_ * 1.25, -0.19 * S, 0,
           0.016 * S);
      foot(0.04 * S, 0);
    } else {
      foot(0.045 * S, 0);
    }
  }

  /* ── head: refined optics, never a face ── */
  const hw = 0.175 * k * S, hh = 0.175 * S, hd = 0.195 * k * S;
  limb(neck, joint, 0.042 * S, 0.10 * S, 0, 0.035 * S, 0);
  // skull: a chamfered core with a moulded crown, so it is not a die
  slab(neck, prim, hw, hh * 0.86, hd, 0, 0.145 * S, 0, 0.042 * S);
  shell(neck, primS, hw * 0.60, Math.PI * 2, Math.PI * 0.5, 0, 0.205 * S, 0);
  slab(neck, dark, hw * 1.02, hh * 0.34, hd * 0.55, 0, 0.128 * S, 0, 0.03 * S);
  const fz = hd / 2 - 0.004 * S;
  const face = (geo, mat, x, y, z) => put(neck, geo, mat, x, y, z);
  if (a.head_variant === "H1") {                       // continuous wrapping visor
    const band = face(P.bandGeo(hw * 0.56, 0.052 * S, Math.PI * 1.15), litS,
                      0, 0.152 * S, -hw * 0.06);
    band.scale.z = hd / (hw * 1.12);
    const cowl = face(P.bandGeo(hw * 0.63, 0.085 * S, Math.PI * 1.05), primS,
                      0, 0.152 * S, -hw * 0.06);
    cowl.scale.z = hd / (hw * 1.12);
  } else if (a.head_variant === "H2") {                // twin recessed optics
    for (const s of [-1, 1]) {
      slab(neck, dark, 0.062 * S, 0.062 * S, 0.02 * S, s * 0.048 * S, 0.150 * S,
           fz, 0.028 * S);
      const o = put(neck, P.ballGeo(0.023 * S), lit, s * 0.048 * S, 0.150 * S,
                    fz + 0.008 * S);
      o.scale.z = 0.5;
    }
  } else if (a.head_variant === "H3") {                // segmented sensor array
    slab(neck, dark, hw * 0.88, 0.055 * S, 0.022 * S, 0, 0.150 * S, fz, 0.02 * S);
    for (let i = -2; i <= 2; i++)
      slab(neck, lit, 0.019 * S, 0.034 * S, 0.016 * S, i * 0.030 * S, 0.150 * S,
           fz + 0.010 * S, 0.007 * S);
  } else if (a.head_variant === "H4") {                // dome and status strip
    shell(neck, secS, hw * 0.66, Math.PI * 2, Math.PI * 0.52, 0, 0.196 * S, 0);
    const band = face(P.bandGeo(hw * 0.54, 0.030 * S, Math.PI * 0.9), litS,
                      0, 0.140 * S, -hw * 0.06);
    band.scale.z = hd / (hw * 1.10);
  } else {                                              // faceted, narrow aperture
    const f = slab(neck, sec, hw * 0.92, hh * 0.56, 0.055 * S, 0, 0.158 * S,
                   hd / 2 - 0.022 * S, 0.03 * S);
    f.rotation.x = -0.18;
    slab(neck, dark, hw * 0.70, 0.042 * S, 0.02 * S, 0, 0.156 * S, fz + 0.012 * S,
         0.018 * S);
    slab(neck, lit, hw * 0.46, 0.020 * S, 0.014 * S, 0, 0.156 * S, fz + 0.022 * S,
         0.008 * S);
  }
  // sensor fitting
  if (!detail) { /* dropped at distance */
  } else if (a.sensor_variant === "S1") {
    const boom = limb(neck, joint, 0.011 * S, 0.22 * S, 0.105 * S, 0.225 * S, 0);
    boom.rotation.z = -0.48;
    const pod = slab(neck, acc, 0.05 * S, 0.042 * S, 0.06 * S, 0.185 * S, 0.315 * S, 0,
                     0.018 * S);
    pod.rotation.z = -0.48;
  } else if (a.sensor_variant === "S2") {
    const collar = put(neck, P.ringGeo(0.125 * S, 0.014 * S), acc, 0, 0.035 * S, 0);
    collar.rotation.x = Math.PI / 2;
  } else if (a.sensor_variant === "S3") {
    for (const s of [-1, 1]) {
      const t = slab(neck, acc, 0.022 * S, 0.055 * S, 0.055 * S,
                     s * (hw / 2 + 0.010 * S), 0.165 * S, 0, 0.016 * S);
      t.rotation.z = s * 0.14;
    }
  }

  /* ── role equipment. Role changes what an agent CARRIES, never its colour. ── */
  const eq = detail ? (a.equipment || "") : "";
  if (eq.includes("sensor boom")) {
    const slate = slab(foreL, dark, 0.18 * S, 0.014 * S, 0.13 * S, 0, -0.375 * S,
                       0.085 * S, 0.012 * S);
    slate.rotation.x = -0.38;
    const face2 = slab(foreL, lit, 0.15 * S, 0.008 * S, 0.10 * S, 0, -0.382 * S,
                       0.088 * S, 0.008 * S);
    face2.rotation.x = -0.38;
  } else if (eq.includes("forearm tool")) {
    const t = limb(foreR, joint, 0.032 * S, 0.15 * S, 0, -0.40 * S, 0.035 * S);
    t.rotation.x = 0.3;
    slab(foreR, acc, 0.032 * S, 0.05 * S, 0.032 * S, 0, -0.465 * S, 0.055 * S, 0.012 * S);
    slab(torso, dark, chestW * 0.54, 0.22 * S, 0.075 * S, 0, 0.30 * S,
         -chestD / 2 - 0.055 * S, 0.028 * S);
  } else if (eq.includes("inspection lamp")) {
    const lamp = put(foreR, new THREE.CylinderGeometry(0.038 * S, 0.028 * S, 0.07 * S,
      lod === "far" ? 6 : 14), joint, 0, -0.40 * S, 0.03 * S);
    lamp.rotation.x = 0.4;
    put(foreR, P.ballGeo(0.028 * S), lit, 0, -0.428 * S, 0.055 * S).scale.y = 0.5;
    const sl = slab(foreL, dark, 0.16 * S, 0.014 * S, 0.12 * S, 0, -0.375 * S,
                    0.075 * S, 0.012 * S);
    sl.rotation.x = -0.42;
  } else if (eq.includes("comms module")) {
    slab(armR, acc, 0.075 * S, 0.055 * S, 0.075 * S, 0.018 * S, 0.075 * S, -0.02 * S,
         0.022 * S);
    limb(torso, lit, 0.016 * S, 0.15 * S, chestW * 0.42, shoulderY + 0.14 * S, 0);
  } else if (eq.includes("coordination ring")) {
    const ring = put(torso, P.ringGeo(0.17 * S, 0.013 * S), acc, 0, 0.74 * S, 0);
    ring.rotation.x = Math.PI / 2;
    limb(torso, joint, 0.012 * S, 0.14 * S, 0, 0.66 * S, 0);
  }

  const rig = { root, hips, torso, neck, armL, armR, foreL, foreR,
                legL, legR, shinL, shinR };
  for (const j of Object.values(rig)) j.userData.rigJoint = true;
  if (lod === "far") {
    // One mesh per material for the whole body. It cannot articulate, and at
    // this distance nothing it could do would be visible.
    root.updateMatrixWorld(true);
    weld(THREE, root, true);
    g.userData.rig = null;
  } else {
    for (const j of Object.values(rig)) weld(THREE, j, false);
    g.userData.rig = rig;
  }
  g.userData.scale = S;
  g.userData.height = H;
  return g;
}

/* ── POSE ─────────────────────────────────────────────────────────────
   A pure function of (animation, time, phase). It sets rotations on the rig
   and nothing else, so an animation can never move an agent through the world
   — position is the server's, always. `speed` is 0 unless the world says the
   agent is walking, which is why a standing agent's legs do not cycle. */
export function poseBody(body, anim, t, phase = 0) {
  const r = body.userData.rig;
  if (!r) return;
  const S = body.userData.scale || 1;
  const T = t + phase;
  const breathe = Math.sin(T * 1.1) * 0.012;

  // reset the few joints every pose touches
  r.hips.position.y = 0.92 * S;
  r.torso.rotation.set(0, 0, 0);
  r.neck.rotation.set(0, 0, 0);
  r.armL.rotation.set(0, 0, 0.06);
  r.armR.rotation.set(0, 0, -0.06);
  r.foreL.rotation.set(0, 0, 0);
  r.foreR.rotation.set(0, 0, 0);
  r.legL.rotation.set(0, 0, 0);
  r.legR.rotation.set(0, 0, 0);
  r.shinL.rotation.x = 0;
  r.shinR.rotation.x = 0;

  switch (anim) {
    case "walk": {
      const s = Math.sin(T * 5.2), c = Math.cos(T * 5.2);
      r.legL.rotation.x = s * 0.62;
      r.legR.rotation.x = -s * 0.62;
      r.shinL.rotation.x = Math.max(0, -s) * 0.78;
      r.shinR.rotation.x = Math.max(0, s) * 0.78;
      r.armL.rotation.x = -s * 0.42;
      r.armR.rotation.x = s * 0.42;
      r.foreL.rotation.x = -Math.max(0, -s) * 0.34;
      r.foreR.rotation.x = -Math.max(0, s) * 0.34;
      r.hips.position.y = 0.92 * S + Math.abs(c) * 0.022 * S;
      r.torso.rotation.y = s * 0.055;
      r.neck.rotation.y = -s * 0.035;
      break;
    }
    case "type": {
      r.torso.rotation.x = 0.14;
      r.armL.rotation.x = -1.02; r.armR.rotation.x = -1.02;
      r.foreL.rotation.x = -0.72 + Math.sin(T * 8.5) * 0.10;
      r.foreR.rotation.x = -0.72 + Math.sin(T * 8.5 + 1.7) * 0.10;
      r.neck.rotation.x = 0.30;
      break;
    }
    case "read": {
      r.armL.rotation.x = -1.28; r.foreL.rotation.x = -0.55;
      r.armR.rotation.x = -0.24; r.foreR.rotation.x = -0.30;
      r.neck.rotation.x = 0.36 + Math.sin(T * 0.7) * 0.05;
      r.neck.rotation.y = Math.sin(T * 0.45) * 0.20;      // scanning the page
      r.torso.rotation.x = 0.07 + breathe;
      break;
    }
    case "assemble": case "rework": {
      const w = Math.sin(T * (anim === "rework" ? 2.1 : 3.4));
      r.torso.rotation.x = 0.20;
      r.armR.rotation.x = -1.16 + w * 0.26;
      r.foreR.rotation.x = -0.50 - w * 0.22;
      r.armL.rotation.x = -0.92;
      r.foreL.rotation.x = -0.46;
      r.neck.rotation.x = 0.40;
      r.hips.position.y = 0.92 * S - 0.015 * S;
      break;
    }
    case "inspect": {
      r.torso.rotation.x = 0.24;
      r.armR.rotation.x = -1.34; r.foreR.rotation.x = -0.34;
      r.armL.rotation.x = -0.70; r.foreL.rotation.x = -0.72;
      r.neck.rotation.x = 0.44;
      r.neck.rotation.y = Math.sin(T * 0.55) * 0.34;      // sweeping the artifact
      break;
    }
    case "operate": {
      r.armL.rotation.x = -1.12; r.armR.rotation.x = -1.12;
      r.foreL.rotation.x = -0.40; r.foreR.rotation.x = -0.40;
      r.torso.rotation.y = Math.sin(T * 0.6) * 0.14;
      r.neck.rotation.x = 0.18;
      break;
    }
    case "direct": {
      r.armR.rotation.x = -1.46 + Math.sin(T * 0.9) * 0.14;
      r.foreR.rotation.x = -0.34;
      r.torso.rotation.y = Math.sin(T * 0.4) * 0.26;      // addressing the floor
      r.neck.rotation.y = Math.sin(T * 0.4) * 0.30;
      r.torso.rotation.x = breathe;
      break;
    }
    case "confer": {
      r.torso.rotation.y = 0.42;
      r.neck.rotation.y = 0.30;
      r.armR.rotation.x = -0.62 + Math.sin(T * 2.2) * 0.16;
      r.foreR.rotation.x = -0.70;
      r.torso.rotation.x = breathe;
      break;
    }
    case "wait": {
      r.torso.rotation.x = breathe;
      r.neck.rotation.y = Math.sin(T * 0.28) * 0.42;      // looking about
      r.armL.rotation.x = 0.05; r.armR.rotation.x = 0.05;
      break;
    }
    case "blocked": {
      r.neck.rotation.x = 0.30;                            // head down
      r.torso.rotation.x = 0.06 + breathe * 0.5;
      r.armL.rotation.x = 0.12; r.armR.rotation.x = 0.12;
      r.hips.position.y = 0.92 * S - 0.012 * S;
      break;
    }
    case "work": {
      r.torso.rotation.x = 0.10;
      r.armL.rotation.x = -0.90; r.armR.rotation.x = -0.90;
      r.foreL.rotation.x = -0.52; r.foreR.rotation.x = -0.52;
      r.neck.rotation.x = 0.24;
      break;
    }
    default: {                                             // idle
      r.torso.rotation.x = breathe;
      r.torso.rotation.y = Math.sin(T * 0.23) * 0.05;
      r.neck.rotation.y = Math.sin(T * 0.19) * 0.12;
      r.hips.position.y = 0.92 * S + breathe * 0.4 * S;
      r.armL.rotation.x = Math.sin(T * 0.5) * 0.02;
      r.armR.rotation.x = -Math.sin(T * 0.5) * 0.02;
    }
  }
}

export function disposeBody(body) {
  body.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  for (const m of body.userData.materials || []) m.dispose();
}
