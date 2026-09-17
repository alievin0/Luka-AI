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
import type { LidarScan, RobotIO, SafetyApi, SafetyVerdict } from "../core/types.ts";

export type SafetyLimits = {
  /** Fastest the base may ever travel, m/s. */
  maxLinear: number;
  /** Fastest the base may ever turn, rad/s. */
  maxAngular: number;
  /** Deceleration the brakes can actually deliver, m/s². */
  maxDecel: number;
  /** Sense→command→motor latency, seconds. */
  reactionTime: number;
  /** Assumed human approach speed, m/s (1.6 is the standard walking figure). */
  humanSpeed: number;
  /** Perception + localisation uncertainty rolled into one margin, metres. */
  uncertainty: number;
  /** Never get closer to a person than this, whatever the maths says. */
  minSeparation: number;
  /** Stop before hitting static geometry with less than this clearance. */
  obstacleClearance: number;
  /** Peak gripper force allowed for `contact`-class abilities, newtons. */
  maxContactForce: number;
};

export const DEFAULT_LIMITS: SafetyLimits = {
  maxLinear: 1.2,
  maxAngular: 1.8,
  maxDecel: 1.2,
  reactionTime: 0.12,
  humanSpeed: 1.6,
  uncertainty: 0.12,
  minSeparation: 0.35,
  obstacleClearance: 0.25,
  maxContactForce: 28,
};

export type GovernorOptions = {
  limits?: Partial<SafetyLimits>;
  /** When false, `contact`-class abilities are refused. Operator-controlled. */
  allowContact?: boolean;
  /** Called on every level change — wire it to logging or an audit trail. */
  onChange?: (verdict: SafetyVerdict) => void;
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
  }

  /**
   * Protective separation distance for a robot travelling at `speed`: how far
   * away a person has to be for this speed to still be safe.
   */
  protectiveDistance(speed: number): number {
    const { reactionTime, maxDecel, humanSpeed, uncertainty } = this.limits;
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
    const { reactionTime, maxDecel, humanSpeed, uncertainty, minSeparation, maxLinear } =
      this.limits;
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

    const nearestHuman = this.nearestHumanDistance(robot);
    const humanLimit = this.allowedSpeed(nearestHuman);
    const obstacle = nearestObstacle(robot.lidar());
    const obstacleLimit = this.obstacleSpeedLimit(obstacle);

    const allowed = Math.min(humanLimit, obstacleLimit);
    const speedScale = clamp(allowed / this.limits.maxLinear, 0, 1);

    if (allowed <= 1e-3) {
      const reason =
        humanLimit <= obstacleLimit
          ? `person ${nearestHuman.toFixed(2)} m away — holding`
          : `obstacle ${obstacle.toFixed(2)} m ahead — holding`;
      return this.publish({ level: "stop", speedScale: 0, reason, nearestHuman });
    }

    if (speedScale < 0.98) {
      const reason =
        humanLimit <= obstacleLimit
          ? `slowed to ${allowed.toFixed(2)} m/s for a person at ${nearestHuman.toFixed(2)} m`
          : `slowed to ${allowed.toFixed(2)} m/s for geometry at ${obstacle.toFixed(2)} m`;
      return this.publish({ level: "slow", speedScale, reason, nearestHuman });
    }

    return this.publish({
      level: "clear",
      speedScale: 1,
      reason: "clear",
      nearestHuman,
    });
  }

  /**
   * Clamp a requested command to what is currently safe. Turning in place is
   * allowed at reduced rate even when forward motion is blocked, so a cornered
   * robot can still look for a way out.
   */
  govern(robot: RobotIO, linear: number, angular: number): GovernedCommand {
    const verdict = this.assess(robot);

    // A reflex that has taken the wheel keeps them. Without this, a deliberative
    // ability writing at 20 Hz simply overwrites a reflex writing at 50 Hz and
    // the evasive manoeuvre never happens — the two controllers average each
    // other out into standing still.
    if (this.override) {
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
    const { maxDecel, reactionTime, obstacleClearance, maxLinear } = this.limits;
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
