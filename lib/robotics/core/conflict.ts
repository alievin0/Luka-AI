// When the robot's senses disagree about the same physical fact.
//
// Every other check in this kernel asks whether one channel is working. This
// one asks whether two channels that must agree actually do. The difference
// matters because the most dangerous sensor failures are the ones where the
// reading is perfectly well-formed, fresh, complete, and wrong — a wheel
// encoder counting turns of a wheel that is spinning in place, an IMU that has
// been knocked loose, odometry that is confidently integrating a slip.
//
// None of those are caught by asking "is this channel reporting". All of them
// are caught by asking "does this channel agree with the other one that
// measures the same thing".
//
// ── A conflict needs two independent measurements of one quantity ───────────
//
// This is the whole design constraint, and it is what keeps the file from
// becoming a bag of thresholds. Each detector below names a physical quantity
// and two paths to it that do not share a sensor:
//
//   turning      wheel odometry ←→ IMU gyro
//   self-motion  wheel odometry ←→ how the world moves through the scan
//   obedience    what was commanded ←→ what the body did
//
// Two estimates of one quantity disagreeing is evidence. One estimate crossing
// a threshold is a preference.
//
// ── What this does not do ──────────────────────────────────────────────────
//
// It does not adjudicate. Given an encoder saying the robot is turning and a
// gyro saying it is not, this reports that they disagree and which capabilities
// depend on the answer; it does not pick a winner, because picking one is how a
// robot ends up confidently navigating on the broken sensor. Choosing is the
// caller's job and it should usually choose to slow down.
//
// ── Clearing takes more evidence than raising ──────────────────────────────
//
// A conflict is kept until the sources positively agree at a magnitude where
// agreement means something. Two sources both reporting zero agree perfectly
// and prove nothing, and that is not a corner case — it is what the response
// produces. Slowing down is the answer to a self-motion conflict, a slower
// robot has a smaller odometry gap, and a small gap looks like agreement. The
// first version of this cleared on that and oscillated at about 3 Hz: surge,
// crawl, surge, crawl, on a robot that was sitting on ice.
//
// So the robot has to demonstrate the fault is over — actually travel, with
// both senses seeing it — rather than merely stop contradicting itself. Where
// it cannot (an obedience conflict stops the wheels, and a stopped robot proves
// nothing about its motors), `clear` exists so somebody can decide to try.

import type { EvidenceSet } from "./evidence.ts";
import type { RobotIO } from "./types.ts";

export type ConflictKind = "turning" | "self-motion" | "obedience";

export type ConflictingSource = {
  /** The channel, and what it claims. */
  source: string;
  /** The claim in the quantity's own units. */
  value: number;
  /** When the claim was made, on whichever clock produced it. */
  at: number;
  /**
   * How much weight this source deserves, 0..1, from its evidence quality.
   * Not a probability — a statement about the channel, not about the world.
   */
  confidence: number;
};

export type WorldStateConflict = {
  kind: ConflictKind;
  /** The physical quantity the sources disagree about. */
  quantity: string;
  sources: ConflictingSource[];
  /** How far apart they are, in the quantity's units. */
  disagreement: number;
  /** What this makes untrustworthy. */
  affects: string[];
  /**
   * What to do about it. Deliberately not "stop" in every case: a robot that
   * halts on every disagreement is a robot that cannot work in a building with
   * a carpet in it.
   */
  response: "slow" | "degrade" | "stop";
  /**
   * True when the sources are not disagreeing at this instant but the conflict
   * is being kept anyway, pending positive evidence that it is over.
   *
   * Worth reporting rather than hiding: an operator looking at live readings
   * that agree, next to a robot that is still crawling, needs to know it is
   * being held and what would release it.
   */
  held: boolean;
  /** The whole thing in a sentence, for a log or an operator. */
  summary: string;
};

/**
 * Whether a cross-check can currently see anything at all.
 *
 * A detector compares two measurements of one quantity, and the comparison only
 * says something when the quantity is large enough that a failed source would
 * differ by more than the threshold. Driving straight, a stuck gyro and a
 * working one both read zero: the check runs, agrees, and has learned nothing.
 *
 * Measured over ordinary navigation, the turning check is in a position to see
 * a dead gyro in 0.8% of ticks, with unbroken blind runs of 591 ticks — most of
 * a mission. A robot can carry a completely dead gyro from end to end while a
 * detector that is working perfectly reports no conflicts, because there was
 * never anything for it to disagree about.
 *
 * So there are three outcomes, not two, and they are the same shape as the
 * evidence layer's: agreement while excited is a *positive verification*;
 * disagreement while excited is a conflict; no excitation is silence. Treating
 * the third as the first is how a robot concludes it is healthy from having
 * driven in a straight line.
 */
export type CrossCheckState = {
  name: ConflictKind;
  /** The physical quantity the two sources are being compared on. */
  quantity: string;
  /** Whether the current motion would reveal a fault in this pair. */
  excited: boolean;
  /** When the sources last agreed while excited, on the sample clock. */
  verifiedAt: number | null;
  /** How long since that, ms. Null when it has never been verified. */
  unverifiedForMs: number | null;
  /** What motion would put this check in a position to say something. */
  excitedBy: string;
};

/** Reading the detectors take on every tick. */
export type MotionSample = {
  /** Commanded linear and angular velocity, as last asked for. */
  commanded: { linear: number; angular: number };
  /** Measured from wheel odometry. */
  odometry: { linear: number; angular: number };
  /** Yaw rate from the IMU gyro, rad/s. */
  gyroYawRate: number;
  /** Mean range change across the scan since the last sample, m/s. */
  scanClosure: number | null;
  at: number;
};

export type ConflictThresholds = {
  /**
   * Rad/s the gyro and the wheels may differ by before it counts. Wheels on a
   * slippery floor disagree with a gyro constantly at small magnitudes, so
   * this is well above the noise rather than at it.
   */
  turnRate: number;
  /** m/s the wheels and the scan may differ by. */
  selfMotion: number;
  /** m/s the body may lag a command by before obedience is in question. */
  obedience: number;
  /** How long a disagreement must persist before it is reported, ms. */
  persistenceMs: number;
  /**
   * How long the sources must positively agree before a raised conflict is
   * dropped, ms. Longer than `persistenceMs` on purpose: it should be harder to
   * decide a fault is gone than to notice it arrived.
   */
  clearanceMs: number;
  /**
   * The magnitude at which agreement counts as evidence, in each quantity's
   * units — m/s for speed, rad/s for yaw.
   *
   * Two sources both reporting zero agree perfectly and prove nothing. A robot
   * that has stopped has no way to tell a floor that grips from one that does
   * not, so clearing a conflict requires the robot to have actually moved and
   * both senses to have seen it.
   */
  confirmSpeed: number;
  confirmTurn: number;
};

export const DEFAULT_THRESHOLDS: ConflictThresholds = {
  // A gyro and a wheel encoder on a real robot disagree by a few hundredths
  // constantly. Half a radian per second is a robot turning when it believes
  // it is not.
  turnRate: 0.5,
  // Measured, not guessed. Across 1,362 samples of a healthy robot driving at
  // 0.5 m/s through an empty hall and a cluttered office, the largest gap
  // between wheel odometry and scan closure was 0.22 m/s and the 95th
  // percentile was 0.11. With the wheels turning on a frictionless floor the
  // gap sat at 0.50. This sits between the two distributions with room on
  // either side; it is not a knob to turn when something false-fires, because
  // every false fire so far has been the estimator being wrong rather than the
  // threshold being tight.
  selfMotion: 0.35,
  obedience: 0.25,
  // One tick of disagreement is noise. A third of a second of it is a fault.
  persistenceMs: 300,
  clearanceMs: 500,
  // Reachable while held at the governor's contradiction speed, so a robot on a
  // floor that has recovered can demonstrate it without anyone intervening.
  confirmSpeed: 0.12,
  confirmTurn: 0.2,
};

/**
 * How far below its maximum a beam has to read before it counts as having hit
 * something, in metres. Wide enough to cover the noise the clamp hides.
 */
const SATURATION_MARGIN = 0.1;

/** Below this many usable beams the sector is not describing a scene. */
const MIN_BEAMS = 8;

/**
 * How far the per-beam speed estimates may typically sit from their median, in
 * m/s, before the scan is judged to be describing a change of scene rather than
 * a speed. Set from the spread a healthy robot shows in a cluttered room.
 */
const MAX_BEAM_SPREAD = 0.4;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const confidenceOf = (evidence: EvidenceSet, source: string): number => {
  const found = evidence.get(source as never);
  if (!found) return 0;
  return found.quality === "good" ? 1 : found.quality === "degraded" ? 0.5 : 0;
};

/**
 * Watches for two channels disagreeing about one quantity, and only reports it
 * once the disagreement has lasted.
 */
export class ConflictMonitor {
  private readonly thresholds: ConflictThresholds;
  /** When each kind of disagreement started, or 0 while they agree. */
  private since = new Map<ConflictKind, number>();
  /** Conflicts raised and not yet positively cleared, by when they were raised. */
  private latched = new Map<ConflictKind, number>();
  /** When the sources started positively agreeing again, per kind. */
  private clearing = new Map<ConflictKind, number>();
  /** Forward-sector ranges from the previous scan, by beam index. */
  private lastScanRanges: Array<number | null> | null = null;
  private lastScanAt = 0;
  /** Previous command-to-body gap, to tell accelerating from disobeying. */
  private lastObedienceGap = 0;
  /** When each check last agreed while it was in a position to disagree. */
  private verifiedAt = new Map<ConflictKind, number>();
  /** Whether each check could have seen a fault on the last sample. */
  private excited = new Map<ConflictKind, boolean>();
  /** The clock of the most recent sample, for reporting ages. */
  private lastSampleAt: number | null = null;

  constructor(thresholds: Partial<ConflictThresholds> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * A second opinion on forward speed, read out of how the world moves through
   * the scan. It comes from a sensor the wheels know nothing about, which is
   * the whole point — but only when the scan can actually answer the question.
   *
   * Returns null whenever it cannot, and that happens often. A number that is
   * wrong whenever the robot corners or passes a doorway is worse than no
   * number, because the layer above cannot tell the two apart.
   */
  sampleScan(robot: RobotIO, now: number, turnRate = 0): number | null {
    // --- abstain while turning ---------------------------------------------
    //
    // Turning sweeps the beams across near and far surfaces, so ranges change
    // fast for reasons that have nothing to do with travelling anywhere. The
    // first version of this ignored that and fired twenty-five times on one
    // healthy crossing. A robot that is turning simply does not get a second
    // opinion this way.
    if (Math.abs(turnRate) > 0.15) {
      this.lastScanRanges = null;
      return null;
    }

    const scan = robot.lidar();
    // Forward sector only, for a related reason: beams out to the side measure
    // how the room widens, not how fast the robot is closing on anything.
    //
    // The sector is narrow because the angle correction is deliberately
    // skipped. A beam at angle θ sees a point feature recede at v·cos θ and a
    // perpendicular wall at v/cos θ, and which of those applies depends on the
    // surface orientation, which is unknown. Across ±0.35 rad the two bracket
    // the truth within about 6%, so no correction is applied and the residual
    // is left as bias — small against any threshold worth setting.
    const n = scan.ranges.length;
    const current: Array<number | null> = new Array(n).fill(null);
    let usable = 0;
    for (let i = 0; i < n; i += 1) {
      const angle = -scan.fov / 2 + (scan.fov * i) / Math.max(1, n - 1);
      if (Math.abs(angle) > 0.35) continue;
      const range = scan.ranges[i];
      if (!Number.isFinite(range) || range <= 0) continue;
      // A beam sitting at its maximum range did not measure a surface — it
      // reported that there is nothing within twelve metres. Differencing two
      // of those gives exactly zero, and zero here reads as "not moving".
      //
      // That is the whole family of bug this kernel exists to prevent, written
      // into the detector meant to catch it: measured across an empty hall it
      // reported a confident 0.00 m/s while the robot drove at 0.50, forty-one
      // times in seven hundred. A saturated beam carries no distance
      // information and must not be allowed to contribute a difference of zero.
      if (range >= scan.maxRange - SATURATION_MARGIN) continue;
      current[i] = range;
      usable += 1;
    }

    const previous = this.lastScanRanges;
    const dt = (now - this.lastScanAt) / 1000;
    this.lastScanRanges = usable >= MIN_BEAMS ? current : null;
    this.lastScanAt = now;
    if (previous === null || usable < MIN_BEAMS || dt <= 0 || dt > 1) return null;

    // --- per-beam, then the median -----------------------------------------
    //
    // The first version took the mean of the sector and compared its rate of
    // change against wheel speed. Measured over a cluttered room that fired on
    // a healthy robot 120 times in 708 samples, once reporting −3.01 m/s while
    // the robot drove steadily forward at 0.5.
    //
    // Nothing was wrong with the threshold. Driving past the edge of a box
    // moves a handful of beams from the box to the wall behind it, and the mean
    // jumps by the depth of the room — the statistic was reporting a change of
    // subject as though it were a change of position. Every beam that keeps its
    // surface agrees on the speed; the ones that switch disagree wildly and in
    // whichever direction the geometry happens to fall. That is what a median
    // is for.
    const deltas: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const before = previous[i];
      const after = current[i];
      if (before === null || after === null) continue;
      // Closing on the world means the range falls, so forward motion is
      // positive.
      deltas.push((before - after) / dt);
    }
    if (deltas.length < MIN_BEAMS) return null;
    const closure = median(deltas);

    // --- abstain when the beams do not agree with each other ---------------
    //
    // A median survives a minority changing surface. It does not survive a
    // majority, which is what a doorway or the end of an aisle looks like. The
    // spread among the beams says which case this is: when most of them are
    // reporting the same speed the estimate means something, and when they are
    // not, no single number describes what the scan is doing.
    const spread = median(deltas.map((d) => Math.abs(d - closure)));
    if (spread > MAX_BEAM_SPREAD) return null;

    return closure;
  }

  /**
   * Check the sample for disagreements. Returns everything currently standing —
   * both what has just been found and what was found earlier and has not been
   * positively cleared.
   */
  check(sample: MotionSample, evidence: EvidenceSet): WorldStateConflict[] {
    const found: WorldStateConflict[] = [];
    this.lastSampleAt = sample.at;

    /**
     * Record whether this check could have seen a fault, and whether it did.
     *
     * Only agreement *while excited* counts as having verified anything. A
     * check that agrees because neither source had anything to say has not
     * cleared its pair; it has been silent about it.
     */
    const observe = (kind: ConflictKind, excited: boolean, disagreeing: boolean): void => {
      this.excited.set(kind, excited);
      if (excited && !disagreeing) this.verifiedAt.set(kind, sample.at);
    };

    /**
     * Whether this kind of disagreement is standing, given what the sample says
     * and what has been standing until now.
     *
     * `confirmed` is the part that is easy to get wrong, and getting it wrong
     * produced a measured limit cycle: the response to a self-motion conflict
     * is to slow down, slowing down shrinks the odometry, and a shrunken
     * odometry is within threshold of a scan that says the robot is not moving.
     * So the conflict cleared because the robot had crawled, the speed came
     * back, the gap reopened, and the robot surged and crawled at roughly 3 Hz.
     *
     * A disagreement that has gone quiet is not the same as sources that agree.
     * Clearing takes positive evidence: the quantity measured at a magnitude
     * where agreement means something, by both sources, for longer than it took
     * to raise the conflict.
     */
    const standing = (
      kind: ConflictKind,
      disagreeing: boolean,
      confirmed: boolean,
    ): boolean => {
      const held = this.latched.get(kind);

      if (disagreeing) {
        this.clearing.delete(kind);
        if (held) return true;
        const first = this.since.get(kind);
        if (first === undefined) {
          this.since.set(kind, sample.at);
          return false;
        }
        if (sample.at - first < this.thresholds.persistenceMs) return false;
        this.latched.set(kind, sample.at);
        return true;
      }

      this.since.delete(kind);
      if (!held) return false;

      // Latched, and not currently disagreeing. That alone changes nothing.
      if (!confirmed) {
        this.clearing.delete(kind);
        return true;
      }
      const clearingSince = this.clearing.get(kind);
      if (clearingSince === undefined) {
        this.clearing.set(kind, sample.at);
        return true;
      }
      if (sample.at - clearingSince < this.thresholds.clearanceMs) return true;
      this.latched.delete(kind);
      this.clearing.delete(kind);
      return false;
    };

    // --- turning: wheels against gyro ---------------------------------------
    const turnGap = Math.abs(sample.odometry.angular - sample.gyroYawRate);
    const turnConfirmed =
      turnGap < this.thresholds.turnRate / 2 &&
      Math.abs(sample.odometry.angular) >= this.thresholds.confirmTurn &&
      Math.abs(sample.gyroYawRate) >= this.thresholds.confirmTurn;
    const turnDisagrees = turnGap > this.thresholds.turnRate;
    // A stuck gyro reads zero, so the pair only separates once the robot is
    // genuinely turning faster than the threshold.
    observe(
      "turning",
      Math.abs(sample.odometry.angular) > this.thresholds.turnRate,
      turnDisagrees,
    );
    if (standing("turning", turnDisagrees, turnConfirmed)) {
      found.push({
        kind: "turning",
        held: !turnDisagrees,
        quantity: "yaw rate (rad/s)",
        sources: [
          {
            source: "wheel odometry",
            value: sample.odometry.angular,
            at: sample.at,
            confidence: confidenceOf(evidence, "velocity"),
          },
          {
            source: "IMU gyro",
            value: sample.gyroYawRate,
            at: sample.at,
            confidence: confidenceOf(evidence, "imu"),
          },
        ],
        disagreement: turnGap,
        affects: ["navigate.to", "explore.frontier", "memory.spatial", "hri.yield-path"],
        // Everything that integrates heading is now integrating something
        // wrong, and the error compounds. Slowing buys time; it does not fix it.
        response: "degrade",
        summary:
          `The wheels say ${sample.odometry.angular.toFixed(2)} rad/s and the gyro says ` +
          `${sample.gyroYawRate.toFixed(2)}. One of them is wrong, and anything that integrates ` +
          "heading is compounding the error — a slipping wheel and a loose IMU look identical here." +
          (turnDisagrees
            ? ""
            : " They agree at this instant; the conflict is held until both measure a real turn."),
      });
    }

    // --- self-motion: wheels against the world moving through the scan ------
    if (sample.scanClosure === null) {
      // No second opinion available, so nothing is being checked.
      observe("self-motion", false, false);
    } else {
      const motionGap = Math.abs(sample.odometry.linear - sample.scanClosure);
      const motionConfirmed =
        motionGap < this.thresholds.selfMotion / 2 &&
        Math.abs(sample.odometry.linear) >= this.thresholds.confirmSpeed &&
        Math.abs(sample.scanClosure) >= this.thresholds.confirmSpeed;
      const motionDisagrees = motionGap > this.thresholds.selfMotion;
      observe(
        "self-motion",
        Math.abs(sample.odometry.linear) > this.thresholds.selfMotion,
        motionDisagrees,
      );
      if (standing("self-motion", motionDisagrees, motionConfirmed)) {
        found.push({
          kind: "self-motion",
          held: !motionDisagrees,
          quantity: "forward speed (m/s)",
          sources: [
            {
              source: "wheel odometry",
              value: sample.odometry.linear,
              at: sample.at,
              confidence: confidenceOf(evidence, "velocity"),
            },
            {
              source: "scan closure",
              value: sample.scanClosure,
              at: sample.at,
              confidence: confidenceOf(evidence, "lidar"),
            },
          ],
          disagreement: motionGap,
          affects: ["navigate.to", "explore.frontier", "power.lifeline", "memory.spatial"],
          response: "degrade",
          summary:
            `The wheels say ${sample.odometry.linear.toFixed(2)} m/s and the world is moving past ` +
            `at ${sample.scanClosure.toFixed(2)}. Wheels turning without the robot moving is the ` +
            "signature of a robot jacked up, stuck on a lip, or spinning on a wet floor — and the " +
            "odometry is confidently adding up distance it never travelled." +
            (motionDisagrees
              ? ""
              : " They agree at this instant, which is what a robot that has been slowed to a " +
                "crawl looks like whether or not the floor has recovered; the conflict is held " +
                "until both measure real travel."),
        });
      }
    }

    // --- obedience: what was asked against what happened --------------------
    //
    // A body does not reach a commanded speed instantly, so comparing the two
    // directly flags every acceleration. The first version did exactly that and
    // fired four times per healthy crossing. What matters is not whether the
    // robot has arrived at the command but whether it is getting there: a gap
    // that is closing is a robot accelerating, and a gap that sits still while
    // the command holds is a robot that is not obeying.
    const obedienceGap = Math.abs(sample.commanded.linear) - Math.abs(sample.odometry.linear);
    const closing = obedienceGap < this.lastObedienceGap - 0.01;
    this.lastObedienceGap = obedienceGap;
    const obedienceConfirmed =
      Math.abs(obedienceGap) < this.thresholds.obedience / 2 &&
      Math.abs(sample.commanded.linear) >= this.thresholds.confirmSpeed &&
      Math.abs(sample.odometry.linear) >= this.thresholds.confirmSpeed;
    const obedienceDisagrees = obedienceGap > this.thresholds.obedience && !closing;
    observe(
      "obedience",
      Math.abs(sample.commanded.linear) > this.thresholds.obedience,
      obedienceDisagrees,
    );
    if (standing("obedience", obedienceDisagrees, obedienceConfirmed)) {
      found.push({
        kind: "obedience",
        held: !obedienceDisagrees,
        quantity: "forward speed (m/s)",
        sources: [
          {
            source: "commanded",
            value: sample.commanded.linear,
            at: sample.at,
            confidence: 1,
          },
          {
            source: "wheel odometry",
            value: sample.odometry.linear,
            at: sample.at,
            confidence: confidenceOf(evidence, "velocity"),
          },
        ],
        disagreement: obedienceGap,
        affects: ["navigate.to", "hri.yield-path", "balance.recover"],
        // A robot that is not doing what it was told should not be given more
        // to do. This is the one that stops.
        response: "stop",
        summary:
          `Commanded ${sample.commanded.linear.toFixed(2)} m/s and the body is doing ` +
          `${sample.odometry.linear.toFixed(2)}. Either something is holding the robot, the motors ` +
          "are not driving, or the command never arrived — and a command being sent is not the " +
          "same as an action happening." +
          (obedienceDisagrees
            ? ""
            : " Nothing is being asked of the wheels right now, so nothing is being proved; this " +
              "clears when the robot follows a real command, or when an operator re-arms it."),
      });
    }

    return found;
  }

  /**
   * Drop a latched conflict deliberately, the way an operator re-arms a tripped
   * guard.
   *
   * The way out of a conflict the robot cannot clear by itself: an obedience
   * conflict stops the wheels, and a stopped robot can never demonstrate that
   * its motors work again. Someone has to decide to try.
   */
  clear(kind?: ConflictKind): void {
    if (kind === undefined) {
      this.latched.clear();
      this.clearing.clear();
      this.since.clear();
      return;
    }
    this.latched.delete(kind);
    this.clearing.delete(kind);
    this.since.delete(kind);
  }

  /**
   * What each cross-check currently knows, and how long since it knew it.
   *
   * The number that matters is `unverifiedForMs`. A robot whose gyro check has
   * been unverified for thirty seconds is not a robot with a working gyro; it
   * is a robot that has not been in a position to find out.
   */
  verifiability(): CrossCheckState[] {
    const now = this.lastSampleAt;
    const describe: Record<ConflictKind, { quantity: string; excitedBy: string }> = {
      turning: {
        quantity: "yaw rate (rad/s)",
        excitedBy: `turning faster than ${this.thresholds.turnRate} rad/s`,
      },
      "self-motion": {
        quantity: "forward speed (m/s)",
        excitedBy:
          `travelling faster than ${this.thresholds.selfMotion} m/s with surfaces in view`,
      },
      obedience: {
        quantity: "forward speed (m/s)",
        excitedBy: `being asked for more than ${this.thresholds.obedience} m/s`,
      },
    };
    return (Object.keys(describe) as ConflictKind[]).map((name) => {
      const verifiedAt = this.verifiedAt.get(name) ?? null;
      return {
        name,
        quantity: describe[name].quantity,
        excited: this.excited.get(name) ?? false,
        verifiedAt,
        unverifiedForMs: verifiedAt === null || now === null ? null : now - verifiedAt,
        excitedBy: describe[name].excitedBy,
      };
    });
  }

  /** Whether a conflict of this kind is standing. */
  isLatched(kind: ConflictKind): boolean {
    return this.latched.has(kind);
  }

  /** Forget the history, for a fresh run. */
  reset(): void {
    this.since.clear();
    this.latched.clear();
    this.clearing.clear();
    this.verifiedAt.clear();
    this.excited.clear();
    this.lastSampleAt = null;
    this.lastScanRanges = null;
    this.lastScanAt = 0;
    this.lastObedienceGap = 0;
  }
}

/** The strongest response among a set of conflicts. */
export function worstResponse(conflicts: readonly WorldStateConflict[]): "none" | "slow" | "degrade" | "stop" {
  if (conflicts.length === 0) return "none";
  if (conflicts.some((c) => c.response === "stop")) return "stop";
  if (conflicts.some((c) => c.response === "degrade")) return "degrade";
  return "slow";
}
