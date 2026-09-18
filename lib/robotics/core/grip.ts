// ── Braking authority, measured ──────────────────────────────────────────────
//
// Every protective distance in this kernel is `v²/(2a)` plus reaction terms,
// and `a` is a number somebody typed into a configuration file. `safety.
// stoppable` already names the failure that matters — "the assumed figure being
// optimistic" — and until the simulator had friction there was no way for that
// figure to be wrong, so it never was.
//
// It can be wrong. The deceleration a wheeled robot can reach is µ·g, and µ
// belongs to the floor, not to the robot. A machine commissioned on dry sealed
// concrete and driven onto a wet patch keeps the same constant and loses half
// its brakes. Measured here: with the default limits, `maxDecel = 1.2` is a
// claim that the floor gives at least µ = 0.122. Below that the robot drives at
// speeds it cannot stop from, and nothing in the system notices, because every
// check downstream is computed from the same constant.
//
// So measure it. The instrument is the lidar, and the instrument matters:
//
//   the wheels     cannot see it. On a slippery floor the wheels decelerate
//                  exactly as commanded — the body is the thing that does not
//                  follow, and the encoders are on the wheels.
//   the scan       closure from `conflict.ts` is too noisy for a one-second
//                  transient. It was built to catch a sustained disagreement
//                  over hundreds of milliseconds and it does that well; asked
//                  for an instantaneous speed it returns ±0.2 m/s, which is a
//                  third of the signal.
//   the IMU        works on a statically stable platform and cannot work on a
//                  balancing one. A balancer pitches until the specific force
//                  lies along its own body axis, so the forward accelerometer
//                  channel reads almost nothing during steady acceleration —
//                  and the fused attitude that would remove the gravity term is
//                  itself derived from that same accelerometer. Measured: with
//                  no compensation the estimate reads 1.2 m/s² at µ=0.12 and
//                  1.2 m/s² at µ=0.8, which is to say it reads the pitch; with
//                  compensation it collapses to 0.07 m/s², which is to say it
//                  cancels the signal. On a static platform it is good to 2%.
//   two ranges     work everywhere. A lidar measures an absolute distance to
//                  whatever is ahead with about a centimetre of noise and no
//                  drift at all. One reading as the brakes go on, one when the
//                  robot has come to rest, and the difference is the stopping
//                  distance — no integration, nothing to accumulate.
//
// The entry speed comes from the wheels, which are trustworthy at that instant
// for the same reason they are useless later: nothing is slipping yet. A robot
// rolling at constant speed is not asking the contact for any force.
//
// What comes out is `v₀²/(2d)`: the mean deceleration actually achieved. That
// is the right shape to feed back, because the constant it replaces is used as
// a constant deceleration in exactly that formula.

import type { LidarScan } from "./types.ts";

/** One control cycle's worth of what the grip monitor needs. */
export type GripSample = {
  /** Sensor clock, ms. */
  now: number;
  /** Wheel speed, m/s. */
  speed: number;
  /** What the drive was last asked for, m/s. */
  commanded: number;
  /** Yaw rate, rad/s. A stop that turns measures a different surface. */
  turnRate: number;
  scan: LidarScan | null;
};

export type GripMeasurement = {
  /**
   * Which event this came from.
   *
   * `stop` is a direct measurement of braking. `launch` is an inference: the
   * grip that carried the robot away from rest is the same tyre-ground contact
   * that has to stop it, so the figure transfers — for a differential drive
   * with motor braking, where both directions act through the same two wheels.
   * It does not transfer cleanly to a chassis where braking loads different
   * wheels than driving does, and on one of those a launch figure can read
   * high. It is kept because it arrives on the first metre of a mission and the
   * alternative is knowing nothing until the first hard stop, which on a bad
   * floor is the stop that was going to hurt.
   */
  source: "stop" | "launch";
  /** Mean deceleration achieved, m/s². */
  decel: number;
  /** Speed the stop started from, m/s. */
  from: number;
  /** How far the body actually travelled, metres, by the lidar. */
  distance: number;
  /** How far the wheels claimed it travelled. */
  wheelDistance: number;
  /** Sensor clock at the end of the stop, ms. */
  at: number;
};

export type GripThresholds = {
  /** Stops slower than this measure nothing useful. */
  minEntrySpeed: number;
  /** Beyond this the stop was a turn, and the range is a different surface. */
  maxTurnRate: number;
  /** Forward half-angle of the beams used for the range, radians. */
  sector: number;
  /** Beams needed inside the sector for a range to mean anything. */
  minBeams: number;
  /** A stop taking longer than this is something other than a stop. */
  maxStopMs: number;
  /** The range has settled once it stops closing by more than this, metres. */
  settleEpsilon: number;
  /** How long it has to stay settled before the stop is called finished, ms. */
  settleMs: number;
  /** Measurements older than this stop counting against the robot. */
  windowMs: number;
  /** How many to keep. */
  keep: number;
  /** Below this a measurement is not believable and is thrown away. */
  minCredible: number;
  /**
   * How far the two distance estimates have to disagree before the event is
   * counted as the floor giving way rather than the drive doing its job, as a
   * fraction of the distance the wheels claimed.
   *
   * This gate is the difference between a capability and a tax. Without it,
   * measured across `cluttered-office` and `long-patrol` on a perfectly good
   * floor, five launches in twenty-four came out below the configured
   * 1.20 m/s² — worst 1.126 — and the robot spent a third of its ticks under a
   * tightened envelope for no reason at all. A launch the floor kept up with
   * measures the drive's own ramp, not the ground, and the only honest thing it
   * establishes is "at least that much", which is already more than the
   * configured figure.
   *
   * 0.2 sits above the worst disagreement seen on a good floor (17.5%) and well
   * below a floor that is actually failing (58% at µ=0.06, 35% at µ=0.10). A
   * floor only marginally worse than the configured figure falls inside the
   * gate and is not reported — correctly, because there is nothing to tighten.
   */
  saturationMargin: number;
  /** A launch is only worth watching if this much speed is being asked for. */
  minLaunchTarget: number;
  /** Above this the robot was already moving and the launch is half over. */
  maxLaunchEntry: number;
  /**
   * How far back to look to decide whether the surface ahead is standing
   * still, ms. Long enough that a centimetre of range noise is small against
   * the distance travelled.
   */
  staticBaselineMs: number;
  /**
   * How far the range may close against the robot's own speed and still be
   * called a wall, m/s.
   */
  staticTolerance: number;
};

export const DEFAULT_GRIP_THRESHOLDS: GripThresholds = {
  minEntrySpeed: 0.25,
  maxTurnRate: 0.1,
  sector: 0.12,
  minBeams: 5,
  maxStopMs: 6000,
  settleEpsilon: 0.005,
  settleMs: 300,
  windowMs: 120_000,
  keep: 6,
  minCredible: 0.08,
  saturationMargin: 0.2,
  minLaunchTarget: 0.5,
  maxLaunchEntry: 0.2,
  staticBaselineMs: 400,
  staticTolerance: 0.2,
};

/** Median forward range, or null when the scan cannot supply one. */
export function forwardRange(scan: LidarScan, thresholds: GripThresholds): number | null {
  const n = scan.ranges.length;
  const kept: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = -scan.fov / 2 + (scan.fov * i) / Math.max(1, n - 1);
    if (Math.abs(angle) > thresholds.sector) continue;
    const range = scan.ranges[i];
    if (!Number.isFinite(range) || range <= 0) continue;
    // A beam at its maximum range measured no surface. Differencing two of
    // those gives zero, and zero here would read as "travelled no distance",
    // which is the whole family of mistake this kernel exists to stop.
    if (range >= scan.maxRange - 0.1) continue;
    // Project onto the heading: a beam at angle θ looking at a wall ahead
    // reports r/cos θ. Across ±0.12 rad the correction is under a per cent, and
    // it is applied rather than argued about.
    kept.push(range * Math.cos(angle));
  }
  if (kept.length < thresholds.minBeams) return null;
  kept.sort((a, b) => a - b);
  const mid = kept.length >> 1;
  return kept.length % 2 ? kept[mid] : (kept[mid - 1] + kept[mid]) / 2;
}

type Pending = {
  phase: "stop" | "launch";
  from: number;
  /** Speed already on the wheels when the event was recognised, m/s. */
  entrySpeed: number;
  rangeAtStart: number;
  startedAt: number;
  wheelDistance: number;
  lastSpeed: number;
  lastAt: number;
  /** Closest the forward surface has come, metres. */
  nearest: number;
  /** When the range last improved on that. */
  nearestAt: number;
};

export class GripMonitor {
  private readonly thresholds: GripThresholds;
  private pending: Pending | null = null;
  private history: GripMeasurement[] = [];
  private lastAt: number | null = null;
  /** Recent (time, range, wheel speed), for deciding what is ahead. */
  private trail: Array<{ at: number; range: number; speed: number }> = [];
  /** Why the most recent candidate was thrown away, for anyone debugging. */
  private lastDiscard: string | null = null;

  constructor(thresholds: Partial<GripThresholds> = {}) {
    this.thresholds = { ...DEFAULT_GRIP_THRESHOLDS, ...thresholds };
  }

  /**
   * Feed one control cycle. Returns a measurement on the cycle a stop
   * completes, and null every other time.
   */
  observe(sample: GripSample): GripMeasurement | null {
    const t = this.thresholds;
    // The same instant twice is not two observations — the same guard the
    // conflict monitor needs, for the same reason.
    if (this.lastAt !== null && sample.now <= this.lastAt) return null;
    const dt = this.lastAt === null ? 0 : (sample.now - this.lastAt) / 1000;
    this.lastAt = sample.now;

    const speed = Math.abs(sample.speed);
    const range = sample.scan ? forwardRange(sample.scan, t) : null;

    // Keep a short history of what the forward range has been doing, so the
    // question "is that a wall or a person" can be answered before a stop is
    // committed to rather than after it has produced a number.
    if (range !== null) this.trail.push({ at: sample.now, range, speed });
    else this.trail.length = 0;
    while (this.trail.length > 1 && sample.now - this.trail[0].at > t.staticBaselineMs * 2) {
      this.trail.shift();
    }

    if (this.pending === null) {
      if (range === null || Math.abs(sample.turnRate) > t.maxTurnRate) return null;
      // A stop starts when the drive stops asking for speed while the robot
      // still has some. Anything gentler than that measures how hard the robot
      // chose to brake, not how hard it could have.
      const braking = Math.abs(sample.commanded) < 0.02 && speed >= t.minEntrySpeed;
      // A launch starts from near rest with a real speed asked for. It matters
      // because it happens on the first metre of every mission, where a stop
      // measurement does not exist yet — and the drive ramps at its own limit
      // on the way up, so a floor that cannot carry that saturates immediately.
      //
      // "Near" rest rather than rest: the command this sees is the one already
      // sent, so the earliest a launch can be recognised is the cycle after it
      // began, by which time the wheels have had one tick of ramp. Insisting on
      // a standing start missed every launch there was.
      const launching =
        !braking && speed < t.maxLaunchEntry && sample.commanded >= t.minLaunchTarget;
      if (!braking && !launching) return null;
      // A stopping distance measured against something that is itself moving is
      // not a stopping distance. Measured in the corridor, against a person
      // walking in at 1.6 m/s: the range closed by the robot's travel plus
      // theirs, and the robot concluded its brakes delivered 0.16 m/s² where
      // the floor was giving 0.59 — wrong by a factor of four, in the direction
      // that makes it crawl rather than the direction that hurts somebody, but
      // wrong.
      //
      // A wall closes on the robot at exactly the robot's own speed. Anything
      // else is a thing with its own opinion, and the only honest response is
      // to measure something else. Over a 0.4 s baseline a centimetre of range
      // noise is worth 0.03 m/s, so this discriminates properly rather than
      // being drowned.
      if (!this.surfaceIsStanding(sample.now)) return null;
      this.pending = {
        phase: braking ? "stop" : "launch",
        from: braking ? speed : sample.commanded,
        entrySpeed: speed,
        rangeAtStart: range,
        startedAt: sample.now,
        wheelDistance: 0,
        lastSpeed: speed,
        lastAt: sample.now,
        nearest: range,
        nearestAt: sample.now,
      };
      return null;
    }

    const p = this.pending;
    p.wheelDistance += ((p.lastSpeed + speed) / 2) * dt;
    p.lastSpeed = speed;
    p.lastAt = sample.now;

    const abandon = (why: string) => {
      this.lastDiscard = why;
      this.pending = null;
      return null;
    };

    if (Math.abs(sample.turnRate) > t.maxTurnRate) return abandon("the robot turned mid-event");
    if (range === null) return abandon("nothing measurable ahead any more");
    if (sample.now - p.startedAt > t.maxStopMs) return abandon("took too long to be a stop");

    if (p.phase === "launch") {
      if (sample.commanded < p.from - 0.02) return abandon("the launch was cut short");
      // The wheels have reached what was asked of them. Whether the body has is
      // the question, and the range answers it.
      if (speed < p.from - 0.02) return null;
      const covered = p.rangeAtStart - range;
      const seconds = (sample.now - p.startedAt) / 1000;
      if (seconds <= 0.1) return abandon("over too quickly to measure");
      // The body cannot outrun the wheels while they are dragging it up to
      // speed. A range that closed further than the wheels turned is measuring
      // something walking towards the robot.
      if (covered > p.wheelDistance + 0.05) {
        return abandon("the surface ahead moved, so the range is not a distance travelled");
      }
      if (covered <= 0.01) return abandon("no measurable travel");
      if (covered > p.wheelDistance * (1 - t.saturationMargin)) {
        return abandon("the body kept up with the wheels, so this measured the drive and not the floor");
      }
      // d = v₀t + ½at². The entry speed comes off the wheels and is a slight
      // over-estimate of the body's — on a bad floor the wheels are already
      // ahead — which lowers the answer, which is the direction to be wrong in.
      const accel = (2 * (covered - p.entrySpeed * seconds)) / (seconds * seconds);
      this.pending = null;
      if (!Number.isFinite(accel) || accel < t.minCredible) {
        return abandon(`implausible acceleration ${accel.toFixed(3)} m/s²`);
      }
      return this.record({
        source: "launch",
        decel: accel,
        from: p.from,
        distance: covered,
        wheelDistance: p.wheelDistance,
        at: sample.now,
      });
    }

    if (Math.abs(sample.commanded) >= 0.02) return abandon("the robot was asked to drive again");

    // Not finished until the wheels have stopped *and* the range has settled.
    //
    // On a bad floor those are not the same moment, and the gap between them is
    // the entire measurement. The first version of this ended the stop when the
    // wheel speed reached zero, which is the encoder's opinion of when the robot
    // stopped — the same channel this whole capability exists because it cannot
    // be trusted. Measured on µ=0.06: it reported 0.857 m/s² where the truth
    // was 0.589, because it stopped counting at the moment the wheels did and
    // missed the 0.4 m the body slid afterwards. An optimistic braking figure
    // is the one error here that is not allowed to happen.
    if (range < p.nearest - t.settleEpsilon) {
      p.nearest = range;
      p.nearestAt = sample.now;
    }
    if (speed > 0.01) return null;
    if (sample.now - p.nearestAt < t.settleMs) return null;

    // Measured against the closest the surface ever came, not against wherever
    // it happens to read now. A noisy minimum runs a little long, which
    // overstates the distance and therefore understates the braking — the
    // direction an error here is allowed to take.
    const distance = p.rangeAtStart - p.nearest;
    // The wheels give a lower bound on how far the body went: they decelerate
    // faster than the ground can, so the body over-runs them and never falls
    // short. A range that closed by less than the wheels turned means the thing
    // being measured moved — someone walked out of the way — and the reading is
    // about them, not about the floor.
    if (distance < p.wheelDistance - 0.05) {
      return abandon("the surface ahead moved, so the range is not a distance travelled");
    }
    if (distance <= 0.01) return abandon("no measurable travel");
    if (distance < p.wheelDistance * (1 + t.saturationMargin)) {
      return abandon("the body stopped with the wheels, so this measured the drive and not the floor");
    }

    const decel = (p.from * p.from) / (2 * distance);
    this.pending = null;
    if (!Number.isFinite(decel) || decel < t.minCredible) {
      return abandon(`implausible deceleration ${decel.toFixed(3)} m/s²`);
    }

    return this.record({
      source: "stop",
      decel,
      from: p.from,
      distance,
      wheelDistance: p.wheelDistance,
      at: sample.now,
    });
  }

  private record(measurement: GripMeasurement): GripMeasurement {
    this.history.push(measurement);
    if (this.history.length > this.thresholds.keep) this.history.shift();
    this.lastDiscard = null;
    return measurement;
  }

  /**
   * The worst braking recently demonstrated, or null when the robot has not
   * stopped hard enough for anyone to know.
   *
   * Worst rather than latest, and worst rather than mean, because this feeds a
   * safety margin. A floor that was slippery thirty seconds ago is a floor the
   * robot is probably still on, and averaging a bad stop with three good ones
   * produces a number that describes none of them.
   *
   * Null is not a synonym for "fine". It is the caller's job to keep using its
   * configured assumption and to say that it is an assumption.
   */
  authority(now: number): number | null {
    const live = this.history.filter((m) => now - m.at <= this.thresholds.windowMs);
    if (!live.length) return null;
    return Math.min(...live.map((m) => m.decel));
  }

  /**
   * Whether the thing the forward beams are looking at is holding still.
   *
   * Returns false when it cannot be established — a robot that has not been
   * moving has no way to tell a wall from a person standing in front of it, and
   * "cannot tell" is not "it is a wall". The cost of being wrong here is a
   * fabricated braking figure fed straight into the safety envelope.
   */
  private surfaceIsStanding(now: number): boolean {
    const t = this.thresholds;
    const recent = this.trail.filter((p) => now - p.at <= t.staticBaselineMs);
    if (recent.length < 3) return false;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const seconds = (last.at - first.at) / 1000;
    if (seconds < t.staticBaselineMs / 2000) return false;
    const closure = (first.range - last.range) / seconds;
    const travelled = recent.reduce((a, p) => a + p.speed, 0) / recent.length;
    // A launch begins from rest, where both numbers are zero and nothing is
    // proved. Trust it only when the robot has been moving enough for the
    // comparison to mean something, or when the range has been genuinely still.
    if (travelled < 0.05) return Math.abs(closure) <= t.staticTolerance;
    return Math.abs(closure - travelled) <= t.staticTolerance;
  }

  measurements(now: number): GripMeasurement[] {
    return this.history.filter((m) => now - m.at <= this.thresholds.windowMs);
  }

  /** Whether a stop is being watched right now. */
  watching(): boolean {
    return this.pending !== null;
  }

  discardReason(): string | null {
    return this.lastDiscard;
  }

  reset(): void {
    this.pending = null;
    this.history = [];
    this.lastAt = null;
    this.lastDiscard = null;
    this.trail = [];
  }
}
