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
    // Deliberately declares no evidence requirements, and this is the one place
    // that omission is correct rather than an oversight.
    //
    // The capability gate refuses a capability whose sensors are absent, invalid or
    // stale. This is the capability whose entire job is to find out whether the
    // sensors are absent, invalid or stale. Gate it on the lidar working and a
    // robot with a dead lidar cannot run the check that would tell anyone the lidar
    // is dead — the diagnosis becomes available exactly when it is not needed.
    //
    // So it reads every channel directly and reports what it finds, including
    // nothing. Its twelve gates are the evidence model applied by hand, in an order
    // where nothing moves until whatever would stop it has been proven to work.
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Twelve gates run in the simulator, including the last one, which is measured rather " +
        "than asserted: it drives the robot, abandons the command, and records whether the " +
        "wheels stopped. Wiring the deadman in caught this ability itself relying on a latched " +
        "command.",
      verification:
        "This is the one that is verified by running it on the hardware, which is the point of " +
        "it. The order is the specification: `lib/robotics/BRINGUP.md` walks through what should " +
        "fail at each step and what it means when it does not.",
      failureModes: [
        "It checks the channels a robot declares. A sensor nobody put in the profile is not " +
          "missing as far as this is concerned.",
        "The clock gate separates a constant offset from a drift, and reports the drift first " +
          "because it is the cause — but it can only see the drift over the window it watches.",
        "Passing means the robot's senses agreed with themselves on a stationary robot in one " +
          "place at one moment. It says nothing about a robot that has been driven for an hour.",
      ],
      degradedModes: [
        "It is the diagnosis, so it does not degrade — it reports degradation. A gate that " +
          "cannot be answered is reported as unanswered rather than passed.",
      ],
      safetyBoundary:
        "Nothing moves until the gates that would stop it have passed, and the drive test is " +
        "bounded by the deadman it is testing.",
    },
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

    // 3a. Is the link carrying traffic in both directions at all?
    //
    //     A transport that cannot decode what arrives, or cannot deliver what
    //     is sent, produces a robot that looks obedient and inert. Commands
    //     return normally with nothing sent; topics stay silent with nothing
    //     reported. Either way this process and the robot have stopped agreeing
    //     about what is happening, and that is not a state to drive in.
    const transport = ctx.robot as {
      transportProblems?: () => number;
      isConnected?: () => boolean;
      inbound?: () => { everReceived: boolean; silentForMs: number };
      advertisedTopics?: (timeoutMs?: number) => Promise<Set<string> | null>;
      missingTopics?: () => string[] | null;
    };
    if (typeof transport.transportProblems === "function") {
      const problems = transport.transportProblems();
      const connected = transport.isConnected?.() ?? true;
      const inbound = transport.inbound?.() ?? { everReceived: true, silentForMs: 0 };

      // Ask the robot what it publishes before blaming a sensor for silence.
      // rosbridge accepts a subscription to any name, so a typo produces
      // exactly the silence a dead sensor produces — and gets debugged as one.
      if (connected && typeof transport.advertisedTopics === "function") {
        await transport.advertisedTopics(2000);
      }
      const missing = transport.missingTopics?.() ?? null;

      if (!connected) {
        add("transport", "fail", "There is no connection to the robot. Nothing sent will arrive.");
      } else if (!inbound.everReceived) {
        add(
          "transport",
          "fail",
          `The socket is open and nothing has ever arrived on it (${inbound.silentForMs.toFixed(0)} ms ` +
            "so far). An open socket is not a working link: a connection that half-closes keeps " +
            "accepting sends and never delivers them, and never errors either.",
        );
      } else if (missing && missing.length > 0) {
        add(
          "transport",
          "fail",
          `The robot does not publish ${missing.join(", ")}. These are subscribed and will stay ` +
            "silent forever, which is indistinguishable from the sensors being dead — check the " +
            "topic names before replacing any hardware.",
        );
      } else if (missing === null && connected) {
        add(
          "transport",
          "warn",
          "The robot did not answer /rosapi/topics, so the topic names in this profile are " +
            "unverified. A name that is wrong will look like a sensor that is broken.",
        );
      } else if (problems > 0) {
        add(
          "transport",
          "fail",
          `${problems} message(s) could not be decoded or delivered. A link that drops traffic ` +
            "makes a robot look obedient and inert — commands return normally having gone nowhere.",
        );
      } else {
        add("transport", "pass", "The link is carrying traffic in both directions.");
      }
    }

    // 3b. Do the robot's clocks agree with each other?
    //
    //     This is the failure that most often shows up as "navigation does not
    //     work". A robot is usually several computers — a base, a sensor
    //     controller, the machine running this — and each stamps its messages
    //     with its own clock. When those clocks disagree, a scan arrives
    //     describing a moment the pose estimate has not reached yet, the
    //     transform lookup fails or silently extrapolates, and the symptom is a
    //     map that tears, an obstacle that smears, or a robot that will not
    //     plan. Nothing in any of that says "clock".
    //
    //     Two separate faults are worth telling apart: a constant offset, which
    //     is merely wrong, and a drift, which is wrong at a rate and will be
    //     fine this morning and broken this afternoon.
    const skews: number[] = [];
    let unstamped = 0;
    for (let i = 0; i < 5; i += 1) {
      const t = ctx.now();
      for (const sample of [
        ctx.robot.capabilities.includes("lidar") ? ctx.robot.lidar() : null,
        ctx.robot.capabilities.includes("imu") ? ctx.robot.imu() : null,
      ]) {
        if (!sample) continue;
        // A reading the robot did not stamp carries this machine's own clock,
        // so comparing it against this machine's clock measures zero by
        // construction. That is not agreement, it is the question going
        // unasked — and it is exactly how this gate passed a robot five
        // minutes out while its own tests were green.
        if (sample.stamp === "arrival") unstamped += 1;
        else skews.push(sample.t - t);
      }
      await ctx.sleep(observeMs / 5);
    }

    if (unstamped > 0) {
      add(
        "clock",
        "fail",
        `${unstamped} reading(s) arrived with no timestamp from the robot, so there is nothing to ` +
          "compare this machine's clock against. Arrival time is this machine's clock on both " +
          "sides of the comparison and would report perfect agreement no matter how far out the " +
          "robot is. Publish header stamps before trusting anything built on sensor time.",
      );
    } else if (skews.length === 0) {
      add("clock", "warn", "No timestamped sensor to compare clocks against.");
    } else {
      const worst = Math.max(...skews.map(Math.abs));
      // Drift is the change in skew across the window, which separates a clock
      // that is offset from one that is running at a different rate.
      const drift = Math.abs(skews[skews.length - 1] - skews[0]);

      // Drift is reported ahead of offset even when both are out, because a
      // clock running at the wrong rate is what *produces* a growing offset.
      // Reporting the offset alone sends someone off to correct a number that
      // will be wrong again by the time they have finished.
      if (drift > 10) {
        add(
          "clock",
          "fail",
          `Clock offset moved ${drift.toFixed(0)} ms during a ${observeMs} ms window` +
            (worst > 50 ? `, and is currently ${worst.toFixed(0)} ms out` : "") +
            ". The clocks are running at different rates rather than merely disagreeing, so " +
            "correcting the offset will not hold. This works now and stops working later, which " +
            "is the worst way for it to fail.",
        );
      } else if (worst > 50) {
        add(
          "clock",
          "fail",
          `Sensor timestamps are ${worst.toFixed(0)} ms away from this machine's clock. ` +
            "Above about 50 ms the transform between a scan and a pose is being extrapolated " +
            "rather than looked up, and every failure that causes gets blamed on something else. " +
            "Synchronise the clocks before trusting anything built on top of them.",
        );
      } else {
        add(
          "clock",
          "pass",
          `Sensor timestamps within ${worst.toFixed(0)} ms of this machine's clock, drifting ${drift.toFixed(0)} ms.`,
        );
      }
    }

    // 3c. How fast does the loop actually close? The governor measures this
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

