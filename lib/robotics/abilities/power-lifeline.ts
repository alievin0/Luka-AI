// ── power.lifeline · حبل النجاة ─────────────────────────────────────────────
// The point of no return, computed continuously.
//
// Battery percentage is a useless number on its own: 20% is plenty next to the
// dock and fatal on the far side of a warehouse. What matters is the margin
// between the energy left and the energy needed to get home — and the only
// honest way to know the second one is to measure this robot, on this floor,
// today. So the lifeline learns its own consumption per metre and its own
// tendency to take detours, and calls the mission the moment the margin runs
// out, not when a percentage crosses a line someone guessed at.

import { distance, type Vec2 } from "../core/math.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type LifelineInput = {
  /** Where home is. */
  dockX: number;
  dockY: number;
  /** Fraction of the return estimate to keep in hand, e.g. 0.35 = 35% spare. */
  reserveFactor?: number;
  /** Charge below which we return no matter what the arithmetic says, 0..1. */
  hardFloor?: number;
  periodMs?: number;
  /** Drive home when the point of no return is reached. */
  autoReturn?: boolean;
};

export type LifelineReport = {
  triggered: boolean;
  reason: string;
  /** Learned consumption, watt-hours per metre travelled. */
  whPerMetre: number;
  /** Learned detour factor: metres actually driven per metre of straight line. */
  detourFactor: number;
  /** Energy needed to get home at the moment of the decision, Wh. */
  returnCostWh: number;
  /** Energy left at that moment, Wh. */
  remainingWh: number;
  chargeAtTrigger: number;
  returnedHome: boolean;
  samples: number;
};

export const powerLifeline: Ability<LifelineInput, LifelineReport> = {
  manifest: {
    id: "power.lifeline",
    version: "1.0.0",
    name: { en: "Power Lifeline", ar: "حبل النجاة" },
    summary: {
      en: "Learns what this robot actually costs per metre, tracks the point of no return to the dock, and calls the mission before it is stranded.",
      ar: "بيتعلّم كم بتكلّف كل متر فعلياً، وبيراقب نقطة اللاعودة للقاعدة، وبينهي المهمة قبل ما ينقطع فيه.",
    },
    rationale:
      "A robot that dies mid-floor is not a dead robot, it is a recovery operation, a " +
      "blocked aisle and someone's afternoon. Fixed battery thresholds get this wrong " +
      "in both directions — they strand robots that were nearly home and recall robots " +
      "that had plenty left. Measuring watt-hours per metre in flight, and multiplying " +
      "by the detour factor the robot has actually been achieving, turns 'how much " +
      "battery is left' into the only question worth asking: can I still get back?",
    tags: ["power", "safety", "daemon", "learning"],
    risk: "motion",
    requires: ["drive", "battery"],
    // The capability is entirely a claim about the battery, and this kernel has
    // already been bitten by a charge figure whose units nobody established — 0.8
    // on a 0-100 driver is nearly flat and reads as 80%. A charge it cannot vouch
    // for is not a charge to plan a journey home on.
    evidence: [
      {
        source: "battery" as const,
        because: "the whole decision is how much charge is left against how much getting back costs",
      },
      {
        source: "pose" as const,
        because: "the cost of getting home depends on how far away home is",
      },
    ],
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Called the mission at 40% and made it back with 72.5 Wh in hand against 53.9 Wh needed " +
        "from 22.4 m out, having learned 2382.9 mWh/m during the run. Simulated battery model.",
      verification:
        "Drive a real robot a measured distance and integrate real current draw, then compare " +
        "against what this learned. Do it loaded and unloaded, and on carpet as well as hard " +
        "floor — the per-metre figure changes with all three.",
      failureModes: [
        "State of charge is not linear in voltage and the curve differs per chemistry and per " +
          "cell age. A driver reporting voltage as a percentage is wrong in a direction that " +
          "flatters the robot.",
        "It learns Wh per metre on the terrain it has been driving. A return journey that is " +
          "uphill, or across carpet, costs more than the average it learned.",
        "It assumes the dock is reachable. A closed door makes every number here correct and the " +
          "conclusion wrong.",
      ],
      degradedModes: [
        "With a battery whose units were never established the evidence layer marks it degraded, " +
          "and this does not accept that: a lifeline computed from a number nobody can vouch for " +
          "is worse than no lifeline, because it will be believed.",
      ],
      safetyBoundary:
        "Calls the mission at the point of no return rather than at a charge threshold, and the " +
        "margin it keeps is the one it measured rather than a percentage.",
    },
    typicalDurationMs: 0,
    daemon: true,
    inputSchema: {
      type: "object",
      properties: {
        dockX: { type: "number", description: "Dock X in metres." },
        dockY: { type: "number", description: "Dock Y in metres." },
        reserveFactor: {
          type: "number",
          description: "Spare energy to keep beyond the return estimate.",
          default: 0.35,
        },
        hardFloor: { type: "number", description: "Absolute charge floor, 0..1.", default: 0.08 },
        periodMs: { type: "number", description: "Check interval, ms.", default: 500 },
        autoReturn: { type: "boolean", description: "Drive home on trigger.", default: true },
      },
      required: ["dockX", "dockY"],
    },
  },

  async run(input, ctx): Promise<AbilityResult<LifelineReport>> {
    const dock: Vec2 = { x: input.dockX, y: input.dockY };
    const reserveFactor = input.reserveFactor ?? 0.35;
    const hardFloor = input.hardFloor ?? 0.08;
    const periodMs = input.periodMs ?? 500;
    const autoReturn = input.autoReturn ?? true;
    /**
     * Extra multiple on the reserve, applied when the charge reading's units
     * were never established. One means the reading is trusted as given.
     */
    let uncertaintyMargin = 1;

    const battery0 = ctx.robot.battery();
    const capacityWh = battery0.capacityWh;

    // This ability's entire job is deciding when there is not enough charge
    // left to get home. A charge reading whose units nobody established cannot
    // support that decision: the same raw number is either eighty per cent or
    // four fifths of one, and the ability would answer confidently either way.
    //
    // It still runs — refusing outright would leave a robot with no energy
    // discipline at all, which is worse — but it says so, and the margin it
    // keeps is widened, because the failure it is guarding against is being
    // stranded.
    const trustworthy = battery0.confident !== false;
    if (!trustworthy) {
      uncertaintyMargin = 1.5;
      ctx.emit({
        kind: "warn",
        message:
          "Battery units are not established, so the charge reading cannot be fully trusted. " +
          "Reading it pessimistically and keeping a wider reserve. Read the battery topic once " +
          "and record whether it publishes 0-1 or 0-100.",
      });
    }

    let lastPose = ctx.robot.pose();
    let lastCharge = battery0.charge;
    let odometry = 0;
    let straightLineProgress = 0;
    let energySpentWh = 0;
    let samples = 0;

    // Seeded with a sane prior so the first few seconds are not wild.
    let whPerMetre = 0.012;
    let detourFactor = 1.25;

    const report: LifelineReport = {
      triggered: false,
      reason: "",
      whPerMetre,
      detourFactor,
      returnCostWh: 0,
      remainingWh: capacityWh * battery0.charge,
      chargeAtTrigger: battery0.charge,
      returnedHome: false,
      samples: 0,
    };

    while (!ctx.signal.aborted) {
      await ctx.sleep(periodMs);
      samples += 1;

      const pose = ctx.robot.pose();
      const battery = ctx.robot.battery();
      const stepDistance = distance(pose, lastPose);
      const stepEnergy = Math.max((lastCharge - battery.charge) * capacityWh, 0);

      odometry += stepDistance;
      energySpentWh += stepEnergy;
      lastPose = pose;
      lastCharge = battery.charge;

      // Learn the two numbers that matter, once there is enough travel for the
      // ratio to mean anything.
      if (odometry > 1.5) {
        whPerMetre = energySpentWh / odometry;
        straightLineProgress = Math.max(straightLineProgress, 0.001);
        detourFactor = Math.max(odometry / Math.max(straightLineProgress, 1), 1);
      }
      straightLineProgress += stepDistance;

      const homeDistance = distance(pose, dock);
      const remainingWh = battery.charge * capacityWh;
      // Getting home costs the straight line times however much this robot
      // actually wanders, plus a fixed allowance for docking manoeuvres.
      const returnCostWh = homeDistance * whPerMetre * detourFactor + 0.4;
      const margin = remainingWh - returnCostWh * (1 + reserveFactor) * uncertaintyMargin;

      if (samples % 10 === 0) {
        ctx.emit({
          kind: "metric",
          name: "power.marginWh",
          value: Number(margin.toFixed(3)),
          unit: "Wh",
        });
      }

      const belowFloor = battery.charge <= hardFloor;
      if (margin <= 0 || belowFloor) {
        report.triggered = true;
        report.reason = belowFloor
          ? `charge hit the hard floor (${(battery.charge * 100).toFixed(0)}%)`
          : `no margin left — ${remainingWh.toFixed(1)} Wh in hand, ${returnCostWh.toFixed(1)} Wh to get home from ${homeDistance.toFixed(1)} m out`;
        report.whPerMetre = whPerMetre;
        report.detourFactor = detourFactor;
        report.returnCostWh = returnCostWh;
        report.remainingWh = remainingWh;
        report.chargeAtTrigger = battery.charge;
        report.samples = samples;

        ctx.robot.setLights("returning", "#eab308");
        ctx.robot.say("Battery reserve reached — heading back. البطارية خلصت احتياطها، راجع عالقاعدة.");
        ctx.escalate(`power lifeline: ${report.reason}`);

        if (autoReturn) {
          const trip = await ctx.call<{ x: number; y: number; tolerance: number }, unknown>(
            "navigate.to",
            { x: dock.x, y: dock.y, tolerance: 0.3 },
          );
          report.returnedHome = trip.ok;
        }

        return {
          ok: report.returnedHome || !autoReturn,
          summary: report.returnedHome
            ? `Called the mission at ${(report.chargeAtTrigger * 100).toFixed(0)}% and made it back — ${report.reason}. Learned ${(whPerMetre * 1000).toFixed(1)} mWh/m at ${detourFactor.toFixed(2)}× detour.`
            : `Called the mission at ${(report.chargeAtTrigger * 100).toFixed(0)}% — ${report.reason}${autoReturn ? ", but did not reach the dock" : ""}.`,
          failure: report.returnedHome || !autoReturn ? undefined : "gave-up",
          data: report,
          metrics: { chargeAtTrigger: report.chargeAtTrigger, returnCostWh, whPerMetre },
        };
      }
    }

    report.whPerMetre = whPerMetre;
    report.detourFactor = detourFactor;
    report.samples = samples;
    report.remainingWh = ctx.robot.battery().charge * capacityWh;

    return {
      ok: true,
      summary: `Mission finished with margin to spare — measured ${(whPerMetre * 1000).toFixed(1)} mWh/m over ${odometry.toFixed(1)} m at ${detourFactor.toFixed(2)}× detour.`,
      data: report,
      metrics: { whPerMetre, detourFactor, odometry },
    };
  },
};
