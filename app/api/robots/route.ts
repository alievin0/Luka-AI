// Streams a robot mission to the browser.
//
// The kernel already emits telemetry as it works; this route adds world frames
// so the page can draw what is happening, and runs the mission at a chosen
// multiple of wall-clock speed so it is watchable rather than instant.

import { NextRequest } from "next/server";
import { createSimRig, SCENARIOS, type ScenarioName } from "@/lib/robotics/index.ts";
import { createInMemoryBackend } from "@/lib/robotics/core/memory.ts";
import { MAP_KEY, type PublishedMap } from "@/lib/robotics/abilities/explore-frontier.ts";
import { DEMOS, runDemo, type DemoName } from "@/lib/robotics/demos.ts";
import type { SimRig } from "@/lib/robotics/index.ts";
import type { AbilityEvent } from "@/lib/robotics/core/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  demo?: DemoName;
  ability?: string;
  input?: Record<string, unknown>;
  scenario?: ScenarioName;
  seed?: number;
  /** 1 = wall-clock, 4 = four times faster. */
  speed?: number;
};

/** The catalogue, for the page to render without a second round trip. */
export async function GET() {
  const rig = createSimRig({ scenario: "empty-hall" });
  return Response.json({
    abilities: rig.registry.manifests().map((m) => ({
      id: m.id,
      name: m.name,
      summary: m.summary,
      rationale: m.rationale,
      risk: m.risk,
      requires: m.requires,
      tags: m.tags,
      daemon: m.daemon ?? false,
      inputSchema: m.inputSchema,
      typicalDurationMs: m.typicalDurationMs,
    })),
    demos: Object.entries(DEMOS).map(([name, demo]) => ({
      name,
      title: demo.title,
      blurb: demo.blurb,
      abilities: demo.abilities,
    })),
    scenarios: Object.values(SCENARIOS).map((s) => ({
      name: s.name,
      title: s.title,
      description: s.description,
    })),
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Body;
  const speed = Math.min(Math.max(body.speed ?? 6, 1), 60);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      let sampler: ReturnType<typeof setInterval> | null = null;
      const memoryBackend = createInMemoryBackend();
      let lastMapAt = -1;

      const bindRig = (rig: SimRig) => {
        if (sampler) clearInterval(sampler);
        lastMapAt = -1;
        send("setup", describeWorld(rig));
        sampler = setInterval(() => {
          send("frame", snapshot(rig));
          // The map is large and changes slowly; send it only when it moves on.
          const map = memoryBackend.read(`${rig.robot.id}:${MAP_KEY}`) as
            | PublishedMap
            | undefined;
          if (map && map.updatedAtMs !== lastMapAt) {
            lastMapAt = map.updatedAtMs;
            send("map", packMap(map));
          }
        }, 60);
      };

      const onEvent = (event: AbilityEvent) => send("log", event);

      try {
        if (body.demo) {
          const demo = DEMOS[body.demo];
          if (!demo) {
            send("done", { ok: false, summary: `Unknown demo "${body.demo}".` });
            return;
          }
          const outcome = await runDemo(body.demo, {
            seed: body.seed,
            realtimeFactor: speed,
            onEvent,
            onRig: bindRig,
            memoryBackend,
          });
          send("done", outcome);
          return;
        }

        const rig = createSimRig({
          scenario: body.scenario ?? "cluttered-office",
          seed: body.seed,
          realtimeFactor: speed,
          memoryBackend,
        });
        rig.runtime.on(onEvent);
        bindRig(rig);

        const abilityId = body.ability ?? "navigate.to";
        if (!rig.registry.has(abilityId)) {
          send("done", {
            ok: false,
            summary: `Unknown ability "${abilityId}".`,
            details: [],
            metrics: {},
          });
          return;
        }

        // Anything that moves runs with the shield up.
        const risky = rig.registry.require(abilityId).manifest.risk !== "passive";
        const shield = risky ? rig.runtime.startDaemon("reflex.shield", {}) : null;

        const result = await rig.runtime.run(abilityId, body.input ?? {});
        await rig.runtime.stopDaemons();
        const shieldReport = shield ? await shield.promise : null;

        send("frame", snapshot(rig));
        send("done", {
          ok: result.ok,
          summary: result.summary,
          details: shieldReport ? [shieldReport.summary] : [],
          metrics: result.metrics ?? {},
        });
      } catch (error) {
        send("done", {
          ok: false,
          summary: error instanceof Error ? error.message : String(error),
          details: [],
          metrics: {},
        });
      } finally {
        if (sampler) clearInterval(sampler);
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function describeWorld(rig: SimRig) {
  return {
    width: rig.world.width,
    height: rig.world.height,
    dock: rig.world.dock,
    obstacles: rig.world.obstacles,
  };
}

/** Occupancy as a base64 byte per cell — a tenth the size of a JSON array. */
function packMap(map: PublishedMap) {
  const bytes = Uint8Array.from(map.cells);
  return {
    resolution: map.resolution,
    origin: map.origin,
    width: map.width,
    height: map.height,
    cells: Buffer.from(bytes).toString("base64"),
  };
}

/** Every third beam: enough to draw a readable fan, a third of the bytes. */
function packLidar(rig: SimRig) {
  const scan = rig.robot.lidar();
  const stride = 3;
  const ranges: number[] = [];
  for (let i = 0; i < scan.ranges.length; i += stride) {
    ranges.push(Math.round(scan.ranges[i] * 100) / 100);
  }
  return { ranges, fov: scan.fov, maxRange: scan.maxRange, stride };
}

function snapshot(rig: SimRig) {
  const lead = rig.world.robot(rig.robot.id);
  const arm = rig.robot.arm();
  const gripper = rig.robot.gripper();

  return {
    t: rig.world.timeMs,
    robots: rig.world.allRobots().map((r) => ({
      id: r.id,
      x: r.pose.x,
      y: r.pose.y,
      theta: r.pose.theta,
      tilt: r.tilt,
      charge: r.charge,
      lights: r.lights,
      holding: r.holding,
      speed: r.linear,
      utterance: r.utterance,
    })),
    lidar: packLidar(rig),
    arm: {
      tip: rig.world.tipWorldPosition(lead),
      height: arm.height,
      closure: gripper.closure,
      force: gripper.force,
      slip: gripper.slip,
      pull: gripper.externalPull,
    },
    // How far away a person has to be for the robot's current speed to be safe.
    // Drawing this is the clearest way to show what the governor is doing.
    envelope: rig.governor.protectiveDistance(Math.abs(lead.linear)),
    humans: rig.world.humans.map((h) => ({
      id: h.id,
      x: h.at.x,
      y: h.at.y,
      attentive: h.attentive,
    })),
    objects: rig.world.objects.map((o) => ({
      id: o.id,
      label: o.label,
      x: o.at.x,
      y: o.at.y,
      held: Boolean(o.heldBy),
      damaged: Boolean(o.damaged),
    })),
    safety: rig.governor.verdict(),
  };
}
