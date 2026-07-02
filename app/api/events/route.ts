import { structuredCall, missingApiKey } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type FamilyEvent = {
  title: string;
  type: "wedding" | "gathering" | "condolence" | "birthday" | "eid" | "other";
  dateISO: string; // YYYY-MM-DD
  time?: string; // HH:MM 24h, if mentioned
  location?: string;
  host?: string;
  sourceQuote: string;
  confidence: "high" | "medium" | "low";
};

type EventsPayload = { events: FamilyEvent[] };

// WhatsApp exports can be huge; keep a generous cap for the model.
const MAX_CHARS = 150_000;

const SYSTEM = `You extract family occasions from an exported WhatsApp group chat (the user exported it themselves, with the group's knowledge).

Context: in Gulf/Levantine culture, invitations are rarely formal — a wedding (عرس/زواج), dinner invitation (عزيمة/غدا/عشا), condolence gathering (عزاء/فاتحة), birthday (عيد ميلاد), or Eid gathering is simply mentioned in the group conversation ("العشا عندنا الخميس", "عرس فلان يوم ٢٥", "العزاء في ديوانية...").

Rules:
- Scan the whole chat and extract EVERY concrete upcoming occasion with enough detail to calendar it.
- WhatsApp export lines look like "MM/DD/YY, HH:MM - Sender: message" (formats vary by locale) — use each message's own timestamp to resolve relative dates ("الخميس الجاي", "بكرة", "بعد باكر", "يوم ٢٥").
- dateISO must be a real resolved calendar date. If a date truly cannot be resolved, skip the event rather than guessing wildly; if it can be reasonably inferred, include it with confidence "low" or "medium".
- Hijri dates: convert to Gregorian as best you can and lower the confidence.
- title: short and human, in the chat's language (e.g. "عزيمة عشا عند أبو خالد", "عرس محمد").
- sourceQuote: the exact message text (trimmed) the event came from, so the user can verify.
- Ignore past events relative to the provided "today" date, jokes, and vague plans with no date.
- Deduplicate: the same occasion discussed across many messages is ONE event (use the most complete details).`;

export async function POST(req: Request) {
  const keyError = missingApiKey();
  if (keyError) return keyError;

  const body = (await req.json().catch(() => null)) as {
    chat?: string;
    today?: string;
  } | null;

  const chat = (body?.chat ?? "").trim();
  if (!chat) {
    return Response.json({ error: "Missing chat text." }, { status: 400 });
  }
  const today = body?.today || new Date().toISOString().slice(0, 10);

  try {
    const result = await structuredCall<EventsPayload>({
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Today's date: ${today}\n\nExported WhatsApp group chat:\n\n${chat.slice(
            -MAX_CHARS,
          )}`,
        },
      ],
      toolName: "extracted_events",
      toolDescription: "Submit every occasion found in the chat.",
      maxTokens: 4000,
      schema: {
        type: "object",
        properties: {
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                type: {
                  type: "string",
                  enum: [
                    "wedding",
                    "gathering",
                    "condolence",
                    "birthday",
                    "eid",
                    "other",
                  ],
                },
                dateISO: { type: "string", description: "YYYY-MM-DD" },
                time: { type: "string", description: "HH:MM 24h, omit if unknown" },
                location: { type: "string" },
                host: { type: "string" },
                sourceQuote: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
              },
              required: ["title", "type", "dateISO", "sourceQuote", "confidence"],
            },
          },
        },
        required: ["events"],
      },
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
