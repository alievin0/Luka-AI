// ── balance.recover · استرداد التوازن ───────────────────────────────────────
// Catching a fall, using the capture point.
//
// For a body balancing over a support, there is a single point on the ground
// where the support would have to be placed *right now* to bring the body to a
// stop: ξ = θ + θ̇/ω₀, with ω₀ = √(g/L). If that point is still inside the
// footprint, the ankles can handle it and the right answer is to do nothing
// dramatic. If it has left the footprint, no amount of ankle torque will help
// and the base itself must move underneath the centre of mass. Knowing which
// case you are in is the whole ability.

import { clamp } from "../core/math.ts";
import { nearestObstacle } from "../safety/governor.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type BalanceInput = {
  /** Height of the centre of mass above the wheels, metres. */
  comHeight?: number;
  /** Half-length of the support footprint, metres. */
  footHalf?: number;
  /** Fastest the base may lunge while catching the fall, m/s. */
  maxLungeSpeed?: number;
  /** Give up and brace for impact past this lean, radians. */
  fallAngle?: number;
  timeoutMs?: number;
};

export type BalanceReport = {
  strategy: "none" | "ankle" | "lunge" | "brace";
  peakTilt: number;
  peakCapturePoint: number;
  recoveryMs: number;
  /** How far the base had to travel to get back under the body, metres. */
  drift: number;
  recovered: boolean;
};

export const balanceRecover: Ability<BalanceInput, BalanceReport> = {
  manifest: {
    id: "balance.recover",
    version: "1.0.0",
    name: { en: "Balance Recovery", ar: "استرداد التوازن" },
    summary: {
      en: "Catches a fall by computing the capture point and driving the base back under the centre of mass — or braces when the fall is already lost.",
      ar: "بيمسك السقطة: بيحسب نقطة الالتقاط وبيرجّع القاعدة تحت مركز الثقل — وإذا صارت السقطة محتومة بيستعد للارتطام.",
    },
    rationale:
      "A robot that tips over is expensive, and one that tips over onto a person is " +
      "worse. The capture point turns 'am I falling?' into arithmetic: compare it to " +
      "the footprint and you know instantly whether the ankles can cope, whether the " +
      "base must lunge, or whether the fall is unrecoverable and the remaining job is " +
      "to fail gracefully — tuck the arm, warn, and stop fighting.",
    tags: ["safety", "control", "critical"],
    risk: "critical",
    requires: ["drive", "imu"],
    // The one capability where a missing sensor is unambiguous: a robot cannot
    // catch a fall it cannot measure. A dead IMU used to read as a perfectly
    // upright robot, which produced "caught the fall, peak lean 0.0°" from a robot
    // lying flat on the floor. It refuses rather than reporting that again.
    evidence: [
      {
        source: "imu" as const,
        because: "tilt and tilt rate are the entire input to the capture-point calculation",
        maxAgeMs: 200,
      },
      {
        source: "velocity" as const,
        because: "the recovery drives the base under the centre of mass and has to know its speed",
      },
    ],
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Holds to a 1.6 rad/s shove and fails at 2.0, ten seeds per level with intervals. At " +
        "n=10 nothing under about 50 percentage points apart is distinguishable, which is stated " +
        "in the demo rather than rounded away. Simulated inverted pendulum only.",
      verification:
        "This is the one that should not be verified by pushing a real robot until somebody has " +
        "rehearsed the catch in simulation with that robot's measured mass and centre-of-mass " +
        "height. Then, on a tether, apply a measured impulse and compare peak lean against the " +
        "predicted capture point.",
      failureModes: [
        "Centre-of-mass height and foot half-length are platform constants; wrong ones make the " +
          "capture point wrong in the direction that says a lost fall is recoverable.",
        "Past the tip angle the drive needs emergency torque the platform may not have, in which " +
          "case the manoeuvre is computed, commanded and does not happen.",
        "A frozen IMU reports a constant tilt, which looks like a stable lean rather than a " +
          "sensor that has stopped — freshness is checked for exactly this.",
      ],
      degradedModes: [
        "None. There is no useful half-measure between measuring the fall and not measuring it, " +
          "so this refuses rather than bracing on a guess.",
      ],
      safetyBoundary:
        "Braces when the fall is past recovery instead of continuing to drive, and never uses " +
        "emergency acceleration outside the tip angle.",
    },
    typicalDurationMs: 2000,
    inputSchema: {
      type: "object",
      properties: {
        comHeight: { type: "number", description: "Centre-of-mass height, m.", default: 0.55 },
        footHalf: { type: "number", description: "Support half-length, m.", default: 0.11 },
        maxLungeSpeed: { type: "number", description: "Lunge speed cap, m/s.", default: 1.2 },
        fallAngle: { type: "number", description: "Unrecoverable lean, rad.", default: 0.6 },
        timeoutMs: { type: "number", description: "Stop trying after this long.", default: 6000 },
      },
      required: [],
    },
  },

  async run(input, ctx): Promise<AbilityResult<BalanceReport>> {
    const comHeight = input.comHeight ?? 0.55;
    const footHalf = input.footHalf ?? 0.11;
    const maxLunge = input.maxLungeSpeed ?? 1.2;
    const fallAngle = input.fallAngle ?? 0.6;
    const timeoutMs = input.timeoutMs ?? 6000;

    const omega0 = Math.sqrt(9.81 / comHeight);
    // The footprint expressed as an angle — the ankle's entire authority.
    const supportAngle = Math.asin(clamp(footHalf / comHeight, 0, 1));

    const started = ctx.now();
    const startPose = ctx.robot.pose();

    let strategy: BalanceReport["strategy"] = "none";
    let peakTilt = 0;
    let peakCapture = 0;
    let settledFor = 0;

    ctx.robot.setLights("balance", "#f97316");

    // A stalled IMU reads as perfectly upright, and this ability would then
    // report a triumphant recovery of a robot lying on the floor. Measured
    // before this check existed: tilted 90 degrees, flat on the ground, and the
    // summary said "caught it with the ankle strategy, peak lean 0.0 degrees".
    //
    // The timestamp is the tell. A driver that has stopped republishes its last
    // sample, or its initialisation values, and the numbers look entirely
    // plausible — level, still, fine. Only the clock gives it away.
    let lastImuStamp = ctx.robot.imu().t;
    let stalledTicks = 0;

    while (!ctx.signal.aborted) {
      const imu = ctx.robot.imu();

      if (imu.t === lastImuStamp) {
        stalledTicks += 1;
        // Several ticks with no new sample is not a slow sensor, it is a stopped
        // one. Balance cannot be assessed without it, and claiming otherwise is
        // worse than failing.
        if (stalledTicks > 10) {
          ctx.robot.stop();
          ctx.emit({
            kind: "warn",
            message: "IMU is not producing new samples — refusing to judge balance from a stale reading.",
          });
          return {
            ...finish(false, "precondition"),
            summary:
              `The IMU has not produced a new sample in ${stalledTicks} control ticks, so the ` +
              "tilt reading is stale. A stalled IMU reads as perfectly upright, which is why this " +
              "refuses rather than reporting a recovery it cannot see.",
          };
        }
      } else {
        stalledTicks = 0;
        lastImuStamp = imu.t;
      }

      const capture = imu.tilt + imu.tiltRate / omega0;

      peakTilt = Math.max(peakTilt, Math.abs(imu.tilt));
      peakCapture = Math.max(peakCapture, Math.abs(capture));

      // Settled: upright, still, and staying that way for a moment.
      if (Math.abs(imu.tilt) < 0.02 && Math.abs(imu.tiltRate) < 0.08) {
        settledFor += 20;
        if (settledFor >= 300) {
          ctx.robot.stop();
          return finish(true);
        }
      } else {
        settledFor = 0;
      }

      if (Math.abs(imu.tilt) > fallAngle) {
        // Lost. Stop fighting: let go of the wheels, pull the arm in so it is
        // not the thing that hits the floor, and say so.
        strategy = "brace";
        ctx.robot.stop();
        ctx.robot.moveArm({ x: 0.22, y: 0 }, 0.15);
        ctx.robot.setGripper(1, 4);
        ctx.robot.setLights("alarm", "#ef4444");
        ctx.robot.say("Falling — stand clear. انتبه، عم أوقع.");
        ctx.emit({ kind: "warn", message: "Fall unrecoverable — bracing." });
        ctx.safety.emergencyStop("robot is falling");
        return finish(false);
      }

      if (Math.abs(capture) <= supportAngle * 0.8) {
        // Inside the footprint: the low-level ankle controller has this. The
        // worst thing to do here is add base motion and make it oscillate.
        if (strategy === "none") strategy = "ankle";
        ctx.robot.drive(0, 0);
      } else {
        strategy = "lunge";
        // Drive the base toward the fall. Gains chosen so the base arrives
        // under the capture point without overshooting into the opposite fall.
        const command = clamp(3.2 * capture + 0.9 * imu.tilt, -maxLunge, maxLunge);

        // Lunging into a wall is worse than tipping over.
        const clearance = nearestObstacle(ctx.robot.lidar());
        const safeCommand = command > 0 && clearance < 0.45 ? 0 : command;
        if (safeCommand !== command) {
          ctx.emit({
            kind: "warn",
            message: `Lunge blocked by geometry at ${clearance.toFixed(2)} m — holding.`,
          });
        }

        ctx.robot.drive(safeCommand, 0);
        ctx.emit({
          kind: "metric",
          name: "balance.capturePoint",
          value: capture,
          unit: "rad",
        });
      }

      if (ctx.now() - started > timeoutMs) {
        ctx.robot.stop();
        return finish(false, "timeout");
      }

      await ctx.sleep(20);
    }

    ctx.robot.stop();
    return finish(false, "aborted");

    function finish(
      recovered: boolean,
      failure?: AbilityResult["failure"],
    ): AbilityResult<BalanceReport> {
      const pose = ctx.robot.pose();
      const drift = Math.hypot(pose.x - startPose.x, pose.y - startPose.y);
      const report: BalanceReport = {
        strategy,
        peakTilt,
        peakCapturePoint: peakCapture,
        recoveryMs: ctx.now() - started,
        drift,
        recovered,
      };
      ctx.robot.setLights("idle", "#3b82f6");
      ctx.emit({ kind: "metric", name: "balance.peakTilt", value: peakTilt, unit: "rad" });

      return {
        ok: recovered,
        summary: recovered
          ? `Caught it with the ${strategy} strategy — peak lean ${(peakTilt * 57.3).toFixed(1)}°, recovered in ${report.recoveryMs} ms after drifting ${drift.toFixed(2)} m.`
          : strategy === "brace"
            ? `Fall was unrecoverable at ${(peakTilt * 57.3).toFixed(1)}° — braced, tucked the arm and warned.`
            : `Did not stabilise within ${timeoutMs} ms (peak lean ${(peakTilt * 57.3).toFixed(1)}°).`,
        failure: recovered ? undefined : (failure ?? "gave-up"),
        data: report,
        metrics: { peakTilt, drift, recoveryMs: report.recoveryMs },
      };
    }
  },
};
