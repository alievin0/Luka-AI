// Streams a robot mission to the browser.
//
// The kernel already emits telemetry as it works; this route adds world frames
// so the page can draw what is happening, and runs the mission at a chosen
// multiple of wall-clock speed so it is watchable rather than instant.

import { NextRequest } from "next/server";
import { createSimRig, SCENARIOS, type ScenarioName } from "@/lib/robotics/index.ts";
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

      const bindRig = (rig: SimRig) => {
        if (sampler) clearInterval(sampler);
        send("setup", describeWorld(rig));
        sampler = setInterval(() => send("frame", snapshot(rig)), 60);
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
          });
          send("done", outcome);
          return;
        }

        const rig = createSimRig({
          scenario: body.scenario ?? "cluttered-office",
          seed: body.seed,
          realtimeFactor: speed,
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

function snapshot(rig: SimRig) {
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
