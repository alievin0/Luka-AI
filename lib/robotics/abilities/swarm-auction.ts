// ── swarm.auction · مزاد السرب ──────────────────────────────────────────────
// Dividing work between robots with no one in charge.
//
// A central dispatcher is a single point of failure and a bottleneck, and it is
// always working from stale information about where everyone is. A market is
// not: whoever is announcing a job broadcasts it, every robot that can do it
// bids its own honest cost — distance, battery, whether it is already busy —
// and the cheapest bid wins. Nobody needs a map of the fleet, and a robot that
// goes silent simply stops winning work.
//
// This is the Contract Net Protocol, which has been the right answer since 1980
// and still is.

import { distance, type Vec2 } from "../core/math.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type SwarmTask = { id: string; x: number; y: number; priority?: number };

export type SwarmInput = {
  role?: "auctioneer" | "bidder";
  /** Auctioneer: the jobs to hand out. */
  tasks?: SwarmTask[];
  /** How long to wait for bids, ms. */
  bidWindowMs?: number;
  /** Bidder: how long to stay available, ms. */
  listenMs?: number;
  /** Refuse to bid below this charge, 0..1. */
  minCharge?: number;
  /** Radio topic, so two fleets can share a floor. */
  topic?: string;
};

export type SwarmBid = { taskId: string; robot: string; cost: number; charge: number };

export type SwarmReport = {
  role: string;
  /** Auctioneer: who got what. */
  awards: Array<{ taskId: string; robot: string; cost: number; runnerUp?: number }>;
  /** Auctioneer: jobs nobody could take. */
  unassigned: string[];
  /** Bidder: jobs this robot won. */
  won: string[];
  bidsPlaced: number;
  bidsReceived: number;
};

const TOPIC = (base: string, kind: string) => `${base}/${kind}`;

export const swarmAuction: Ability<SwarmInput, SwarmReport> = {
  manifest: {
    id: "swarm.auction",
    version: "1.0.0",
    name: { en: "Swarm Task Auction", ar: "مزاد السرب" },
    summary: {
      en: "Robots divide a pile of jobs between themselves by bidding their true cost — no dispatcher, no fleet map, no single point of failure.",
      ar: "الروبوتات بتوزّع الشغل بينها بالمزاد، كل واحد بيقدّم كلفته الحقيقية — بدون موزّع مركزي ولا نقطة فشل وحدة.",
    },
    rationale:
      "Allocation is the hard part of running more than one robot, and the obvious " +
      "solution — a central planner — is the wrong one: it needs global state it cannot " +
      "keep fresh, and when it dies the whole fleet stops. Auctions push the estimate " +
      "to the only place it is accurate, the robot itself, which knows its own battery, " +
      "position and current load. The result degrades gracefully: lose a robot and its " +
      "jobs are simply re-auctioned.",
    tags: ["multi-robot", "coordination", "planning"],
    risk: "passive",
    requires: ["radio", "battery"],
    typicalDurationMs: 3000,
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description: "auctioneer runs the sale; bidder answers it.",
          enum: ["auctioneer", "bidder"],
          default: "bidder",
        },
        tasks: {
          type: "array",
          description: "Jobs to auction (auctioneer only).",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              priority: { type: "number" },
            },
            required: ["id", "x", "y"],
          },
        },
        bidWindowMs: { type: "number", description: "How long bids stay open.", default: 1200 },
        listenMs: { type: "number", description: "How long a bidder stays available.", default: 4000 },
        minCharge: { type: "number", description: "Refuse to bid below this charge.", default: 0.15 },
        topic: { type: "string", description: "Radio topic prefix.", default: "swarm" },
      },
      required: [],
    },
  },

  async run(input, ctx): Promise<AbilityResult<SwarmReport>> {
    const role = input.role ?? "bidder";
    const topic = input.topic ?? "swarm";
    const bidWindowMs = input.bidWindowMs ?? 1200;
    const minCharge = input.minCharge ?? 0.15;

    const report: SwarmReport = {
      role,
      awards: [],
      unassigned: [],
      won: [],
      bidsPlaced: 0,
      bidsReceived: 0,
    };

    if (role === "bidder") {
      const listenMs = input.listenMs ?? 4000;
      const until = ctx.now() + listenMs;

      while (ctx.now() < until && !ctx.signal.aborted) {
        for (const message of ctx.robot.receive(TOPIC(topic, "call-for-bids"))) {
          const task = message as SwarmTask;
          if (!task?.id) continue;

          const battery = ctx.robot.battery();
          if (battery.charge < minCharge) {
            ctx.emit({
              kind: "status",
              message: `Sitting out ${task.id} — only ${(battery.charge * 100).toFixed(0)}% charge`,
              ar: `مو مشارك بـ ${task.id} — البطارية ${(battery.charge * 100).toFixed(0)}٪`,
            });
            continue;
          }

          const bid: SwarmBid = {
            taskId: task.id,
            robot: ctx.robot.id,
            cost: bidCost(ctx.robot.pose(), task, battery.charge),
            charge: battery.charge,
          };
          ctx.robot.broadcast(TOPIC(topic, "bid"), bid);
          report.bidsPlaced += 1;
          ctx.emit({
            kind: "signal",
            channel: "radio",
            payload: `bid ${bid.cost.toFixed(1)} on ${task.id}`,
          });
        }

        for (const message of ctx.robot.receive(TOPIC(topic, "award"))) {
          const award = message as { taskId: string; robot: string };
          if (award?.robot === ctx.robot.id) {
            report.won.push(award.taskId);
            ctx.emit({
              kind: "status",
              message: `Won ${award.taskId}`,
              ar: `ربحت ${award.taskId}`,
            });
          }
        }

        await ctx.sleep(100);
      }

      return {
        ok: true,
        summary: report.won.length
          ? `Bid on ${report.bidsPlaced} job(s), won ${report.won.length}: ${report.won.join(", ")}.`
          : `Bid on ${report.bidsPlaced} job(s), won none.`,
        data: report,
        metrics: { bidsPlaced: report.bidsPlaced, won: report.won.length },
      };
    }

    // Auctioneer.
    const tasks = input.tasks ?? [];
    if (tasks.length === 0) {
      return { ok: false, summary: "Nothing to auction.", failure: "precondition", data: report };
    }

    // Highest priority first, so the important jobs get the best robots.
    const ordered = [...tasks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const taken = new Set<string>();

    for (const task of ordered) {
      ctx.robot.broadcast(TOPIC(topic, "call-for-bids"), task);
      ctx.emit({
        kind: "signal",
        channel: "radio",
        payload: `call for bids: ${task.id} at (${task.x}, ${task.y})`,
      });

      const deadline = ctx.now() + bidWindowMs;
      const bids: SwarmBid[] = [];
      while (ctx.now() < deadline && !ctx.signal.aborted) {
        for (const message of ctx.robot.receive(TOPIC(topic, "bid"))) {
          const bid = message as SwarmBid;
          if (bid?.taskId === task.id && !taken.has(bid.robot)) bids.push(bid);
        }
        await ctx.sleep(50);
      }
      report.bidsReceived += bids.length;

      // The auctioneer can do the job itself if nobody else is cheaper.
      const ownBid: SwarmBid = {
        taskId: task.id,
        robot: ctx.robot.id,
        cost: bidCost(ctx.robot.pose(), task, ctx.robot.battery().charge),
        charge: ctx.robot.battery().charge,
      };
      if (!taken.has(ctx.robot.id)) bids.push(ownBid);

      if (bids.length === 0) {
        report.unassigned.push(task.id);
        ctx.emit({ kind: "warn", message: `No bids for ${task.id}.` });
        continue;
      }

      // Cheapest wins; ties break on robot id so every robot in the fleet
      // computes the same winner without another round of messages.
      bids.sort((a, b) => a.cost - b.cost || a.robot.localeCompare(b.robot));
      const [winner, runnerUp] = bids;

      taken.add(winner.robot);
      report.awards.push({
        taskId: task.id,
        robot: winner.robot,
        cost: winner.cost,
        runnerUp: runnerUp?.cost,
      });
      ctx.robot.broadcast(TOPIC(topic, "award"), { taskId: task.id, robot: winner.robot });
      ctx.emit({
        kind: "status",
        message: `${task.id} → ${winner.robot} (cost ${winner.cost.toFixed(1)}${runnerUp ? `, next best ${runnerUp.cost.toFixed(1)}` : ""})`,
        ar: `${task.id} ← ${winner.robot} (كلفة ${winner.cost.toFixed(1)})`,
      });
    }

    // Let the winners hear their awards before the auction closes.
    await ctx.sleep(200);

    const totalCost = report.awards.reduce((sum, a) => sum + a.cost, 0);
    return {
      ok: report.unassigned.length === 0,
      summary: `Auctioned ${tasks.length} job(s) to ${new Set(report.awards.map((a) => a.robot)).size} robot(s) for a total cost of ${totalCost.toFixed(1)}${report.unassigned.length ? `; ${report.unassigned.length} went unclaimed` : ""}.`,
      data: report,
      metrics: {
        awarded: report.awards.length,
        unassigned: report.unassigned.length,
        totalCost,
      },
      failure: report.unassigned.length === 0 ? undefined : "gave-up",
    };
  },
};

/**
 * What this job would really cost me: the drive there, plus a penalty that grows
 * steeply as the battery empties, so a robot on its last quarter stops
 * out-bidding a fresher one for distant work.
 */
function bidCost(from: Vec2, task: SwarmTask, charge: number): number {
  const travel = distance(from, task);
  const batteryPenalty = charge > 0 ? (1 - charge) ** 2 * 18 : 100;
  const urgency = task.priority ? 1 / (1 + task.priority * 0.15) : 1;
  return (travel + batteryPenalty) * urgency;
}
