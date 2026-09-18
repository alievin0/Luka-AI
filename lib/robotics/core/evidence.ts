// What the robot can currently justify believing.
//
// Everything above this file used to ask the hardware a question and act on
// whatever came back. That is how a dead lidar became a clear path and a
// stalled IMU became a level robot: the reading was there, it looked like a
// number, and nothing in between was responsible for asking whether it meant
// anything.
//
// Evidence is that missing layer. A reading arrives here and leaves as a claim
// with a quality attached, an age measured against the clock that produced it,
// and a reason a person can read. Nothing downstream gets the raw number
// without also getting the answer to "should I believe this".
//
//   sensor → evidence → world state → capability gate → action → verification
//              ^^^^^^^^
//
// ── Why quality is not a boolean ───────────────────────────────────────────
//
// Four states, because collapsing them is the bug this whole layer exists to
// prevent:
//
//   good      the channel is reporting and the reading is usable
//   degraded  reporting, usable, and worse than it should be — a scan with
//             half its beams answering still tells you about the half it sees
//   invalid   reporting something that cannot be true, which is different from
//             not reporting: a driver publishing NaN is not a quiet driver
//   absent    the hardware is not there, or nothing has arrived
//
// `absent` and `invalid` both mean "do not use this", and they mean different
// things to whoever has to fix it. `degraded` is the one that makes graceful
// degradation possible at all, because a capability that needs a perfect scan
// and one that needs any scan are different capabilities.

import { scanQuality } from "../safety/governor.ts";
import type { RobotIO } from "./types.ts";

export type EvidenceSource =
  | "pose"
  | "velocity"
  | "lidar"
  | "imu"
  | "battery"
  | "detections"
  | "people"
  | "gripper"
  | "arm"
  | "transport";

export type EvidenceQuality = "good" | "degraded" | "invalid" | "absent";

export type Evidence = {
  source: EvidenceSource;
  quality: EvidenceQuality;
  /**
   * How old the reading is, ms, measured against the clock that produced it.
   * Null when nothing stamped it — which is not the same as fresh, and callers
   * that need freshness have to treat it as unknown rather than as zero.
   */
  ageMs: number | null;
  /**
   * Whether the age above was computed from the robot's own clock or from when
   * the message happened to arrive here. Arrival time cannot detect a clock
   * disagreement, because it is this machine's clock on both sides.
   */
  clock: "sensor" | "arrival" | "none";
  /** How much of the channel is usable, 0..1. */
  completeness: number;
  /** Why it has the quality it has, in words. */
  reason: string;
};

/** Everything the robot can currently justify believing, by channel. */
export type EvidenceSet = Map<EvidenceSource, Evidence>;

const absent = (source: EvidenceSource, reason: string): Evidence => ({
  source,
  quality: "absent",
  ageMs: null,
  clock: "none",
  completeness: 0,
  reason,
});

/**
 * Read every channel and say what can be believed about each.
 *
 * `now` is the caller's clock in the same units the robot stamps with — the
 * simulated clock under the simulator, wall time on hardware.
 */
export function gatherEvidence(robot: RobotIO, now: number): EvidenceSet {
  const set: EvidenceSet = new Map();
  const has = (capability: string) => robot.capabilities.includes(capability as never);

  // --- lidar --------------------------------------------------------------
  if (!has("lidar")) {
    set.set("lidar", absent("lidar", "This robot has no lidar."));
  } else {
    const scan = robot.lidar();
    const quality = scanQuality(scan);
    const clock = scan.stamp ?? "arrival";
    // Whether a timestamp exists is what `stamp` says, not whether the value is
    // non-zero. Using `t > 0` as the test made a legitimate timestamp of zero —
    // the first instant of a run — indistinguishable from no timestamp at all,
    // which is this file's own subject matter and was caught by the gate
    // refusing every navigation at world time zero.
    const ageMs = scan.stamp === undefined ? null : now - scan.t;

    if (scan.ranges.length === 0) {
      set.set("lidar", {
        ...absent("lidar", "No scan is arriving."),
        clock,
      });
    } else if (quality === 0) {
      // Reporting, and reporting nothing usable. Not the same as silence: a
      // driver publishing NaN across every beam is a driver that is running.
      set.set("lidar", {
        source: "lidar",
        quality: "invalid",
        ageMs,
        clock,
        completeness: 0,
        reason: `${scan.ranges.length} beams and not one carries data.`,
      });
    } else {
      set.set("lidar", {
        source: "lidar",
        quality: quality >= 0.9 ? "good" : "degraded",
        ageMs,
        clock,
        completeness: quality,
        reason:
          quality >= 0.9
            ? `${scan.ranges.length} beams, ${(quality * 100).toFixed(0)}% answering.`
            : `Only ${(quality * 100).toFixed(0)}% of ${scan.ranges.length} beams are answering.`,
      });
    }
  }

  // --- imu ----------------------------------------------------------------
  if (!has("imu")) {
    set.set("imu", absent("imu", "This robot has no IMU."));
  } else {
    const imu = robot.imu();
    const clock = imu.stamp ?? "arrival";
    const usable = Number.isFinite(imu.tilt) && Number.isFinite(imu.tiltRate);
    set.set("imu", {
      source: "imu",
      quality: usable ? "good" : "invalid",
      ageMs: imu.stamp === undefined ? null : now - imu.t,
      clock,
      completeness: usable ? 1 : 0,
      reason: usable
        ? `Tilt ${((imu.tilt * 180) / Math.PI).toFixed(1)}°.`
        : "The IMU is reporting values that are not numbers.",
    });
  }

  // --- pose and velocity --------------------------------------------------
  const pose = robot.pose();
  const poseUsable = Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.theta);
  set.set("pose", {
    source: "pose",
    quality: poseUsable ? "good" : "invalid",
    ageMs: null,
    clock: "none",
    completeness: poseUsable ? 1 : 0,
    reason: poseUsable
      ? `At (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}).`
      : "Odometry is not reporting a position.",
  });

  const velocity = robot.velocity();
  const velocityUsable = Number.isFinite(velocity.linear) && Number.isFinite(velocity.angular);
  set.set("velocity", {
    source: "velocity",
    quality: velocityUsable ? "good" : "invalid",
    ageMs: null,
    clock: "none",
    completeness: velocityUsable ? 1 : 0,
    reason: velocityUsable
      ? `${velocity.linear.toFixed(2)} m/s, ${velocity.angular.toFixed(2)} rad/s.`
      : "Odometry is not reporting a speed.",
  });

  // --- battery ------------------------------------------------------------
  if (!has("battery")) {
    set.set("battery", absent("battery", "This robot has no battery telemetry."));
  } else {
    const battery = robot.battery();
    const usable = Number.isFinite(battery.charge);
    // A charge figure whose units were never established is a reading, and it
    // is not one to plan a return journey on.
    const confident = battery.confident !== false;
    set.set("battery", {
      source: "battery",
      quality: !usable ? "invalid" : confident ? "good" : "degraded",
      ageMs: null,
      clock: "none",
      completeness: !usable ? 0 : confident ? 1 : 0.5,
      reason: !usable
        ? "The battery is not reporting a charge."
        : confident
          ? `${(battery.charge * 100).toFixed(0)}% charge.`
          : `${(battery.charge * 100).toFixed(0)}% charge, but the driver's units were never established.`,
    });
  }

  // --- perception ---------------------------------------------------------
  if (!has("camera")) {
    set.set(
      "people",
      absent("people", "Nothing on this robot detects people. An empty result means nobody is looking, not that nobody is there."),
    );
    set.set("detections", absent("detections", "Nothing on this robot detects objects."));
  } else {
    const people = robot.trackHumans();
    set.set("people", {
      source: "people",
      quality: "good",
      ageMs: null,
      clock: "none",
      completeness: 1,
      reason: `${people.length} person track(s).`,
    });
    const objects = robot.detectObjects();
    set.set("detections", {
      source: "detections",
      quality: "good",
      ageMs: null,
      clock: "none",
      completeness: 1,
      reason: `${objects.length} object detection(s).`,
    });
  }

  // --- manipulation -------------------------------------------------------
  if (!has("gripper")) {
    set.set("gripper", absent("gripper", "This robot has no gripper."));
  } else {
    const grip = robot.gripper();
    const sensed = grip.forceSensed !== false && Number.isFinite(grip.force);
    set.set("gripper", {
      source: "gripper",
      quality: sensed ? "good" : "degraded",
      ageMs: null,
      clock: "none",
      completeness: sensed ? 1 : 0.5,
      reason: sensed
        ? `Closed ${(grip.closure * 100).toFixed(0)}%, ${grip.force.toFixed(1)} N.`
        : "Position is known; force is not measured on this gripper.",
    });
  }

  set.set(
    "arm",
    has("arm")
      ? {
          source: "arm",
          quality: "good",
          ageMs: null,
          clock: "none",
          completeness: 1,
          reason: "Arm state is reporting.",
        }
      : absent("arm", "This robot has no arm."),
  );

  // --- transport ----------------------------------------------------------
  // Only a real link has anything to say here; the simulator's is in-process.
  const link = robot as {
    transportProblems?: () => number;
    isConnected?: () => boolean;
    inbound?: () => { everReceived: boolean; silentForMs: number };
  };
  if (typeof link.transportProblems !== "function") {
    set.set("transport", {
      source: "transport",
      quality: "good",
      ageMs: null,
      clock: "none",
      completeness: 1,
      reason: "In-process; there is no link to fail.",
    });
  } else {
    const problems = link.transportProblems();
    const connected = link.isConnected?.() ?? false;
    const inbound = link.inbound?.() ?? { everReceived: true, silentForMs: 0 };
    const quality: EvidenceQuality = !connected
      ? "absent"
      : !inbound.everReceived
        ? "invalid"
        : problems > 0
          ? "degraded"
          : "good";
    set.set("transport", {
      source: "transport",
      quality,
      ageMs: inbound.silentForMs,
      clock: "arrival",
      completeness: quality === "good" ? 1 : quality === "degraded" ? 0.5 : 0,
      reason: !connected
        ? "No connection to the robot."
        : !inbound.everReceived
          ? `Socket open, nothing has ever arrived (${inbound.silentForMs.toFixed(0)} ms).`
          : problems > 0
            ? `${problems} frame(s) or command(s) did not make it.`
            : "Carrying traffic both ways.",
    });
  }

  return set;
}

/** A one-line summary of everything, for a log or a refusal message. */
export function summariseEvidence(set: EvidenceSet): string {
  const byQuality = new Map<EvidenceQuality, string[]>();
  for (const [source, evidence] of set) {
    const list = byQuality.get(evidence.quality) ?? [];
    list.push(source);
    byQuality.set(evidence.quality, list);
  }
  const parts: string[] = [];
  for (const quality of ["invalid", "absent", "degraded", "good"] as EvidenceQuality[]) {
    const list = byQuality.get(quality);
    if (list && list.length > 0) parts.push(`${quality}: ${list.join(", ")}`);
  }
  return parts.join(" · ");
}
