// Binds the simulator to the hardware interface abilities are written against.
// Swapping this for `hal/ros2-bridge.ts` puts the same abilities on a real
// robot — that is the whole point of the RobotIO seam.

import { clamp, distance, headingTo, type Pose2, type Vec2, wrapAngle } from "../core/math.ts";

/** How far a docking beacon reaches, metres. Real infrared docks manage a few. */
const DOCK_BEACON_RANGE = 3;

/** Detections kept per person for estimating velocity. */
const TRACK_WINDOW = 8;
/**
 * How long a track survives without a detection, ms.
 *
 * A tracker that keeps differencing across a gap reports the average velocity
 * over the time the person was out of sight, which is a number about the gap
 * rather than about them. Real trackers drop a track and re-acquire; so does
 * this one.
 */
const TRACK_STALE_MS = 1500;
import type { SafetyGovernor } from "../safety/governor.ts";
import type {
  ArmState,
  BatteryState,
  DetectedObject,
  GripperState,
  HardwareCapability,
  HumanTrack,
  ImuSample,
  LidarScan,
  RobotIO,
} from "../core/types.ts";
import { GRAVITY } from "./world.ts";
import type { SimRobot, SimWorld } from "./world.ts";

export const FULL_HARDWARE: HardwareCapability[] = [
  "drive",
  "arm",
  "gripper",
  "lidar",
  "imu",
  "camera",
  "tactile",
  "battery",
  "lights",
  "speaker",
  "radio",
];

export type SimAdapterOptions = {
  capabilities?: HardwareCapability[];
  lidarBeams?: number;
  lidarFov?: number;
  lidarMaxRange?: number;
  /** How far the camera can recognise objects, metres. */
  visionRange?: number;
  visionFov?: number;
  /**
   * Fraction of lidar beams that return nothing, 0..1.
   *
   * A real failure mode rather than a test hook: a dirty window, a failing
   * photodiode array, a surface that absorbs at the sensor's wavelength. The
   * beams that do answer are as accurate as ever, which is what makes this
   * different from noise and what makes a partial scan worth using.
   *
   * Which beams drop is fixed per scan by the world's seeded RNG, so a run
   * replays exactly.
   */
  beamDropout?: number;
  /**
   * A contiguous arc of the scan that returns nothing, as {centre, width} in
   * radians relative to the robot's heading.
   *
   * The other way a lidar half-fails, and the dangerous one. A smear on one
   * part of the window, a failed segment of the receiver, the robot's own arm
   * swung into the plane: the beams that answer are perfect, and there is a
   * whole direction the robot cannot see. It loses the same fraction of beams
   * as dropout does and it is not remotely the same failure.
   */
  blindSector?: { centre: number; width: number };
};

export class SimRobotAdapter implements RobotIO {
  readonly id: string;
  readonly capabilities: HardwareCapability[];

  /**
   * While true, the governor's latched emergency stop is bypassed. The runtime
   * sets it only for `critical`-class abilities — the ones whose whole job is to
   * act when something has already gone wrong.
   */
  privileged = false;

  private readonly world: SimWorld;
  private readonly governor: SafetyGovernor;
  private readonly options: Required<Omit<SimAdapterOptions, "blindSector">> &
    Pick<SimAdapterOptions, "blindSector">;
  private readonly radioCursor = new Map<string, number>();

  constructor(
    world: SimWorld,
    robotId: string,
    governor: SafetyGovernor,
    options: SimAdapterOptions = {},
  ) {
    this.world = world;
    this.id = robotId;
    this.governor = governor;
    this.options = {
      capabilities: options.capabilities ?? FULL_HARDWARE,
      lidarBeams: options.lidarBeams ?? 181,
      lidarFov: options.lidarFov ?? Math.PI * 1.5,
      lidarMaxRange: options.lidarMaxRange ?? 12,
      visionRange: options.visionRange ?? 6,
      visionFov: options.visionFov ?? Math.PI * 0.9,
      beamDropout: options.beamDropout ?? 0,
      blindSector: options.blindSector,
    };
    this.capabilities = this.options.capabilities;
  }

  /**
   * Recent observations of each person, for estimating how fast they are going.
   *
   * A real tracker has no access to anybody's velocity. It sees a sequence of
   * noisy detections and differences them, which makes the estimate both noisy
   * and late — and `hri.yield-path` projects it five seconds forward, where a
   * fifth of a metre per second of error becomes a metre of prediction.
   *
   * Reporting the true velocity instead made that capability look better than
   * any tracker can be. This keeps the last few detections and fits a line
   * through them, which is what the estimate actually costs.
   */
  private tracks = new Map<string, Array<{ t: number; x: number; y: number }>>();

  private get self(): SimRobot {
    return this.world.robot(this.id);
  }

  // --- sensing -------------------------------------------------------------

  /**
   * A true world point, as the robot would report it.
   *
   * A camera measures where something is *relative to the robot* — a bearing
   * and a range — and that measurement carries no odometry error at all. World
   * coordinates only appear when the robot composes that relative measurement
   * with its own believed pose, and that is where the drift enters.
   *
   * Handing out true world positions while `pose()` drifts counts the error
   * twice: the relative geometry the robot computes from the two would be
   * wrong by the drift, when in reality it is the one thing that is right.
   * Measured, that made a robot unable to grasp an object it was standing
   * beside. So the sensor is modelled where it actually is: relative geometry
   * exact, absolute position carrying the robot's own error.
   */
  private asBelieved(point: Vec2): Vec2 {
    const truth = this.self.pose;
    const believed = this.self.odom;
    const dx = point.x - truth.x;
    const dy = point.y - truth.y;
    // Into the robot's frame using the true heading, because that is the
    // geometry the sensor actually sees...
    const cos = Math.cos(-truth.theta);
    const sin = Math.sin(-truth.theta);
    const forward = dx * cos - dy * sin;
    const left = dx * sin + dy * cos;
    // ...and back out using the believed heading, which is what the robot will
    // use to put it on a map.
    return {
      x: believed.x + forward * Math.cos(believed.theta) - left * Math.sin(believed.theta),
      y: believed.y + forward * Math.sin(believed.theta) + left * Math.cos(believed.theta),
    };
  }

  /**
   * How fast somebody is going, from having watched them.
   *
   * A least-squares line through the last few detections, which is what a
   * tracker's filter approximates. Shorter windows follow a change of direction
   * faster and are noisier; longer ones are smoother and later. Both costs are
   * real and neither is avoidable, which is the point of estimating it here
   * rather than handing out the truth.
   */
  private estimateVelocity(id: string, observed: Vec2): { velocity: Vec2; uncertainty: number } {
    const now = this.world.timeMs;
    let history = this.tracks.get(id) ?? [];
    // A person who walked out of the camera's field of view and back in is a
    // new track, not a continuation. Differencing the position they had before
    // they left against the one they have now measures the gap.
    if (history.length && now - history[history.length - 1].t > TRACK_STALE_MS) {
      history = [];
    }
    // One sample per instant: an ability polling twice in a tick must not get a
    // velocity differenced against zero elapsed time.
    if (history.length === 0 || now > history[history.length - 1].t) {
      history.push({ t: now, x: observed.x, y: observed.y });
    }
    while (history.length > TRACK_WINDOW) history.shift();
    this.tracks.set(id, history);

    // Too few detections to fit anything. Zero velocity with unbounded
    // uncertainty, rather than a confident standstill.
    if (history.length < 3) {
      return { velocity: { x: 0, y: 0 }, uncertainty: Number.POSITIVE_INFINITY };
    }
    const meanT = history.reduce((a, h) => a + h.t, 0) / history.length;
    let varT = 0;
    let covX = 0;
    let covY = 0;
    for (const h of history) {
      const dt = h.t - meanT;
      varT += dt * dt;
      covX += dt * h.x;
      covY += dt * h.y;
    }
    if (varT <= 0) return { velocity: { x: 0, y: 0 }, uncertainty: Number.POSITIVE_INFINITY };
    // Slope is metres per millisecond; the caller wants metres per second.
    const velocity = { x: (covX / varT) * 1000, y: (covY / varT) * 1000 };

    // How far the detections sit from the line that was fitted to them. This is
    // the tracker's own opinion of itself, and it is available on real hardware
    // for the same reason it is available here: it falls out of the fit.
    const meanX = history.reduce((a, h) => a + h.x, 0) / history.length;
    const meanY = history.reduce((a, h) => a + h.y, 0) / history.length;
    let residual = 0;
    for (const h of history) {
      const dt = (h.t - meanT) / 1000;
      residual +=
        (h.x - (meanX + velocity.x * dt)) ** 2 + (h.y - (meanY + velocity.y * dt)) ** 2;
    }
    const spread = Math.sqrt(residual / Math.max(1, history.length - 2));
    // Standard error of a slope: the scatter about the line, over the spread of
    // the times it was fitted across.
    const spanSeconds = Math.sqrt(varT) / 1000;
    const uncertainty = spanSeconds > 0 ? spread / spanSeconds : Number.POSITIVE_INFINITY;
    return { velocity, uncertainty };
  }

  /**
   * The dock, as a beacon sees it — or null when it is out of range.
   *
   * Dead reckoning does not get a robot onto a charging contact. Over the
   * nineteen metres this kernel's power lifeline typically has to cover, the
   * accumulated error is most of a metre and the dock needs a third of one, so
   * a robot that navigates home purely on odometry arrives somewhere near the
   * dock and stops. Measured: it missed every time.
   *
   * Every real docking system solves this the same way, with a measurement
   * that does not go through odometry at all — an infrared beacon, a fiducial
   * marker, a magnetic guide. Modelled here as what those give you: a direct
   * relative fix, accurate, and only available close in.
   */
  dockBeacon(): { at: Vec2; distance: number } | null {
    if (!this.capabilities.includes("camera")) return null;
    const dock = this.world.dock;
    const range = distance(this.self.pose, dock);
    if (range > DOCK_BEACON_RANGE) return null;
    return { at: this.asBelieved(dock), distance: this.world.noisy(range, 0.01) };
  }

  /**
   * Where the robot believes it is.
   *
   * This is dead reckoning, not the truth: the integral of the wheel speeds,
   * with the systematic scale errors a real platform has. It drifts, it drifts
   * further the longer the robot drives, and driving a loop back to the start
   * does not bring it home. Anything that plans in world coordinates is
   * planning against this.
   *
   * `truePose` is next door and is for scoring and rendering only. Using it in
   * a controller is the simulator lying to the robot.
   */
  pose(): Pose2 {
    const { odom } = this.self;
    return {
      x: this.world.noisy(odom.x, 0.01),
      y: this.world.noisy(odom.y, 0.01),
      theta: wrapAngle(this.world.noisy(odom.theta, 0.004)),
    };
  }

  /** Ground-truth tilt, for scoring. Never for control. */
  trueTilt(): number {
    return this.self.tilt;
  }

  /** Ground-truth pose — for scoring and rendering, never for control. */
  truePose(): Pose2 {
    return { ...this.self.pose };
  }

  velocity(): { linear: number; angular: number } {
    return { linear: this.self.linear, angular: this.self.angular };
  }

  lidar(): LidarScan {
    const {
      lidarBeams,
      lidarFov,
      lidarMaxRange,
      beamDropout: dropout,
      blindSector: blind,
    } = this.options;
    const { pose } = this.self;
    const ranges: number[] = new Array(lidarBeams);
    const step = lidarFov / Math.max(lidarBeams - 1, 1);
    for (let i = 0; i < lidarBeams; i += 1) {
      const angle = pose.theta - lidarFov / 2 + i * step;
      if (blind !== undefined && Math.abs(wrapAngle(angle - pose.theta - blind.centre)) <= blind.width / 2) {
        ranges[i] = Number.NaN;
        continue;
      }
      if (dropout > 0 && this.world.random() < dropout) {
        // Not a range of zero, and not the maximum range either. The beam did
        // not come back, and the only honest value for that is one that cannot
        // be mistaken for a measurement.
        ranges[i] = Number.NaN;
        continue;
      }
      const hit = this.world.raycast(pose, angle, lidarMaxRange);
      ranges[i] = clamp(this.world.noisy(hit, 0.015), 0.02, lidarMaxRange);
    }
    // The simulated world's clock is the sensor's own clock here, so these are
    // stamped rather than left to be read as arrival times.
    return {
      ranges,
      fov: lidarFov,
      maxRange: lidarMaxRange,
      t: this.world.timeMs,
      stamp: "sensor" as const,
    };
  }

  /**
   * What the IMU reports, which is not what the body is doing.
   *
   * `tilt` is a fused estimate rather than a measurement — see `stepIMU` — and
   * the rates carry this unit's constant bias. Before this the simulator handed
   * out the true tilt with three milliradians of noise, which is not a sensor,
   * it is the answer. `balance.recover` decides whether a fall is still
   * catchable from this number.
   */
  /**
   * The IMU, including the channel that was not one.
   *
   * `accel` is declared as forward acceleration in m/s², and the ROS bridge
   * maps it from `linear_acceleration.x`, which is what an accelerometer
   * actually publishes. Here it used to be `commandedLinear - linear`: the
   * difference between what the motor controller was asked for and what the
   * wheels were doing. That is not an acceleration — the units are m/s — and
   * more to the point it is computed from the command and the encoders, two
   * things an accelerometer has no access to. The device measures the force on
   * the chassis; it cannot know what anyone asked for.
   *
   * Nothing read it, which is why it survived. It is also the one channel that
   * can see the robot's brakes failing to bite, because on a slippery floor the
   * wheels decelerate exactly as commanded and only the body does not follow.
   *
   * What comes back now is specific force along the body's forward axis: the
   * body's own acceleration, contaminated by gravity when the robot is pitched,
   * offset by this unit's turn-on bias, and noisy. The gravity term is why an
   * accelerometer alone cannot tell braking from a downslope, and the bias is
   * why every IMU driver zeroes itself while the machine is standing still.
   */
  imu(): ImuSample {
    const robot = this.self;
    const specificForce =
      robot.bodyAccel - GRAVITY * Math.sin(robot.tilt) + robot.accelBias;
    return {
      tilt: this.world.noisy(robot.tiltEstimate, 0.003),
      tiltRate: this.world.noisy(robot.tiltRate + robot.gyroBias, 0.01),
      accel: this.world.noisy(specificForce, 0.05),
      yawRate: this.world.noisy(robot.angular + robot.gyroBias, 0.01),
      t: this.world.timeMs,
      stamp: "sensor" as const,
    };
  }

  /**
   * What the fuel gauge says, which is not what is in the pack.
   *
   * State of charge is inferred rather than measured. The usual inference is a
   * voltage curve that is nearly flat through the middle of a lithium
   * discharge, so a small voltage error is a large charge error, and it carries
   * a systematic offset per pack and per cell age. On top of that the terminal
   * voltage sags under load, so a driving robot reads lower than the same robot
   * standing still with the same energy left — which is why a robot that stops
   * to think about returning finds it has more charge than it did while moving.
   *
   * Reported to 0.2% of the true coulomb state before this, which is a better
   * gauge than exists. `power.lifeline` decides when to abandon a mission from
   * this number, so how wrong it can be is the whole question.
   */
  battery(): BatteryState {
    const robot = this.self;
    const watts = this.world.drawWatts(robot);
    // Sag: proportional to draw, and it reads low rather than high, which is
    // the safe direction and also the one that makes a robot dither.
    const sag = (watts / 120) * 0.05;
    const indicated = robot.charge + robot.gaugeBias - sag;
    return {
      charge: clamp(this.world.noisy(indicated, 0.01), 0, 1),
      drawWatts: this.world.noisy(watts, 0.4),
      capacityWh: robot.capacityWh,
      // The simulator's units are its own, so they are known by construction.
      // On hardware this is true only once somebody has read the topic.
      confident: true,
    };
  }

  /** The true coulomb state, for scoring. Never for a decision. */
  trueCharge(): number {
    return this.self.charge;
  }

  detectObjects(): DetectedObject[] {
    // A robot with no camera does not quietly get perception anyway. The
    // simulator being more capable than the hardware it stands in for is how a
    // stack passes in simulation and fails on the machine.
    if (!this.capabilities.includes("camera")) return [];
    const robot = this.self;
    const out: DetectedObject[] = [];
    for (const object of this.world.objects) {
      if (object.heldBy && object.heldBy !== this.id) continue;
      const dist = distance(robot.pose, object.at);
      if (dist > this.options.visionRange) continue;
      const bearing = wrapAngle(headingTo(robot.pose, object.at) - robot.pose.theta);
      if (Math.abs(bearing) > this.options.visionFov / 2) continue;
      // Confidence falls off with distance — perception is not a database.
      const confidence = clamp(1 - dist / (this.options.visionRange * 1.2), 0.15, 0.99);
      out.push({
        id: object.id,
        label: object.label,
        at: {
          x: this.world.noisy(this.asBelieved(object.at).x, 0.02 + dist * 0.01),
          y: this.world.noisy(this.asBelieved(object.at).y, 0.02 + dist * 0.01),
        },
        confidence,
        distance: dist,
        graspable: object.graspable,
      });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  /**
   * The people the camera can actually see.
   *
   * `detectObjects`, twenty lines above, gates on `visionRange` and
   * `visionFov` and lets its position error grow with distance. This did none
   * of those things: it mapped over every person in the world and sorted them
   * by distance, so the safety governor was reading people behind the robot and
   * people eight metres away through a lens that reaches six.
   *
   * Measured across the two corridor scenarios, 7,200 tracks: 30% were beyond
   * the declared range and 10% were outside the declared field of view, and
   * **the nearest person — the one `allowedSpeed` is computed from — was one
   * the camera could not have seen on 19–21% of ticks**. The same camera, the
   * same two constants, applied to objects and not to people.
   *
   * Line of sight is not modelled, and the reason is a measurement rather than
   * an oversight: across the same runs, 0.0% of tracks were behind static
   * geometry, because the corridors have none between the robot and the people.
   * Building a ray cast for a case no scenario exercises would be arithmetic
   * nobody could check.
   *
   * What replaces the missing people is not nothing. The governor's obstacle
   * term works on raw lidar returns and stops for a person because a person is
   * an obstacle — which is the whole reason that term carries the load when
   * nothing is tracking anyone.
   */
  trackHumans(): HumanTrack[] {
    // Person tracking is a camera and a neural pipeline, and most real robots
    // ship without the second even when they have the first. A profile that
    // does not declare a camera gets no tracks here either.
    if (!this.capabilities.includes("camera")) return [];
    const robot = this.self;
    const seen: HumanTrack[] = [];
    for (const human of this.world.humans) {
      const dist = distance(robot.pose, human.at);
      if (dist > this.options.visionRange) continue;
      const bearing = wrapAngle(headingTo(robot.pose, human.at) - robot.pose.theta);
      if (Math.abs(bearing) > this.options.visionFov / 2) continue;
      // Position error grows with distance, the way a camera's does: a bearing
      // error of a fixed number of pixels is a larger displacement further out.
      // A flat figure said a person ten metres away was located as precisely as
      // one at arm's length.
      const spread = 0.03 + dist * 0.01;
      const observed = {
        x: this.world.noisy(this.asBelieved(human.at).x, spread),
        y: this.world.noisy(this.asBelieved(human.at).y, spread),
      };
      const motion = this.estimateVelocity(human.id, observed);
      seen.push({
        id: human.id,
        at: observed,
        velocityUncertainty: motion.uncertainty,
        velocity: motion.velocity,
        distance: Math.max(this.world.noisy(dist, spread), 0),
        attentive: human.attentive,
      });
    }
    return seen.sort((a, b) => a.distance - b.distance);
  }

  gripper(): GripperState {
    const robot = this.self;
    // Closure and what is held come from the servo and the world; force and
    // slip come from a sensor most grippers do not have. A robot without one
    // reports that it does not know, rather than reporting zero.
    const sensed = this.capabilities.includes("tactile");
    return {
      closure: robot.gripperClosure,
      force: sensed ? robot.gripperForce : Number.NaN,
      forceSensed: sensed,
      holding: robot.holding,
      slip: sensed ? clamp(this.world.noisy(robot.slip, 0.01), 0, 1) : Number.NaN,
      externalPull: sensed
        ? Math.max(this.world.noisy(robot.externalPull, 0.05), 0)
        : Number.NaN,
    };
  }

  /**
   * Where the arm believes its tip is, and whether it was asked for something
   * it could reach.
   *
   * The tip position is not measured. It is computed from the joint encoders
   * through the kinematic chain, so an error in a link length or a joint zero
   * appears at the tip, scaled by the reach and constant for the robot. This
   * used to report the true tip with no error at all — not noise, zero — which
   * matters against `learn.demo` claiming it reproduces a demonstration to
   * 10 mm.
   */
  arm(): ArmState {
    const robot = this.self;
    return {
      tip: {
        x: robot.armTip.x + robot.armTipBias.x,
        y: robot.armTip.y + robot.armTipBias.y,
      },
      height: robot.armHeight,
      moving: robot.armTarget !== null,
      reachable: robot.armTargetReachable,
    };
  }

  health(): Record<string, number> {
    const robot = this.self;
    const nominal = this.world.nominalHealth(robot);
    const out: Record<string, number> = {};
    for (const [channel, value] of Object.entries(nominal)) {
      const fault = this.world.faults.find(
        (f) => f.channel === channel && this.world.timeMs >= f.startsAtMs,
      );
      const biased = value + (fault?.bias ?? 0);
      out[channel] = this.world.noisy(biased, 0.01 + (fault?.noise ?? 0));
    }
    return out;
  }

  // --- acting --------------------------------------------------------------

  drive(linear: number, angular: number): void {
    const robot = this.self;
    if (this.governor.isStopped() && !this.privileged) {
      robot.commandedLinear = 0;
      robot.commandedAngular = 0;
      return;
    }
    const governed = this.privileged
      ? { linear, angular }
      : this.governor.govern(this, linear, angular);
    robot.commandedLinear = governed.linear;
    robot.commandedAngular = governed.angular;
  }

  stop(): void {
    const robot = this.self;
    robot.commandedLinear = 0;
    robot.commandedAngular = 0;
  }

  moveArm(target: Vec2, height: number): void {
    const robot = this.self;
    // Reach envelope: the arm cannot leave a 0.2–0.75 m annulus in front.
    //
    // A target outside it is still clamped, because that is what the arm does —
    // it goes as far as it can and stops. What changed is that it says so.
    // Measured before it did: asked for a point 1.6 m away the arm went to
    // 0.75 m, eight hundred and fifty millimetres short, and reported
    // `moving: false` and a tip, exactly as it does on a motion that arrived.
    const wanted = Math.hypot(target.x, target.y);
    const reach = clamp(wanted, 0.2, 0.75);
    const angle = Math.atan2(target.y, target.x);
    const wantedHeight = clamp(height, 0.05, 1.2);
    robot.armTargetReachable =
      Math.abs(reach - wanted) < 1e-9 && Math.abs(wantedHeight - height) < 1e-9;
    robot.armTarget = { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
    robot.armTargetHeight = wantedHeight;
  }

  setGripper(closure: number, force: number): void {
    const robot = this.self;
    robot.gripperTarget = clamp(closure, 0, 1);
    robot.gripperForce = this.governor.governForce(force);
  }

  setLights(pattern: string, color: string): void {
    this.self.lights = { pattern, color };
  }

  say(text: string): void {
    this.self.utterance = text;
  }

  broadcast(topic: string, payload: unknown): void {
    this.world.send({ from: this.id, topic, payload, t: this.world.timeMs });
  }

  receive(topic: string): unknown[] {
    const since = this.radioCursor.get(topic) ?? 0;
    const messages = this.world.inbox(topic, since, this.id);
    // Advance past everything that arrived, including messages from peers we
    // filter out, so nothing is re-delivered and nothing is skipped.
    //
    // Only past what *arrived*: a frame this receiver lost must not move the
    // cursor, or a later read would skip over frames behind it that did arrive.
    for (const message of messages) {
      this.radioCursor.set(topic, Math.max(this.radioCursor.get(topic) ?? 0, message.seq));
    }
    return messages.filter((m) => m.from !== this.id).map((m) => m.payload);
  }

  /** Peer messages including our own — for auditing a conversation after the fact. */
  receiveAll(
    topic: string,
    afterSeq = 0,
  ): Array<{ from: string; payload: unknown; t: number; seq: number }> {
    return this.world.inbox(topic, afterSeq).map((m) => ({
      from: m.from,
      payload: m.payload,
      t: m.t,
      seq: m.seq,
    }));
  }
}
