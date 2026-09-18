// ── explore.frontier · المستكشف ─────────────────────────────────────────────
// Mapping a space nobody has told the robot about.
//
// The insight is small and complete: the interesting places to go are the
// boundaries between what you know is free and what you have not seen yet.
// Those boundaries are called frontiers, and driving to one is guaranteed to
// teach you something. Run out of frontiers and you have, by definition,
// mapped everything reachable.
//
// The judgement is in choosing *which* frontier: the biggest information gain
// is often across the room, and a robot that keeps crossing its own map to
// chase marginally better frontiers spends its battery on travel. So gain is
// discounted by distance, and the discount is what makes exploration finish.

import { distance, type Vec2 } from "../core/math.ts";
import { driveTo, turnTo, ROBOT_RADIUS } from "./_motion.ts";
import type { Ability, AbilityContext, AbilityResult } from "../core/types.ts";

export type ExploreInput = {
  /** Grid cell size in metres. Smaller = sharper map, more memory. */
  resolution?: number;
  /** Stop once this fraction of reachable cells is known, 0..1. */
  coverageTarget?: number;
  /** Hard cap on exploration time, ms. */
  budgetMs?: number;
  /** Stop if the battery falls below this, 0..1. */
  minCharge?: number;
  /** Metres of travel that cancel out one cell of information gain. */
  travelPenalty?: number;
};

export type ExploreReport = {
  coverage: number;
  knownCells: number;
  freeCells: number;
  occupiedCells: number;
  frontiersVisited: number;
  frontiersRemaining: number;
  travelled: number;
  elapsedMs: number;
  /** Cells newly mapped per metre driven — the real efficiency number. */
  cellsPerMetre: number;
};

/** Where the published map lives in ability memory. */
export const MAP_KEY = "map:occupancy";

/** The map as anything outside the ability sees it. */
export type PublishedMap = {
  resolution: number;
  origin: Vec2;
  width: number;
  height: number;
  /** 0 unknown, 1 free, 2 occupied — row-major. */
  cells: number[];
  updatedAtMs: number;
};

type Grid = {
  resolution: number;
  width: number;
  height: number;
  /** Log-odds occupancy. 0 = unknown, >0 occupied, <0 free. */
  cells: Float32Array;
  /**
   * Whether a cell has ever been inside a sensor reading, regardless of what
   * that reading concluded. Occupancy alone is a bad frontier test: a cell on
   * the edge of a wall collects free and occupied evidence in equal measure and
   * hovers around zero forever, so it stays "unknown" no matter how many times
   * the robot looks at it — and the robot keeps going back. Having looked is a
   * fact that does not flicker.
   */
  seen: Uint8Array;
};

export const exploreFrontier: Ability<ExploreInput, ExploreReport> = {
  manifest: {
    id: "explore.frontier",
    version: "1.0.0",
    name: { en: "Frontier Explorer", ar: "المستكشف" },
    summary: {
      en: "Builds an occupancy map of an unknown space by repeatedly driving to the best boundary between the known and the unseen.",
      ar: "بيبني خريطة لمكان مجهول عن طريق إنه يروح كل مرة على أفضل حدّ بين المعروف وغير المكتشف.",
    },
    rationale:
      "Exploration has an elegant stopping condition that most search strategies lack: " +
      "when there are no frontiers left, the reachable space is mapped, and the robot " +
      "knows it is finished rather than guessing. Weighing each frontier's information " +
      "gain against the cost of driving there keeps the robot from ping-ponging across " +
      "the map, and reporting cells-mapped-per-metre makes it obvious when a sensor or " +
      "a cluttered room is making exploration expensive.",
    tags: ["navigation", "mapping", "autonomy"],
    risk: "motion",
    requires: ["drive", "lidar", "battery"],
    // Frontier exploration is built on the claim that unobserved space is
    // distinguishable from observed empty space, so the scan not arriving has to
    // be distinguishable from the scan finding nothing.
    evidence: [
      {
        source: "lidar" as const,
        because: "a frontier is the boundary between what the scan has seen and what it has not",
        maxAgeMs: 500,
        acceptDegraded: true,
      },
      { source: "pose" as const, because: "every observation is recorded against where it was taken" },
      {
        source: "battery" as const,
        because: "exploring is open-ended, and the way it should end is a charge budget",
      },
    ],
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Maps 95% of reachable cells over 27.5 m in the demo, with a real stopping condition: no " +
        "frontiers left. Simulated raycast lidar and perfect pose.",
      verification:
        "Run it in a room whose floor area is known, and compare the mapped area against a tape " +
        "measurement. Then repeat from a different start pose — a map that depends on where the " +
        "robot began is a map dominated by odometry drift.",
      failureModes: [
        "Odometry drift accumulates into the map, so on a real robot without SLAM the same wall " +
          "gets recorded in several places and frontiers appear where the map disagrees with itself.",
        "Glass and polished metal return nothing to a lidar, so they map as open space and stay " +
          "frontiers forever.",
        "The stopping condition is about frontiers, not about whether the map is any good.",
      ],
      degradedModes: [
        "A thinned scan maps more slowly rather than wrongly, because an unanswered beam records " +
          "nothing rather than recording free space.",
      ],
      safetyBoundary:
        "Stops on the battery budget rather than on reaching a charge threshold, and stops when " +
        "frontiers run out rather than wandering.",
    },
    typicalDurationMs: 60_000,
    inputSchema: {
      type: "object",
      properties: {
        resolution: { type: "number", description: "Cell size, m.", default: 0.3 },
        coverageTarget: { type: "number", description: "Stop at this coverage, 0..1.", default: 0.9 },
        budgetMs: { type: "number", description: "Time budget, ms.", default: 180000 },
        minCharge: { type: "number", description: "Stop below this charge.", default: 0.15 },
        travelPenalty: {
          type: "number",
          description: "Cells of gain traded per metre of travel.",
          default: 1.4,
        },
      },
      required: [],
    },
  },

  async run(input, ctx): Promise<AbilityResult<ExploreReport>> {
    const resolution = input.resolution ?? 0.3;
    const coverageTarget = input.coverageTarget ?? 0.9;
    const budgetMs = input.budgetMs ?? 180_000;
    const minCharge = input.minCharge ?? 0.15;
    const travelPenalty = input.travelPenalty ?? 1.4;

    const started = ctx.now();
    const scan0 = ctx.robot.lidar();
    // Size the grid from sensor range: enough to hold whatever we can reach.
    const extent = scan0.maxRange * 2.6;
    const side = Math.ceil(extent / resolution);
    const grid: Grid = {
      resolution,
      width: side,
      height: side,
      cells: new Float32Array(side * side),
      seen: new Uint8Array(side * side),
    };
    const origin: Vec2 = {
      x: ctx.robot.pose().x - extent / 2,
      y: ctx.robot.pose().y - extent / 2,
    };

    let travelled = 0;
    let frontiersVisited = 0;
    let previousPose = ctx.robot.pose();
    let lastPublish = 0;

    // Publishing the map as it fills, rather than only at the end, is what lets
    // anything else — a UI, an operator, another robot — watch the space become
    // known instead of waiting for a verdict.
    const publish = () => {
      ctx.memory.set(MAP_KEY, {
        resolution,
        origin,
        width: grid.width,
        height: grid.height,
        /** 0 unknown, 1 free, 2 occupied. */
        cells: Array.from(grid.cells, (value, index) =>
          grid.seen[index] === 0 ? 0 : value > 0.5 ? 2 : value < -0.5 ? 1 : 0,
        ),
        updatedAtMs: ctx.now(),
      });
      lastPublish = ctx.now();
    };

    integrateScan(grid, origin, ctx);
    publish();

    while (!ctx.signal.aborted) {
      const elapsed = ctx.now() - started;
      const charge = ctx.robot.battery().charge;
      const stats = summarise(grid, origin, ctx.robot.pose());

      if (elapsed > budgetMs) break;
      if (charge < minCharge) {
        ctx.emit({ kind: "warn", message: `Stopping exploration at ${(charge * 100).toFixed(0)}% charge.` });
        break;
      }
      if (stats.coverage >= coverageTarget) break;

      const frontiers = findFrontiers(grid, origin);
      if (frontiers.length === 0) {
        ctx.emit({
          kind: "status",
          message: "No frontiers left — everything reachable is mapped.",
          ar: "ما ضل حدود — كل الوصول ممكن انمسح.",
        });
        break;
      }

      const pose = ctx.robot.pose();
      const best = frontiers
        .map((f) => ({
          ...f,
          score: f.gain - distance(pose, f.at) * travelPenalty,
        }))
        .sort((a, b) => b.score - a.score)[0];

      ctx.emit({ kind: "mark", label: `frontier +${best.gain}`, at: best.at });
      ctx.emit({
        kind: "status",
        message: `${frontiers.length} frontier(s) open; heading for one worth ${best.gain} cells at ${distance(pose, best.at).toFixed(1)} m`,
        ar: `في ${frontiers.length} حدّ مفتوح؛ رايح على واحد بيعطي ${best.gain} خانة على بعد ${distance(pose, best.at).toFixed(1)} متر`,
      });

      // If the best frontier is already underfoot, driving there teaches
      // nothing and loops forever. Turn on the spot instead — the lidar covers
      // 270°, so a rotation is the cheapest way to convert a blind arc into map.
      if (distance(pose, best.at) < resolution * 3) {
        await sweep(ctx, grid, origin);
        markBlocked(grid, origin, best.at);
        frontiersVisited += 1;
        await ctx.sleep(100);
        continue;
      }

      const outcome = await driveTo(ctx, best.at, {
        tolerance: resolution * 2,
        maxLinear: 0.75,
        timeoutMs: 15_000,
        stallMs: 6000,
        onStep: () => {
          const now = ctx.robot.pose();
          travelled += distance(now, previousPose);
          previousPose = now;
          integrateScan(grid, origin, ctx);
          if (ctx.now() - lastPublish > 700) publish();
        },
      });

      frontiersVisited += 1;
      // A full turn on arrival: the blind arc behind the robot is exactly where
      // the next frontier usually is.
      if (outcome.ok) await sweep(ctx, grid, origin);
      integrateScan(grid, origin, ctx);
      // Never spin the loop without letting the clock move, or a budget can
      // never expire.
      await ctx.sleep(100);

      if (outcome.reason === "aborted") break;
      if (!outcome.ok) {
        // We tried and could not get there. Whatever the reason — blocked,
        // stalled, or simply too slow — writing it off is what stops the robot
        // choosing the same unreachable frontier for the rest of the mission.
        markBlocked(grid, origin, best.at);
        ctx.emit({
          kind: "warn",
          message: `Frontier at (${best.at.x.toFixed(1)}, ${best.at.y.toFixed(1)}) unreachable (${outcome.reason}) — written off.`,
        });
      }
    }

    ctx.robot.stop();
    const stats = summarise(grid, origin, ctx.robot.pose());
    const remaining = findFrontiers(grid, origin).length;
    const elapsedMs = ctx.now() - started;

    const report: ExploreReport = {
      coverage: stats.coverage,
      knownCells: stats.known,
      freeCells: stats.free,
      occupiedCells: stats.occupied,
      frontiersVisited,
      frontiersRemaining: remaining,
      travelled,
      elapsedMs,
      cellsPerMetre: travelled > 0.1 ? stats.known / travelled : 0,
    };

    publish();
    ctx.emit({ kind: "metric", name: "explore.coverage", value: stats.coverage });

    return {
      ok: remaining === 0 || stats.coverage >= coverageTarget,
      summary: `Mapped ${stats.known} cells (${(stats.coverage * 100).toFixed(0)}% of what's reachable) over ${travelled.toFixed(1)} m and ${frontiersVisited} frontier(s) — ${report.cellsPerMetre.toFixed(1)} cells per metre${remaining ? `, ${remaining} frontier(s) still open` : ", nothing left to explore"}.`,
      data: report,
      metrics: {
        coverage: stats.coverage,
        travelled,
        cellsPerMetre: report.cellsPerMetre,
      },
    };
  },
};

/** Turn a full circle, folding scans in as we go. */
async function sweep(ctx: AbilityContext, grid: Grid, origin: Vec2): Promise<void> {
  const start = ctx.robot.pose().theta;
  for (const fraction of [0.33, 0.66, 0.99]) {
    if (ctx.signal.aborted) return;
    await turnTo(ctx, start + fraction * Math.PI * 2, 0.15, 4000);
    integrateScan(grid, origin, ctx);
  }
}

/** Fold the current lidar scan into the occupancy grid. */
function integrateScan(grid: Grid, origin: Vec2, ctx: AbilityContext): void {
  const scan = ctx.robot.lidar();
  const pose = ctx.robot.pose();
  const step = scan.fov / Math.max(scan.ranges.length - 1, 1);

  let previousHit: Vec2 | null = null;

  for (let i = 0; i < scan.ranges.length; i += 1) {
    const angle = pose.theta - scan.fov / 2 + i * step;
    const range = scan.ranges[i];
    const hit = range < scan.maxRange - 0.05;

    // Everything the beam passed through is free — but stop well short of the
    // hit. A beam striking a wall at a shallow angle clips cells that hold the
    // wall itself, and marking those free punches a hole straight through it.
    // One hole is enough to make "how much is left to explore" meaningless.
    const freeUntil = range - grid.resolution * 2.5;
    for (let d = 0; d < freeUntil; d += grid.resolution * 0.5) {
      bump(
        grid,
        origin,
        { x: pose.x + Math.cos(angle) * d, y: pose.y + Math.sin(angle) * d },
        -0.7,
      );
    }

    if (!hit) {
      previousHit = null;
      continue;
    }

    // And whatever stopped it is not.
    const at = { x: pose.x + Math.cos(angle) * range, y: pose.y + Math.sin(angle) * range };
    bump(grid, origin, at, 1.4);

    // Beams diverge with range, so a distant wall arrives as a dotted line of
    // hits with unmapped gaps between them. Joining consecutive hits that are
    // plausibly the same surface closes those gaps — without it, every wall in
    // the map leaks, and "how much is left to explore" becomes meaningless.
    if (previousHit && distance(previousHit, at) < 0.6) {
      const steps = Math.ceil(distance(previousHit, at) / (grid.resolution * 0.5));
      for (let k = 1; k < steps; k += 1) {
        const f = k / steps;
        bump(
          grid,
          origin,
          {
            x: previousHit.x + (at.x - previousHit.x) * f,
            y: previousHit.y + (at.y - previousHit.y) * f,
          },
          1.0,
        );
      }
    }
    previousHit = at;
  }
}

function bump(grid: Grid, origin: Vec2, at: Vec2, delta: number): void {
  const cx = Math.floor((at.x - origin.x) / grid.resolution);
  const cy = Math.floor((at.y - origin.y) / grid.resolution);
  if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return;
  const index = cy * grid.width + cx;
  // Clamped log-odds: bounded confidence means the map can still change its
  // mind when a door opens or a pallet moves.
  grid.cells[index] = Math.max(-6, Math.min(6, grid.cells[index] + delta));
  grid.seen[index] = 1;
}

/** Write off a patch of map: solid, and considered looked at, so no frontier survives there. */
function markBlocked(grid: Grid, origin: Vec2, at: Vec2, radius = 2): void {
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      bump(grid, origin, { x: at.x + dx * grid.resolution, y: at.y + dy * grid.resolution }, 6);
    }
  }
}

/**
 * Coverage is measured against the space the robot could still walk into: flood
 * fill outward from where it is standing, through anything not known to be
 * occupied, and see how much of that region has actually been observed.
 *
 * Early on the fill leaks through unmapped gaps and spills across the grid, so
 * coverage reads low — correctly, because the robot has no idea how big the
 * place is. As walls get mapped the region closes in on the real room, and
 * coverage approaches the truth. Measuring against the known cells plus their
 * immediate fringe would instead report 90% after one scan, which is how an
 * explorer talks itself into stopping in the first room it enters.
 */
function summarise(
  grid: Grid,
  origin: Vec2,
  at: Vec2,
): { known: number; free: number; occupied: number; coverage: number } {
  let free = 0;
  let occupied = 0;
  for (let i = 0; i < grid.cells.length; i += 1) {
    if (grid.cells[i] < -0.5) free += 1;
    else if (grid.cells[i] > 0.5) occupied += 1;
  }
  const known = free + occupied;

  const startX = Math.floor((at.x - origin.x) / grid.resolution);
  const startY = Math.floor((at.y - origin.y) / grid.resolution);
  const reachable = floodFill(grid, startX, startY, knownBounds(grid));

  return {
    known,
    free,
    occupied,
    coverage: reachable.total > 0 ? reachable.observed / reachable.total : 0,
  };
}

/** The rectangle containing everything the robot has actually sensed. */
function knownBounds(grid: Grid): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = grid.width;
  let minY = grid.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (Math.abs(grid.cells[y * grid.width + x]) <= 0.5) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // One cell of margin, so a room whose far wall is exactly on the boundary
  // still has somewhere for its frontier to live.
  return {
    minX: Math.max(minX - 1, 0),
    minY: Math.max(minY - 1, 0),
    maxX: Math.min(maxX + 1, grid.width - 1),
    maxY: Math.min(maxY + 1, grid.height - 1),
  };
}

/**
 * Cells reachable from (x, y) without passing through anything known to be
 * solid, confined to the region the robot has sensed. The confinement matters:
 * a single unmapped gap in a wall would otherwise let the fill spill across the
 * whole grid, and coverage would report the robot's ignorance of empty space it
 * has no reason to believe exists.
 */
function floodFill(
  grid: Grid,
  startX: number,
  startY: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): { total: number; observed: number } {
  if (startX < bounds.minX || startY < bounds.minY || startX > bounds.maxX || startY > bounds.maxY) {
    return { total: 0, observed: 0 };
  }
  const seen = new Uint8Array(grid.cells.length);
  const stack: number[] = [startY * grid.width + startX];
  seen[stack[0]] = 1;

  let total = 0;
  let observed = 0;

  while (stack.length > 0) {
    const index = stack.pop() as number;
    total += 1;
    if (grid.seen[index] === 1) observed += 1;

    const x = index % grid.width;
    const y = (index - x) / grid.width;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < bounds.minX || ny < bounds.minY || nx > bounds.maxX || ny > bounds.maxY) continue;
      const ni = ny * grid.width + nx;
      if (seen[ni]) continue;
      // Solid cells bound the region; free and unknown are both walkable until
      // proven otherwise.
      if (grid.cells[ni] > 0.5) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }

  return { total, observed };
}

/**
 * The closest cell to (x, y) that is observed free and has room for the robot's
 * body — not merely free for a laser beam.
 */
function nearestFreeCell(
  grid: Grid,
  x: number,
  y: number,
  clearanceCells: number,
  maxRadius = 8,
): { x: number; y: number } | null {
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        if (grid.cells[ny * grid.width + nx] >= -0.5) continue;
        if (hasClearance(grid, nx, ny, clearanceCells)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/** No solid cell within `cells` of (x, y). */
function hasClearance(grid: Grid, x: number, y: number, cells: number): boolean {
  for (let dy = -cells; dy <= cells; dy += 1) {
    for (let dx = -cells; dx <= cells; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      if (grid.cells[ny * grid.width + nx] > 0.5) return false;
    }
  }
  return true;
}

function hasFreeNeighbour(grid: Grid, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      if (grid.cells[ny * grid.width + nx] < -0.5) return true;
    }
  }
  return false;
}

/**
 * Frontier cells are unknown cells touching free space. They are clustered so
 * that one wide doorway is a single destination worth many cells, rather than
 * fifteen destinations worth one each.
 */
function findFrontiers(
  grid: Grid,
  origin: Vec2,
): Array<{ at: Vec2; gain: number }> {
  // The map says where the sensor saw floor; the robot is wider than a beam, so
  // a target has to be far enough from anything solid for the body to fit.
  const clearanceCells = Math.ceil(ROBOT_RADIUS / grid.resolution) + 1;
  const seen = new Uint8Array(grid.cells.length);
  const clusters: Array<{ at: Vec2; gain: number }> = [];

  const isFrontier = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= grid.width - 1 || y >= grid.height - 1) return false;
    // Never looked at, and next to somewhere we know we can stand.
    if (grid.seen[y * grid.width + x] === 1) return false;
    return hasFreeNeighbour(grid, x, y);
  };

  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      const index = y * grid.width + x;
      if (seen[index] || !isFrontier(x, y)) continue;

      // Flood-fill this frontier cluster.
      const queue: Array<[number, number]> = [[x, y]];
      seen[index] = 1;
      let sumX = 0;
      let sumY = 0;
      let count = 0;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop() as [number, number];
        sumX += cx;
        sumY += cy;
        count += 1;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = cx + dx;
            const ny = cy + dy;
            const ni = ny * grid.width + nx;
            if (nx < 1 || ny < 1 || nx >= grid.width - 1 || ny >= grid.height - 1) continue;
            if (seen[ni] || !isFrontier(nx, ny)) continue;
            seen[ni] = 1;
            queue.push([nx, ny]);
          }
        }
      }

      // Single stray cells are usually sensor noise, not a doorway.
      if (count < 3) continue;

      // Drive to known-free ground beside the frontier, not to the centroid
      // itself: the centroid is unknown space by definition, and may well be
      // the inside of a desk. Aiming at the nearest observed-free cell keeps
      // every exploration target reachable.
      const approach = nearestFreeCell(
        grid,
        Math.round(sumX / count),
        Math.round(sumY / count),
        clearanceCells,
      );
      if (!approach) continue;

      clusters.push({
        at: {
          x: origin.x + (approach.x + 0.5) * grid.resolution,
          y: origin.y + (approach.y + 0.5) * grid.resolution,
        },
        gain: count,
      });
    }
  }

  return clusters;
}
