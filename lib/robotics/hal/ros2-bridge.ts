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
  /**
   * Wire format for subscriptions. `cbor` is the right default for anything
   * carrying arrays; `none` (JSON) is useful only when debugging by eye.
   */
  compression?: "none" | "cbor" | "cbor-raw" | "png";
  /** Server-side throttle per subscription, ms between messages. */
  throttleMs?: number;
  /** Supply a WebSocket implementation when the runtime has no global one. */
  socketFactory?: (url: string) => WebSocketLike;
  /**
   * Units the battery driver publishes charge in. Take this from the robot's
   * profile; read the topic once and record what you saw rather than assuming.
   * Left unset, charge is read pessimistically and marked unconfident.
   */
  batteryScale?: "fraction" | "percent" | "unknown";
  /** Called when the transport is delivering something this client cannot read. */
  onProblem?: (message: string) => void;
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
  private readonly compression: "none" | "cbor" | "cbor-raw" | "png";
  private readonly throttleMs: number;
  private readonly socketFactory?: (url: string) => WebSocketLike;
  private readonly cache = new Map<string, Cached<unknown>>();
  private readonly mailbox = new Map<string, unknown[]>();

  /** Units the battery driver publishes in. Declared, never inferred. */
  private readonly batteryScale?: "fraction" | "percent" | "unknown";
  /**
   * Frames that arrived and could not be read. A robot whose every message is
   * undecodable is indistinguishable from a robot with no sensors, so this is
   * counted and exposed rather than discarded.
   */
  private undecodableFrames = 0;
  /** Topics already reported as publishing an unreadable shape. */
  private readonly reportedMalformed = new Set<string>();
  /** When the last readable frame arrived, or 0 if none ever has. */
  private lastInboundAt = 0;
  /** When connect() completed, for judging how long silence has lasted. */
  private connectedAt = 0;
  /** Outstanding service calls, keyed by request id. */
  private readonly serviceReplies = new Map<string, (values: unknown) => void>();
  /** Topics the robot said it publishes, or null if never asked or no answer. */
  private advertised: Set<string> | null = null;
  /** Commands issued with nowhere to send them. */
  private undeliveredCommands = 0;
  /** Last velocity actually reported, held so silence does not read as stopped. */
  private lastVelocity = { linear: 0, angular: 0 };
  /**
   * Last IMU sample actually received, with the time it arrived. Held so a
   * stalled sensor shows up as a timestamp that stops moving, which is the only
   * thing that distinguishes it from a robot that is genuinely level and still.
   */
  private lastImu: ImuSample = {
    tilt: Number.NaN,
    tiltRate: Number.NaN,
    accel: Number.NaN,
    yawRate: Number.NaN,
    t: 0,
    stamp: "arrival",
  };
  private readonly onProblem?: (message: string) => void;

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
    // JSON, because JSON is what the frame handler below can actually read.
    //
    // This defaulted to CBOR while the handler parsed every frame with
    // JSON.parse and swallowed the failure, which meant a bridge talking to a
    // rosbridge that honoured the request received nothing at all and said
    // nothing about it. Every topic would simply go stale forever.
    //
    // CBOR is the better wire format for scans and images and the subscribe
    // call still accepts it — but asking for it needs a decoder here first, so
    // it is opt-in rather than the default.
    this.compression = options.compression ?? "none";
    this.throttleMs = options.throttleMs ?? 20;
    this.socketFactory = options.socketFactory;
    this.batteryScale = options.batteryScale;
    this.onProblem = options.onProblem;
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

    socket.addEventListener("message", (event: { data: unknown }) => {
      if (typeof event.data !== "string") {
        // A binary frame, which means the server is sending CBOR or PNG and
        // nothing here can read it. Counted and reported rather than dropped:
        // silently discarding every message looks exactly like a robot with no
        // sensors, and that is a much harder thing to debug than an error.
        this.undecodableFrames += 1;
        if (this.undecodableFrames === 1) {
          this.onProblem?.(
            "rosbridge is sending binary frames and this client only decodes JSON. " +
              `Subscriptions were requested with compression "${this.compression}". ` +
              "Every topic will read as silent until this is resolved.",
          );
        }
        return;
      }

      try {
        const frame = JSON.parse(event.data) as {
          op: string;
          topic?: string;
          msg?: unknown;
          id?: string;
          values?: unknown;
        };

        // Anything readable arriving is proof the link is alive in the inbound
        // direction, which is the direction a half-open socket stops working
        // in first.
        this.lastInboundAt = Date.now();

        if (frame.op === "service_response" && frame.id) {
          this.serviceReplies.get(frame.id)?.(frame.values);
          this.serviceReplies.delete(frame.id);
          return;
        }

        if (frame.op !== "publish" || !frame.topic) return;
        this.cache.set(frame.topic, { value: frame.msg, at: Date.now() });
        if (frame.topic === this.topics.mesh) {
          const list = this.mailbox.get(this.topics.mesh) ?? [];
          list.push(frame.msg);
          this.mailbox.set(this.topics.mesh, list.slice(-256));
        }
      } catch {
        // One malformed frame is not worth taking the robot down for. A stream
        // of them is a different problem, so they are counted.
        this.undecodableFrames += 1;
      }
    });

    this.connectedAt = Date.now();

    // CBOR rather than the default JSON. rosbridge's reputation for choking on
    // high-rate topics is mostly the JSON tax: a lidar scan is a thousand
    // floats, and spelling each one out in decimal costs several times what the
    // binary costs to send and to parse. CBOR packs homogeneous arrays, and it
    // is a per-subscription flag, not a different bridge.
    for (const topic of this.subscribedTopics()) {
      this.publish({
        op: "subscribe",
        topic,
        compression: this.compression,
        // Throttle at the source to the rate the control loop can actually use.
        // Consuming a 100 Hz topic to run a 20 Hz loop wastes the link and adds
        // queueing latency, which the safety model then has to pay for.
        throttle_rate: this.throttleMs,
        queue_length: 1,
      });
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

  /**
   * Feed the observed staleness into the safety model.
   *
   * The separation model's reaction time is not a constant on real hardware —
   * it is however long the slowest thing in the chain took. Calling this every
   * control cycle is what keeps the protective distance honest when the link
   * degrades.
   */
  reportLatencyTo(governor: { observeLatency(seconds: number): void }): void {
    const ages = this.staleness();
    const worst = Math.max(
      ages[this.topics.odom] ?? 0,
      ages[this.topics.scan] ?? 0,
    );
    if (Number.isFinite(worst)) governor.observeLatency(worst / 1000);
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
    const msg = this.shaped<{
      pose: { pose: { position: { x: number; y: number }; orientation: { z: number; w: number } } };
    }>(
      this.topics.odom,
      this.read(this.topics.odom),
      (m) => {
        const inner = (m.pose as { pose?: { position?: unknown; orientation?: unknown } })?.pose;
        return (
          typeof (inner?.position as { x?: unknown })?.x === "number" &&
          typeof (inner?.orientation as { w?: unknown })?.w === "number"
        );
      },
    );
    if (!msg) {
      // The origin is a plausible pose, which is exactly what makes returning
      // it dangerous: an ability would navigate confidently from a position the
      // robot is not at. There is no safe guess for "where am I", so this is
      // unusable on purpose — anything computed from it comes out NaN and fails
      // rather than succeeding at the wrong thing.
      return { x: Number.NaN, y: Number.NaN, theta: Number.NaN };
    }
    const { position, orientation } = msg.pose.pose;
    // Planar robot: yaw straight out of the quaternion's z/w terms.
    return {
      x: position.x,
      y: position.y,
      theta: 2 * Math.atan2(orientation.z, orientation.w),
    };
  }

  velocity(): { linear: number; angular: number } {
    const msg = this.shaped<{ twist: { twist: { linear: { x: number }; angular: { z: number } } } }>(
      this.topics.odom,
      this.read(this.topics.odom),
      (m) => {
        const inner = (m.twist as { twist?: { linear?: unknown; angular?: unknown } })?.twist;
        return (
          typeof (inner?.linear as { x?: unknown })?.x === "number" &&
          typeof (inner?.angular as { z?: unknown })?.z === "number"
        );
      },
    );
    if (msg) {
      this.lastVelocity = {
        linear: msg.twist.twist.linear.x,
        angular: msg.twist.twist.angular.z,
      };
      return this.lastVelocity;
    }

    // Odometry has gone quiet. Reporting zero would say the robot is stopped,
    // and the safety model sizes its stopping distance from this number — so a
    // robot that is still rolling would be given the separation margin of one
    // standing still. The last known speed is the safer assumption: a robot
    // that was moving probably still is.
    return this.lastVelocity;
  }

  lidar(): LidarScan {
    const msg = this.shaped<{
      ranges: number[];
      angle_min: number;
      angle_max: number;
      range_max: number;
    }>(
      this.topics.scan,
      this.read(this.topics.scan),
      (m) =>
        Array.isArray(m.ranges) &&
        typeof m.angle_min === "number" &&
        typeof m.angle_max === "number" &&
        typeof m.range_max === "number",
    );
    if (!msg) return { ranges: [], fov: 0, maxRange: 0, t: 0, stamp: "arrival" };
    const stamped = this.stampOf(msg);
    return {
      // Two very different things arrive looking similar here, and collapsing
      // them loses the only evidence that the sensor has failed.
      //
      // Infinity is a beam that reached nothing within range. That is an answer,
      // and `range_max` represents it faithfully: clear at least that far.
      //
      // NaN or null is a beam that returned no data. That is not an answer, and
      // it has to stay unusable, because a scan of nothing and a scan of an
      // empty room are otherwise identical — which is how a robot whose lidar
      // has died concludes the path is clear.
      ranges: msg.ranges.map((r) => {
        if (r === null || Number.isNaN(r)) return Number.NaN;
        return Number.isFinite(r) ? r : msg.range_max;
      }),
      stamp: stamped === null ? "arrival" : "sensor",
      fov: msg.angle_max - msg.angle_min,
      maxRange: msg.range_max,
      // The scanner's own clock where it gave one. A driver republishing an
      // identical frame then repeats its stamp too, which is what makes a
      // frozen sensor detectable at all.
      t: stamped ?? Date.now(),
    };
  }

  imu(): ImuSample {
    const msg = this.shaped<{
      orientation: { x: number; y: number; z: number; w: number };
      angular_velocity: { y: number; z: number };
      linear_acceleration: { x: number };
    }>(
      this.topics.imu,
      this.read(this.topics.imu),
      (m) =>
        typeof (m.orientation as { w?: unknown })?.w === "number" &&
        typeof (m.angular_velocity as { z?: unknown })?.z === "number" &&
        typeof (m.linear_acceleration as { x?: unknown })?.x === "number",
    );
    if (!msg) {
      // The last real sample, with the timestamp it actually arrived at.
      //
      // Not fresh zeros. Zeros read as perfectly level and perfectly still,
      // which is what a robot lying on the floor looks like to anything that
      // believes them — and stamping them with the current time is worse still,
      // because the one signal that gives a stalled sensor away is a timestamp
      // that stops advancing. Consumers check exactly that.
      return this.lastImu;
    }
    const { x, y, z, w } = msg.orientation;
    // Pitch from the quaternion, clamped because asin hates rounding error.
    const sinPitch = clamp(2 * (w * y - z * x), -1, 1);
    const stamped = this.stampOf(msg);
    this.lastImu = {
      tilt: Math.asin(sinPitch),
      tiltRate: msg.angular_velocity.y,
      accel: msg.linear_acceleration.x,
      yawRate: msg.angular_velocity.z,
      // The robot's own clock where it gave one. Arrival time otherwise, and
      // flagged, because the two answer different questions.
      t: stamped ?? Date.now(),
      stamp: stamped === null ? "arrival" : "sensor",
    };
    return this.lastImu;
  }

  battery(): BatteryState {
    const msg = this.shaped<{
      percentage: number;
      current: number;
      voltage: number;
      capacity: number;
    }>(
      this.topics.battery,
      this.read(this.topics.battery),
      (m) =>
        typeof m.percentage === "number" &&
        typeof m.voltage === "number" &&
        typeof m.current === "number",
    );
    if (!msg) return { charge: 0, drawWatts: 0, capacityWh: 1, confident: false };

    // The units are declared, not guessed. The obvious heuristic — anything
    // above one must be a percentage — is right most of the time and wrong
    // exactly when it matters: a battery at 0.8% on a percentage driver reads
    // as 0.8, which the heuristic calls a fraction and reports as 80%. The
    // robot then sets off across the building believing it is nearly full.
    const scale = this.batteryScale ?? "unknown";
    const raw = msg.percentage;
    const charge =
      scale === "percent"
        ? raw / 100
        : scale === "fraction"
          ? raw
          // Unknown: take the pessimistic reading of the two. Being wrong this
          // way sends the robot home early; being wrong the other way leaves it
          // somewhere with a flat battery.
          : Math.min(raw, raw / 100);

    return {
      charge: clamp(charge, 0, 1),
      drawWatts: Math.abs(msg.current * msg.voltage),
      capacityWh: msg.capacity * msg.voltage,
      confident: scale !== "unknown",
    };
  }

  detectObjects(): DetectedObject[] {
    const msg = this.read<{ detections: DetectedObject[] }>(this.topics.detections);
    return msg?.detections ?? [];
  }

  trackHumans(): HumanTrack[] {
    const msg = this.shaped<{ people: HumanTrack[] }>(
      this.topics.people,
      this.read(this.topics.people),
      (m) => Array.isArray(m.people),
    );
    return [...(msg?.people ?? [])].sort((a, b) => a.distance - b.distance);
  }

  gripper(): GripperState {
    const msg = this.read<GripperState>(this.topics.gripperState);
    if (msg) return { forceSensed: true, ...msg };
    // No reading means an unknown force, not zero newtons. Zero is what a
    // gripper that is not touching anything reports, so a controller closing on
    // something fragile would read it as permission to keep squeezing.
    return {
      closure: Number.NaN,
      force: Number.NaN,
      forceSensed: false,
      holding: null,
      slip: Number.NaN,
      externalPull: Number.NaN,
    };
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

  /**
   * Frames that could not be read, plus commands that could not be sent.
   *
   * Either one alone means the robot and this process have stopped agreeing
   * about what is happening, which is worth refusing to drive on.
   */
  transportProblems(): number {
    return this.undecodableFrames + this.undeliveredCommands;
  }

  /** Whether there is currently a connection to send on. */
  isConnected(): boolean {
    return this.socket !== null;
  }

  /**
   * Whether anything has actually arrived, and how long it has been.
   *
   * An open socket is not a working link. A TCP connection that has half-closed
   * keeps accepting sends locally and never delivers them, and never errors
   * either — so a robot that died the moment after connecting looks exactly
   * like a robot that is connected and quiet. Measured before this existed: a
   * link that had never delivered one message reported itself healthy with
   * zero problems.
   *
   * The inbound direction is the one that gives it away, because a live robot
   * is always publishing something.
   */
  inbound(): { everReceived: boolean; silentForMs: number } {
    if (this.socket === null) return { everReceived: false, silentForMs: 0 };
    const since = this.lastInboundAt === 0 ? this.connectedAt : this.lastInboundAt;
    return {
      everReceived: this.lastInboundAt > 0,
      silentForMs: Math.max(0, Date.now() - since),
    };
  }

  /**
   * Ask the robot which topics it actually publishes.
   *
   * rosbridge accepts a subscription to any name at all, so a typo in a topic
   * produces exactly the silence a dead sensor produces — and the silence gets
   * debugged as a dead sensor, which it is not. `/rosapi/topics` is the only
   * way to tell the two apart from this side.
   *
   * Returns null when the robot does not answer, which is itself worth knowing
   * and must not be reported as "all topics present".
   */
  async advertisedTopics(timeoutMs = 2000): Promise<Set<string> | null> {
    if (!this.socket) return null;
    const id = `topics-${Date.now()}`;

    const answer = await new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        this.serviceReplies.delete(id);
        resolve(null);
      }, timeoutMs);
      this.serviceReplies.set(id, (values) => {
        clearTimeout(timer);
        resolve(values);
      });
      this.publish({ op: "call_service", service: "/rosapi/topics", id });
    });

    const topics = (answer as { topics?: unknown })?.topics;
    if (!Array.isArray(topics)) return null;
    this.advertised = new Set(topics.map(String));
    return this.advertised;
  }

  /**
   * Which of the topics this bridge subscribes to the robot does not publish.
   *
   * Null when the robot never answered, because "nobody told us" is a
   * different state from "everything is there" and collapsing them is the
   * whole mistake this audit keeps finding.
   */
  missingTopics(): string[] | null {
    if (!this.advertised) return null;
    return this.subscribedTopics().filter((topic) => !this.advertised!.has(topic));
  }

  /** Every topic this bridge subscribes to. */
  subscribedTopics(): string[] {
    return [
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
    ];
  }

  /**
   * The robot's own timestamp for a message, in ms, or null when it did not
   * send one.
   *
   * ROS puts this in `header.stamp` as separate seconds and nanoseconds. It is
   * the only thing in a message that is on the *robot's* clock rather than
   * this one, which makes it the only thing that can answer whether the two
   * clocks agree. Falling back to arrival time silently would make that
   * question unanswerable while appearing to answer it.
   */
  /**
   * Check a message has the fields the reader is about to use.
   *
   * Every reader indexed straight into the payload, so a driver publishing a
   * slightly different shape — a different ROS version, a renamed field, a
   * partially written message — threw out of the reader. That is not a
   * cosmetic difference from returning nothing: the safety governor calls
   * `lidar()` on every control tick, so one badly shaped frame took the entire
   * safety loop down with it. Seven of nine malformed frames did exactly that
   * when this was measured.
   *
   * A frame that does not match is treated as a frame that did not arrive,
   * counted as a transport problem, and reported once. The reading then
   * degrades the same way a silent topic does, which is a path that is already
   * tested and already fails closed.
   */
  private shaped<T>(topic: string, msg: unknown, required: (m: Record<string, unknown>) => boolean): T | null {
    if (msg === null || typeof msg !== "object") return this.malformed<T>(topic);
    try {
      if (!required(msg as Record<string, unknown>)) return this.malformed<T>(topic);
    } catch {
      return this.malformed<T>(topic);
    }
    return msg as T;
  }

  private malformed<T>(topic: string): T | null {
    this.undecodableFrames += 1;
    if (!this.reportedMalformed.has(topic)) {
      this.reportedMalformed.add(topic);
      this.onProblem?.(
        `A message on ${topic} did not have the fields this client reads. The driver is ` +
          "publishing a shape this bridge does not understand, and the reading is being treated " +
          "as absent rather than guessed at.",
      );
    }
    return null;
  }

  private stampOf(msg: unknown): number | null {
    const header = (msg as { header?: { stamp?: { sec?: number; nanosec?: number } } })?.header;
    const stamp = header?.stamp;
    if (!stamp || typeof stamp.sec !== "number") return null;
    const nanos = typeof stamp.nanosec === "number" ? stamp.nanosec : 0;
    return stamp.sec * 1000 + nanos / 1e6;
  }

  private read<T>(topic: string): T | null {
    const entry = this.cache.get(topic);
    if (!entry) return null;
    if (Date.now() - entry.at > this.maxStalenessMs) return null;
    return entry.value as T;
  }

  private publish(frame: Record<string, unknown>): void {
    if (!this.socket) {
      // Every command here returned normally with nothing sent: drive, and
      // more to the point stop. A caller asking a disconnected robot to halt
      // was told it had halted. Commands that go nowhere are counted and
      // reported, because a robot that silently ignores instructions is
      // indistinguishable from one that is obeying them and not moving.
      this.undeliveredCommands += 1;
      if (this.undeliveredCommands === 1) {
        this.onProblem?.(
          "A command was issued with no connection to the robot. Nothing was sent, and " +
            "nothing on the robot changed — including any stop.",
        );
      }
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }
}
