// Shared motion primitives. These are not abilities themselves — they are the
// verbs abilities are written in.

import {
  angleDiff,
  clamp,
  distance,
  headingTo,
  radians,
  type Vec2,
  wrapAngle,
} from "../core/math.ts";
import type { AbilityContext, LidarScan } from "../core/types.ts";

export const ROBOT_RADIUS = 0.28;

export type SteerResult = {
  linear: number;
  angular: number;
  /** Heading actually chosen, world frame — may differ from the goal bearing. */
  heading: number;
  /** True when the direct line to the goal is blocked and we steered around it. */
  detouring: boolean;
};

/**
 * Vector-field-histogram-style local steering: build the set of headings that
 * are clear enough to drive through, then take the clear heading closest to the
 * one we actually want. Cheap, reactive, and good enough to get through a room
 * without a global planner.
 */
export function steerToward(
  scan: LidarScan,
  currentTheta: number,
  goalBearing: number,
  options: { maxLinear?: number; lookahead?: number; turnGain?: number } = {},
): SteerResult {
  const maxLinear = options.maxLinear ?? 0.8;
  const lookahead = options.lookahead ?? 1.6;
  const turnGain = options.turnGain ?? 1.8;

  // A heading is only worth considering if the robot could actually drive along
  // it. Accepting headings it can merely point at produces the classic reactive
  // deadlock: aimed at a gap too tight to enter, speed limited to zero by the
  // very obstacle it is aimed at, turning nowhere because it already faces its
  // chosen heading.
  const minUsableClearance = 0.35;

  let bestCost = Number.POSITIVE_INFINITY;
  let bestOffset = 0;
  let bestClearance = 0;
  let blockedAhead = false;

  // Sample candidate headings every four degrees across the forward half. Fine
  // enough to find a doorway, coarse enough to evaluate each one properly.
  const sweep = Math.PI / 2;
  const stepRad = radians(4);

  for (let offset = -sweep; offset <= sweep + 1e-9; offset += stepRad) {
    // Acceptance uses the true clearance. Lookahead only shapes *preference*
    // between headings that all work: capping the clearance before the
    // comparison means that when the goal is close, every direction looks
    // unusable and the robot spins on the spot a foot from where it was going.
    const clearance = clearanceAlong(scan, offset);
    if (clearance < minUsableClearance) {
      if (Math.abs(offset) < 0.25) blockedAhead = true;
      continue;
    }

    const deviation = Math.abs(wrapAngle(currentTheta + offset - goalBearing));
    const cost = deviation + clamp(lookahead - Math.min(clearance, lookahead), 0, lookahead) * 0.9;
    if (cost < bestCost) {
      bestCost = cost;
      bestOffset = offset;
      bestClearance = clearance;
    }
  }

  if (!Number.isFinite(bestCost)) {
    // Fully boxed in: rotate in place and look again.
    return { linear: 0, angular: 1.0, heading: currentTheta, detouring: true };
  }

  const heading = wrapAngle(currentTheta + bestOffset);
  const headingError = wrapAngle(heading - currentTheta);
  const slowForTurn = Math.max(Math.cos(headingError), 0) ** 2;

  // Speed comes from the room along the heading actually chosen, and is cut to
  // nothing while the body's own corridor is blocked — so the robot turns
  // first and drives second, instead of nosing into what it is turning away from.
  const room = Math.max(bestClearance - 0.15, 0);
  const bodyBlocked = clearanceAlong(scan, 0) < 0.12;

  return {
    linear: bodyBlocked ? 0 : Math.min(maxLinear * slowForTurn, room * 1.2),
    angular: clamp(turnGain * headingError, -2, 2),
    heading,
    detouring: blockedAhead || Math.abs(wrapAngle(heading - goalBearing)) > 0.2,
  };
}

/**
 * How far the robot could drive along `offset` (relative to its current facing)
 * before its body touched something.
 *
 * Treating the robot as a disc being swept forward makes this exact. A point at
 * (along, lateral) can only ever be touched if |lateral| is under the robot's
 * radius; if it is, contact happens after travelling
 * `along - sqrt(radius² - lateral²)`. Anything further out to the side is
 * scenery the robot drives past, which is the common case — a robot that
 * treated every wall it passes as an obstacle in front of it would never get
 * through a doorway.
 *
 * It looks at every beam rather than the few nearest the heading, so an
 * obstacle just off the nose cannot hide between two beams that both see past
 * it — the failure that makes naive reactive navigation drive into table legs.
 */
export function clearanceAlong(
  scan: LidarScan,
  offset: number,
  halfWidth = ROBOT_RADIUS,
): number {
  const { ranges, fov, maxRange } = scan;
  if (ranges.length === 0) return maxRange;
  const step = fov / Math.max(ranges.length - 1, 1);
  let nearest = maxRange;

  for (let i = 0; i < ranges.length; i += 1) {
    const relative = wrapAngle(-fov / 2 + i * step - offset);
    if (Math.abs(relative) > Math.PI / 2) continue;
    const lateral = Math.abs(ranges[i] * Math.sin(relative));
    if (lateral >= halfWidth) continue;
    const along = ranges[i] * Math.cos(relative);
    if (along <= 0) continue;
    const contactAt = along - Math.sqrt(halfWidth * halfWidth - lateral * lateral);
    if (contactAt < nearest) nearest = Math.max(contactAt, 0);
  }
  return nearest;
}

/** Straight-ahead clearance — the common case. */
export function corridorClearance(scan: LidarScan, halfWidth = ROBOT_RADIUS): number {
  return clearanceAlong(scan, 0, halfWidth);
}

export type DriveToOptions = {
  tolerance?: number;
  maxLinear?: number;
  /** Give up after this much simulated time, ms. */
  timeoutMs?: number;
  /** Declare a stall after this long without meaningful progress, ms. */
  stallMs?: number;
  /** Called every control step; return `false` to stop early. */
  onStep?: (info: { at: Vec2; remaining: number; detouring: boolean }) => boolean | void;
};

export type DriveToOutcome = {
  ok: boolean;
  reason: "arrived" | "timeout" | "stuck" | "aborted" | "cancelled" | "blocked";
  travelled: number;
  elapsedMs: number;
};

/** Drive to a world point, steering around whatever the lidar sees. */
export async function driveTo(
  ctx: AbilityContext,
  goal: Vec2,
  options: DriveToOptions = {},
): Promise<DriveToOutcome> {
  const tolerance = options.tolerance ?? 0.25;
  const maxLinear = options.maxLinear ?? 0.8;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const stallMs = options.stallMs ?? 20_000;

  const started = ctx.now();
  let previous = ctx.robot.pose();
  let travelled = 0;
  // Progress is judged over a window, not per cycle: a centimetre of pose noise
  // per reading would otherwise look exactly like creeping forward.
  let windowStart = ctx.robot.pose();
  let windowOpenedAt = ctx.now();
  let stalledMs = 0;

  while (true) {
    if (ctx.signal.aborted) {
      ctx.robot.stop();
      return { ok: false, reason: "aborted", travelled, elapsedMs: ctx.now() - started };
    }

    const pose = ctx.robot.pose();
    travelled += distance(pose, previous);
    previous = pose;

    const remaining = distance(pose, goal);
    if (remaining <= tolerance) {
      ctx.robot.stop();
      return { ok: true, reason: "arrived", travelled, elapsedMs: ctx.now() - started };
    }

    if (ctx.now() - started > timeoutMs) {
      ctx.robot.stop();
      return { ok: false, reason: "timeout", travelled, elapsedMs: ctx.now() - started };
    }

    const steer = steerToward(ctx.robot.lidar(), pose.theta, headingTo(pose, goal), {
      maxLinear,
      // Close in gently so we don't overshoot the tolerance band.
      lookahead: clamp(remaining, 0.9, 1.8),
    });

    if (options.onStep?.({ at: pose, remaining, detouring: steer.detouring }) === false) {
      ctx.robot.stop();
      return { ok: false, reason: "cancelled", travelled, elapsedMs: ctx.now() - started };
    }

    ctx.robot.drive(steer.linear, steer.angular);

    // "Stuck" means the world stopped changing for a while — either the wheels
    // are spinning against something or the safety governor is holding us. A
    // robot waiting for a person to walk past is not stuck, so the window is
    // generous.
    if (ctx.now() - windowOpenedAt >= 2000) {
      // Standing still because a person is inside the safety envelope is not
      // being stuck, it is being polite. Only count time the robot had no
      // excuse for.
      const waitingForSomeone = ctx.safety.verdict().nearestHuman < 1.5;
      const progressed = distance(pose, windowStart) >= 0.15;
      stalledMs = progressed || waitingForSomeone ? 0 : stalledMs + (ctx.now() - windowOpenedAt);
      windowStart = pose;
      windowOpenedAt = ctx.now();
      if (stalledMs >= stallMs) {
        ctx.robot.stop();
        return { ok: false, reason: "stuck", travelled, elapsedMs: ctx.now() - started };
      }
    }

    await ctx.sleep(50);
  }
}

/** Turn in place until facing `heading` (world frame). */
export async function turnTo(
  ctx: AbilityContext,
  heading: number,
  tolerance = 0.06,
  timeoutMs = 12_000,
): Promise<boolean> {
  const started = ctx.now();
  while (!ctx.signal.aborted) {
    const pose = ctx.robot.pose();
    const error = angleDiff(pose.theta, heading);
    if (Math.abs(error) <= tolerance) {
      ctx.robot.stop();
      return true;
    }
    if (ctx.now() - started > timeoutMs) {
      ctx.robot.stop();
      return false;
    }
    ctx.robot.drive(0, clamp(2.2 * error, -1.6, 1.6));
    await ctx.sleep(50);
  }
  ctx.robot.stop();
  return false;
}

/** Back away from a point for `ms`, used when a manoeuvre has to be abandoned. */
export async function retreatFrom(
  ctx: AbilityContext,
  from: Vec2,
  ms: number,
): Promise<void> {
  const until = ctx.now() + ms;
  while (ctx.now() < until && !ctx.signal.aborted) {
    const pose = ctx.robot.pose();
    const away = wrapAngle(headingTo(pose, from) + Math.PI);
    ctx.robot.drive(-0.25, clamp(angleDiff(pose.theta, away) * 0.8, -0.8, 0.8));
    await ctx.sleep(50);
  }
  ctx.robot.stop();
}
