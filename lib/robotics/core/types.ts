// The ability contract. Everything in this kernel exists to make this one type
// cheap to implement and safe to run: a robot ability is a named, versioned,
// schema-described behaviour that streams telemetry while it works and can be
// aborted at any instant.

import type { Pose2, Vec2 } from "./math.ts";

/**
 * How much damage this ability can do if it misbehaves. The safety governor
 * gates execution on it, and the UI colour-codes it.
 *
 * - `passive`  — reads sensors / memory only, never commands an actuator.
 * - `motion`   — moves the base or arm through free space.
 * - `contact`  — deliberately touches the world (grasping, pushing, handover).
 * - `critical` — runs when something is already going wrong (balance recovery,
 *                emergency braking). Never blocked, always logged.
 */
export type RiskClass = "passive" | "motion" | "contact" | "critical";

/** Hardware a robot must expose for an ability to be runnable on it. */
export type HardwareCapability =
  | "drive"
  | "arm"
  | "gripper"
  | "lidar"
  | "imu"
  | "camera"
  | "tactile"
  | "battery"
  | "lights"
  | "speaker"
  | "radio";

export type Bilingual = { en: string; ar: string };

/** A minimal JSON-Schema subset — enough for validation and for Claude tools. */
export type JsonSchema = {
  type: "object" | "array" | "string" | "number" | "boolean";
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: Array<string | number>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

export type AbilityManifest = {
  /** Stable dotted id, e.g. `reflex.shield`. This is what plans reference. */
  id: string;
  version: string;
  name: Bilingual;
  summary: Bilingual;
  /** Why this ability is worth having — the idea behind it, in one paragraph. */
  rationale: string;
  tags: string[];
  risk: RiskClass;
  requires: HardwareCapability[];
  inputSchema: JsonSchema;
  /** Roughly how long a nominal run takes, in ms. Used by the planner. */
  typicalDurationMs: number;
  /**
   * Daemons keep running in the background alongside other abilities instead of
   * finishing on their own (the reflex shield and the power lifeline are both
   * daemons).
   */
  daemon?: boolean;
};

export type AbilityEvent =
  | { t: number; kind: "status"; message: string; ar?: string }
  | { t: number; kind: "metric"; name: string; value: number; unit?: string }
  | {
      t: number;
      kind: "signal";
      channel: "light" | "sound" | "motion" | "screen" | "radio";
      payload: string;
    }
  | { t: number; kind: "safety"; level: "clear" | "slow" | "stop"; reason: string }
  | { t: number; kind: "pose"; pose: Pose2 }
  | { t: number; kind: "mark"; label: string; at: Vec2 }
  | { t: number; kind: "warn"; message: string }
  | { t: number; kind: "result"; ok: boolean; summary: string };

/**
 * An event before the runtime stamps it with a time.
 *
 * Omit does not distribute over a union — `Omit<AbilityEvent, "t">` would
 * collapse to just the keys every variant shares, which is only `kind`. The
 * conditional forces it to apply variant by variant.
 */
export type AbilityEventInput = AbilityEvent extends infer E
  ? E extends AbilityEvent
    ? Omit<E, "t">
    : never
  : never;

export type AbilityResult<T = unknown> = {
  ok: boolean;
  /** One-line outcome, written for a human reading the log. */
  summary: string;
  data?: T;
  /** Set when `ok` is false: a machine-readable reason a planner can branch on. */
  failure?:
    | "aborted"
    | "timeout"
    | "unsafe"
    | "precondition"
    | "hardware"
    | "not-found"
    | "gave-up";
  metrics?: Record<string, number>;
};

/**
 * A throwaway copy of the robot and its world, used to try something before
 * doing it for real. Structurally typed so the ability contract does not have
 * to know the simulator exists.
 */
export type TwinRuntime = {
  run<I, O>(abilityId: string, input: I): Promise<AbilityResult<O>>;
  stopDaemons(reason?: string): Promise<void>;
  /** Ground truth from inside the twin — the thing you cannot get in reality. */
  state(): { x: number; y: number; charge: number; collisions: number; timeMs: number };
};

export type TwinFactory = (options: {
  seed: number;
  /** Sensor-noise multiplier for this trial; 1 = same as the live robot. */
  noise?: number;
}) => TwinRuntime | null;

/** Persistent key/value + spatial store handed to abilities. */
export type AbilityMemory = {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  keys(prefix?: string): string[];
};

/** Everything an ability is allowed to touch. */
/** The part of the command guard an ability is allowed to touch. */
export type DeadmanApi = {
  /** Whether motion is currently refused because a command went stale. */
  isLatched(): boolean;
  /** How many commands have gone stale. */
  expiries(): number;
  /** Clear the latch. Refused while the wheels are still turning. */
  rearm(): { ok: boolean; reason?: string };
};

export type AbilityContext = {
  robot: RobotIO;
  safety: SafetyApi;
  memory: AbilityMemory;
  /** Emit telemetry. Cheap — call it freely. */
  emit(event: AbilityEventInput): void;
  /** Milliseconds on the robot's clock (simulated clock under the simulator). */
  now(): number;
  /** Clock-aware sleep: under the simulator this advances physics. */
  sleep(ms: number): Promise<void>;
  /** Aborted when the operator stops the run or a daemon escalates. */
  signal: AbortSignal;
  /** Run another registered ability as a sub-step, sharing this context. */
  call<I, O>(abilityId: string, input: I): Promise<AbilityResult<O>>;
  /** Deterministic per-run RNG, so a run can be replayed exactly. */
  random(): number;
  /**
   * The guard that makes velocity commands expire, when there is one.
   *
   * Present only when the link can drop — an in-process simulator has nothing
   * to guard against. An ability that needs to check the guard should check
   * this one rather than building its own, because a copy tests a copy.
   */
  deadman?: DeadmanApi;
  /**
   * Stop whatever the robot is doing in the foreground. Daemons use this when
   * they discover something the mission cannot be allowed to continue through —
   * a battery that can no longer make it home, a fault that is getting worse.
   */
  escalate(reason: string): void;
  /**
   * Fork a disposable copy of the world to rehearse in. Present only when the
   * robot has a model of itself — on hardware without a simulator this is
   * undefined, and `plan.rehearse` says so rather than pretending.
   */
  twin?: TwinFactory;
};

export type Ability<I = Record<string, unknown>, O = unknown> = {
  manifest: AbilityManifest;
  /** Optional cheap check the planner can run before committing to the ability. */
  precondition?(input: I, ctx: AbilityContext): { ok: boolean; reason?: string };
  run(input: I, ctx: AbilityContext): Promise<AbilityResult<O>>;
};

// ---------------------------------------------------------------------------
// Hardware abstraction
// ---------------------------------------------------------------------------

export type LidarScan = {
  /** Ranges in metres, one per beam, evenly spread over `fov` centred on +x. */
  ranges: number[];
  fov: number;
  maxRange: number;
  t: number;
};

export type ImuSample = {
  /** Body tilt from vertical, radians. */
  tilt: number;
  /** Tilt rate, rad/s. */
  tiltRate: number;
  /** Forward acceleration, m/s². */
  accel: number;
  yawRate: number;
  t: number;
};

export type DetectedObject = {
  id: string;
  label: string;
  /** World position as estimated by perception (noisy). */
  at: Vec2;
  confidence: number;
  /** Straight-line distance from the robot, metres. */
  distance: number;
  graspable?: boolean;
};

export type HumanTrack = {
  id: string;
  at: Vec2;
  /** Estimated velocity, m/s. */
  velocity: Vec2;
  distance: number;
  /** True while the person is facing (and probably aware of) the robot. */
  attentive: boolean;
};

export type BatteryState = {
  /** 0..1 */
  charge: number;
  /** Instantaneous draw in watts. */
  drawWatts: number;
  capacityWh: number;
};

export type GripperState = {
  /** 0 = fully open, 1 = fully closed. */
  closure: number;
  /** Newtons currently applied. */
  force: number;
  holding: string | null;
  /** Tactile slip signal, 0..1 — how much the held object is sliding. */
  slip: number;
  /**
   * Force a person is applying to the held object, newtons. This is what a
   * wrist force/torque sensor reads when someone takes something out of the
   * robot's hand, and it is the only reliable cue for when to let go.
   */
  externalPull: number;
};

export type ArmState = {
  /** End-effector position in the robot's body frame. */
  tip: Vec2;
  /** Height above the base, metres. */
  height: number;
  moving: boolean;
};

/**
 * The hardware interface. The simulator implements it; a ROS 2 bridge, a
 * micro-ROS board or a vendor SDK can implement the same shape later and every
 * ability keeps working unchanged.
 */
export type RobotIO = {
  readonly id: string;
  readonly capabilities: HardwareCapability[];

  // --- sensing -------------------------------------------------------------
  pose(): Pose2;
  velocity(): { linear: number; angular: number };
  lidar(): LidarScan;
  imu(): ImuSample;
  battery(): BatteryState;
  detectObjects(): DetectedObject[];
  trackHumans(): HumanTrack[];
  gripper(): GripperState;
  arm(): ArmState;
  /** Broadband health channels (motor current, vibration, temperature, …). */
  health(): Record<string, number>;

  // --- acting --------------------------------------------------------------
  /** Command base velocity. Always routed through the safety governor. */
  drive(linear: number, angular: number): void;
  stop(): void;
  moveArm(target: Vec2, height: number): void;
  setGripper(closure: number, force: number): void;
  setLights(pattern: string, color: string): void;
  say(text: string): void;
  /** Broadcast to peer robots on the local radio mesh. */
  broadcast(topic: string, payload: unknown): void;
  receive(topic: string): unknown[];
};

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export type SafetyVerdict = {
  level: "clear" | "slow" | "stop";
  /** Multiplier applied to commanded speed, 0..1. */
  speedScale: number;
  reason: string;
  /** Distance to the closest human, metres — Infinity when nobody is near. */
  nearestHuman: number;
};

export type SafetyApi = {
  /** Latest verdict, recomputed every control tick. */
  verdict(): SafetyVerdict;
  /** Latch an emergency stop. Only `critical` abilities keep running. */
  emergencyStop(reason: string): void;
  clearEmergencyStop(): void;
  isStopped(): boolean;
  /** Ask permission before a `contact`-class action. */
  permitContact(what: string): boolean;
  /** Hard ceiling on gripper force, newtons. */
  contactForceLimit(): number;
  /**
   * The sense-to-act latency the separation model is currently using, seconds.
   * Measured, not assumed — a policy on the far side of a network can add more
   * than the whole latency budget, and abilities reasoning about stopping
   * distance need the real figure.
   */
  effectiveReactionTime(): number;
  /** Report a measured sense-to-act latency, seconds. */
  observeLatency(seconds: number): void;
  /**
   * Take the base away from whatever else is driving it. Reflexes use this so a
   * deliberative ability cannot overwrite an evasive manoeuvre.
   */
  takeWheel(linear: number, angular: number, reason: string): void;
  releaseWheel(): void;
  wheelHeldBy(): string | null;
};
