// Binds the simulator to the hardware interface abilities are written against.
// Swapping this for `hal/ros2-bridge.ts` puts the same abilities on a real
// robot — that is the whole point of the RobotIO seam.

import { clamp, distance, headingTo, type Pose2, type Vec2, wrapAngle } from "../core/math.ts";
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
  private readonly options: Required<SimAdapterOptions>;
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
    };
    this.capabilities = this.options.capabilities;
  }

  private get self(): SimRobot {
    return this.world.robot(this.id);
  }

  // --- sensing -------------------------------------------------------------

  pose(): Pose2 {
    const { pose } = this.self;
    return {
      x: this.world.noisy(pose.x, 0.01),
      y: this.world.noisy(pose.y, 0.01),
      theta: wrapAngle(this.world.noisy(pose.theta, 0.004)),
    };
  }

  /** Ground-truth pose — for scoring and rendering, never for control. */
  truePose(): Pose2 {
    return { ...this.self.pose };
  }

  velocity(): { linear: number; angular: number } {
    return { linear: this.self.linear, angular: this.self.angular };
  }

  lidar(): LidarScan {
    const { lidarBeams, lidarFov, lidarMaxRange } = this.options;
    const { pose } = this.self;
    const ranges: number[] = new Array(lidarBeams);
    const step = lidarFov / Math.max(lidarBeams - 1, 1);
    for (let i = 0; i < lidarBeams; i += 1) {
      const angle = pose.theta - lidarFov / 2 + i * step;
      const hit = this.world.raycast(pose, angle, lidarMaxRange);
      ranges[i] = clamp(this.world.noisy(hit, 0.015), 0.02, lidarMaxRange);
    }
    return { ranges, fov: lidarFov, maxRange: lidarMaxRange, t: this.world.timeMs };
  }

  imu(): ImuSample {
    const robot = this.self;
    return {
      tilt: this.world.noisy(robot.tilt, 0.003),
      tiltRate: this.world.noisy(robot.tiltRate, 0.01),
      accel: this.world.noisy(robot.commandedLinear - robot.linear, 0.02),
      yawRate: this.world.noisy(robot.angular, 0.01),
      t: this.world.timeMs,
    };
  }

  battery(): BatteryState {
    const robot = this.self;
    const watts =
      12 + Math.abs(robot.linear) * 34 + Math.abs(robot.angular) * 9 + robot.gripperForce * 0.15;
    return {
      charge: clamp(this.world.noisy(robot.charge, 0.002), 0, 1),
      drawWatts: this.world.noisy(watts, 0.4),
      capacityWh: robot.capacityWh,
      // The simulator's units are its own, so they are known by construction.
      // On hardware this is true only once somebody has read the topic.
      confident: true,
    };
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
          x: this.world.noisy(object.at.x, 0.02 + dist * 0.01),
          y: this.world.noisy(object.at.y, 0.02 + dist * 0.01),
        },
        confidence,
        distance: dist,
        graspable: object.graspable,
      });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  trackHumans(): HumanTrack[] {
    // Person tracking is a camera and a neural pipeline, and most real robots
    // ship without the second even when they have the first. A profile that
    // does not declare a camera gets no tracks here either.
    if (!this.capabilities.includes("camera")) return [];
    const robot = this.self;
    return this.world.humans
      .map((human) => {
        const dist = distance(robot.pose, human.at);
        const index = human.waypointIndex ?? 0;
        const target = human.waypoints[index % Math.max(human.waypoints.length, 1)];
        const velocity =
          human.waypoints.length > 0 && target
            ? {
                x: ((target.x - human.at.x) / Math.max(distance(target, human.at), 1e-6)) *
                  human.speed,
                y: ((target.y - human.at.y) / Math.max(distance(target, human.at), 1e-6)) *
                  human.speed,
              }
            : { x: 0, y: 0 };
        return {
          id: human.id,
          at: { x: this.world.noisy(human.at.x, 0.03), y: this.world.noisy(human.at.y, 0.03) },
          velocity,
          distance: Math.max(this.world.noisy(dist, 0.03), 0),
          attentive: human.attentive,
        };
      })
      .sort((a, b) => a.distance - b.distance);
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

  arm(): ArmState {
    const robot = this.self;
    return {
      tip: { ...robot.armTip },
      height: robot.armHeight,
      moving: robot.armTarget !== null,
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
    const reach = clamp(Math.hypot(target.x, target.y), 0.2, 0.75);
    const angle = Math.atan2(target.y, target.x);
    robot.armTarget = { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
    robot.armTargetHeight = clamp(height, 0.05, 1.2);
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
    const messages = this.world.inbox(topic, since);
    // Advance past everything published so far, including messages from peers
    // we filter out, so nothing is re-delivered and nothing is skipped.
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
