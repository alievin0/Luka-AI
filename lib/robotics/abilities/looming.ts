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
//
// It still has false positives while manoeuvring. Crossing a cluttered room at
// 0.8 m/s it escapes about five times in seven metres, none of which were real
// threats. The trip completes and nothing is hit, but the number is not zero
// and tuning it to zero would mean tuning away the real responses too. Two
// corrections got it this far and both are documented where they are applied:
// gating the size channel on actual expansion, in brain/circuits/escape.ts,
// and subtracting the robot's own motion, below.

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
  /**
   * Subtract the expansion the robot's own motion explains. On by default, and
   * turning it off makes the reflex escape from whatever the robot is driving
   * towards. Only useful for seeing what the raw circuit does.
   */
  cancelSelfMotion?: boolean;
};

/**
 * Where the reflex publishes what its circuit is doing, so a viewer can watch
 * it rather than take the summary on trust. Written every tick and read by
 * whoever is drawing; nothing in the reflex depends on anyone reading it.
 */
export const LOOMING_STATE_KEY = "looming:state";

export type LoomingState = {
  t: number;
  /** Mean firing rate per cell, spikes per second. */
  lc4: { L: number; R: number };
  lplc2: { L: number; R: number };
  /** Giant Fibre spikes this tick. */
  giantFibre: { L: number; R: number };
  /** Angular size and expansion rate the circuit is being driven with. */
  stimulus: { L: LoomingStimulus; R: LoomingStimulus };
  /** True while an escape is latched. */
  escaping: boolean;
  escapes: number;
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
  /**
   * Times an expansion was explained away by the robot's own motion. A large
   * number here is the reflex correctly not escaping from its own destination.
   */
  suppressedBySelfMotion: number;
  /**
   * Frames where the nearest return jumped further than anything could have
   * moved, so it was a different object rather than a closer one.
   */
  changesOfSubject: number;
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
  // The circuit is driven entirely by the scan: angular size and its rate of
  // change are computed from ranges, so a scan that has stopped reporting is a
  // circuit with no input at all rather than one seeing an empty room.
  evidence: [
    {
      source: "lidar" as const,
      because: "angular size and expansion rate are both read out of the scan",
      maxAgeMs: 300,
      acceptDegraded: true,
    },
    {
      source: "velocity" as const,
      because: "the escape direction depends on where the robot is already going",
    },
  ],
  proof: {
    status: "SIMULATED" as const,
    basis:
      "367 cells and 57,450 measured synaptic contacts from the MaleCNS v1.0 connectome. In " +
      "the fly-reflex demo it fires 0.33 m earlier than the geometric reflex and holds " +
      "time-to-contact roughly constant across approach speeds, which was not coded for. All " +
      "of it is simulated.",
    verification:
      "Approach a stationary robot with a flat panel at several constant speeds and record the " +
      "range at which it fires. Time-to-contact at firing should stay near-constant while the " +
      "range at firing changes — that is the claim, and a fixed range threshold would fail it.",
    failureModes: [
      "Tuned to the fly's own escape capability, which fires at about 0.5 m for someone walking " +
        "in at 1.5 m/s — too late for a robot that brakes more slowly than a fly jumps.",
      "It still false-positives while manoeuvring: about 5 in 7 metres across a cluttered room, " +
        "none of them real. Tuning those out removes the real responses as well.",
      "Glutamate is inhibitory in the fly, which is the opposite of the vertebrate default; a " +
        "sign error anywhere in the wiring inverts the circuit silently.",
    ],
    degradedModes: [
      "Runs on a partial scan. Fewer beams mean a coarser angular-size estimate and a later " +
        "firing, not a wrong one.",
    ],
    safetyBoundary:
      "Escapes and brakes; it never drives the robot toward anything.",
  },
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
      cancelSelfMotion: {
        type: "boolean" as const,
        description:
          "Subtract the expansion the robot's own motion explains. Off makes it escape from whatever it drives towards.",
        default: true,
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
    const cancelSelfMotion = input.cancelSelfMotion ?? true;

    const circuit = new EscapeCircuit();
    const report: LoomingReport = {
      escapes: 0,
      sides: [],
      minRange: Number.POSITIVE_INFINITY,
      peakExpansion: 0,
      minTimeToContact: Number.POSITIVE_INFINITY,
      suppressedBySelfMotion: 0,
      changesOfSubject: 0,
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
    let suppressed = 0;
    let discontinuities = 0;

    while (!ctx.signal.aborted) {
      report.ticks += 1;

      const scan = ctx.robot.lidar();
      const bearings = hemifieldRanges(scan, horizon);
      report.minRange = Math.min(report.minRange, bearings.L.range, bearings.R.range);

      const dt = periodMs / 1000;
      const velocity = ctx.robot.velocity();
      const stimulus: Record<Side, LoomingStimulus> = { L: quiet(), R: quiet() };

      for (const side of ["L", "R"] as Side[]) {
        const bearing = bearings[side];
        if (!Number.isFinite(bearing.range)) continue;
        const theta = angularSize(objectRadius, bearing.range);
        const before = previous ? previous[side] : bearing.range;
        // Expansion is only meaningful against the previous frame. On the first
        // tick there is no previous frame, so the rate is zero rather than a
        // fabricated number.
        let measured = previous ? (theta - angularSize(objectRadius, before)) / dt : 0;

        // The nearest return is not a tracked object. When the robot turns, or
        // when something passes in front of something further away, the beam
        // that was nearest is suddenly a different surface, and the range jumps.
        // That jump is not expansion — nothing grew, the robot is just looking
        // at a different thing — but it looks like enormous expansion to a
        // circuit that only sees a number getting bigger.
        //
        // Nothing can close faster than the robot's own speed plus the fastest
        // thing plausibly thrown at it, so a frame-to-frame change beyond that
        // is a change of subject rather than a change of range.
        const plausible = (Math.abs(velocity.linear) + MAX_CLOSING_SPEED) * dt;
        if (previous && Math.abs(bearing.range - before) > plausible) {
          measured = 0;
          discontinuities += 1;
        }

        // Take out what the robot's own motion accounts for. Whatever is left
        // is the object approaching under its own power, which is the only
        // thing worth escaping from.
        const ownMotion = cancelSelfMotion
          ? selfMotionExpansion(bearing, objectRadius, velocity.linear, velocity.angular)
          : 0;
        const dTheta = measured - ownMotion;
        if (measured > 0 && dTheta <= 0) suppressed += 1;

        stimulus[side] = { theta, dTheta };
        report.peakExpansion = Math.max(report.peakExpansion, dTheta);
        const ttc = timeToContact(stimulus[side]);
        if (Number.isFinite(ttc)) report.minTimeToContact = Math.min(report.minTimeToContact, ttc);
      }

      previous = { L: bearings.L.range, R: bearings.R.range };

      const verdict = circuit.advance(periodMs, stimulus);
      const now = ctx.now();

      ctx.memory.set<LoomingState>(LOOMING_STATE_KEY, {
        t: now,
        lc4: verdict.visual.lc4,
        lplc2: verdict.visual.lplc2,
        giantFibre: verdict.giantFibre,
        stimulus,
        escaping: now < latchedUntil,
        escapes: report.escapes,
      });

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

    report.suppressedBySelfMotion = suppressed;
    report.changesOfSubject = discontinuities;

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

/**
 * The fastest an object is assumed to close on the robot under its own power,
 * m/s. A thrown ball or a running person is near this; anything faster is not
 * something a reflex was going to save it from anyway.
 */
const MAX_CLOSING_SPEED = 4;

function quiet(): LoomingStimulus {
  return { theta: 0, dTheta: 0 };
}

export type Bearing = { range: number; angle: number };

/**
 * Closest return in each half of the scan, with the bearing it came from.
 *
 * The circuit is bilateral and that is the point: two independent hemifields
 * are what make the reflex directional. Taking the nearest return per side is
 * crude compared to a fly's retinotopy, and it is the right crudeness here —
 * the thing about to hit the robot is the thing that is closest.
 */
function hemifieldRanges(scan: LidarScan, horizon: number): { L: Bearing; R: Bearing } {
  const left: Bearing = { range: Number.POSITIVE_INFINITY, angle: -Math.PI / 4 };
  const right: Bearing = { range: Number.POSITIVE_INFINITY, angle: Math.PI / 4 };
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
    const side = angle < 0 ? left : right;
    if (range < side.range) {
      side.range = range;
      side.angle = angle;
    }
  }

  return { L: left, R: right };
}

/**
 * The expansion the robot's own motion accounts for, rad/s.
 *
 * A robot driving at a stationary wall sees it grow in the scan exactly like
 * something charging. Measured: without this correction the circuit fires at
 * 0.88 m to 1.22 m from a wall the robot is driving into at 0.5 to 1.2 m/s.
 * With it, never — which is the right answer, because nothing is approaching.
 *
 * The fly has the same problem and solves it the same way. Its escape pathway
 * is suppressed during self-generated optic flow by a signal derived from the
 * motor command rather than from the eye, so the animal does not startle at its
 * own flight. A robot has a cleaner version of that signal available: it knows
 * exactly what it told its wheels to do.
 *
 * For a static object at range d and bearing φ, a robot moving at v closes at
 * v·cos φ, and since θ = 2·atan(r/d), the self-generated expansion is
 * 2·r·v·cos φ / (d² + r²). Subtract it, and what is left is the object's own
 * approach. A stationary robot subtracts nothing, which is exactly right.
 */
export function selfMotionExpansion(
  bearing: Bearing,
  radius: number,
  linear: number,
  angular: number,
): number {
  const d = bearing.range;
  if (!Number.isFinite(d) || d <= 0) return 0;
  // Only translation closes range. Turning sweeps the beam across the scene,
  // which changes which object is nearest rather than how near it is, so the
  // angular rate does not enter here.
  void angular;
  const closing = linear * Math.cos(bearing.angle);
  return (2 * radius * closing) / (d * d + radius * radius);
}

/** Exported for the tests, which need to drive the reflex without a rig. */
export const _internals = { hemifieldRanges, selfMotionExpansion, clamp };
