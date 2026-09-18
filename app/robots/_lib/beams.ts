// The geometry of a lidar scan, with no renderer attached.
//
// Both views draw the same fan, and both have to put beam `i` at the same angle
// the adapter cast it at. That is three separate places agreeing on one
// convention, which is exactly the kind of agreement that quietly stops being
// true — so the convention lives here, on its own, where a test can hold it.

/** What came back on one beam. The three are not interchangeable. */
export type BeamKind =
  /** A surface, at this range. */
  | "hit"
  /** Nothing within the sensor's reach along this ray. Real, negative information. */
  | "clear"
  /** The beam did not come back. Nothing at all is known along this ray. */
  | "missing";

export type Beam = {
  kind: BeamKind;
  /** Angle relative to the robot's heading, radians. */
  angle: number;
  /** How far to draw. Meaningless for a missing beam, which should not be drawn. */
  reach: number;
};

/**
 * Angle of sample `i` relative to the robot's heading.
 *
 * `ranges` carries every `stride`-th beam of the original scan, so the last
 * sample sits on beam `(count - 1) * stride` and that is what the field of view
 * is divided across — not `count * stride`, which spreads the fan a beam too
 * wide, and not `count * stride - 1`.
 */
export function beamAngle(fov: number, stride: number, count: number, i: number): number {
  const step = fov / Math.max(1, (count - 1) * stride);
  return -fov / 2 + i * stride * step;
}

export function classify(range: number, maxRange: number): BeamKind {
  if (!Number.isFinite(range)) return "missing";
  return range >= maxRange - 0.05 ? "clear" : "hit";
}

export function beams(scan: {
  ranges: number[];
  fov: number;
  stride: number;
  maxRange: number;
}): Beam[] {
  const { ranges, fov, stride, maxRange } = scan;
  return ranges.map((r, i) => {
    const kind = classify(r, maxRange);
    return {
      kind,
      angle: beamAngle(fov, stride, ranges.length, i),
      reach: kind === "hit" ? Math.min(r, maxRange) : maxRange,
    };
  });
}

/**
 * Where a beam lands in the world. This is the reference the 2D renderer draws
 * directly, and the one the 3D renderer has to reproduce through a rotated
 * group; see `beamLocal`.
 */
export function beamWorld(
  robot: { x: number; y: number; theta: number },
  beam: Beam,
): { x: number; y: number } {
  const a = robot.theta + beam.angle;
  return { x: robot.x + Math.cos(a) * beam.reach, y: robot.y + Math.sin(a) * beam.reach };
}

/**
 * The same point in the robot's own frame, laid out the way the 3D scene is:
 * three's +x is the robot's forward, and three's +z is the world's +y.
 *
 * The 3D renderer puts the fan in a group with `rotation.y = -theta`. Rotating
 * about three's +y by `-theta` maps `(x, z)` to `(x cosθ - z sinθ, x sinθ + z
 * cosθ)`, which is a plain rotation by `+theta` of `(x, z)` read as `(x, y)`.
 * So `z` must carry `+sin(angle)`: negating it reflects the entire scan about
 * the robot's forward axis, which looks almost right and is not.
 */
export function beamLocal(beam: Beam): { x: number; z: number } {
  return { x: Math.cos(beam.angle) * beam.reach, z: Math.sin(beam.angle) * beam.reach };
}

/** Apply that group rotation, so a test can check the two agree. */
export function localToWorld(
  robot: { x: number; y: number; theta: number },
  local: { x: number; z: number },
): { x: number; y: number } {
  const c = Math.cos(robot.theta);
  const s = Math.sin(robot.theta);
  return { x: robot.x + local.x * c - local.z * s, y: robot.y + local.x * s + local.z * c };
}
