// ── The studio view ──────────────────────────────────────────────────────────
//
// The same frames the 2D renderer draws, put in a lit three-dimensional scene:
// perspective, soft shadows, physically based materials, and a bloom pass so
// the emissive parts read as light rather than as bright paint.
//
// One thing this must not do, and it is the reason the badge in the corner
// exists: **the world is two-dimensional and the physics is two-dimensional.**
// There is no height field, no slope, no ground normal and no foot contact —
// that boundary is enforced by a test in `lib/robotics/__tests__/physics.test.ts`
// and it has not moved. The obstacles here are extruded to a height this file
// chose so the scene reads; the simulator knows nothing about that height.
//
// So this is a renderer, not a simulation. It shows what the robot is doing
// more legibly than a top-down diagram can. It does not show anything the
// robot's physics does not already contain.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { beamLocal, beams } from "./beams.ts";
import type { Layers, SceneState } from "./types.ts";

/** Heights chosen for legibility. The simulator has no opinion about any of them. */
const H = {
  wall: 0.75,
  obstacle: 0.55,
  robotBody: 0.30,
  sensor: 0.42,
  human: 1.7,
  object: 0.10,
  floor: 0.0,
};

const ROBOT_RADIUS = 0.28;
const WHEEL_R = 0.105;
const HUMAN_RADIUS = 0.25;
/** Bodies touch at this separation, centre to centre. */
const CONTACT = ROBOT_RADIUS + HUMAN_RADIUS + 0.02;

const C = {
  floor: 0x0a0f1a,
  grid: 0x1b2942,
  wall: 0x263449,
  obstacle: 0x33465f,
  robot: 0xdbe5f0,
  human: 0xf0736f,
  object: 0xf0b429,
  objectHeld: 0xb87ff5,
  objectDamaged: 0xf43f5e,
  dock: 0x2ee6a8,
  lidar: 0xffd23f,
  envelope: 0xff5d5d,
  trail: 0x4cc9f0,
  free: 0x1d3555,
  occupied: 0x3d5878,
};

type Pool<T extends THREE.Object3D> = { items: T[]; make: () => T };

function take<T extends THREE.Object3D>(pool: Pool<T>, index: number, parent: THREE.Object3D): T {
  let item = pool.items[index];
  if (!item) {
    item = pool.make();
    pool.items[index] = item;
    parent.add(item);
  }
  item.visible = true;
  return item;
}

function hide<T extends THREE.Object3D>(pool: Pool<T>, from: number): void {
  for (let i = from; i < pool.items.length; i += 1) pool.items[i].visible = false;
}

export type CameraMode = "orbit" | "follow" | "chase";

export class Studio {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private composer: EffectComposer | null = null;
  private readonly canvas: HTMLCanvasElement;

  private readonly world = new THREE.Group();
  private readonly idle = new THREE.Group();
  private readonly dynamic = new THREE.Group();
  private readonly key: THREE.DirectionalLight;

  private robot: THREE.Group | null = null;
  private accent: THREE.MeshStandardMaterial | null = null;
  private turret: THREE.Group | null = null;
  private turretWindow: THREE.Mesh | null = null;
  private turretFov = -1;
  private lidarMesh: THREE.Mesh | null = null;
  private lidarPoints: THREE.Points | null = null;
  private envelopeRing: THREE.Mesh | null = null;
  private trailLine: THREE.Line | null = null;
  private mapTiles: THREE.InstancedMesh | null = null;

  private readonly humans: Pool<THREE.Group> = { items: [], make: () => this.makeHuman() };
  private readonly objects: Pool<THREE.Mesh> = { items: [], make: () => this.makeObject() };

  private built = false;
  private mode: CameraMode = "orbit";
  private readonly focus = new THREE.Vector3();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.fog = new THREE.Fog(0x05080f, 22, 62);

    // A cyclorama. Nothing above the room's walls is part of the world, so a
    // low camera used to look straight into flat black; a graded dome gives it
    // a horizon to sit against without pretending there is a ceiling.
    this.scene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(90, 32, 20),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          depthWrite: false,
          fog: false,
          uniforms: {
            top: { value: new THREE.Color(0x0b1220) },
            horizon: { value: new THREE.Color(0x141d2e) },
            bottom: { value: new THREE.Color(0x03050a) },
          },
          vertexShader: `
            varying float vH;
            void main() {
              vH = normalize(position).y;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: `
            uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
            varying float vH;
            void main() {
              vec3 c = vH > 0.0
                ? mix(horizon, top, smoothstep(0.0, 0.55, vH))
                : mix(horizon, bottom, smoothstep(0.0, 0.35, -vH));
              gl_FragColor = vec4(c, 1.0);
            }`,
        }),
      ),
    );

    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    this.camera.position.set(9, 9, 12);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 45;

    this.scene.add(this.world, this.dynamic, this.idle);

    // Before a scenario has sent its world there is nothing to draw, and an
    // empty scene aimed at the origin looks at the dark underside of the dome —
    // which is to say, at nothing. An empty stage reads as waiting instead of
    // as broken.
    const stage = new THREE.GridHelper(40, 40, 0x35507a, 0x1e2d47);
    (stage.material as THREE.Material).transparent = true;
    (stage.material as THREE.Material).opacity = 0.7;
    this.idle.add(stage);
    this.controls.target.set(0, 0.6, 0);
    this.camera.position.set(7, 4.2, 9);
    this.controls.update();

    // --- the lighting rig -------------------------------------------------
    //
    // Key, fill and two rims. The rims are what make a dark scene read as a
    // studio rather than as a dim room: they put an edge on every silhouette
    // without lifting the black.
    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0a0f18, 0.55));

    this.key = new THREE.DirectionalLight(0xffffff, 2.1);
    this.key.position.set(7, 12, 5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.02;
    const cam = this.key.shadow.camera;
    cam.near = 1;
    cam.far = 45;
    cam.left = -14;
    cam.right = 14;
    cam.top = 14;
    cam.bottom = -14;
    this.scene.add(this.key, this.key.target);

    const rimCool = new THREE.DirectionalLight(0x5b8cff, 1.1);
    rimCool.position.set(-9, 4, -7);
    const rimWarm = new THREE.DirectionalLight(0xffb066, 0.55);
    rimWarm.position.set(6, 3, -9);
    this.scene.add(rimCool, rimWarm);

    this.buildComposer();
  }

  private buildComposer(): void {
    try {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        0.62, // strength — enough for the emissives, not enough to fog the scene
        0.85, // radius
        0.72, // threshold: only things brighter than the body glow
      );
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
    } catch {
      // A machine without the float targets bloom needs still gets the scene.
      this.composer = null;
    }
  }

  // --- construction, once the world dimensions are known --------------------

  private buildWorld(setup: NonNullable<SceneState["setup"]>): void {
    this.world.clear();
    const { width, height } = setup;
    const cx = width / 2;
    const cz = height / 2;

    // The floor of the room, and a larger dark plane under it so the room sits
    // on something instead of floating in the void.
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 1, metalness: 0 }),
    );
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -0.02;
    backdrop.receiveShadow = true;
    this.world.add(backdrop);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        color: C.floor,
        roughness: 0.58,
        metalness: 0.15,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.receiveShadow = true;
    this.world.add(floor);

    const grid = new THREE.GridHelper(Math.max(width, height), Math.round(Math.max(width, height)), C.grid, C.grid);
    grid.position.set(cx, 0.004, cz);
    (grid.material as THREE.Material).opacity = 0.42;
    (grid.material as THREE.Material).transparent = true;
    this.world.add(grid);

    // The room's own walls, so the space is enclosed rather than implied.
    const wallMat = new THREE.MeshStandardMaterial({
      color: C.wall,
      roughness: 0.82,
      metalness: 0.06,
    });
    const T = 0.12;
    const walls: Array<[number, number, number, number]> = [
      [cx, 0, width, T],
      [cx, height, width, T],
      [0, cz, T, height],
      [width, cz, T, height],
    ];
    for (const [x, z, w, d] of walls) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, H.wall, d), wallMat);
      mesh.position.set(x, H.wall / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.world.add(mesh);
    }

    const obstacleMat = new THREE.MeshStandardMaterial({
      color: C.obstacle,
      roughness: 0.7,
      metalness: 0.12,
    });
    for (const o of setup.obstacles) {
      const mesh =
        o.kind === "circle"
          ? new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius * 1.03, H.obstacle, 28), obstacleMat)
          : new THREE.Mesh(new THREE.BoxGeometry(o.width, H.obstacle, o.height), obstacleMat);
      mesh.position.set(o.at.x, H.obstacle / 2, o.at.y);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.world.add(mesh);
    }

    // The dock, as a lit pad rather than a square outline.
    const dock = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.03, 0.5),
      new THREE.MeshStandardMaterial({
        color: C.dock,
        emissive: C.dock,
        emissiveIntensity: 1.4,
        roughness: 0.4,
      }),
    );
    dock.position.set(setup.dock.x, 0.015, setup.dock.y);
    this.world.add(dock);

    // Fit the shadow camera to this room. It used to be a fixed +/-14 m box,
    // which left the floor beyond it out of the shadow pass entirely: the
    // backdrop outside that box kept the rim lights the room's walls should
    // have blocked, and the boundary showed up as a hard-edged bright
    // parallelogram running off into the dark.
    const reach = Math.hypot(width, height) / 2 + 3;
    const cam = this.key.shadow.camera;
    cam.left = -reach;
    cam.right = reach;
    cam.top = reach;
    cam.bottom = -reach;
    cam.updateProjectionMatrix();
    this.key.position.set(cx + width * 0.4, Math.max(width, height) * 0.9, cz - height * 0.25);
    this.key.target.position.set(cx, 0, cz);
    this.key.target.updateMatrixWorld();
    this.frameRoom(width, height);
    this.built = true;
  }

  /**
   * Put the whole room on screen. The old version guessed a distance from the
   * room's width, which left a third of the canvas empty on a wide viewport and
   * cropped the walls on a narrow one. This fits the room's bounding circle
   * inside whichever field of view is the tighter of the two.
   */
  private frameRoom(width: number, height: number): void {
    const cx = width / 2;
    const cz = height / 2;
    this.controls.target.set(cx, 0.4, cz);
    this.focus.set(cx, 0.4, cz);

    // A three-quarter view: high enough to read the layout, low enough that the
    // obstacles keep a visible side and therefore a shadow to sit in. The swing
    // is taken from whichever axis is longer, so the room's long side runs
    // across the screen's long side instead of diagonally across a wide canvas.
    const alongX = width >= height;
    const azimuth = (alongX ? 0 : Math.PI / 2) + Math.PI * 0.13;
    const elevation = Math.PI * 0.26;
    const dir = new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth),
    );

    // Solve for the distance along `dir` at which every corner of the room is
    // inside the frustum. Fitting the bounding *circle* instead — the obvious
    // shortcut — leaves a rectangular room swimming in empty canvas, because a
    // room is not as wide as its diagonal from every angle.
    const target = this.controls.target;
    const forward = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * this.camera.aspect;

    let distance = 1;
    for (const x of [0, width]) {
      for (const y of [0, H.wall]) {
        for (const z of [0, height]) {
          const corner = new THREE.Vector3(x, y, z).sub(target);
          // Depth of this corner once the camera sits at `target + dir * d`.
          const behind = -corner.dot(dir);
          distance = Math.max(
            distance,
            Math.abs(corner.dot(right)) / tanH - behind,
            Math.abs(corner.dot(up)) / tanV - behind,
          );
        }
      }
    }

    this.camera.position.copy(target).addScaledVector(dir, distance * 1.02);
    this.controls.update();
  }

  /**
   * The robot, local +x forward. Two driven wheels and a trailing caster is the
   * arrangement the simulator's kinematics actually describe — differential
   * drive, `linear` and `angular`. The sizes are the renderer's choice, like
   * every other length in this file; the simulator has no wheel in it.
   */
  private makeRobot(): THREE.Group {
    const group = new THREE.Group();

    const dark = new THREE.MeshStandardMaterial({ color: 0x141b27, roughness: 0.42, metalness: 0.85 });

    // --- running gear -----------------------------------------------------
    const wheel = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.055, 26);
    const tyre = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.92, metalness: 0.05 });
    const hub = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.3,
      metalness: 0.9,
    });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wheel, tyre);
      w.rotation.x = Math.PI / 2;
      w.position.set(0, WHEEL_R, side * ROBOT_RADIUS * 0.82);
      w.castShadow = true;
      group.add(w);

      const cap = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R * 0.4, WHEEL_R * 0.4, 0.06, 18), hub);
      cap.rotation.x = Math.PI / 2;
      cap.position.copy(w.position);
      group.add(cap);
    }
    const caster = new THREE.Mesh(new THREE.SphereGeometry(WHEEL_R * 0.52, 16, 12), hub);
    caster.position.set(-ROBOT_RADIUS * 0.74, WHEEL_R * 0.52, 0);
    caster.castShadow = true;
    group.add(caster);

    // --- chassis ----------------------------------------------------------
    const CHASSIS_BOTTOM = 0.085;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(ROBOT_RADIUS * 0.88, ROBOT_RADIUS * 0.8, H.robotBody - CHASSIS_BOTTOM, 44),
      dark,
    );
    body.position.y = (H.robotBody + CHASSIS_BOTTOM) / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // A brushed deck, inset, so the silhouette has a rim to catch the rims.
    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(ROBOT_RADIUS, ROBOT_RADIUS * 0.95, 0.045, 44),
      new THREE.MeshStandardMaterial({ color: C.robot, roughness: 0.24, metalness: 0.62 }),
    );
    deck.position.y = H.robotBody + 0.01;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    // The light ring the abilities actually drive through `lights.color`.
    this.accent = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x3b82f6,
      emissiveIntensity: 3.2,
      roughness: 0.3,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ROBOT_RADIUS * 0.92, 0.026, 12, 56), this.accent);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = H.robotBody - 0.035;
    group.add(ring);

    // A short light on the mast too, so the robot is still a point of colour
    // when the whole room is in frame and the ring is two pixels tall.
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), this.accent);
    beacon.position.y = H.sensor + 0.12;
    group.add(beacon);

    // --- sensor turret ----------------------------------------------------
    //
    // A housing at the height the lidar plane sits at, and a bright window over
    // the arc the robot can actually see. The window is built from the frame's
    // own `lidar.fov`, so a narrow sensor looks narrow: it is not decoration.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.08, 16), hub);
    mast.position.y = H.robotBody + 0.05;
    group.add(mast);

    const turret = new THREE.Group();
    turret.position.y = H.sensor;
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.085, 28), dark);
    housing.castShadow = true;
    turret.add(housing);
    const cap2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.022, 28), hub);
    cap2.position.y = 0.052;
    turret.add(cap2);
    this.turret = turret;
    group.add(turret);

    // Which way is forward, without a label.
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.16, 4),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x94a3b8, emissiveIntensity: 0.5, roughness: 0.3 }),
    );
    nose.rotation.z = -Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.position.set(ROBOT_RADIUS * 0.92, H.robotBody * 0.74, 0);
    group.add(nose);

    return group;
  }

  /** The lit arc on the turret, rebuilt only when the sensor's span changes. */
  private syncTurret(fov: number): void {
    if (!this.turret || Math.abs(fov - this.turretFov) < 1e-3) return;
    this.turretFov = fov;
    if (this.turretWindow) {
      this.turret.remove(this.turretWindow);
      this.turretWindow.geometry.dispose();
    }
    const span = Math.min(Math.max(fov, 0.05), Math.PI * 2);
    const window = new THREE.Mesh(
      // Local +x is forward and the cylinder's theta starts at +z, so the arc
      // is centred on forward by starting a quarter turn back from it.
      new THREE.CylinderGeometry(0.088, 0.088, 0.05, 40, 1, true, Math.PI / 2 - span / 2, span),
      new THREE.MeshStandardMaterial({
        color: C.lidar,
        emissive: C.lidar,
        emissiveIntensity: 1.6,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    this.turretWindow = window;
    this.turret.add(window);
  }

  private makeHuman(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(HUMAN_RADIUS * 0.8, H.human - HUMAN_RADIUS * 1.8, 6, 18),
      new THREE.MeshStandardMaterial({ color: C.human, roughness: 0.68, metalness: 0.02 }),
    );
    body.position.y = H.human / 2;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(HUMAN_RADIUS * 0.52, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xf5b4a8, roughness: 0.72, metalness: 0.02 }),
    );
    head.position.y = H.human - HUMAN_RADIUS * 0.3;
    head.castShadow = true;
    group.add(head);

    // The circle a person is entitled to. Bodies touch at its edge.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(CONTACT - 0.03, CONTACT, 56),
      new THREE.MeshBasicMaterial({
        color: C.human,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    group.add(ring);
    return group;
  }

  private makeObject(): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.BoxGeometry(0.16, H.object, 0.16),
      new THREE.MeshStandardMaterial({
        color: C.object,
        emissive: C.object,
        emissiveIntensity: 0.8,
        roughness: 0.45,
      }),
    );
  }

  // --- per-frame ------------------------------------------------------------

  sync(state: SceneState, layers: Layers): void {
    if (this.disposed) return;
    if (state.setup && !this.built) this.buildWorld(state.setup);
    this.idle.visible = !this.built;
    const frame = state.frame;
    if (!frame) return;

    const self = frame.robots[0];
    if (self) {
      if (!this.robot) {
        this.robot = this.makeRobot();
        this.dynamic.add(this.robot);
      }
      this.robot.position.set(self.x, 0, self.y);
      this.robot.rotation.y = -self.theta;
      // A tilting robot leans about the axis across its direction of travel.
      this.robot.rotation.z = 0;
      this.robot.rotation.x = 0;
      this.robot.rotateOnAxis(new THREE.Vector3(0, 0, 1), -self.tilt);
      if (this.accent) {
        const colour = new THREE.Color(self.lights.color || "#3b82f6");
        this.accent.color.copy(colour);
        this.accent.emissive.copy(colour);
      }
      this.focus.lerp(new THREE.Vector3(self.x, 0.4, self.y), 0.12);
    }

    this.syncLidar(state, layers);
    this.syncEnvelope(state, layers);
    this.syncTrail(state, layers);
    this.syncMap(state, layers);

    const people = frame.humans;
    people.forEach((h, i) => {
      const g = take(this.humans, i, this.dynamic);
      g.position.set(h.x, 0, h.y);
    });
    hide(this.humans, people.length);

    const loose = frame.objects.filter((o) => !o.held);
    loose.forEach((o, i) => {
      const m = take(this.objects, i, this.dynamic);
      m.position.set(o.x, H.object / 2 + 0.01, o.y);
      const mat = m.material as THREE.MeshStandardMaterial;
      const colour = o.damaged ? C.objectDamaged : o.held ? C.objectHeld : C.object;
      mat.color.setHex(colour);
      mat.emissive.setHex(colour);
    });
    hide(this.objects, loose.length);

    this.updateCamera();
  }

  /** The fan, built from the ranges the robot actually received. */
  private syncLidar(state: SceneState, layers: Layers): void {
    const frame = state.frame;
    const self = frame?.robots[0];
    if (!frame || !self || !layers.lidar || frame.lidar.ranges.length === 0) {
      if (this.lidarMesh) this.lidarMesh.visible = false;
      if (this.lidarPoints) this.lidarPoints.visible = false;
      return;
    }
    this.syncTurret(frame.lidar.fov);
    // Angles, ranges and the hit/clear/missing distinction all come from
    // `beams.ts`, which the 2D renderer uses as well and which a test checks
    // against the adapter's own indexing.
    const scan = beams(frame.lidar);
    const hits: number[] = [];
    const fan: number[] = [];
    const colours: number[] = [];
    const near = new THREE.Color(C.lidar);

    // How bright a wedge is at the sensor, and at the far end of each of its
    // two rays. Additive over a dark floor, so a little goes a long way and the
    // map tiles underneath stay readable through it.
    //
    //  - hit:     the beam measured a surface. Brightest, and it keeps a faint
    //             far edge where the surface is, plus a lit dot.
    //  - clear:   nothing inside the sensor's reach along this ray. Real
    //             information, so it is drawn — but dimmer, and it fades to
    //             nothing rather than ending on an edge at the range ceiling.
    //  - missing: the beam never came back. Nothing at all is known here, so
    //             nothing is drawn. The adapter takes care never to report this
    //             as a range and the renderer must not undo that on the way to
    //             the screen.
    const root = (kind: string) => (kind === "clear" ? 0.05 : 0.17);
    const edge = (kind: string) => (kind === "clear" ? 0 : 0.05);

    let previous: { point: THREE.Vector3; kind: string } | null = null;
    for (const beam of scan) {
      if (beam.kind === "missing") {
        previous = null;
        continue;
      }
      const local = beamLocal(beam);
      const point = new THREE.Vector3(local.x, H.sensor, local.z);
      if (beam.kind === "hit") hits.push(point.x, point.y, point.z);
      if (previous) {
        fan.push(0, H.sensor, 0, previous.point.x, previous.point.y, previous.point.z, point.x, point.y, point.z);
        // Each triangle carries its own copy of the sensor vertex, so the two
        // rays it spans brighten it independently.
        const a = [(root(previous.kind) + root(beam.kind)) / 2, edge(previous.kind), edge(beam.kind)];
        for (const v of a) colours.push(near.r * v + 0.015, near.g * v + 0.015, near.b * v);
      }
      previous = { point, kind: beam.kind };
    }

    if (!this.lidarMesh) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.lidarMesh = new THREE.Mesh(geometry, material);
      this.dynamic.add(this.lidarMesh);
    }
    const g = this.lidarMesh.geometry;
    g.setAttribute("position", new THREE.Float32BufferAttribute(fan, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    g.computeBoundingSphere();
    this.lidarMesh.visible = true;
    this.lidarMesh.position.set(self.x, 0, self.y);
    this.lidarMesh.rotation.y = -self.theta;

    if (!this.lidarPoints) {
      this.lidarPoints = new THREE.Points(
        new THREE.BufferGeometry(),
        new THREE.PointsMaterial({
          color: C.lidar,
          size: 0.055,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        }),
      );
      this.dynamic.add(this.lidarPoints);
    }
    this.lidarPoints.geometry.setAttribute("position", new THREE.Float32BufferAttribute(hits, 3));
    this.lidarPoints.geometry.computeBoundingSphere();
    this.lidarPoints.visible = true;
    this.lidarPoints.position.copy(this.lidarMesh.position);
    this.lidarPoints.rotation.y = this.lidarMesh.rotation.y;
  }

  /** How far away the robot has to start stopping, drawn on the floor. */
  private syncEnvelope(state: SceneState, layers: Layers): void {
    const frame = state.frame;
    const self = frame?.robots[0];
    const radius = frame?.envelope ?? 0;
    if (!frame || !self || !layers.envelope || radius <= 0.05) {
      if (this.envelopeRing) this.envelopeRing.visible = false;
      return;
    }
    if (!this.envelopeRing) {
      this.envelopeRing = new THREE.Mesh(
        new THREE.RingGeometry(0.97, 1, 96),
        new THREE.MeshBasicMaterial({
          color: C.envelope,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      this.envelopeRing.rotation.x = -Math.PI / 2;
      this.dynamic.add(this.envelopeRing);
    }
    this.envelopeRing.visible = true;
    this.envelopeRing.position.set(self.x, 0.008, self.y);
    this.envelopeRing.scale.setScalar(radius);
    const level = frame.safety.level;
    (this.envelopeRing.material as THREE.MeshBasicMaterial).color.setHex(
      level === "stop" ? 0xff3b3b : level === "slow" ? 0xffa53b : C.envelope,
    );
  }

  private syncTrail(state: SceneState, layers: Layers): void {
    if (!layers.trail || state.trail.length < 2) {
      if (this.trailLine) this.trailLine.visible = false;
      return;
    }
    const points: number[] = [];
    const colours: number[] = [];
    const colour = new THREE.Color(C.trail);
    state.trail.forEach((p, i) => {
      points.push(p.x, 0.02, p.y);
      const a = (i / state.trail.length) ** 1.6;
      colours.push(colour.r * a, colour.g * a, colour.b * a);
    });
    if (!this.trailLine) {
      this.trailLine = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }),
      );
      this.dynamic.add(this.trailLine);
    }
    this.trailLine.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    this.trailLine.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    this.trailLine.geometry.computeBoundingSphere();
    this.trailLine.visible = true;
  }

  /** The map the robot built for itself, as tiles on the floor. */
  private syncMap(state: SceneState, layers: Layers): void {
    const map = state.map;
    if (!layers.map || !map) {
      if (this.mapTiles) this.mapTiles.visible = false;
      return;
    }
    const { decoded, meta } = map;
    const count = decoded.length;
    if (!this.mapTiles || this.mapTiles.count < count) {
      if (this.mapTiles) {
        this.mapTiles.geometry.dispose();
        this.dynamic.remove(this.mapTiles);
      }
      this.mapTiles = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(meta.resolution * 0.94, meta.resolution * 0.94),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
        count,
      );
      this.mapTiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      this.dynamic.add(this.mapTiles);
    }
    const tiles = this.mapTiles;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const scale = new THREE.Vector3(1, 1, 1);
    const free = new THREE.Color(C.free);
    const occupied = new THREE.Color(C.occupied);
    let n = 0;
    for (let i = 0; i < count; i += 1) {
      const v = decoded[i];
      if (v === 0) continue;
      const gx = i % meta.width;
      const gy = Math.floor(i / meta.width);
      matrix.compose(
        new THREE.Vector3(
          meta.origin.x + (gx + 0.5) * meta.resolution,
          0.006,
          meta.origin.y + (gy + 0.5) * meta.resolution,
        ),
        quaternion,
        scale,
      );
      tiles.setMatrixAt(n, matrix);
      tiles.setColorAt(n, v === 2 ? occupied : free);
      n += 1;
    }
    tiles.count = n;
    tiles.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    tiles.visible = n > 0;
  }

  // --- camera and loop ------------------------------------------------------

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
  }

  private updateCamera(): void {
    if (this.mode === "orbit") return;
    const target = this.focus;
    this.controls.target.lerp(target, 0.15);
    if (this.mode === "chase") {
      // Forward is `(cos yaw, 0, sin yaw)`; behind is the other way along both
      // axes. Flipping only one of them put the camera out to the side and
      // ahead of the robot, which is why chase looked like a tighter orbit.
      const yaw = this.cameraYaw();
      const behind = new THREE.Vector3(
        target.x - Math.cos(yaw) * 4.0,
        2.6,
        target.z - Math.sin(yaw) * 4.0,
      );
      this.camera.position.lerp(behind, 0.08);
    } else {
      const above = new THREE.Vector3(target.x + 2.6, 6.4, target.z + 6.8);
      this.camera.position.lerp(above, 0.06);
    }
  }

  private cameraYaw(): number {
    return this.robot ? -this.robot.rotation.y : 0;
  }

  render(): void {
    if (this.disposed) return;
    this.controls.update();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    if (this.disposed) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Forget the room so the next scenario builds its own. */
  resetWorld(): void {
    this.built = false;
    this.idle.visible = true;
    this.world.clear();
    this.dynamic.clear();
    this.robot = null;
    this.accent = null;
    this.turret = null;
    this.turretWindow = null;
    this.turretFov = -1;
    this.lidarMesh = null;
    this.lidarPoints = null;
    this.envelopeRing = null;
    this.trailLine = null;
    this.mapTiles = null;
    this.humans.items = [];
    this.objects.items = [];
  }

  dispose(): void {
    this.disposed = true;
    this.controls.dispose();
    this.composer?.dispose?.();
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.renderer.dispose();
  }
}
