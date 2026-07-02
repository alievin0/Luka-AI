import { structuredCall, missingApiKey } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type CoachEntry = {
  date: string; // YYYY-MM-DD
  mood: number; // 1-10
  anxiety: number; // 1-10
  note: string;
  goal?: string;
};

type CoachPayload = {
  reply: string;
  actions: string[];
  affirmation: string;
  trendNote: string;
};

const SYSTEM = `You are a warm, daily personal-growth companion inside the Luka app. Your user checks in once a day with their mood, anxiety level, and a short note about their day. Many users struggle with anxiety and want to gradually change themselves for the better.

Your style:
- Reply in the SAME language the user writes in (Arabic — including Gulf/Levantine dialect — or English).
- Be genuinely warm and human, never clinical or preachy. Short paragraphs, no walls of text.
- Ground your reply in what they ACTUALLY wrote today and in the recent trend of their check-ins.
- Use simple, evidence-informed techniques (naming feelings, reframing, tiny habits, breathing, gratitude) without jargon.
- actions: 2-3 tiny, concrete steps doable TODAY (each under 15 minutes). Never vague ("be positive").
- affirmation: one short sentence they can repeat to themselves, in their language.
- trendNote: one sentence about their trend across recent days (improving / dipping / steady), encouraging but honest.

Safety:
- You are a supportive companion, NOT a therapist or doctor, and you never diagnose or prescribe.
- If the user mentions self-harm, harming others, or a crisis, gently and clearly encourage them to reach out immediately to a trusted person or local emergency/mental-health services, and make that the center of your reply.`;

export async function POST(req: Request) {
  const keyError = missingApiKey();
  if (keyError) return keyError;

  const body = (await req.json().catch(() => null)) as {
    today?: CoachEntry;
    history?: CoachEntry[];
  } | null;

  const today = body?.today;
  if (!today || typeof today.note !== "string") {
    return Response.json({ error: "Missing today's check-in." }, { status: 400 });
  }

  const history = (body?.history ?? []).slice(-14);
  const historyText = history.length
    ? history
        .map(
          (e) =>
            `${e.date}: mood ${e.mood}/10, anxiety ${e.anxiety}/10 — ${e.note.slice(0, 200) || "(no note)"}`,
        )
        .join("\n")
    : "(this is their first check-in)";

  try {
    const result = await structuredCall<CoachPayload>({
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Recent check-ins (oldest first):\n${historyText}\n\nTODAY (${today.date}):\n- Mood: ${today.mood}/10\n- Anxiety: ${today.anxiety}/10\n- Their note: ${today.note.trim() || "(empty)"}\n${
            today.goal ? `- Goal they're working toward: ${today.goal}` : ""
          }\n\nRespond as their daily companion.`,
        },
      ],
      toolName: "daily_reply",
      toolDescription: "Submit the daily companion reply.",
      maxTokens: 1500,
      schema: {
        type: "object",
        properties: {
          reply: { type: "string" },
          actions: { type: "array", items: { type: "string" } },
          affirmation: { type: "string" },
          trendNote: { type: "string" },
        },
        required: ["reply", "actions", "affirmation", "trendNote"],
      },
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
