// A small deterministic 2-D world: enough physics to make abilities honest
// (momentum, battery drain, slipping grasps, people who walk around) and
// nothing more. Seeded throughout, so a failing run replays exactly.

import {
  clamp,
  distance,
  gaussian,
  length,
  makeRng,
  type Pose2,
  sub,
  type Vec2,
  wrapAngle,
} from "../core/math.ts";

export type SimObstacle =
  | { id: string; kind: "circle"; at: Vec2; radius: number }
  | { id: string; kind: "box"; at: Vec2; width: number; height: number };

export type SimObject = {
  id: string;
  label: string;
  at: Vec2;
  /** Kilograms — decides how much grip force it takes not to drop it. */
  mass: number;
  /**
   * Newtons per unit of gripper closure. Low = squishy (a peach yields a long
   * way under light pressure), high = rigid (a tin barely moves).
   */
  stiffness: number;
  /** Closure at which the fingers first touch the object, 0..1. */
  graspClosure: number;
  /** Force above which the object starts to yield permanently, newtons. */
  crushForce: number;
  graspable: boolean;
  heldBy?: string | null;
  /** Set once the object has been crushed. */
  damaged?: boolean;
  /** Permanent deformation accumulated past the crush force, in closure units. */
  yield?: number;
};

/**
 * How a person behaves around a robot.
 *
 * - `cooperative` — an ordinary pedestrian: sees the robot and walks around it.
 * - `distracted`  — looking at their phone, does not avoid at all. Contact is
 *                   then entirely the robot's problem, which is the case worth
 *                   testing and the one most simulations quietly skip.
 */
export type Avoidance = "cooperative" | "distracted";

export type SimHuman = {
  id: string;
  at: Vec2;
  /** Patrol route; the person walks it on a loop. Empty = stands still. */
  waypoints: Vec2[];
  speed: number;
  /** True when looking at the robot — the telegraphing ability cares. */
  attentive: boolean;
  avoidance?: Avoidance;
  waypointIndex?: number;
};

export type SimFault = {
  /** Health channel to corrupt, e.g. `motorCurrentLeft`. */
  channel: string;
  /** Added to the nominal value, in the channel's own units. */
  bias: number;
  /** Extra noise standard deviation. */
  noise?: number;
  /** Sim time (ms) the fault starts. */
  startsAtMs: number;
};

/**
 * `dynamic` robots balance actively (two-wheelers, humanoids) and can be pushed
 * over; `static` robots sit on a wide wheelbase and never tilt.
 */
export type Stance = "dynamic" | "static";

export type SimRobot = {
  id: string;
  stance: Stance;
  pose: Pose2;
  linear: number;
  angular: number;
  commandedLinear: number;
  commandedAngular: number;
  /** Battery state of charge, 0..1. */
  charge: number;
  capacityWh: number;
  /** Body tilt from vertical, radians — non-zero after a shove. */
  tilt: number;
  tiltRate: number;
  gripperClosure: number;
  gripperTarget: number;
  gripperForce: number;
  holding: string | null;
  slip: number;
  /**
   * Where the robot believes it is, by integrating its own wheel speeds.
   *
   * Kept apart from `pose`, which is the truth. Until this existed the
   * simulated robot always knew exactly where it was — `pose()` returned the
   * true position plus zero-mean noise, so the error stayed around four
   * centimetres however far it drove and never accumulated. Dead-reckoning
   * drift is the dominant error of a wheeled robot and the reason SLAM exists,
   * and a simulator without it flatters every capability that plans in world
   * coordinates.
   */
  odom: Pose2;
  /**
   * Per-robot systematic odometry errors, fixed at construction.
   *
   * Real drift is mostly not random. A wheel radius that is 2% off, or a
   * wheelbase measured a centimetre wide, produces an error that grows with
   * distance and always in the same direction — which is why driving a loop
   * and coming back does not cancel it out. The random part matters much less.
   */
  odomScale: number;
  odomTurnScale: number;
  /** Systematic error in this pack's reported state of charge, fraction. */
  gaugeBias: number;
  /**
   * Constant offset on this unit's rate gyro, rad/s.
   *
   * Every MEMS gyro has one, typically half a degree to two degrees per second,
   * and it changes with temperature. Integrating a biased rate is what makes an
   * unaided tilt estimate walk away from vertical.
   */
  gyroBias: number;
  /**
   * The tilt the driver reports, as opposed to the tilt the body has.
   *
   * An IMU does not measure tilt. It measures angular rate and specific force,
   * and tilt is a fusion of the two — the gyro integrated for the short term,
   * pulled slowly back toward what gravity says by the accelerometer. The
   * simulator used to hand out the true tilt with a little noise on it, which
   * is not a sensor, it is the answer.
   */
  tiltEstimate: number;
  /**
   * How much of the wheel speed the floor actually converts into travel, 0..1.
   *
   * A property of the ground, not of the robot. At 1 the wheels carry the body;
   * at 0 they turn freely and the robot goes nowhere — ice, a lip the wheels
   * cannot climb, a chassis jacked up on a threshold. The odometry keeps
   * reporting the wheel speed the whole time, because that is what a wheel
   * encoder measures, which is exactly the failure the conflict detectors exist
   * to catch.
   */
  groundTraction: number;
  /** Force a nearby person is applying to whatever the robot is holding, N. */
  externalPull: number;
  armTip: Vec2;
  /**
   * Constant error between where the tip is and where the encoders say, metres.
   *
   * A millimetre of link-length error and half a degree of joint zero put a few
   * millimetres at the tip, and they do not average out.
   */
  armTipBias: Vec2;
  /** Whether the last commanded arm target was inside the reach envelope. */
  armTargetReachable: boolean;
  armHeight: number;
  armTarget: Vec2 | null;
  armTargetHeight: number;
  lights: { pattern: string; color: string };
  utterance: string | null;
  collisions: number;
  /** Contacts with a person specifically — the number that actually matters. */
  humanContacts: number;
  /** True while the robot is pressed against geometry. */
  inContact: boolean;
  distanceTravelled: number;
  energyUsedWh: number;
};

export type SimWorldConfig = {
  width: number;
  height: number;
  seed?: number;
  obstacles?: SimObstacle[];
  objects?: SimObject[];
  humans?: SimHuman[];
  dock?: Vec2;
  faults?: SimFault[];
  /** Sensor noise multiplier. 0 = perfect sensors, 1 = realistic, 2 = nasty. */
  noise?: number;
  /**
   * Fraction of radio frames each listener loses, 0..1.
   *
   * Per receiver, not per message: the failure that matters between robots is
   * one of them hearing an announcement that another missed. A few per cent is
   * an ordinary indoor mesh; a warehouse full of steel racking is worse.
   */
  radioLoss?: number;
};

export type RadioMessage = {
  /** Monotonic sequence number. Readers track this, not the clock — two
   *  messages can share a timestamp, and a timestamp cursor loses them. */
  seq: number;
  from: string;
  topic: string;
  payload: unknown;
  t: number;
};

export type SimSnapshot = {
  config: Omit<SimWorldConfig, "seed">;
  timeMs: number;
  robots: SimRobot[];
};

/** Body radii, metres. Two bodies touch when their centres are this far apart. */
export const ROBOT_RADIUS = 0.28;
export const HUMAN_RADIUS = 0.25;

const GRAVITY = 9.81;
const GRIP_FRICTION = 0.6;
/**
 * Commands below these do not move the robot, m/s and rad/s.
 *
 * Static friction in a geared drive. The figures are ordinary for a small
 * indoor platform; a heavier one or a worse gearbox is worse.
 */
const STICTION_LINEAR = 0.03;
const STICTION_ANGULAR = 0.08;

/** Complementary-filter time constant for tilt, seconds. */
const TILT_FUSION_TAU = 0.5;
/** Physics substep. Bigger steps make the tilt integrator misbehave. */
export const MAX_SUBSTEP = 0.02;
/** Height of the centre of mass above the wheel axis, metres. */
const COM_HEIGHT = 0.55;
/**
 * Half-length of the support foot / wheelbase, metres. The low-level balance
 * controller can shift the centre of pressure anywhere inside it — that is the
 * classic "ankle strategy", and it runs out at roughly 11°.
 */
const FOOT_HALF = 0.11;
/** Ankle controller gains, expressed as a commanded centre-of-pressure offset. */
const ANKLE_KP = 2.0;
const ANKLE_KD = 0.5;
/** Lean beyond which the ankle alone can no longer hold the body up. */
export const TIP_ANGLE = Math.asin(FOOT_HALF / COM_HEIGHT);
/**
 * Nominal drive acceleration, m/s². A dynamically balanced base cannot exceed
 * g·footHalf/comHeight (~1.96 m/s²) without toppling, so the drive is limited
 * below that.
 */
const ACCEL_LIMIT = 1.4;
/** Acceleration the drive may use while actively catching a fall, m/s². */
const RECOVERY_ACCEL_LIMIT = 6.5;
/** Base draw when idle, watts. */
const IDLE_WATTS = 12;
const DRIVE_WATTS_PER_MPS = 34;
const TURN_WATTS_PER_RADPS = 9;
const ARM_WATTS = 22;

export class SimWorld {
  readonly width: number;
  readonly height: number;
  readonly obstacles: SimObstacle[];
  readonly objects: SimObject[];
  readonly humans: SimHuman[];
  readonly dock: Vec2;
  readonly noise: number;
  readonly faults: SimFault[];

  timeMs = 0;

  private readonly robots = new Map<string, SimRobot>();
  private readonly radio: RadioMessage[] = [];
  private radioSeq = 0;
  private readonly rng: () => number;
  /** Everything waiting on the simulated clock, across every robot here. */
  private readonly waiters: Array<{ at: number; resolve: () => void }> = [];
  /** Whoever is currently responsible for advancing time. */
  private pumpOwner: object | null = null;

  constructor(config: SimWorldConfig) {
    this.width = config.width;
    this.height = config.height;
    this.obstacles = config.obstacles ? config.obstacles.map((o) => ({ ...o })) : [];
    this.objects = config.objects ? config.objects.map((o) => ({ ...o })) : [];
    this.humans = config.humans
      ? config.humans.map((h) => ({ ...h, waypointIndex: h.waypointIndex ?? 0 }))
      : [];
    this.dock = config.dock ?? { x: 1, y: 1 };
    this.radioLoss = config.radioLoss ?? 0;
    this.radioSalt = String(config.seed ?? 1);
    this.noise = config.noise ?? 1;
    this.faults = config.faults ? [...config.faults] : [];
    this.rng = makeRng(config.seed ?? 1337);
  }

  random(): number {
    return this.rng();
  }

  /**
   * A deep copy of everything that matters, so a rehearsal can fork the world
   * as it is right now, try something a hundred times, and throw the copies
   * away without the real robot moving a millimetre.
   */
  snapshot(): SimSnapshot {
    return {
      config: {
        width: this.width,
        height: this.height,
        dock: { ...this.dock },
        noise: this.noise,
        obstacles: this.obstacles.map((o) => ({ ...o, at: { ...o.at } })),
        objects: this.objects.map((o) => ({ ...o, at: { ...o.at } })),
        humans: this.humans.map((h) => ({
          ...h,
          at: { ...h.at },
          waypoints: h.waypoints.map((w) => ({ ...w })),
        })),
        faults: this.faults.map((f) => ({ ...f })),
      },
      timeMs: this.timeMs,
      robots: this.allRobots().map((r) => ({
        ...r,
        pose: { ...r.pose },
        armTip: { ...r.armTip },
        armTarget: r.armTarget ? { ...r.armTarget } : null,
        lights: { ...r.lights },
      })),
    };
  }

  /** Rebuild a world from a snapshot, optionally with a different seed. */
  static restore(snapshot: SimSnapshot, seed: number): SimWorld {
    const world = new SimWorld({ ...snapshot.config, seed });
    world.timeMs = snapshot.timeMs;
    for (const robot of snapshot.robots) {
      world.robots.set(robot.id, {
        ...robot,
        pose: { ...robot.pose },
        armTip: { ...robot.armTip },
        armTarget: robot.armTarget ? { ...robot.armTarget } : null,
        lights: { ...robot.lights },
      });
    }
    return world;
  }

  noisy(value: number, stdDev: number): number {
    if (this.noise <= 0) return value;
    return gaussian(this.rng, value, stdDev * this.noise);
  }

  addRobot(
    id: string,
    at: Vec2,
    theta = 0,
    options: { capacityWh?: number; stance?: Stance; charge?: number } = {},
  ): SimRobot {
    const capacityWh = options.capacityWh ?? 180;
    const robot: SimRobot = {
      id,
      stance: options.stance ?? "dynamic",
      pose: { x: at.x, y: at.y, theta },
      linear: 0,
      angular: 0,
      commandedLinear: 0,
      commandedAngular: 0,
      charge: options.charge ?? 1,
      capacityWh,
      tilt: 0,
      tiltRate: 0,
      gripperClosure: 0,
      gripperTarget: 0,
      gripperForce: 0,
      holding: null,
      slip: 0,
      groundTraction: 1,
      odom: { x: at.x, y: at.y, theta },
      // A couple of per cent, which is what a carefully measured wheel gets you.
      // A fuel gauge is not a fuel meter. State of charge is inferred, mostly
      // from a voltage curve that is nearly flat through the middle of the
      // discharge, and the inference carries a systematic offset per pack and
      // per cell age. A few per cent is a good gauge.
      gaugeBias: this.random() * 0.08 - 0.04,
      // About a degree per second, which is an ordinary consumer part.
      gyroBias: (this.random() * 0.03 - 0.015),
      tiltEstimate: 0,
      odomScale: 1 + this.random() * 0.04 - 0.02,
      odomTurnScale: 1 + this.random() * 0.06 - 0.03,
      externalPull: 0,
      armTip: { x: 0.35, y: 0 },
      armTipBias: {
        x: this.random() * 0.008 - 0.004,
        y: this.random() * 0.008 - 0.004,
      },
      armTargetReachable: true,
      armHeight: 0.4,
      armTarget: null,
      armTargetHeight: 0.4,
      lights: { pattern: "idle", color: "#3b82f6" },
      utterance: null,
      collisions: 0,
      humanContacts: 0,
      inContact: false,
      distanceTravelled: 0,
      energyUsedWh: 0,
    };
    this.robots.set(id, robot);
    return robot;
  }

  robot(id: string): SimRobot {
    const robot = this.robots.get(id);
    if (!robot) throw new Error(`No robot "${id}" in this world.`);
    return robot;
  }

  allRobots(): SimRobot[] {
    return Array.from(this.robots.values());
  }

  object(id: string): SimObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  /** Shove the robot — used to exercise balance recovery. */
  applyTiltImpulse(id: string, radPerSec: number): void {
    this.robot(id).tiltRate += radPerSec;
  }

  /** Fraction of frames each listener loses, 0..1. */
  readonly radioLoss: number;
  private radioDrops = new Map<string, boolean>();
  private radioSalt = "";

  send(message: Omit<RadioMessage, "seq">): RadioMessage {
    this.radioSeq += 1;
    const full: RadioMessage = { ...message, seq: this.radioSeq };
    this.radio.push(full);
    // Keep the mesh log bounded; nobody reads minute-old chatter.
    if (this.radio.length > 512) this.radio.splice(0, this.radio.length - 512);
    return full;
  }

  /**
   * Everything on `topic` newer than the sequence number the reader has seen,
   * as *this* reader heard it.
   *
   * The radio used to be a shared log: every message reached every reader,
   * instantly, in order, always. That is not a radio, it is a variable. A mesh
   * between robots in a building loses frames to metal and distance, and loses
   * them *per receiver* — which is the failure that breaks agreement protocols,
   * because one robot hears an announcement and another does not and they go on
   * to disagree about what was decided.
   *
   * Loss here is deterministic given the reader, the message and the world
   * seed, so a run still replays exactly. It is not resampled per call: asking
   * twice must not eventually deliver a frame that was dropped, or a caller
   * could poll its way out of packet loss, which is not a thing radios let you
   * do.
   */
  inbox(topic: string, afterSeq: number, listener?: string): RadioMessage[] {
    return this.radio.filter((m) => {
      if (m.topic !== topic || m.seq <= afterSeq) return false;
      if (listener === undefined || this.radioLoss <= 0) return true;
      return !this.dropped(listener, m.seq);
    });
  }

  /** Whether this listener lost this frame. Stable for the life of the world. */
  private dropped(listener: string, seq: number): boolean {
    const key = `${listener}#${seq}`;
    const known = this.radioDrops.get(key);
    if (known !== undefined) return known;
    // Hashed rather than drawn from the world RNG, so that reading the radio
    // does not perturb the physics' random sequence.
    let hash = 2166136261;
    const material = `${this.radioSalt}:${key}`;
    for (let i = 0; i < material.length; i += 1) {
      hash ^= material.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const unit = ((hash >>> 0) % 100000) / 100000;
    const lost = unit < this.radioLoss;
    this.radioDrops.set(key, lost);
    return lost;
  }

  /** The newest sequence number issued, for a reader catching up. */
  get radioHead(): number {
    return this.radioSeq;
  }

  /**
   * Advance physics by `dt` seconds, substepping so a long sleep can't make the
   * tilt integrator blow up. Anything sleeping on the clock that comes due is
   * woken afterwards.
   */
  step(dt: number): void {
    let remaining = dt;
    while (remaining > 1e-9) {
      const h = Math.min(remaining, MAX_SUBSTEP);
      this.timeMs += h * 1000;
      for (const robot of this.robots.values()) this.stepRobot(robot, h);
      this.stepHumans(h);
      remaining -= h;
    }
    this.wake();
  }

  /**
   * Sleep on the simulated clock. The queue lives on the world rather than on a
   * runtime so that a fleet sharing one world also shares one clock — otherwise
   * two robots pumping independently would run at different speeds.
   */
  waitUntil(at: number): { promise: Promise<void>; cancel: () => void } {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    const waiter = { at, resolve };
    this.waiters.push(waiter);
    return {
      promise,
      cancel: () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve();
      },
    };
  }

  /**
   * Claim the right to advance time. Exactly one holder at a time, so a fleet
   * whose robots are all awaiting their own missions still moves at 1× speed.
   */
  acquirePump(token: object): boolean {
    if (this.pumpOwner === null) this.pumpOwner = token;
    return this.pumpOwner === token;
  }

  releasePump(token: object): void {
    if (this.pumpOwner === token) this.pumpOwner = null;
  }

  private wake(): void {
    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      if (this.waiters[i].at <= this.timeMs + 1e-6) {
        const [waiter] = this.waiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  private stepRobot(robot: SimRobot, dt: number): void {
    // First-order actuator response: motors take a moment to reach the command.
    // Past the tip angle the drive is allowed emergency torque — that is what
    // makes a "catch the fall" manoeuvre physically possible at all.
    const peakAccel =
      Math.abs(robot.tilt) > TIP_ANGLE * 0.9 ? RECOVERY_ACCEL_LIMIT : ACCEL_LIMIT;
    const accelLimit = peakAccel * dt;
    const alphaLimit = 4.0 * dt;
    const previousLinear = robot.linear;

    // Stiction: below some command the wheels do not turn at all.
    //
    // The mirror of everything that was wrong on the sensing side, and it had
    // never been looked at. A commanded 0.001 m/s used to produce exactly
    // 0.001 m/s; a geared drive produces nothing until the torque clears static
    // friction, which for a small indoor robot is a few centimetres per second.
    // It matters here more than it looks: every degraded mode in the safety
    // governor answers a problem by crawling, and a crawl is exactly the band
    // where a real motor does nothing.
    const wanted =
      Math.abs(robot.commandedLinear) < STICTION_LINEAR ? 0 : robot.commandedLinear;
    const wantedTurn =
      Math.abs(robot.commandedAngular) < STICTION_ANGULAR ? 0 : robot.commandedAngular;
    robot.linear += clamp(wanted - robot.linear, -accelLimit, accelLimit);
    robot.angular += clamp(wantedTurn - robot.angular, -alphaLimit, alphaLimit);
    const actualAccel = (robot.linear - previousLinear) / dt;

    // A tipping robot loses traction, and so does one on a floor that will not
    // hold it. Both reduce how much of the wheel speed becomes travel; neither
    // touches `robot.linear`, which is what the encoders read.
    const traction =
      clamp(1 - Math.abs(robot.tilt) / 0.5, 0, 1) * clamp(robot.groundTraction, 0, 1);
    const effectiveLinear = robot.linear * traction;

    const nextX = robot.pose.x + Math.cos(robot.pose.theta) * effectiveLinear * dt;
    const nextY = robot.pose.y + Math.sin(robot.pose.theta) * effectiveLinear * dt;

    if (this.blocked({ x: nextX, y: nextY })) {
      // Count contacts, not control cycles: a robot pressed against a wall for
      // two seconds has had one collision, not a hundred.
      if (!robot.inContact) {
        robot.collisions += 1;
        if (this.touchingSomeone({ x: nextX, y: nextY })) robot.humanContacts += 1;
        robot.inContact = true;
      }
      robot.linear = 0;
      robot.commandedLinear = 0;
    } else {
      robot.inContact = false;
      robot.distanceTravelled += Math.hypot(nextX - robot.pose.x, nextY - robot.pose.y);
      robot.pose.x = clamp(nextX, 0.2, this.width - 0.2);
      robot.pose.y = clamp(nextY, 0.2, this.height - 0.2);
    }
    robot.pose.theta = wrapAngle(robot.pose.theta + robot.angular * traction * dt);

    // --- what the robot thinks happened ------------------------------------
    //
    // Integrated from the wheel speeds rather than from where the robot
    // actually went, because a wheel encoder counts turns of a wheel. That is
    // the whole point: on a floor that will not carry the robot, `traction` is
    // zero and the body does not move, while this keeps adding up distance at
    // the commanded speed. The gap between `odom` and `pose` is then the real
    // consequence of a slip rather than a number computed on the side.
    const believedLinear = robot.linear * robot.odomScale;
    const believedAngular = robot.angular * robot.odomTurnScale;
    robot.odom.x += Math.cos(robot.odom.theta) * believedLinear * dt;
    robot.odom.y += Math.sin(robot.odom.theta) * believedLinear * dt;
    robot.odom.theta = wrapAngle(robot.odom.theta + believedAngular * dt);

    // Inverted-pendulum tilt dynamics. Inside the support polygon the wheelbase
    // and suspension hold the body up (stiff, critically damped, so hard
    // acceleration only produces a degree of pitch). Past the tip angle that
    // support fades out and gravity takes over — from there only accelerating
    // the base back under the centre of mass saves it.
    if (robot.stance === "dynamic") {
      // Linear inverted pendulum: θ̈ = ω₀²·(sin θ − u/L) − (a/L)·cos θ, where u
      // is the centre of pressure the ankle can place under the body. Saturating
      // u at the foot edge is what makes big leans unrecoverable without also
      // driving the base back under the centre of mass.
      const omega2 = GRAVITY / COM_HEIGHT;
      const cop = clamp(
        ANKLE_KP * robot.tilt + ANKLE_KD * robot.tiltRate,
        -FOOT_HALF,
        FOOT_HALF,
      );
      const tiltAccel =
        omega2 * (Math.sin(robot.tilt) - cop / COM_HEIGHT) -
        (actualAccel / COM_HEIGHT) * Math.cos(robot.tilt);
      robot.tiltRate += tiltAccel * dt;
      robot.tilt = clamp(robot.tilt + robot.tiltRate * dt, -Math.PI / 2, Math.PI / 2);
      // Flat on the floor is the end of the fall, not the middle of it.
      //
      // The tilt was clamped here and the rate was not, so a robot that had
      // already landed kept accumulating tilt rate at fourteen radians per
      // second squared, for as long as the simulation ran. Nothing caught it
      // because every test reads the tilt, which is clamped and therefore
      // looked right — it surfaced only when an IMU model started integrating
      // the rate and reported a tilt of 905 degrees.
      //
      // A body lying on the ground is supported by the ground.
      if (Math.abs(robot.tilt) >= Math.PI / 2 - 1e-9) robot.tiltRate = 0;
      if (Math.abs(robot.tilt) < 0.001 && Math.abs(robot.tiltRate) < 0.005) {
        robot.tilt = 0;
        robot.tiltRate = 0;
      }
    } else {
      robot.tilt = 0;
      robot.tiltRate = 0;
    }

    this.stepIMU(robot, dt, actualAccel);
    this.stepArm(robot, dt);
    this.stepGripper(robot, dt);
    this.stepBattery(robot, dt);
  }

  /**
   * What the IMU driver believes the tilt is.
   *
   * A complementary filter, which is what a cheap IMU actually ships with: the
   * gyro integrated because it is smooth and fast, corrected slowly toward the
   * accelerometer because the gyro drifts. Both halves are modelled with the
   * error they really have.
   *
   * The gyro half walks away, because the bias is constant and integrating a
   * constant is a ramp. The accelerometer half is the interesting one: it reads
   * the direction of specific force, and under linear acceleration that is not
   * straight down. A robot accelerating forward at `a` appears to lean back by
   * about a/g — so the reference that is supposed to correct the drift is
   * wrong exactly when the robot is accelerating hard, which is exactly what a
   * balancing robot does while catching a fall.
   */
  private stepIMU(robot: SimRobot, dt: number, actualAccel: number): void {
    if (robot.stance !== "dynamic") {
      robot.tiltEstimate = 0;
      return;
    }
    // Gyro: the true rate plus this unit's bias.
    const integrated = robot.tiltEstimate + (robot.tiltRate + robot.gyroBias) * dt;
    // Accelerometer: gravity, tilted by whatever the body is doing.
    const fromGravity = robot.tilt - actualAccel / GRAVITY;
    // Trust the gyro over the short term, gravity over the long one.
    const alpha = TILT_FUSION_TAU / (TILT_FUSION_TAU + dt);
    robot.tiltEstimate = alpha * integrated + (1 - alpha) * fromGravity;
  }

  private stepArm(robot: SimRobot, dt: number): void {
    if (!robot.armTarget) return;
    const speed = 0.45; // m/s at the tip
    const dx = robot.armTarget.x - robot.armTip.x;
    const dy = robot.armTarget.y - robot.armTip.y;
    const dh = robot.armTargetHeight - robot.armHeight;
    const dist = Math.hypot(dx, dy, dh);
    if (dist < 0.01) {
      robot.armTip = { ...robot.armTarget };
      robot.armHeight = robot.armTargetHeight;
      robot.armTarget = null;
      return;
    }
    const stepLen = Math.min(speed * dt, dist);
    robot.armTip = {
      x: robot.armTip.x + (dx / dist) * stepLen,
      y: robot.armTip.y + (dy / dist) * stepLen,
    };
    robot.armHeight += (dh / dist) * stepLen;
  }

  private stepGripper(robot: SimRobot, dt: number): void {
    const closeRate = 1.8; // full stroke in ~0.55 s
    const tip = this.tipWorldPosition(robot);

    // What, if anything, is between the fingers.
    const held = robot.holding ? this.object(robot.holding) : undefined;
    const candidate =
      held ??
      this.objects.find(
        (o) => o.graspable && !o.heldBy && distance(o.at, tip) < 0.18,
      );

    // How far the fingers can actually travel: free stroke until they touch the
    // object, then further only as far as the object deforms under the applied
    // force — plus any permanent yield once it has been over-squeezed.
    let limit = 1;
    if (candidate) {
      if (robot.gripperForce > candidate.crushForce) {
        // Past the crush force the object keeps giving way at constant force.
        // That creep is the only signal a robot gets that it is ruining
        // something, and `grasp.adaptive` watches for exactly this. Damage is
        // permanent only once enough of it has accumulated, so a controller
        // that notices within a couple of hundred milliseconds gets away with it.
        candidate.yield = (candidate.yield ?? 0) + 0.25 * dt;
        if ((candidate.yield ?? 0) > 0.2) candidate.damaged = true;
      }
      limit = clamp(
        candidate.graspClosure +
          robot.gripperForce / Math.max(candidate.stiffness, 1e-3) +
          (candidate.yield ?? 0),
        0,
        1,
      );
    }

    const target = Math.min(robot.gripperTarget, limit);
    robot.gripperClosure += clamp(
      target - robot.gripperClosure,
      -closeRate * dt,
      closeRate * dt,
    );
    robot.gripperClosure = clamp(robot.gripperClosure, 0, 1);

    // A grasp forms when the fingers are pressed against the object with force.
    if (
      !held &&
      candidate &&
      robot.gripperForce > 0.3 &&
      robot.gripperClosure >= candidate.graspClosure - 1e-3
    ) {
      candidate.heldBy = robot.id;
      robot.holding = candidate.id;
    }

    const nowHeld = robot.holding ? this.object(robot.holding) : undefined;
    if (!nowHeld) {
      robot.slip = 0;
      robot.externalPull = Math.max(robot.externalPull - 12 * dt, 0);
      return;
    }

    // A person standing at the robot's hand, looking at it, reaches for what it
    // is holding. The pull builds over about a second — the robot feels it in
    // the wrist long before the object moves.
    const reacher = this.humans.find(
      (h) => h.attentive && distance(h.at, tip) < 0.85,
    );
    robot.externalPull = clamp(
      robot.externalPull + (reacher ? 9 * dt : -12 * dt),
      0,
      8,
    );

    // Once the fingers relax under a real pull, the object changes hands.
    if (robot.externalPull > 2.5 && robot.gripperForce < 1.0) {
      nowHeld.heldBy = `human:${reacher?.id ?? "unknown"}`;
      robot.holding = null;
      robot.slip = 0;
      robot.externalPull = 0;
      return;
    }

    // Enough friction to carry the weight, or it slides out of the fingers.
    const needed = (nowHeld.mass * GRAVITY) / GRIP_FRICTION;
    if (robot.gripperForce + 1e-6 < needed) {
      robot.slip = clamp(robot.slip + (needed - robot.gripperForce) * dt * 0.9, 0, 1);
      if (robot.slip >= 1) {
        nowHeld.heldBy = null;
        robot.holding = null;
        robot.slip = 0;
        return;
      }
    } else {
      robot.slip = clamp(robot.slip - dt * 1.5, 0, 1);
    }

    if (nowHeld.heldBy === robot.id) nowHeld.at = tip;
  }

  /**
   * What the robot is drawing right now, watts.
   *
   * One function, because the adapter used to compute this a second time with
   * its own copy of the constants and left the arm out of it — so a robot
   * moving its manipulator reported a draw missing 22 W against an idle of 12,
   * and `hardware.checkout` printed that figure to a person. Two
   * implementations of one calculation agree until they do not.
   */
  drawWatts(robot: SimRobot): number {
    return (
      IDLE_WATTS +
      Math.abs(robot.linear) * DRIVE_WATTS_PER_MPS +
      Math.abs(robot.angular) * TURN_WATTS_PER_RADPS +
      (robot.armTarget ? ARM_WATTS : 0) +
      robot.gripperForce * 0.15
    );
  }

  private stepBattery(robot: SimRobot, dt: number): void {
    const watts = this.drawWatts(robot);
    const wh = (watts * dt) / 3600;
    robot.energyUsedWh += wh;
    robot.charge = clamp(robot.charge - wh / robot.capacityWh, 0, 1);

    // Docking recharges.
    if (distance(robot.pose, this.dock) < 0.35) {
      robot.charge = clamp(robot.charge + (dt * 0.9) / 60, 0, 1);
    }
  }

  private stepHumans(dt: number): void {
    for (const human of this.humans) {
      if (human.waypoints.length === 0) continue;
      const index = human.waypointIndex ?? 0;
      const target = human.waypoints[index % human.waypoints.length];
      const toTarget = sub(target, human.at);
      const dist = length(toTarget);
      if (dist < 0.12) {
        human.waypointIndex = (index + 1) % human.waypoints.length;
        continue;
      }

      let heading = Math.atan2(toTarget.y, toTarget.x);
      let speed = human.speed;

      if ((human.avoidance ?? "cooperative") === "cooperative") {
        // Steering, not a force field. A repulsion vector fights the walker's
        // own heading and settles into an equilibrium where the person presses
        // against the robot forever; steering the heading makes them go round,
        // which is what people actually do.
        for (const robot of this.robots.values()) {
          const toRobot = sub(robot.pose, human.at);
          const gap = length(toRobot);
          if (gap > 2.2 || gap < 1e-6) continue;

          const bearing = wrapAngle(Math.atan2(toRobot.y, toRobot.x) - heading);
          // Only things roughly in front are worth walking around.
          if (Math.abs(bearing) > Math.PI / 2) continue;

          const clearNeeded = ROBOT_RADIUS + HUMAN_RADIUS + 0.2;
          // How far off the current heading the robot is, laterally.
          const lateral = Math.abs(gap * Math.sin(bearing));
          if (lateral > clearNeeded) continue;

          // Turn away by enough to clear it, more sharply the closer it is.
          const needed = Math.asin(clamp(clearNeeded / Math.max(gap, clearNeeded), 0, 1));
          const away = bearing >= 0 ? -1 : 1;
          heading = wrapAngle(heading + away * needed * clamp(2.2 / gap, 1, 2.5));
          // And slow down when it is close, the way a person does.
          speed = human.speed * clamp(gap / 1.6, 0.35, 1);
        }
      }

      human.at = {
        x: human.at.x + Math.cos(heading) * speed * dt,
        y: human.at.y + Math.sin(heading) * speed * dt,
      };

      // Bodies do not pass through each other, whatever the steering decided.
      // Without this the avoidance above is only a suggestion, and a determined
      // pedestrian walks into the robot — which then shows up as a safety
      // number that looks fine and is not.
      for (const robot of this.robots.values()) {
        const gap = distance(human.at, robot.pose);
        const touching = ROBOT_RADIUS + HUMAN_RADIUS;
        if (gap >= touching || gap < 1e-6) continue;
        human.at = {
          x: robot.pose.x + ((human.at.x - robot.pose.x) / gap) * touching,
          y: robot.pose.y + ((human.at.y - robot.pose.y) / gap) * touching,
        };
      }
    }
  }

  /** World position of the robot's gripper tip. */
  tipWorldPosition(robot: SimRobot): Vec2 {
    const cos = Math.cos(robot.pose.theta);
    const sin = Math.sin(robot.pose.theta);
    return {
      x: robot.pose.x + robot.armTip.x * cos - robot.armTip.y * sin,
      y: robot.pose.y + robot.armTip.x * sin + robot.armTip.y * cos,
    };
  }

  /**
   * True when a robot body centred at `at` would be inside something solid.
   * People count: a robot that can drive through a person makes every safety
   * number it reports meaningless.
   */
  blocked(at: Vec2, radius = ROBOT_RADIUS): boolean {
    for (const human of this.humans) {
      if (distance(at, human.at) < radius + HUMAN_RADIUS) return true;
    }

    if (at.x < radius || at.y < radius) return true;
    if (at.x > this.width - radius || at.y > this.height - radius) return true;
    for (const obstacle of this.obstacles) {
      if (obstacle.kind === "circle") {
        if (distance(at, obstacle.at) < obstacle.radius + radius) return true;
      } else {
        // Exact disc-versus-box: distance from the centre to the nearest point
        // of the rectangle. Expanding the box by the radius instead would
        // inflate its corners by a factor of √2 and stop the robot a good six
        // centimetres short of anything it tries to round.
        const dx = Math.max(Math.abs(at.x - obstacle.at.x) - obstacle.width / 2, 0);
        const dy = Math.max(Math.abs(at.y - obstacle.at.y) - obstacle.height / 2, 0);
        if (Math.hypot(dx, dy) < radius) return true;
      }
    }
    return false;
  }

  /** True when a robot body at `at` would be touching a person. */
  touchingSomeone(at: Vec2, radius = ROBOT_RADIUS): boolean {
    return this.humans.some((h) => distance(at, h.at) < radius + HUMAN_RADIUS + 1e-6);
  }

  /** Distance to the first thing a ray hits, up to `maxRange`. */
  raycast(origin: Vec2, angle: number, maxRange: number): number {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let nearest = maxRange;

    // Walls.
    for (const hit of [
      dx > 0 ? (this.width - origin.x) / dx : dx < 0 ? -origin.x / dx : Infinity,
      dy > 0 ? (this.height - origin.y) / dy : dy < 0 ? -origin.y / dy : Infinity,
    ]) {
      if (hit > 0 && hit < nearest) nearest = hit;
    }

    for (const obstacle of this.obstacles) {
      const hit =
        obstacle.kind === "circle"
          ? rayCircle(origin, dx, dy, obstacle.at, obstacle.radius)
          : rayBox(origin, dx, dy, obstacle.at, obstacle.width, obstacle.height);
      if (hit !== null && hit > 0 && hit < nearest) nearest = hit;
    }

    // People are obstacles too, modelled as cylinders of HUMAN_RADIUS.
    for (const human of this.humans) {
      const hit = rayCircle(origin, dx, dy, human.at, HUMAN_RADIUS);
      if (hit !== null && hit > 0 && hit < nearest) nearest = hit;
    }

    return nearest;
  }

  /** Nominal health channels, before faults and noise. */
  nominalHealth(robot: SimRobot): Record<string, number> {
    const load = Math.abs(robot.linear) + Math.abs(robot.angular) * 0.4;
    return {
      motorCurrentLeft: 1.1 + load * 2.4 + (robot.angular < 0 ? 0.3 : 0),
      motorCurrentRight: 1.1 + load * 2.4 + (robot.angular > 0 ? 0.3 : 0),
      vibration: 0.05 + load * 0.22 + Math.abs(robot.tilt) * 0.8,
      temperatureC: 31 + load * 6 + robot.energyUsedWh * 0.05,
      wheelSlipRatio: 0.01 + Math.abs(robot.angular) * 0.02,
    };
  }
}

function rayCircle(
  origin: Vec2,
  dx: number,
  dy: number,
  center: Vec2,
  radius: number,
): number | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = -b - sqrtDisc;
  const t2 = -b + sqrtDisc;
  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return null;
}

function rayBox(
  origin: Vec2,
  dx: number,
  dy: number,
  center: Vec2,
  width: number,
  height: number,
): number | null {
  const minX = center.x - width / 2;
  const maxX = center.x + width / 2;
  const minY = center.y - height / 2;
  const maxY = center.y + height / 2;

  let tMin = Number.NEGATIVE_INFINITY;
  let tMax = Number.POSITIVE_INFINITY;

  if (Math.abs(dx) < 1e-9) {
    if (origin.x < minX || origin.x > maxX) return null;
  } else {
    const t1 = (minX - origin.x) / dx;
    const t2 = (maxX - origin.x) / dx;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }

  if (Math.abs(dy) < 1e-9) {
    if (origin.y < minY || origin.y > maxY) return null;
  } else {
    const t1 = (minY - origin.y) / dy;
    const t2 = (maxY - origin.y) / dy;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }

  if (tMax < Math.max(tMin, 0)) return null;
  return tMin >= 0 ? tMin : tMax;
}
