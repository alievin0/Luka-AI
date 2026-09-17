// ── reflex.looming · انعكاس الاقتراب ───────────────────────────────────────
// A fly's escape reflex, running on a robot's lidar.
//
// The circuit underneath this is not an analogy. It is the giant-fibre escape
// pathway of Drosophila, wired from measured connectome data: 367 cells from the
// visual projection neurons that detect looming, through the single decision
// cell that commits to escaping, down to the motor neuron that fires the jump.
// See brain/circuits/escape.ts for what in it is measured and what is modelled —
// the short version is that the wiring is measured and everything that turns
// wiring into behaviour is not.
//
// What it adds over the geometric reflex already in this kernel:
//
// `reflex.shield` computes time-to-collision from range and speed. That is the
// right calculation and it needs to know how fast the robot is going. This one
// needs no such thing. It responds to something *growing* in the visual field,
// which is a property of the world, not of the robot's own odometry. A ball
// thrown at a stationary robot has a time-to-collision the geometric reflex will
// compute correctly only if it happens to be tracking that object's velocity;
// the looming circuit sees it expand and fires.
//
// They are meant to run together. Neither replaces the safety governor.
//
// ── What this reflex does not do ───────────────────────────────────────────
//
// It does not fire for slow approaches. Measured here: below roughly 0.4 m/s of
// closing speed the Giant Fibre never reaches threshold, because the velocity
// channel is linear in expansion rate and a slow approach barely expands. This
// is true of the animal too, and for a robot it is correct — a slowly closing
// gap is the navigation stack's problem, and it has time to think. But it means
// this ability must never be described as collision avoidance. It is a startle.

import { clamp } from "../core/math.ts";
import {
  EscapeCircuit,
  ESCAPE_LATCH_MS,
  angularSize,
  timeToContact,
  type LoomingStimulus,
  type Side,
} from "../brain/circuits/escape.ts";
import type { Ability, AbilityContext, AbilityResult, LidarScan } from "../core/types.ts";

export type LoomingInput = {
  /** Control period, ms. */
  periodMs?: number;
  /**
   * Assumed radius of an approaching object, metres. The circuit needs an
   * angular size, and a lidar gives range rather than extent, so something has
   * to stand in for "how big is that". Getting it wrong scales the angular size
   * and therefore the threshold; it does not change the shape of the response.
   */
  objectRadius?: number;
  /** Ignore returns beyond this range, metres. */
  horizon?: number;
  /** How hard to back away when the circuit fires, m/s. */
  escapeSpeed?: number;
  /** Stop the mission after this many escapes. */
  escapeBudget?: number;
};

export type LoomingReport = {
  /** Times the Giant Fibre fired and the robot acted on it. */
  escapes: number;
  /** Which side each escape came from. */
  sides: Side[];
  /** Closest the tracked object got, metres. */
  minRange: number;
  /** Largest expansion rate seen, rad/s. */
  peakExpansion: number;
  /** Smallest time-to-contact seen, seconds. */
  minTimeToContact: number;
  ticks: number;
  /** Cells and synapses actually simulated, so the report is checkable. */
  circuit: { cells: number; synapses: number; contacts: number };
};

const manifest = {
  id: "reflex.looming",
  version: "1.0.0",
  name: { en: "Looming Escape Reflex", ar: "انعكاس الاقتراب" },
  summary: {
    en: "The fruit fly's giant-fibre escape circuit, wired from connectome data and driven by the robot's lidar: 367 simulated neurons that fire when something grows in the visual field, and pull the robot out of the way.",
    ar: "دائرة الهروب عند الذبابة، موصولة من بيانات الكونكتوم وبتشتغل على الليدار: ٣٦٧ خلية عصبية محاكاة بتشتعل لما شي يكبر بسرعة قدّام الروبوت، وبتسحبه من الطريق.",
  },
  rationale:
    "A robot that computes time-to-collision needs to know its own velocity and the " +
    "velocity of the thing approaching it. A looming detector needs neither: an object " +
    "on a collision course grows in the visual field at a rate that encodes the time " +
    "remaining, whatever either party is doing. Evolution found this and built it into " +
    "one of the shortest sensorimotor arcs in any nervous system — eye to jump muscle " +
    "through a single decision cell. That arc has been mapped synapse by synapse, so " +
    "it can be borrowed rather than reinvented, and a lidar measures the quantities it " +
    "consumes more directly than the eye it evolved for.",
  tags: ["safety", "daemon", "reactive", "connectome", "neuroscience"],
  risk: "critical" as const,
  requires: ["drive" as const, "lidar" as const],
  typicalDurationMs: 0,
  daemon: true,
  inputSchema: {
    type: "object" as const,
    properties: {
      periodMs: { type: "number" as const, description: "Control period, ms.", default: 20 },
      objectRadius: {
        type: "number" as const,
        description: "Assumed radius of an approaching object, metres.",
        default: 0.25,
      },
      horizon: {
        type: "number" as const,
        description: "Ignore lidar returns beyond this range, metres.",
        default: 6,
      },
      escapeSpeed: {
        type: "number" as const,
        description: "Reverse speed when the circuit fires, m/s.",
        default: 0.45,
      },
      escapeBudget: {
        type: "number" as const,
        description: "How many escapes before the mission is stopped.",
        default: 8,
      },
    },
    required: [],
  },
};

export const loomingReflex: Ability<LoomingInput, LoomingReport> = {
  manifest,

  async run(input, ctx): Promise<AbilityResult<LoomingReport>> {
    const periodMs = input.periodMs ?? 20;
    const objectRadius = input.objectRadius ?? 0.25;
    const horizon = input.horizon ?? 6;
    const escapeSpeed = input.escapeSpeed ?? 0.45;
    const budget = input.escapeBudget ?? 8;

    const circuit = new EscapeCircuit();
    const report: LoomingReport = {
      escapes: 0,
      sides: [],
      minRange: Number.POSITIVE_INFINITY,
      peakExpansion: 0,
      minTimeToContact: Number.POSITIVE_INFINITY,
      ticks: 0,
      circuit: {
        cells: circuit.compiled.stats.neurons,
        synapses: circuit.compiled.stats.edges,
        contacts: Math.round(circuit.compiled.stats.contacts),
      },
    };

    ctx.emit({
      kind: "status",
      message: `Looming reflex online: ${report.circuit.cells} cells, ${report.circuit.synapses} synapses from the fly connectome.`,
      ar: `انعكاس الاقتراب شغّال: ${report.circuit.cells} خلية و${report.circuit.synapses} مشبك من كونكتوم الذبابة.`,
    });

    let previous: { L: number; R: number } | null = null;
    let latchedUntil = -Infinity;

    while (!ctx.signal.aborted) {
      report.ticks += 1;

      const scan = ctx.robot.lidar();
      const ranges = hemifieldRanges(scan, horizon);
      report.minRange = Math.min(report.minRange, ranges.L, ranges.R);

      const dt = periodMs / 1000;
      const stimulus: Record<Side, LoomingStimulus> = { L: quiet(), R: quiet() };

      for (const side of ["L", "R"] as Side[]) {
        const range = ranges[side];
        if (!Number.isFinite(range)) continue;
        const theta = angularSize(objectRadius, range);
        const before = previous ? previous[side] : range;
        // Expansion is only meaningful against the previous frame. On the first
        // tick there is no previous frame, so the rate is zero rather than a
        // fabricated number.
        const dTheta = previous ? (theta - angularSize(objectRadius, before)) / dt : 0;
        stimulus[side] = { theta, dTheta };
        report.peakExpansion = Math.max(report.peakExpansion, dTheta);
        const ttc = timeToContact(stimulus[side]);
        if (Number.isFinite(ttc)) report.minTimeToContact = Math.min(report.minTimeToContact, ttc);
      }

      previous = ranges;

      const verdict = circuit.advance(periodMs, stimulus);
      const now = ctx.now();

      if (verdict.triggered && now >= latchedUntil) {
        // The Giant Fibre has committed. In the fly this is irreversible within
        // a few milliseconds; here it holds the wheel for a fixed window so the
        // manoeuvre completes instead of chattering against the next scan.
        latchedUntil = now + ESCAPE_LATCH_MS;
        report.escapes += 1;
        const side = verdict.side ?? "L";
        report.sides.push(side);

        // Turn away from the side that fired. When both fired, the threat is
        // ahead and there is no better side, so it reverses straight.
        const bothFired = verdict.giantFibre.L > 0 && verdict.giantFibre.R > 0;
        const turn = bothFired ? 0 : side === "L" ? -1.2 : 1.2;

        ctx.safety.takeWheel(-escapeSpeed, turn, "looming reflex: escape");
        ctx.robot.drive(-escapeSpeed, turn);
        ctx.robot.setLights("alarm", "#ef4444");

        ctx.emit({
          kind: "safety",
          level: "stop",
          reason:
            `looming escape — Giant Fibre fired on the ${side === "L" ? "left" : "right"} ` +
            `at ${((stimulus[side].theta * 180) / Math.PI).toFixed(0)}° angular size, ` +
            `${stimulus[side].dTheta.toFixed(1)} rad/s expansion`,
        });

        if (report.escapes >= budget) {
          ctx.emit({
            kind: "warn",
            message: `Looming reflex escaped ${report.escapes} times — whatever the robot is doing keeps putting it in front of things.`,
          });
          ctx.escalate(`looming reflex: ${report.escapes} escapes, the plan is not working`);
          break;
        }
      } else if (now >= latchedUntil && ctx.safety.wheelHeldBy() === "looming reflex: escape") {
        ctx.safety.releaseWheel();
        ctx.robot.setLights("idle", "#22c55e");
      }

      await ctx.sleep(periodMs);
    }

    if (ctx.safety.wheelHeldBy() === "looming reflex: escape") ctx.safety.releaseWheel();

    return {
      ok: true,
      summary:
        report.escapes === 0
          ? `Quiet: ${report.ticks} ticks of a ${report.circuit.cells}-cell fly circuit, nothing loomed.`
          : `${report.escapes} escape(s) from ${report.ticks} ticks. Closest approach ${report.minRange.toFixed(2)} m.`,
      data: report,
      metrics: {
        escapes: report.escapes,
        minRange: report.minRange,
        peakExpansion: report.peakExpansion,
        ticks: report.ticks,
      },
    };
  },
};

function quiet(): LoomingStimulus {
  return { theta: 0, dTheta: 0 };
}

/**
 * Closest return in each half of the scan.
 *
 * The circuit is bilateral and that is the point: two independent hemifields
 * are what make the reflex directional. Taking the nearest return per side is
 * crude compared to a fly's retinotopy, and it is the right crudeness here —
 * the thing about to hit the robot is the thing that is closest.
 */
function hemifieldRanges(scan: LidarScan, horizon: number): { L: number; R: number } {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.POSITIVE_INFINITY;
  const n = scan.ranges.length;
  if (n === 0) return { L: left, R: right };

  for (let i = 0; i < n; i += 1) {
    const range = scan.ranges[i];
    if (!Number.isFinite(range) || range <= 0 || range > horizon) continue;
    // Beam angles run from -fov/2 to +fov/2 across the scan.
    const angle = -scan.fov / 2 + (scan.fov * i) / Math.max(1, n - 1);
    // Only what is in front matters for looming; something behind the robot is
    // not growing in a field of view it does not have.
    if (Math.abs(angle) > Math.PI / 2) continue;
    if (angle < 0) left = Math.min(left, range);
    else right = Math.min(right, range);
  }

  return { L: left, R: right };
}

/** Exported for the tests, which need to drive the reflex without a rig. */
export const _internals = { hemifieldRanges, clamp };
