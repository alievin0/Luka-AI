export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ElevenLabs text-to-speech for the interviewer's voice.
// Works out of the box with a premade professional voice; to give the
// interviewer a cloned professional voice in your field, clone it in
// ElevenLabs and set ELEVENLABS_VOICE_ID to that voice's id.
//
// When ELEVENLABS_API_KEY is not set, GET reports { enabled: false } and the
// client falls back to the browser's SpeechSynthesis.

const DEFAULT_VOICE_ID = "onwK4e9ZLuTAKqWW03F9"; // "Daniel" — calm, senior tone
const MAX_TEXT_CHARS = 1200;

export async function GET() {
  return Response.json({ enabled: Boolean(process.env.ELEVENLABS_API_KEY) });
}

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY is not set — falling back to browser TTS." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text) {
    return Response.json({ error: "Missing text." }, { status: 400 });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text.slice(0, MAX_TEXT_CHARS),
        model_id: modelId, // multilingual: same voice speaks Arabic and English
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.75,
          style: 0.2,
        },
      }),
    },
  );

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { error: `ElevenLabs request failed (${res.status}): ${detail.slice(0, 300)}` },
      { status: 502 },
    );
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
