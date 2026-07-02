import Anthropic from "@anthropic-ai/sdk";
import { structuredCall, missingApiKey } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All-day monitoring: the client samples a camera frame every few minutes and
// aggregates voice-tone metrics locally (volume, pitch, speaking time) between
// samples — only the frame + numeric metrics reach the server, never audio.

export type VoiceMetrics = {
  speakingSeconds: number;
  windowSeconds: number;
  avgVolume: number; // 0-1 RMS while speaking
  pitchAvgHz: number; // 0 when no voiced speech detected
  pitchVariance: number; // low = monotone, high = expressive
};

export type MonitorSample = {
  time: string; // HH:MM
  postureScore: number;
  postureTip: string;
  toneNote: string;
};

type SamplePayload = {
  postureScore: number;
  postureTip: string;
  toneNote: string;
  severity: "good" | "warn";
};

type SummaryPayload = {
  overallScore: number;
  postureSummary: string;
  voiceSummary: string;
  habits: string[];
  recommendations: string[];
  encouragement: string;
};

const SAMPLE_SYSTEM = `You are an all-day wellness coach. The user opted in to have their camera and mic monitored throughout the day to improve their posture and voice tone (they often work at a desk and want to change themselves for the better).

You receive ONE camera frame plus numeric voice metrics aggregated locally since the last sample (no audio is ever sent).

Rules:
- postureScore 0-10 from the frame: spine/neck alignment, slouching, head-forward posture, distance from screen, tension in shoulders. If no person or too dark, score 5 and say the view is unclear.
- postureTip: ONE short Arabic sentence (max ~10 words) — the single most useful correction or reinforcement right now.
- toneNote: ONE short Arabic sentence about their voice since last sample, based ONLY on the metrics (e.g. long silence, speaking very quietly, monotone pitch, good expressive variety). If speakingSeconds is ~0, note they've been quiet — that's fine, keep it neutral.
- severity: "warn" if posture needs fixing now, else "good".
- Never comment on appearance, identity, or surroundings — only coachable behavior.`;

const SUMMARY_SYSTEM = `You are an all-day wellness coach writing the end-of-day analysis for a user who monitored their posture (camera) and voice tone (local mic metrics) throughout the day because they want to improve themselves.

Write ALL prose in Arabic, warm and specific — like a coach who actually watched their whole day.

- overallScore: 0-100 for the day (posture consistency + healthy voice habits).
- postureSummary: patterns across the day (when did they slouch — morning vs evening? did tips help?).
- voiceSummary: speaking time, volume, monotony vs expressiveness across the day.
- habits: 2-4 recurring habits you noticed (good or bad), each one short sentence.
- recommendations: 3-5 concrete changes for tomorrow (desk setup, break timing, voice exercises) — each doable and specific.
- encouragement: one warm closing line acknowledging their effort to change.`;

export async function POST(req: Request) {
  const keyError = missingApiKey();
  if (keyError) return keyError;

  const body = (await req.json().catch(() => null)) as {
    action?: "sample" | "summary";
    frame?: string;
    voice?: VoiceMetrics;
    log?: MonitorSample[];
    sessionStart?: string;
  } | null;

  if (!body) return Response.json({ error: "Bad request." }, { status: 400 });

  try {
    if (body.action === "summary") {
      const log = (body.log ?? []).slice(-200);
      if (!log.length) {
        return Response.json({ error: "No samples recorded yet." }, { status: 400 });
      }
      const logText = log
        .map(
          (s) =>
            `${s.time} — posture ${s.postureScore}/10 (${s.postureTip}) · voice: ${s.toneNote}`,
        )
        .join("\n");
      const summary = await structuredCall<SummaryPayload>({
        system: SUMMARY_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Monitoring session started at ${body.sessionStart ?? "?"}. Timeline of samples:\n\n${logText}\n\nWrite the full end-of-day analysis.`,
          },
        ],
        toolName: "day_summary",
        toolDescription: "Submit the end-of-day monitoring analysis.",
        maxTokens: 2500,
        schema: {
          type: "object",
          properties: {
            overallScore: { type: "number" },
            postureSummary: { type: "string" },
            voiceSummary: { type: "string" },
            habits: { type: "array", items: { type: "string" } },
            recommendations: { type: "array", items: { type: "string" } },
            encouragement: { type: "string" },
          },
          required: [
            "overallScore",
            "postureSummary",
            "voiceSummary",
            "habits",
            "recommendations",
            "encouragement",
          ],
        },
      });
      return Response.json(summary);
    }

    // action: "sample"
    if (!body.frame) {
      return Response.json({ error: "Missing camera frame." }, { status: 400 });
    }
    const v = body.voice;
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: body.frame },
      },
      {
        type: "text",
        text: v
          ? `Voice metrics since last sample (${Math.round(v.windowSeconds)}s window): spoke ${Math.round(
              v.speakingSeconds,
            )}s, avg volume ${v.avgVolume.toFixed(2)} (0-1), avg pitch ${Math.round(
              v.pitchAvgHz,
            )}Hz, pitch variance ${v.pitchVariance.toFixed(1)} (low=monotone).`
          : "No voice metrics for this window (mic off).",
      },
    ];
    const sample = await structuredCall<SamplePayload>({
      system: SAMPLE_SYSTEM,
      messages: [{ role: "user", content }],
      toolName: "monitor_sample",
      toolDescription: "Submit the posture/voice assessment for this sample.",
      maxTokens: 500,
      schema: {
        type: "object",
        properties: {
          postureScore: { type: "number" },
          postureTip: { type: "string" },
          toneNote: { type: "string" },
          severity: { type: "string", enum: ["good", "warn"] },
        },
        required: ["postureScore", "postureTip", "toneNote", "severity"],
      },
    });
    return Response.json(sample);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
