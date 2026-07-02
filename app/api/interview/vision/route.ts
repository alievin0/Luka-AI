import Anthropic from "@anthropic-ai/sdk";
import { structuredCall, missingApiKey } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VisionPayload = {
  tips: { severity: "good" | "warn"; text: string }[];
  postureScore: number;
};

const SYSTEM = `You are a real-time body-language coach watching a candidate answer a job-interview question through their webcam.

You receive a single camera frame. Analyze ONLY what is visible: posture, facial expression, eye direction (looking at camera vs away), hand position, distance/framing, lighting.

Rules:
- Give 1-3 ultra-short tips in Arabic (max ~8 words each) that can be flashed on screen while the person is still talking.
- severity "warn" = something to fix now (slouching, looking away, hand covering face, too close/far, frowning).
- severity "good" = brief positive reinforcement (good eye contact, upright posture, natural smile).
- postureScore: 0-10 overall impression of this frame.
- Never comment on the person's appearance, identity, ethnicity, age, or attractiveness — only coachable behavior.
- If the frame is too dark/empty to judge, return one warn tip saying the camera view is unclear.`;

export async function POST(req: Request) {
  const keyError = missingApiKey();
  if (keyError) return keyError;

  const body = (await req.json().catch(() => null)) as {
    frame?: string; // base64 JPEG, no data: prefix
    field?: string;
    question?: string;
  } | null;

  if (!body?.frame) {
    return Response.json({ error: "Missing camera frame." }, { status: 400 });
  }

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: body.frame,
      },
    },
    {
      type: "text",
      text: `Interview field: ${body.field || "general"}. The candidate is currently answering: "${
        body.question || "(unknown question)"
      }". Analyze this frame and give live tips.`,
    },
  ];

  try {
    const result = await structuredCall<VisionPayload>({
      system: SYSTEM,
      messages: [{ role: "user", content }],
      toolName: "body_language_tips",
      toolDescription: "Submit live body-language tips for the current frame.",
      maxTokens: 600,
      schema: {
        type: "object",
        properties: {
          tips: {
            type: "array",
            items: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["good", "warn"] },
                text: { type: "string" },
              },
              required: ["severity", "text"],
            },
          },
          postureScore: { type: "number" },
        },
        required: ["tips", "postureScore"],
      },
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
