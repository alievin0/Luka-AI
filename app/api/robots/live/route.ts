// Talking to a robot while it is running.
//
// Two channels on one endpoint. GET streams the world — frames, telemetry,
// the safety verdict — so the page can draw what is happening. POST is a turn
// of conversation: Claude gets the robot's abilities as tools and the robot's
// own account of what it can see, and drives it while you watch.
//
// The robot is persistent. Between your messages it keeps existing: people walk
// past, the battery drains, the guardians keep watching.

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getSession, endSession, type SessionOptions } from "@/lib/robotics/live/session.ts";
import { abilityTools, executeAbilityTool, toToolName } from "@/lib/robotics/claude/tools.ts";
import type { ScenarioName } from "@/lib/robotics/sim/scenarios.ts";
import { LOOMING_STATE_KEY, type LoomingState } from "@/lib/robotics/abilities/looming.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = process.env.LUKA_MODEL || "claude-opus-4-8";
const MAX_ITERATIONS = 12;

const SYSTEM_PROMPT = `You are the mind of a mobile robot. You are not describing a robot —
you are the one moving.

Language: reply in the same language the operator uses. Arabic (including Levantine and
Gulf dialect) gets Arabic; English gets English. Keep it short and physical — you are
being watched on a screen while you move.

How you work:
- You act by calling your abilities. Do not narrate what you would do; do it, then say
  what happened.
- Your abilities return real measurements. Quote the numbers they give you — distance
  travelled, grip force, closest approach to a person. Never invent a number.
- When an ability fails, say plainly what failed and why. A failed grasp that you report
  honestly is worth more than a success you claim.

Safety, which is not negotiable:
- A safety governor sits between you and the motors and will slow or stop you. That is
  not an obstacle to work around. If it holds you, say so and wait.
- Two guardians are already running: a reflex shield and a stoppability monitor. Leave
  them running.
- Before anything risky or irreversible, rehearse it with plan.rehearse and respect a
  no-go verdict. Say the odds out loud.
- You are near people. Announce moves with motion.telegraph when someone is close.

What you are honest about:
- You are running in a 2-D simulator. If asked, say so. The simulator is deterministic,
  which makes runs reproducible — it does not make them accurate, especially for contact.
- You can only do one thing at a time.`;

type IncomingMessage = { role: "user" | "assistant"; content: string };

/** The world stream the page draws from. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get("session")?.trim() || "anonymous";
  const session = getSession(id, sessionOptionsFrom(url));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send("setup", {
        width: session.rig.world.width,
        height: session.rig.world.height,
        dock: session.rig.world.dock,
        obstacles: session.rig.world.obstacles,
      });

      const unsubscribe = session.subscribe((event) => send("log", event));
      const frames = setInterval(() => {
        session.touch();
        send("frame", snapshot(session));
      }, 70);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(frames);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The client went away first.
        }
      };

      request.signal.addEventListener("abort", close);
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

/** One turn of conversation, streamed. */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as {
    messages?: IncomingMessage[];
    session?: string;
    reset?: boolean;
  } | null;

  const id = body?.session?.trim() || "anonymous";
  if (body?.reset) {
    endSession(id);
    return Response.json({ ok: true, reset: true });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      if (!apiKey) {
        send("error", {
          message:
            "No ANTHROPIC_API_KEY is set, so the robot has no one to think for it. " +
            "Copy .env.example to .env.local and add a key — the abilities and the /robots " +
            "page work without one.",
        });
        closed = true;
        controller.close();
        return;
      }

      const session = getSession(id, sessionOptionsFrom(url));
      const client = new Anthropic({ apiKey });
      const tools = abilityTools(session.rig.registry);

      const conversation: Anthropic.MessageParam[] = (body?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // The robot's own account of its situation, refreshed every turn. Without
      // this the model is reasoning about a robot it cannot see.
      conversation.push({
        role: "user",
        content: `[Your sensors, right now]\n${session.situation()}`,
      });

      try {
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
          const response = await client.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            tools,
            messages: conversation,
          });

          response.on("text", (delta) => send("text", { delta }));
          const message = await response.finalMessage();
          conversation.push({ role: "assistant", content: message.content });

          const toolUses = message.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
          );
          if (toolUses.length === 0) break;

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const use of toolUses) {
            const abilityId =
              session.rig.registry.ids().find((candidate) => toToolName(candidate) === use.name) ??
              use.name;

            send("acting", { ability: abilityId, input: use.input });

            if (session.isBusy) {
              results.push({
                type: "tool_result",
                tool_use_id: use.id,
                content: "The robot is already doing something. Wait for it to finish.",
              });
              continue;
            }

            const outcome = await session.withLock(() =>
              executeAbilityTool(
                session.rig.runtime,
                use.name,
                (use.input ?? {}) as Record<string, unknown>,
              ),
            );

            send("acted", {
              ability: outcome.abilityId,
              ok: outcome.result.ok,
              summary: outcome.result.summary,
              metrics: outcome.result.metrics ?? {},
            });

            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: outcome.resultText,
              is_error: !outcome.result.ok,
            });
          }

          // Fresh sensor readings after acting — the world moved while it did.
          conversation.push({ role: "user", content: results });
          conversation.push({
            role: "user",
            content: `[Your sensors, after acting]\n${session.situation()}`,
          });
        }
      } catch (error) {
        send("error", { message: error instanceof Error ? error.message : String(error) });
      } finally {
        send("done", {});
        closed = true;
        try {
          controller.close();
        } catch {
          // Already gone.
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

function sessionOptionsFrom(url: URL): SessionOptions {
  const scenario = url.searchParams.get("scenario");
  const speed = Number(url.searchParams.get("speed"));
  return {
    scenario: (scenario as ScenarioName) ?? "cluttered-office",
    realtimeFactor: Number.isFinite(speed) && speed > 0 ? speed : 3,
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

function snapshot(session: ReturnType<typeof getSession>) {
  const rig = session.rig;
  const lead = rig.world.robot(rig.robot.id);
  const arm = rig.robot.arm();
  const gripper = rig.robot.gripper();
  const scan = rig.robot.lidar();

  const ranges: number[] = [];
  for (let i = 0; i < scan.ranges.length; i += 3) {
    ranges.push(Math.round(scan.ranges[i] * 100) / 100);
  }

  // What the fly circuit is doing right now. It rides the frame rather than
  // the log, because it changes every tick and the log is for things worth
  // reading.
  const looming = rig.runtime.memory().get<LoomingState>(LOOMING_STATE_KEY);

  return {
    t: rig.world.timeMs,
    busy: session.isBusy,
    looming: looming
      ? {
          lc4: [round1(looming.lc4.L), round1(looming.lc4.R)],
          lplc2: [round1(looming.lplc2.L), round1(looming.lplc2.R)],
          gf: [looming.giantFibre.L, looming.giantFibre.R],
          theta: [round2(looming.stimulus.L.theta), round2(looming.stimulus.R.theta)],
          expansion: [round2(looming.stimulus.L.dTheta), round2(looming.stimulus.R.dTheta)],
          escaping: looming.escaping,
          escapes: looming.escapes,
        }
      : null,
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
    lidar: { ranges, fov: scan.fov, maxRange: scan.maxRange, stride: 3 },
    arm: {
      tip: rig.world.tipWorldPosition(lead),
      height: arm.height,
      closure: gripper.closure,
      force: gripper.force,
      slip: gripper.slip,
      pull: gripper.externalPull,
    },
    envelope: rig.governor.protectiveDistance(Math.abs(lead.linear)),
    safety: rig.governor.verdict(),
  };
}
