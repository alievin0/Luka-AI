// Running these abilities on a real robot.
//
// Every ability in this package talks to `RobotIO` and nothing else, so putting
// them on hardware means implementing this one interface. This file does it for
// ROS 2 over `rosbridge_suite`, which speaks JSON over a WebSocket and needs no
// native dependencies — which is what makes it practical to drive from a
// Next.js server.
//
//   ros2 launch rosbridge_server rosbridge_websocket_launch.xml
//
//   const robot = new Ros2Bridge({ url: "ws://robot.local:9090", robotId: "luka-1" });
//   await robot.connect();
//   const runtime = new RobotRuntime({ registry, robot, governor });  // no `world`
//   await runtime.run("navigate.to", { x: 4, y: 2 });
//
// Without a `world`, the runtime uses the wall clock and `ctx.twin` is
// undefined, so `plan.rehearse` correctly reports that it has nothing to
// rehearse in. Everything else behaves the same.
//
// Sensor reads are served from the last message on each topic rather than by
// blocking, because an ability calling `lidar()` inside a control loop must
// never wait on the network. A stale reading is dangerous, so `staleness()`
// exposes the age of every channel and the safety governor should be wired to
// stop the robot when it grows.

import { clamp, type Pose2, type Vec2 } from "../core/math.ts";
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

export type Ros2Topics = {
  cmdVel: string;
  odom: string;
  scan: string;
  imu: string;
  battery: string;
  detections: string;
  people: string;
  gripperState: string;
  gripperCommand: string;
  armCommand: string;
  armState: string;
  lights: string;
  speech: string;
  mesh: string;
  diagnostics: string;
};

export const DEFAULT_TOPICS: Ros2Topics = {
  cmdVel: "/cmd_vel",
  odom: "/odom",
  scan: "/scan",
  imu: "/imu/data",
  battery: "/battery_state",
  detections: "/perception/detections",
  people: "/perception/people",
  gripperState: "/gripper/state",
  gripperCommand: "/gripper/command",
  armCommand: "/arm/target_pose",
  armState: "/arm/state",
  lights: "/ui/lights",
  speech: "/ui/speech",
  mesh: "/fleet/mesh",
  diagnostics: "/diagnostics",
};

export type Ros2BridgeOptions = {
  url: string;
  robotId: string;
  capabilities?: HardwareCapability[];
  topics?: Partial<Ros2Topics>;
  /** Anything older than this is treated as no reading at all, ms. */
  maxStalenessMs?: number;
  /** Supply a WebSocket implementation when the runtime has no global one. */
  socketFactory?: (url: string) => WebSocketLike;
};

export type WebSocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", handler: (event: any) => void): void;
};

type Cached<T> = { value: T; at: number };

export class Ros2Bridge implements RobotIO {
  readonly id: string;
  readonly capabilities: HardwareCapability[];
  readonly topics: Ros2Topics;

  private socket: WebSocketLike | null = null;
  private readonly url: string;
  private readonly maxStalenessMs: number;
  private readonly socketFactory?: (url: string) => WebSocketLike;
  private readonly cache = new Map<string, Cached<unknown>>();
  private readonly mailbox = new Map<string, unknown[]>();

  constructor(options: Ros2BridgeOptions) {
    this.id = options.robotId;
    this.url = options.url;
    this.capabilities = options.capabilities ?? [
      "drive",
      "lidar",
      "imu",
      "battery",
      "camera",
      "lights",
      "speaker",
      "radio",
    ];
    this.topics = { ...DEFAULT_TOPICS, ...options.topics };
    this.maxStalenessMs = options.maxStalenessMs ?? 500;
    this.socketFactory = options.socketFactory;
  }

  async connect(): Promise<void> {
    const factory =
      this.socketFactory ??
      ((url: string) => new (globalThis as { WebSocket?: new (u: string) => WebSocketLike }).WebSocket!(url));
    const socket = factory(this.url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", (event) => reject(new Error(`rosbridge: ${String(event)}`)));
    });

    socket.addEventListener("message", (event: { data: string }) => {
      try {
        const frame = JSON.parse(event.data) as { op: string; topic?: string; msg?: unknown };
        if (frame.op !== "publish" || !frame.topic) return;
        this.cache.set(frame.topic, { value: frame.msg, at: Date.now() });
        if (frame.topic === this.topics.mesh) {
          const list = this.mailbox.get(this.topics.mesh) ?? [];
          list.push(frame.msg);
          this.mailbox.set(this.topics.mesh, list.slice(-256));
        }
      } catch {
        // A malformed frame is not worth taking the robot down for.
      }
    });

    for (const topic of [
      this.topics.odom,
      this.topics.scan,
      this.topics.imu,
      this.topics.battery,
      this.topics.detections,
      this.topics.people,
      this.topics.gripperState,
      this.topics.armState,
      this.topics.mesh,
      this.topics.diagnostics,
    ]) {
      this.publish({ op: "subscribe", topic, throttle_rate: 20 });
    }
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  /** Age in ms of the last message on each subscribed topic. */
  staleness(): Record<string, number> {
    const now = Date.now();
    const out: Record<string, number> = {};
    for (const [topic, entry] of this.cache) out[topic] = now - entry.at;
    return out;
  }

  /** True when every channel an ability depends on is fresh enough to trust. */
  healthy(): boolean {
    const ages = this.staleness();
    return [this.topics.odom, this.topics.scan].every(
      (topic) => (ages[topic] ?? Number.POSITIVE_INFINITY) < this.maxStalenessMs,
    );
  }

  // --- sensing -------------------------------------------------------------

  pose(): Pose2 {
    const msg = this.read<{
      pose: { pose: { position: { x: number; y: number }; orientation: { z: number; w: number } } };
    }>(this.topics.odom);
    if (!msg) return { x: 0, y: 0, theta: 0 };
    const { position, orientation } = msg.pose.pose;
    // Planar robot: yaw straight out of the quaternion's z/w terms.
    return {
      x: position.x,
      y: position.y,
      theta: 2 * Math.atan2(orientation.z, orientation.w),
    };
  }

  velocity(): { linear: number; angular: number } {
    const msg = this.read<{ twist: { twist: { linear: { x: number }; angular: { z: number } } } }>(
      this.topics.odom,
    );
    return msg
      ? { linear: msg.twist.twist.linear.x, angular: msg.twist.twist.angular.z }
      : { linear: 0, angular: 0 };
  }

  lidar(): LidarScan {
    const msg = this.read<{
      ranges: number[];
      angle_min: number;
      angle_max: number;
      range_max: number;
    }>(this.topics.scan);
    if (!msg) return { ranges: [], fov: 0, maxRange: 0, t: Date.now() };
    return {
      // ROS reports out-of-range beams as null/Infinity; the abilities expect a
      // number they can compare, so unreachable means "as far as I can see".
      ranges: msg.ranges.map((r) => (Number.isFinite(r) && r !== null ? r : msg.range_max)),
      fov: msg.angle_max - msg.angle_min,
      maxRange: msg.range_max,
      t: Date.now(),
    };
  }

  imu(): ImuSample {
    const msg = this.read<{
      orientation: { x: number; y: number; z: number; w: number };
      angular_velocity: { y: number; z: number };
      linear_acceleration: { x: number };
    }>(this.topics.imu);
    if (!msg) return { tilt: 0, tiltRate: 0, accel: 0, yawRate: 0, t: Date.now() };
    const { x, y, z, w } = msg.orientation;
    // Pitch from the quaternion, clamped because asin hates rounding error.
    const sinPitch = clamp(2 * (w * y - z * x), -1, 1);
    return {
      tilt: Math.asin(sinPitch),
      tiltRate: msg.angular_velocity.y,
      accel: msg.linear_acceleration.x,
      yawRate: msg.angular_velocity.z,
      t: Date.now(),
    };
  }

  battery(): BatteryState {
    const msg = this.read<{ percentage: number; current: number; voltage: number; capacity: number }>(
      this.topics.battery,
    );
    if (!msg) return { charge: 0, drawWatts: 0, capacityWh: 1 };
    return {
      charge: clamp(msg.percentage > 1 ? msg.percentage / 100 : msg.percentage, 0, 1),
      drawWatts: Math.abs(msg.current * msg.voltage),
      capacityWh: msg.capacity * msg.voltage,
    };
  }

  detectObjects(): DetectedObject[] {
    const msg = this.read<{ detections: DetectedObject[] }>(this.topics.detections);
    return msg?.detections ?? [];
  }

  trackHumans(): HumanTrack[] {
    const msg = this.read<{ people: HumanTrack[] }>(this.topics.people);
    return (msg?.people ?? []).sort((a, b) => a.distance - b.distance);
  }

  gripper(): GripperState {
    return (
      this.read<GripperState>(this.topics.gripperState) ?? {
        closure: 0,
        force: 0,
        holding: null,
        slip: 0,
        externalPull: 0,
      }
    );
  }

  arm(): ArmState {
    return (
      this.read<ArmState>(this.topics.armState) ?? {
        tip: { x: 0, y: 0 },
        height: 0,
        moving: false,
      }
    );
  }

  health(): Record<string, number> {
    const msg = this.read<{ status: Array<{ name: string; values: Array<{ key: string; value: string }> }> }>(
      this.topics.diagnostics,
    );
    const out: Record<string, number> = {};
    for (const status of msg?.status ?? []) {
      for (const { key, value } of status.values) {
        const numeric = Number(value);
        if (!Number.isNaN(numeric)) out[`${status.name}.${key}`] = numeric;
      }
    }
    return out;
  }

  // --- acting --------------------------------------------------------------

  drive(linear: number, angular: number): void {
    this.publish({
      op: "publish",
      topic: this.topics.cmdVel,
      msg: { linear: { x: linear, y: 0, z: 0 }, angular: { x: 0, y: 0, z: angular } },
    });
  }

  stop(): void {
    this.drive(0, 0);
  }

  moveArm(target: Vec2, height: number): void {
    this.publish({
      op: "publish",
      topic: this.topics.armCommand,
      msg: { position: { x: target.x, y: target.y, z: height } },
    });
  }

  setGripper(closure: number, force: number): void {
    this.publish({
      op: "publish",
      topic: this.topics.gripperCommand,
      msg: { closure: clamp(closure, 0, 1), max_effort: Math.max(force, 0) },
    });
  }

  setLights(pattern: string, color: string): void {
    this.publish({ op: "publish", topic: this.topics.lights, msg: { pattern, color } });
  }

  say(text: string): void {
    this.publish({ op: "publish", topic: this.topics.speech, msg: { data: text } });
  }

  broadcast(topic: string, payload: unknown): void {
    this.publish({
      op: "publish",
      topic: this.topics.mesh,
      msg: { from: this.id, topic, payload, t: Date.now() },
    });
  }

  receive(topic: string): unknown[] {
    const all = (this.mailbox.get(this.topics.mesh) ?? []) as Array<{
      from: string;
      topic: string;
      payload: unknown;
    }>;
    const mine = all.filter((m) => m.topic === topic && m.from !== this.id);
    this.mailbox.set(
      this.topics.mesh,
      all.filter((m) => m.topic !== topic),
    );
    return mine.map((m) => m.payload);
  }

  private read<T>(topic: string): T | null {
    const entry = this.cache.get(topic);
    if (!entry) return null;
    if (Date.now() - entry.at > this.maxStalenessMs) return null;
    return entry.value as T;
  }

  private publish(frame: Record<string, unknown>): void {
    this.socket?.send(JSON.stringify(frame));
  }
}
