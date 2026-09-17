// The Safety Governor sits between every ability and the motors. Abilities ask
// for a velocity; the governor decides what the robot is actually allowed to do
// this instant, and nothing reaches an actuator without passing through here.
//
// The separation model follows the shape of ISO/TS 15066 speed-and-separation
// monitoring: keep the protective separation distance below the real distance
// to the nearest person at all times, where that distance accounts for the
// human walking toward the robot, the robot's reaction delay, its braking
// distance, and sensing uncertainty. This implementation is a working model for
// simulation and prototyping — certifying a real machine is a different job
// involving rated safety hardware.

import { clamp } from "../core/math.ts";
import { ConflictMonitor, worstResponse, type WorldStateConflict } from "../core/conflict.ts";
import type { LidarScan, RobotIO, SafetyApi, SafetyVerdict } from "../core/types.ts";

export type SafetyLimits = {
  /** Fastest the base may ever travel, m/s. */
  maxLinear: number;
  /** Fastest the base may ever turn, rad/s. */
  maxAngular: number;
  /** Deceleration the brakes can actually deliver, m/s². */
  maxDecel: number;
  /**
   * Sense→command→motor latency budget, seconds. This is a *budget*: the real
   * figure is measured at runtime and, if it exceeds this, the separation model
   * uses the measured one. A policy running in a datacentre can add a quarter
   * of a second of round trip, which at walking speed is a third of a metre of
   * protective distance the robot would otherwise never have accounted for.
   */
  reactionTime: number;
  /** Assumed human approach speed, m/s (1.6 is the standard walking figure). */
  humanSpeed: number;
  /** Perception + localisation uncertainty rolled into one margin, metres. */
  uncertainty: number;
  /**
   * Never get closer to a person than this, whatever the maths says. Measured
   * centre to centre, because that is what a person tracker reports — so it has
   * to cover both bodies. A 0.28 m robot and a 0.25 m person are touching at
   * 0.53 m, which makes anything below that a collision rather than a close
   * pass.
   */
  minSeparation: number;
  /** Stop before hitting static geometry with less than this clearance. */
  obstacleClearance: number;
  /** Peak gripper force allowed for `contact`-class abilities, newtons. */
  maxContactForce: number;
  /**
   * Fraction of lidar beams that must be returning data, 0..1. Below this the
   * robot is treated as blind rather than as looking at an empty room.
   */
  minScanQuality: number;
  /**
   * Speed allowed while blind, m/s. Not zero: a robot that stops dead the
   * instant a sensor hiccups is a robot nobody can use, and it may need to move
   * to get out of the way. Slow enough that being wrong is a bump.
   */
  blindSpeed: number;
  /**
   * Speed allowed while two senses contradict each other about the robot's own
   * motion, m/s.
   *
   * This is a policy choice and not a measurement, so it is worth saying what
   * it is hedging against. A motion contradiction does not mean the robot
   * cannot see — the lidar is still the lidar, and obstacle avoidance still
   * works on raw ranges. What it means is that the robot's belief about where
   * it is has come apart from where it is, and it will keep acting on that
   * belief until somebody intervenes. The speed is set so that the distance it
   * can accumulate while wrong stays small enough to walk back.
   */
  conflictSpeed: number;
};

export const DEFAULT_LIMITS: SafetyLimits = {
  maxLinear: 1.2,
  maxAngular: 1.8,
  maxDecel: 1.2,
  reactionTime: 0.12,
  humanSpeed: 1.6,
  uncertainty: 0.12,
  minScanQuality: 0.5,
  blindSpeed: 0.05,
  conflictSpeed: 0.2,
  minSeparation: 0.55,
  obstacleClearance: 0.25,
  maxContactForce: 28,
};

export type GovernorOptions = {
  limits?: Partial<SafetyLimits>;
  /** When false, `contact`-class abilities are refused. Operator-controlled. */
  allowContact?: boolean;
  /** Called on every level change — wire it to logging or an audit trail. */
  onChange?: (verdict: SafetyVerdict) => void;
  /**
   * Watch for the robot's senses contradicting each other about its own
   * motion, and govern on the result. On by default: a robot whose odometry has
   * come apart from the world is the case every other check here passes.
   */
  watchConflicts?: boolean;
};

export type GovernedCommand = {
  linear: number;
  angular: number;
  verdict: SafetyVerdict;
  /** True when the governor altered what the ability asked for. */
  modified: boolean;
};

export class SafetyGovernor implements SafetyApi {
  readonly limits: SafetyLimits;

  private allowContact: boolean;
  private readonly onChange?: (verdict: SafetyVerdict) => void;
  private stopped = false;
  private stopReason = "";
  private override: { linear: number; angular: number; reason: string } | null = null;
  /** Exponentially-weighted measurement of the real sense-to-act latency, seconds. */
  private measuredLatency = 0;
  private latencyWarned = false;
  private readonly conflictMonitor: ConflictMonitor | null;
  /** The contradictions standing as of the last command. */
  private conflicts: WorldStateConflict[] = [];
  /**
   * Which clock the conflict timestamps are being measured on.
   *
   * The persistence window only needs differences, and any consistent clock
   * gives them — but differences taken *across* two clocks are meaningless, and
   * under the simulator the sensor clock starts at zero while wall time is in
   * the trillions. Switching between them mid-run would produce a jump of
   * whatever the offset happens to be, which the monitor would read as a
   * disagreement that had persisted for fifty years.
   */
  private conflictClock: "sensor" | "wall" | null = null;
  /** The instant already sampled, so sampling it again changes nothing. */
  private conflictSampledAt: number | null = null;
  /**
   * What was last actually sent to the motors.
   *
   * Obedience is a question about the motors, so it has to be asked about the
   * command they were given and not the one an ability asked for. Using the
   * request would deadlock the moment a conflict stops the wheels: the governed
   * command is zero, the body is correctly still, and comparing that against a
   * request for half a metre a second is a disagreement that can never close.
   *
   * It is also the physically correct comparison. A body's velocity now is a
   * response to the command it was given last tick, not to this one.
   */
  private lastSentCommand = { linear: 0, angular: 0 };
  private last: SafetyVerdict = {
    level: "clear",
    speedScale: 1,
    reason: "initialised",
    nearestHuman: Number.POSITIVE_INFINITY,
  };

  constructor(options: GovernorOptions = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.allowContact = options.allowContact ?? true;
    this.onChange = options.onChange;
    this.conflictMonitor = (options.watchConflicts ?? true) ? new ConflictMonitor() : null;
  }

  /**
   * Compare what was asked for against what the robot's senses say happened.
   *
   * Called from `govern`, because that is the only place holding both halves of
   * the comparison. Everything it finds lands in the next verdict.
   */
  private sampleConflicts(robot: RobotIO): void {
    const monitor = this.conflictMonitor;
    if (!monitor) return;
    const hasImu = robot.capabilities.includes("imu" as never);
    const imu = hasImu ? robot.imu() : null;
    const scan = this.tracksScan(robot) ? robot.lidar() : null;

    // Prefer the clock that stamped the reading, from whichever channel this
    // robot actually has. Falling back to wall time is correct on a robot whose
    // driver stamps nothing, and wrong the moment it is mixed with a sensor
    // clock, so a change of clock resets the history rather than being
    // differenced across.
    const stamped =
      imu?.stamp === "sensor" ? imu.t : scan?.stamp === "sensor" ? scan.t : null;
    const clock: "sensor" | "wall" = stamped === null ? "wall" : "sensor";
    if (clock !== this.conflictClock) {
      monitor.reset();
      this.conflicts = [];
      this.conflictClock = clock;
      this.conflictSampledAt = null;
    }
    const now = stamped ?? Date.now();

    // Sampling the same instant twice is not two observations.
    //
    // `drive` governs the command it is given, so a caller that governs and
    // then drives samples this twice per control tick with the sensors in
    // exactly the same state. The second pass finds no time elapsed, so the
    // scan comparison has nothing to difference against and returns nothing —
    // and that nothing replaced a real detection. Measured: a robot whose
    // wheels spun for three seconds on a frictionless floor was still allowed
    // full speed, because every detection was overwritten by its own duplicate.
    //
    // Holding the previous answer is the honest response. No time has passed,
    // so nothing has been learned.
    if (this.conflictSampledAt === now) return;
    this.conflictSampledAt = now;

    const odometry = robot.velocity();
    if (!Number.isFinite(odometry.linear) || !Number.isFinite(odometry.angular)) {
      // Odometry that is not reporting numbers is a different fault, already
      // caught upstream as invalid evidence. Comparing against it here would
      // manufacture a contradiction out of a channel that is simply down.
      this.conflicts = [];
      return;
    }
    // A gyro that is absent, or not reporting numbers, is a missing channel —
    // not a gyro claiming the robot is standing still. Standing in the
    // odometry's own figure makes the comparison a no-op rather than a
    // fabricated conflict; the missing channel is reported as invalid or absent
    // evidence elsewhere, which is where it belongs.
    const gyroYawRate =
      imu && Number.isFinite(imu.yawRate) ? imu.yawRate : odometry.angular;
    this.conflicts = monitor.check(
      {
        commanded: this.lastSentCommand,
        odometry,
        gyroYawRate,
        scanClosure: this.tracksScan(robot)
          ? monitor.sampleScan(robot, now, odometry.angular)
          : null,
        at: now,
      },
      new Map(),
    );
  }

  private tracksScan(robot: RobotIO): boolean {
    return robot.capabilities.includes("lidar" as never);
  }

  /** Contradictions standing right now, for anyone who has to act on them. */
  standingConflicts(): readonly WorldStateConflict[] {
    return this.conflicts;
  }

  /**
   * Re-arm after a contradiction, the way an operator resets a tripped guard.
   *
   * A conflict is kept until the senses positively agree again at a magnitude
   * that proves something, and an obedience conflict stops the wheels — so a
   * robot that has been accused of not obeying can never demonstrate otherwise
   * on its own. Somebody has to decide to try again. It re-raises immediately
   * if the fault is still there.
   */
  clearConflicts(): void {
    this.conflictMonitor?.clear();
    this.conflicts = [];
  }

  /**
   * Report how long it actually took between sensing the world and the motors
   * acting on it. Everything downstream of a slow link — a cloud policy, a
   * congested network, a busy control loop — shows up here.
   */
  observeLatency(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.measuredLatency = this.measuredLatency === 0
      ? seconds
      : this.measuredLatency * 0.9 + seconds * 0.1;

    if (this.measuredLatency > this.limits.reactionTime && !this.latencyWarned) {
      this.latencyWarned = true;
      this.onChange?.({
        level: this.last.level,
        speedScale: this.last.speedScale,
        reason: `measured latency ${(this.measuredLatency * 1000).toFixed(0)} ms exceeds the ${(this.limits.reactionTime * 1000).toFixed(0)} ms budget — separation distances widened to match`,
        nearestHuman: this.last.nearestHuman,
      });
    }
  }

  /** The latency the separation model is actually using, seconds. */
  effectiveReactionTime(): number {
    return Math.max(this.limits.reactionTime, this.measuredLatency);
  }

  /**
   * Protective separation distance for a robot travelling at `speed`: how far
   * away a person has to be for this speed to still be safe.
   */
  protectiveDistance(speed: number): number {
    const { maxDecel, humanSpeed, uncertainty } = this.limits;
    const reactionTime = this.effectiveReactionTime();
    const stoppingTime = Math.abs(speed) / maxDecel;
    const humanTravel = humanSpeed * (reactionTime + stoppingTime);
    const robotReaction = Math.abs(speed) * reactionTime;
    const robotBraking = (speed * speed) / (2 * maxDecel);
    return humanTravel + robotReaction + robotBraking + uncertainty;
  }

  /**
   * The inverse: the fastest speed that still keeps the protective distance
   * inside `distance`. Solved in closed form from the quadratic above.
   */
  allowedSpeed(distance: number): number {
    const { maxDecel, humanSpeed, uncertainty, minSeparation, maxLinear } = this.limits;
    const reactionTime = this.effectiveReactionTime();
    if (!Number.isFinite(distance)) return maxLinear;

    const usable = distance - minSeparation;
    if (usable <= 0) return 0;

    // v²/(2a) + v·Tr + humanTravel + uncertainty = usable
    const budget = usable - humanSpeed * reactionTime - uncertainty;
    if (budget <= 0) return 0;

    // Human keeps closing while we brake, so the human-speed term depends on v
    // too; fold it in by treating (humanSpeed/maxDecel) as extra braking time.
    const effectiveReaction = reactionTime + humanSpeed / maxDecel;
    const disc =
      maxDecel * maxDecel * effectiveReaction * effectiveReaction + 2 * maxDecel * budget;
    if (disc <= 0) return 0;

    const v = -maxDecel * effectiveReaction + Math.sqrt(disc);
    return clamp(v, 0, maxLinear);
  }

  /** Recompute the verdict from the robot's current sensing. */
  assess(robot: RobotIO): SafetyVerdict {
    if (this.stopped) {
      return this.publish({
        level: "stop",
        speedScale: 0,
        reason: `emergency stop latched: ${this.stopReason}`,
        nearestHuman: this.nearestHumanDistance(robot),
      });
    }

    const peopleSensed = this.tracksPeople(robot);
    const nearestHuman = this.nearestHumanDistance(robot);
    const humanLimit = peopleSensed ? this.allowedSpeed(nearestHuman) : Number.POSITIVE_INFINITY;
    // The term that carries the load when nothing is detecting people, which on
    // real hardware is the normal case: the platforms that could publish person
    // tracks ship with that pipeline turned off. This is geometry on raw range
    // returns, with the stopping-distance equation inverted in closed form. It
    // does not know what a person is and does not need to — it stops for one
    // because a person is an obstacle, which is also why it cannot be fooled by
    // a classifier having a bad day.
    const scan = robot.lidar();

    // What can be seen, and how far the seeing can be trusted.
    //
    // An unanswered beam contributes nothing to `nearestObstacle`: every
    // comparison against NaN is false, so it falls through each guard in turn
    // and leaves the nearest obstacle at maximum range. Nobody decided that an
    // unanswered beam means a clear path — it is what NaN arithmetic does when
    // nothing asks. Measured: a wall 1.2 m dead ahead, with the beams that see
    // it returning nothing, reported 12.00 m of clear road while 78% of the
    // scan was answering perfectly well.
    //
    // So the range at which the picture stops being trustworthy is treated
    // exactly like an obstacle at that range, because an obstacle there cannot
    // be ruled out. Scattered dropout is unaffected: a single missing beam
    // cannot conceal anything closer than 20 m.
    const coverage = scanCoverage(scan);
    const obstacle = Math.min(nearestObstacle(scan), coverage.hiddenNearest);
    const obstacleLimit = this.obstacleSpeedLimit(obstacle);

    // Before trusting any of that: is the sensor reporting at all?
    //
    // This is the sharpest form of the mistake that runs through this whole
    // area. A lidar returning nothing looks identical to a lidar looking at
    // nothing, and every calculation downstream reads it as a clear path — so
    // a robot whose primary safety sensor has just died accelerates to full
    // speed. Measured before this existed: an all-NaN scan produced a verdict
    // of "clear" at scale 1.00.
    const quality = scanQuality(scan);
    const blind = quality < this.limits.minScanQuality;

    // The senses contradicting each other about the robot's own motion.
    //
    // Every other check above asks whether a channel is reporting, and a robot
    // whose wheels are spinning on ice passes all of them: the odometry is
    // fresh, complete, in range and wrong. Only a second measurement of the
    // same quantity catches it, which is what this is.
    const contradiction = worstResponse(this.conflicts);
    if (contradiction === "stop") {
      // Not a latched emergency stop: the robot is not doing what it was told,
      // and the answer to that is to stop telling it things, not to require a
      // human to come and re-arm it. It clears when the robot obeys again.
      return this.publish({
        level: "stop",
        speedScale: 0,
        reason: this.conflicts.map((conflict) => conflict.summary).join(" "),
        nearestHuman,
        peopleSensed,
        conflicts: this.conflicts,
      });
    }

    const allowed = Math.min(
      humanLimit,
      obstacleLimit,
      blind ? this.limits.blindSpeed : Number.POSITIVE_INFINITY,
      contradiction === "degrade" || contradiction === "slow"
        ? this.limits.conflictSpeed
        : Number.POSITIVE_INFINITY,
    );

    if (contradiction !== "none" && !blind) {
      return this.publish({
        level: "slow",
        speedScale: clamp(allowed / this.limits.maxLinear, 0, 1),
        reason:
          `${this.conflicts.map((conflict) => conflict.quantity).join(" and ")} is being ` +
          `reported two different ways — holding ${this.limits.conflictSpeed} m/s until they ` +
          `agree. ${this.conflicts.map((conflict) => conflict.summary).join(" ")}`,
        nearestHuman,
        peopleSensed,
        conflicts: this.conflicts,
      });
    }
    const speedScale = clamp(allowed / this.limits.maxLinear, 0, 1);

    if (blind) {
      // Say it once per verdict rather than silently crawling, because a robot
      // that has slowed to a crawl for no visible reason is one somebody will
      // "fix" by raising the speed limit.
      return this.publish({
        level: "slow",
        speedScale: clamp(allowed / this.limits.maxLinear, 0, 1),
        reason:
          `only ${(quality * 100).toFixed(0)}% of lidar beams are returning data — ` +
          `crawling at ${this.limits.blindSpeed} m/s until the sensor reports again. ` +
          "A scan that returns nothing and a scan of an empty room are the same numbers.",
        nearestHuman,
        peopleSensed,
      });
    }

    if (allowed <= 1e-3) {
      const reason =
        humanLimit <= obstacleLimit
          ? `person ${nearestHuman.toFixed(2)} m away — holding`
          : `obstacle ${obstacle.toFixed(2)} m ahead — holding`;
      return this.publish({ level: "stop", speedScale: 0, reason, nearestHuman, peopleSensed });
    }

    if (speedScale < 0.98) {
      const reason =
        humanLimit <= obstacleLimit
          ? `slowed to ${allowed.toFixed(2)} m/s for a person at ${nearestHuman.toFixed(2)} m`
          : `slowed to ${allowed.toFixed(2)} m/s for geometry at ${obstacle.toFixed(2)} m`;
      return this.publish({ level: "slow", speedScale, reason, nearestHuman, peopleSensed });
    }

    return this.publish({
      level: "clear",
      speedScale: 1,
      reason: "clear",
      nearestHuman,
      peopleSensed,
    });
  }

  /**
   * Clamp a requested command to what is currently safe. Turning in place is
   * allowed at reduced rate even when forward motion is blocked, so a cornered
   * robot can still look for a way out.
   */
  govern(robot: RobotIO, linear: number, angular: number): GovernedCommand {
    // Sampled here because this is the only place that sees every command on
    // its way to the motors.
    this.sampleConflicts(robot);
    const verdict = this.assess(robot);

    // A reflex that has taken the wheel keeps them. Without this, a deliberative
    // ability writing at 20 Hz simply overwrites a reflex writing at 50 Hz and
    // the evasive manoeuvre never happens — the two controllers average each
    // other out into standing still.
    if (this.override) {
      this.lastSentCommand = {
        linear: this.override.linear,
        angular: this.override.angular,
      };
      return {
        linear: this.override.linear,
        angular: this.override.angular,
        verdict,
        modified: true,
      };
    }

    const maxLinear = this.limits.maxLinear * verdict.speedScale;
    const angularScale = verdict.level === "stop" ? 0.3 : 1;

    // Reversing away from a hazard is always permitted — it increases distance.
    const safeLinear =
      linear < 0
        ? clamp(linear, -this.limits.maxLinear, 0)
        : clamp(linear, 0, maxLinear);
    const safeAngular = clamp(
      angular,
      -this.limits.maxAngular * angularScale,
      this.limits.maxAngular * angularScale,
    );

    this.lastSentCommand = { linear: safeLinear, angular: safeAngular };
    return {
      linear: safeLinear,
      angular: safeAngular,
      verdict,
      modified:
        Math.abs(safeLinear - linear) > 1e-6 || Math.abs(safeAngular - angular) > 1e-6,
    };
  }

  /** Clamp a gripper force request to the contact limit. */
  governForce(force: number): number {
    return clamp(force, 0, this.limits.maxContactForce);
  }

  verdict(): SafetyVerdict {
    return this.last;
  }

  emergencyStop(reason: string): void {
    this.stopped = true;
    this.stopReason = reason;
    this.publish({
      level: "stop",
      speedScale: 0,
      reason: `emergency stop: ${reason}`,
      nearestHuman: this.last.nearestHuman,
    });
  }

  clearEmergencyStop(): void {
    this.stopped = false;
    this.stopReason = "";
  }

  isStopped(): boolean {
    return this.stopped;
  }

  permitContact(what: string): boolean {
    if (this.stopped) return false;
    if (!this.allowContact) return false;
    // Contact is only sane when nobody is inside the separation envelope.
    return this.last.nearestHuman > this.limits.minSeparation;
  }

  /**
   * Hand control of the base to a reflex. Everything else commanding the drive
   * is ignored until it is released.
   */
  takeWheel(linear: number, angular: number, reason: string): void {
    this.override = { linear, angular, reason };
  }

  releaseWheel(): void {
    this.override = null;
  }

  wheelHeldBy(): string | null {
    return this.override?.reason ?? null;
  }

  contactForceLimit(): number {
    return this.limits.maxContactForce;
  }

  setContactAllowed(allowed: boolean): void {
    this.allowContact = allowed;
  }

  private obstacleSpeedLimit(distance: number): number {
    const { maxDecel, obstacleClearance, maxLinear } = this.limits;
    const reactionTime = this.effectiveReactionTime();
    const budget = distance - obstacleClearance;
    if (budget <= 0) return 0;
    // v·Tr + v²/(2a) <= budget
    const disc =
      maxDecel * maxDecel * reactionTime * reactionTime + 2 * maxDecel * budget;
    const v = -maxDecel * reactionTime + Math.sqrt(Math.max(disc, 0));
    return clamp(v, 0, maxLinear);
  }

  private nearestHumanDistance(robot: RobotIO): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (const human of robot.trackHumans()) {
      if (human.distance < nearest) nearest = human.distance;
    }
    return nearest;
  }

  /**
   * Whether person tracking is a real channel on this robot.
   *
   * This matters more than it looks. When there is no detector, the nearest
   * person is reported as infinitely far away — which is the same answer an
   * empty room gives. A blind robot and a clear one are indistinguishable from
   * that number alone, so the separation term has to be treated as absent
   * rather than as satisfied.
   */
  private tracksPeople(robot: RobotIO): boolean {
    return robot.capabilities.includes("camera");
  }

  private publish(verdict: SafetyVerdict): SafetyVerdict {
    const changed =
      verdict.level !== this.last.level ||
      Math.abs(verdict.speedScale - this.last.speedScale) > 0.05;
    this.last = verdict;
    if (changed) this.onChange?.(verdict);
    return verdict;
  }
}

/**
 * How far the robot can drive straight before its body hits something.
 *
 * The robot is swept forward as a disc: only returns whose lateral offset is
 * inside the body radius can ever be touched, and contact happens after
 * `along - sqrt(radius² - lateral²)`. A wall half a metre to the side is not an
 * obstacle to a robot driving past it, and treating it as one makes the robot
 * freeze in every doorway.
 */
/**
 * The fraction of beams that carry an answer, 0..1.
 *
 * Three cases have to be told apart, and only one of them is a fault:
 *
 *   a finite positive range   the beam hit something and measured it
 *   positive infinity         the beam hit nothing within range, which is a
 *                             real answer and the correct one in open space
 *   NaN, zero or negative     the beam returned no data at all
 *
 * The last case is the sensor failing to report, and it is the one that has to
 * be distinguished from an empty room. A scan of every beam at infinity is a
 * robot in a field. A scan of every beam at NaN is a robot that cannot see, and
 * to every calculation downstream those look exactly alike: nothing is near.
 */
export function scanQuality(scan: LidarScan): number {
  const { ranges } = scan;
  if (ranges.length === 0) return 0;
  let answered = 0;
  for (const range of ranges) {
    if (Number.isNaN(range)) continue;
    if (range <= 0) continue;
    answered += 1;
  }
  return answered / ranges.length;
}

/**
 * How much of the scan's *direction* is answered, as opposed to how many of its
 * beams are.
 *
 * `scanQuality` counts beams, and counting cannot tell apart the two ways a
 * lidar half-fails. Measured on the same navigation task, at an identical 70%
 * of beams answering:
 *
 *   30% scattered dropout      20/20 arrived, 0 collisions, 7.2 s
 *   30% in one arc, ahead      20/20 arrived, 0 collisions, 9.8 s
 *   30% in one arc, off-centre  0/20 arrived, 2814 collisions
 *
 * Same number, three different robots. Scattered loss is harmless because the
 * neighbouring beams look at the same space; a contiguous arc is a direction
 * the robot cannot see at all, and it reads as clear.
 *
 * ── When a gap can hide something ──────────────────────────────────────────
 *
 * An obstacle of half-width w at range d subtends 2·asin(w/d) ≈ 2w/d. It is
 * entirely inside a blind arc of width α once 2w/d ≤ α, that is from
 *
 *     d ≥ 2w/α
 *
 * outward. Far things hide in narrow gaps; near things need wide ones. At one
 * missing beam out of 181 across 270° (α ≈ 0.0145 rad) a 0.15 m obstacle first
 * hides at 20.7 m, past the sensor's range — which is why scattered dropout
 * costs nothing, derived rather than observed.
 *
 * The other half is whether the gap points anywhere the robot is going. The
 * swept corridor of half-width W spans |θ| ≤ asin(W/d) at range d, narrowing
 * with distance, so a gap whose nearest edge is at θ₁ overlaps the corridor
 * only within
 *
 *     d ≤ W/sin θ₁
 *
 * A gap straight ahead (θ₁ = 0) overlaps it at every range; one out at 80°
 * overlaps it only within 0.28 m, which is inside the robot.
 */
export type ScanCoverage = {
  /** Fraction of beams carrying data, 0..1. What `scanQuality` reports. */
  answered: number;
  /** Widest contiguous unanswered arc in the forward half, radians. */
  largestGap: number;
  /** Where that arc points, radians from the heading. */
  gapCentre: number;
  /**
   * The closest range at which an obstacle could be hiding where the robot is
   * driving, metres, or Infinity when no gap can conceal one.
   *
   * This is the number to govern on. It is not "how far can I see" — it is
   * "how close could the thing I cannot see be", which is the question a
   * stopping distance has to answer.
   */
  hiddenNearest: number;
};

/**
 * Whether an obstacle can hide in the gap and still be in the robot's way.
 *
 * Two conditions, and getting the first one wrong is what made the initial
 * version of this paralyse the robot. An obstacle is only missed if it is
 * *entirely* inside the blind arc — one that pokes out of either edge is seen,
 * and then its position is known well enough to avoid. So:
 *
 *   (a) it fits:      2·asin(w/d) ≤ α,  i.e.  d ≥ w / sin(α/2)
 *   (b) it is in the way: e + asin(w/d) < asin(W/d)
 *
 * where α is the gap's width, e how far its nearer edge sits from the heading,
 * w the obstacle's half-width and W the swept corridor's.
 *
 * (a) is a floor rather than a ceiling, and that is the part that is easy to
 * miss: something very close is too *wide* in angle to hide, so it sticks out
 * of the gap and gets seen. Concealment starts at w/sin(α/2) and ends where
 * (b) fails, so the hiding places form a band rather than everything past a
 * threshold.
 *
 * When the gap spans the heading itself, e is zero, (b) holds at every range,
 * and the band runs to the horizon — a robot that cannot see straight ahead
 * cannot drive straight ahead, and no speed makes that safe.
 */
function concealmentRange(
  gapWidth: number,
  nearEdge: number,
  sweptHalfWidth: number,
  obstacleHalfWidth: number,
  maxRange: number,
): number {
  if (gapWidth <= 0) return Number.POSITIVE_INFINITY;
  const w = obstacleHalfWidth;
  const W = sweptHalfWidth;

  // (a) Closer than this the obstacle is too wide in angle to fit in the gap.
  //
  // And closer than the two bodies' radii combined it is not hiding anywhere —
  // it is already touching the robot. Leaving that floor out made the measure
  // report concealment at 0.23 m on a robot of radius 0.28, which is a point
  // inside its own footprint; the governor read that as an obstacle inside its
  // stopping clearance and refused to move at all. A robot that will not move
  // is not a degraded robot, it is a stopped one.
  const fits = Math.max(
    gapWidth >= Math.PI ? 0 : w / Math.sin(gapWidth / 2),
    sweptHalfWidth + w,
  );
  if (fits > maxRange) return Number.POSITIVE_INFINITY;

  // (b) The furthest range at which something inside the gap is still inside
  // the corridor. Monotone in d, so a bisection settles it.
  const inTheWay = (d: number): boolean => {
    const corridor = Math.asin(Math.min(1, W / d));
    const obstacle = Math.asin(Math.min(1, w / d));
    return nearEdge + obstacle < corridor;
  };
  if (!inTheWay(Math.max(fits, 1e-3))) return Number.POSITIVE_INFINITY;
  if (inTheWay(maxRange)) return fits;

  let low = Math.max(fits, 1e-3);
  let high = maxRange;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (inTheWay(mid)) low = mid;
    else high = mid;
  }
  return low >= fits ? fits : Number.POSITIVE_INFINITY;
}

/**
 * Describe what the scan can and cannot see, by direction.
 *
 * `minObstacle` is the half-width of the smallest thing worth not hitting — a
 * chair leg, an ankle. Making it smaller makes the measure stricter, because
 * smaller things hide in narrower gaps.
 */
export function scanCoverage(
  scan: LidarScan,
  sweptHalfWidth = 0.28,
  minObstacle = 0.15,
): ScanCoverage {
  const { ranges, fov, maxRange } = scan;
  if (ranges.length === 0) {
    return { answered: 0, largestGap: Math.PI, gapCentre: 0, hiddenNearest: 0 };
  }
  const step = fov / Math.max(ranges.length - 1, 1);
  const start = -fov / 2;
  const answers = (range: number) => !Number.isNaN(range) && range > 0;

  let largestGap = 0;
  let gapCentre = 0;
  let hiddenNearest = Number.POSITIVE_INFINITY;
  let runStart: number | null = null;

  const closeRun = (endIndex: number) => {
    if (runStart === null) return;
    const first = start + runStart * step;
    const last = start + (endIndex - 1) * step;
    // A run of n beams blocks an arc n steps wide, not n-1: each beam stands
    // for the slice around it.
    const width = last - first + step;
    if (width > largestGap) {
      largestGap = width;
      gapCentre = (first + last) / 2;
    }
    const spansHeading = first <= 0 && last >= 0;
    const nearEdge = spansHeading ? 0 : Math.min(Math.abs(first), Math.abs(last));
    const nearest = concealmentRange(width, nearEdge, sweptHalfWidth, minObstacle, maxRange);
    if (nearest < hiddenNearest) hiddenNearest = nearest;
    runStart = null;
  };

  let answered = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    if (answers(ranges[i])) answered += 1;
    const angle = start + i * step;
    // Only the forward half can conceal something the robot is driving into. A
    // blind arc behind it is a real hole in its picture of the room and not a
    // reason to slow down — a limit worth stating rather than hiding, because
    // it means this measure says nothing to a robot reversing.
    if (Math.abs(angle) <= Math.PI / 2 && !answers(ranges[i])) {
      if (runStart === null) runStart = i;
    } else {
      closeRun(i);
    }
  }
  closeRun(ranges.length);

  return { answered: answered / ranges.length, largestGap, gapCentre, hiddenNearest };
}

export function nearestObstacle(scan: LidarScan, halfWidth = 0.28): number {
  const { ranges, fov, maxRange } = scan;
  if (ranges.length === 0) return maxRange;
  let nearest = maxRange;
  const step = fov / Math.max(ranges.length - 1, 1);
  const start = -fov / 2;
  for (let i = 0; i < ranges.length; i += 1) {
    const angle = start + i * step;
    if (Math.abs(angle) > Math.PI / 2) continue;
    const lateral = Math.abs(ranges[i] * Math.sin(angle));
    if (lateral >= halfWidth) continue;
    const along = ranges[i] * Math.cos(angle);
    if (along <= 0) continue;
    const contactAt = along - Math.sqrt(halfWidth * halfWidth - lateral * lateral);
    if (contactAt < nearest) nearest = Math.max(contactAt, 0);
  }
  return nearest;
}
