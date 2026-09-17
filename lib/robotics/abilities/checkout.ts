// ── hardware.checkout · فحص ما قبل التشغيل ─────────────────────────────────
// The first thing to run on a real robot, and the thing that should refuse.
//
// Everything else in this kernel assumes its senses work and its brakes work.
// On a simulator those are true by construction. On a machine they are claims,
// and the moment they stop being true is not announced — a lidar driver that
// has frozen returns the same scan forever, which reads as a perfectly still
// world, which reads as "safe to drive".
//
// So this checks the assumptions the rest of the stack is built on, in an order
// chosen so that nothing moves until the things that would stop it have been
// shown to work.

import {
  auditProfile,
  linkSupportsControl,
  validateProfile,
  type RobotProfile,
} from "../hal/profile.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type CheckoutInput = {
  /** Skip the checks that command motion. Use it for the very first run. */
  staticOnly?: boolean;
  /** How long to watch each sensor for signs of life, ms. */
  observeMs?: number;
  /** Refuse if the battery is below this, 0..1. */
  minCharge?: number;
};

export type Check = {
  name: string;
  /** `fail` blocks the robot; `warn` is worth knowing and does not block. */
  status: "pass" | "warn" | "fail";
  detail: string;
};

export type CheckoutReport = {
  checks: Check[];
  passed: number;
  warnings: number;
  failures: number;
  /** Whether the robot should be allowed to run a mission. */
  cleared: boolean;
};

export const hardwareCheckout: Ability<CheckoutInput, CheckoutReport> = {
  manifest: {
    id: "hardware.checkout",
    version: "1.0.0",
    name: { en: "Pre-flight Checkout", ar: "فحص ما قبل التشغيل" },
    summary: {
      en: "Tests the assumptions every other ability is built on — that the senses are live and moving, that the brakes work, that the emergency stop is obeyed — and refuses to clear the robot when one fails.",
      ar: "بيختبر الافتراضات اللي كل القدرات التانية مبنية عليها — إنو الحواس شغّالة وبتتغيّر، والفرامل بتشتغل، وزر الطوارئ مسموع — وبيرفض يعطي الإذن إذا وحدة فشلت.",
    },
    rationale:
      "A frozen sensor is more dangerous than a dead one: a lidar driver that has " +
      "stopped updating returns the same scan forever, which reads as a perfectly still " +
      "world, which reads as safe to drive. Nothing announces it. The same goes for a " +
      "brake that does not bite and an emergency stop nobody has pulled since it was " +
      "wired. These are the assumptions every other ability inherits, they are free to " +
      "test, and testing them is the difference between a robot that fails safely and " +
      "one that discovers the problem by driving into something.",
    tags: ["safety", "hardware", "diagnostics"],
    risk: "motion",
    requires: [],
    typicalDurationMs: 6000,
    inputSchema: {
      type: "object",
      properties: {
        staticOnly: {
          type: "boolean",
          description: "Skip the checks that move the robot.",
          default: false,
        },
        observeMs: {
          type: "number",
          description: "How long to watch each sensor, ms.",
          default: 600,
        },
        minCharge: { type: "number", description: "Refuse below this charge.", default: 0.15 },
      },
      required: [],
    },
  },

  async run(input, ctx): Promise<AbilityResult<CheckoutReport>> {
    const staticOnly = input.staticOnly ?? false;
    const observeMs = input.observeMs ?? 600;
    const minCharge = input.minCharge ?? 0.15;

    const checks: Check[] = [];
    const add = (name: string, status: Check["status"], detail: string) => {
      checks.push({ name, status, detail });
      if (status === "fail") ctx.emit({ kind: "warn", message: `${name}: ${detail}` });
    };

    const profile = ctx.memory.get<RobotProfile>("profile");

    // 1. The profile, before anything trusts it.
    if (!profile) {
      add(
        "profile",
        "warn",
        "No robot profile is loaded, so the safety model is running on defaults rather than on this machine's measurements.",
      );
    } else {
      const problems = validateProfile(profile);
      if (problems.length > 0) {
        add("profile", "fail", `${profile.id}: ${problems.join(" ")}`);
      } else if (profile.verified === "unverified") {
        add(
          "profile",
          "warn",
          `${profile.id} is marked unverified — its numbers are a hypothesis about this robot, not a measurement of it.`,
        );
      } else {
        add("profile", "pass", `${profile.id} (${profile.verified}) is internally consistent.`);
      }

      const declared = new Set(profile.capabilities);
      const actual = new Set(ctx.robot.capabilities);
      const claimed = [...declared].filter((c) => !actual.has(c));
      if (claimed.length > 0) {
        add(
          "capabilities",
          "fail",
          `The profile claims ${claimed.join(", ")} but the hardware interface does not expose it.`,
        );
      } else {
        add("capabilities", "pass", `${actual.size} capabilities, all backed by the interface.`);
      }

      // The profile can be internally consistent and still describe a machine
      // that should not be switched on at these speeds. That is a separate
      // question and it gets a separate answer.
      const findings = auditProfile(profile);
      const blocking = findings.filter((f) => f.level === "block");
      if (blocking.length > 0) {
        add("posture", "fail", blocking.map((f) => f.message).join(" "));
      } else if (findings.length > 0) {
        add("posture", "warn", findings.map((f) => f.message).join(" "));
      } else {
        add("posture", "pass", "Nothing about this configuration is known to be risky.");
      }
    }

    // 2. Are the senses alive, and are they *changing*? A frozen driver is the
    //    failure that looks most like everything being fine.
    if (ctx.robot.capabilities.includes("lidar")) {
      const first = ctx.robot.lidar();
      await ctx.sleep(observeMs);
      const second = ctx.robot.lidar();

      if (first.ranges.length === 0) {
        add("lidar", "fail", "The scan is empty — no data is arriving.");
      } else if (identical(first.ranges, second.ranges) && first.t === second.t) {
        add(
          "lidar",
          "fail",
          `Two scans ${observeMs} ms apart are bit-identical across ${first.ranges.length} beams and share a timestamp. ` +
            "The driver is frozen, and a frozen scan reads as a perfectly still world.",
        );
      } else if (identical(first.ranges, second.ranges)) {
        add(
          "lidar",
          "warn",
          `Timestamps advance but ${first.ranges.length} beams are bit-identical across ${observeMs} ms. ` +
            "That is either a noiseless simulator or a sensor repeating its last frame — on hardware, assume the second.",
        );
      } else {
        const valid = first.ranges.filter((r) => Number.isFinite(r) && r > 0).length;
        add(
          "lidar",
          valid === first.ranges.length ? "pass" : "warn",
          `${first.ranges.length} beams over ${((first.fov * 180) / Math.PI).toFixed(0)}°, ${valid} valid, updating.`,
        );
      }
    }

    if (ctx.robot.capabilities.includes("imu")) {
      const first = ctx.robot.imu();
      await ctx.sleep(observeMs / 2);
      const second = ctx.robot.imu();
      if (first.t === second.t) {
        add("imu", "fail", "The IMU timestamp is not advancing — the driver is stalled.");
      } else if (Math.abs(first.tilt) > 0.35) {
        add(
          "imu",
          "fail",
          `Reporting a ${((first.tilt * 180) / Math.PI).toFixed(0)}° lean while stationary. Either the robot is not upright or the IMU is not level.`,
        );
      } else {
        add("imu", "pass", `Upright to ${((first.tilt * 180) / Math.PI).toFixed(1)}°, timestamps advancing.`);
      }
    }

    if (ctx.robot.capabilities.includes("battery")) {
      const battery = ctx.robot.battery();
      if (battery.charge < minCharge) {
        add(
          "battery",
          "fail",
          `${(battery.charge * 100).toFixed(0)}% is below the ${(minCharge * 100).toFixed(0)}% floor for starting anything.`,
        );
      } else if (battery.capacityWh <= 0) {
        add("battery", "warn", "Capacity reads as zero, so nothing can budget energy.");
      } else {
        add(
          "battery",
          battery.charge < 0.3 ? "warn" : "pass",
          `${(battery.charge * 100).toFixed(0)}% of ${battery.capacityWh.toFixed(0)} Wh, drawing ${battery.drawWatts.toFixed(0)} W.`,
        );
      }
    }

    // 3. How fast does the loop actually close? The governor measures this
    //    continuously and widens its separation distances when the measurement
    //    is worse than the budget, so the number is already there — what this
    //    check adds is saying it out loud before a mission rather than after.
    const measured = ctx.safety.effectiveReactionTime();
    const budget = (profile?.reactionTimeMs ?? 120) / 1000;
    add(
      "latency",
      measured > budget * 1.5 ? "warn" : "pass",
      measured > budget
        ? `Sense-to-act is measuring ${(measured * 1000).toFixed(0)} ms against a ${(budget * 1000).toFixed(0)} ms budget, so the separation model has widened to match — the robot will be slower near people than the profile promised.`
        : `Sense-to-act within budget at ${(measured * 1000).toFixed(0)} ms.`,
    );

    // A related but different question: can a loop be closed across the link at
    // all? Note this is deliberately *not* fed the reaction time measured above.
    // Sense-to-act covers the whole pipeline — sensing, deciding, acting — and
    // the link is one term in it. Substituting one for the other would compare
    // a robot's thinking time against its network budget and call the result a
    // network verdict.
    //
    // The kernel has no transport-level round-trip measurement yet, so what is
    // checked here is the profile's own claim about its link, and the detail
    // says so rather than implying something was measured.
    if (profile?.link) {
      const verdict = linkSupportsControl(profile);
      add(
        "link",
        verdict.ok ? "pass" : "fail",
        verdict.ok
          ? `${profile.link.kind} link: a declared ${profile.link.maxRoundTripP99Ms} ms p99 fits inside ` +
              `the ${profile.link.controlPeriodMs} ms control period. Declared, not measured — this kernel ` +
              "does not yet time the transport itself."
          : (verdict.reason ?? ""),
      );
    }

    // 4. The emergency stop, before anything is allowed to move. If this does
    //    not work, nothing below it should be attempted.
    const wasStopped = ctx.safety.isStopped();
    ctx.safety.emergencyStop("pre-flight check");
    const latched = ctx.safety.isStopped();
    const refusedContact = !ctx.safety.permitContact("pre-flight check");
    if (!wasStopped) ctx.safety.clearEmergencyStop();

    if (!latched || !refusedContact) {
      add(
        "emergency-stop",
        "fail",
        "The emergency stop did not latch, or contact was still permitted while it was latched.",
      );
    } else {
      add("emergency-stop", "pass", "Latches, and refuses contact while latched.");
    }

    // 5. Only now, motion — and the only thing being tested is stopping.
    if (staticOnly) {
      add("brakes", "warn", "Skipped: static-only run, so the brakes are untested.");
    } else if (!ctx.robot.capabilities.includes("drive")) {
      add("brakes", "warn", "No drive to test.");
    } else if (ctx.safety.isStopped()) {
      add("brakes", "fail", "An emergency stop is latched — clear it before testing motion.");
    } else {
      ctx.emit({
        kind: "status",
        message: "Creeping forward briefly to check the brakes bite…",
        ar: "رح يتحرّك شوي بس لأتأكد إنو الفرامل بتمسك…",
      });

      // Renew the command rather than issuing it once and sleeping. Commanding
      // a speed and then waiting relies on the order standing while nothing
      // repeats it, which is the thing the deadman exists to stop — and on a
      // guarded robot that turns this into a test of the guard rather than of
      // the brakes.
      for (let elapsed = 0; elapsed < 700; elapsed += 50) {
        ctx.robot.drive(0.12, 0);
        await ctx.sleep(50);
      }
      const moving = Math.abs(ctx.robot.velocity().linear);

      ctx.robot.stop();
      await ctx.sleep(700);
      const afterStop = Math.abs(ctx.robot.velocity().linear);

      if (moving < 0.01) {
        add(
          "drive",
          "warn",
          "Commanded 0.12 m/s and nothing moved. Either the wheels are blocked, the motors are disabled, or the governor is holding the robot.",
        );
      } else {
        add("drive", "pass", `Reached ${moving.toFixed(2)} m/s under a 0.12 m/s command.`);
      }

      if (afterStop > 0.02) {
        add(
          "brakes",
          "fail",
          `Still moving at ${afterStop.toFixed(2)} m/s ${700} ms after a stop command. Do not run missions on this.`,
        );
      } else {
        add("brakes", "pass", "Came to rest within 700 ms of the stop command.");
      }

      // 6. The failure that actually hurts people: a command that outlives
      //    whatever sent it. This is measured rather than asserted — the robot
      //    is told to move, then abandoned, and what happens next is recorded.
      if (!ctx.safety.isStopped()) {
        const timeoutMs = profile?.link?.robotSideWatchdogMs ?? 300;

        if (ctx.deadman) {
          // There is a real guard on the command path, so test that one. A
          // stand-in built here would test itself and tell you nothing about
          // what is actually protecting the robot.
          const before = ctx.deadman.expiries();
          ctx.robot.drive(0.12, 0);
          await ctx.sleep(300);
          const beforeAbandon = Math.abs(ctx.robot.velocity().linear);

          // Stop renewing it, as a dead sender would.
          await ctx.sleep(timeoutMs + 600);
          const afterAbandon = Math.abs(ctx.robot.velocity().linear);

          if (ctx.deadman.expiries() === before) {
            add(
              "deadman",
              "fail",
              `A velocity command was left unrenewed for ${timeoutMs + 600} ms and the guard did ` +
                "not notice. A command that outlives its sender is how a robot drives into someone " +
                "after the process that was steering it has already died.",
            );
          } else if (!ctx.deadman.isLatched()) {
            add(
              "deadman",
              "fail",
              "The stale command was noticed but nothing latched, so the next command would resume " +
                "motion with nobody having decided that it should.",
            );
          } else if (afterAbandon > 0.02) {
            add(
              "deadman",
              "fail",
              `The stale command latched but the robot is still moving at ${afterAbandon.toFixed(2)} m/s.`,
            );
          } else {
            add(
              "deadman",
              "pass",
              `An abandoned ${beforeAbandon.toFixed(2)} m/s command expired and the base latched ` +
                "stopped. It will not resume without a deliberate re-arm.",
            );
          }

          // Leave the robot usable: the latch was this check's doing, and the
          // wheels have stopped.
          const rearmed = ctx.deadman.rearm();
          if (!rearmed.ok) {
            add("deadman", "warn", `Could not re-arm after the test: ${rearmed.reason}`);
          }
        } else {
          add(
            "deadman",
            "warn",
            "Nothing makes velocity commands expire on this robot. That is correct for an " +
              "in-process simulator, where the sender cannot die separately from the robot. On " +
              "anything reached over a link, it means the last command stands forever.",
          );
        }
      }
    }

    const failures = checks.filter((c) => c.status === "fail").length;
    const warnings = checks.filter((c) => c.status === "warn").length;
    const passed = checks.filter((c) => c.status === "pass").length;

    const report: CheckoutReport = {
      checks,
      passed,
      warnings,
      failures,
      cleared: failures === 0,
    };

    ctx.memory.set("checkout:last", { at: ctx.now(), cleared: report.cleared, failures });
    ctx.emit({ kind: "metric", name: "checkout.failures", value: failures });

    const worst = checks.find((c) => c.status === "fail");
    return {
      ok: report.cleared,
      summary: report.cleared
        ? `Cleared: ${passed} checks passed${warnings ? `, ${warnings} worth reading` : ""}.`
        : `Not cleared — ${failures} check(s) failed. First: ${worst?.name} — ${worst?.detail}`,
      failure: report.cleared ? undefined : "precondition",
      data: report,
      metrics: { passed, warnings, failures },
    };
  },
};

function identical(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

