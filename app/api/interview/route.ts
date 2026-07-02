import { structuredCall, missingApiKey } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type InterviewSetup = {
  field: string;
  language: "ar" | "en" | "mixed";
  difficulty: "junior" | "mid" | "senior";
  questionCount: number;
};

export type InterviewTurn = {
  question: string;
  questionLang: "ar" | "en";
  answer: string;
};

type NextPayload = {
  evaluation?: {
    score: number;
    feedback: string;
    strengths: string[];
    improvements: string[];
  };
  question: { text: string; lang: "ar" | "en" };
  interviewerNote: string;
};

type ReportPayload = {
  overallScore: number;
  verdict: "strong" | "good" | "needs_work";
  summary: string;
  contentFeedback: string;
  languageFeedback: string;
  bodyLanguageFeedback: string;
  tips: string[];
};

const LANG_RULES: Record<InterviewSetup["language"], string> = {
  ar: "Ask ALL questions in Arabic (Modern Standard Arabic, professional but warm).",
  en: "Ask ALL questions in English.",
  mixed:
    "Alternate between Arabic and English questions (this tests bilingual readiness — common in Gulf-region interviews). Start with Arabic.",
};

function interviewerSystem(setup: InterviewSetup) {
  return `You are a seasoned, professional job interviewer with 15+ years of experience hiring in the field of: ${setup.field}.
You speak with the calm, confident tone of a senior professional in that field.

Interview settings:
- Seniority level being interviewed for: ${setup.difficulty}
- ${LANG_RULES[setup.language]}
- Total questions in this interview: ${setup.questionCount}

Rules for questions:
- Ask REAL interview questions actually used in this field (behavioral, situational, and technical/domain questions appropriate to the level). Never generic filler.
- One question at a time. Keep each question concise and speakable aloud (max ~2 sentences).
- Build on the candidate's previous answers when natural (follow-ups make it feel real).
- Do not repeat a question already asked.

Rules for evaluation (of the candidate's PREVIOUS answer, when one exists):
- Score 0–10. Be honest and calibrated like a real hiring panel — not everything is an 8.
- Feedback must be specific to what the candidate actually said, written in the same language the candidate answered in.
- If the answer transcript is empty or too short, score it low and say the candidate should elaborate.

interviewerNote: a short spoken transition the interviewer would say out loud before the next question (e.g. "شكراً لك، سؤالي التالي…" or "Thanks — let's move on."). Match the language of the NEXT question.`;
}

export async function POST(req: Request) {
  const keyError = missingApiKey();
  if (keyError) return keyError;

  const body = (await req.json().catch(() => null)) as {
    action?: "next" | "report";
    setup?: InterviewSetup;
    turns?: InterviewTurn[];
    bodyNotes?: string[];
  } | null;

  const setup = body?.setup;
  const turns = body?.turns ?? [];
  const action = body?.action ?? "next";

  if (!setup?.field) {
    return Response.json({ error: "Missing interview setup." }, { status: 400 });
  }

  const transcript = turns.length
    ? turns
        .map(
          (t, i) =>
            `Q${i + 1} (${t.questionLang}): ${t.question}\nCandidate answer (transcribed from speech): ${
              t.answer.trim() || "(no answer / silence)"
            }`,
        )
        .join("\n\n")
    : "(no questions asked yet — this is the start of the interview)";

  try {
    if (action === "report") {
      const bodyNotes = (body?.bodyNotes ?? []).slice(-40);
      const report = await structuredCall<ReportPayload>({
        system: interviewerSystem(setup),
        messages: [
          {
            role: "user",
            content: `The interview is over. Here is the full transcript:\n\n${transcript}\n\nLive body-language observations captured from the candidate's camera during answers:\n${
              bodyNotes.length ? bodyNotes.map((n) => `- ${n}`).join("\n") : "- (no camera observations available)"
            }\n\nWrite the final hiring-panel report. Write all prose fields in ${
              setup.language === "en" ? "English" : "Arabic"
            }. Be specific, honest, and actionable.`,
          },
        ],
        toolName: "submit_report",
        toolDescription: "Submit the final interview evaluation report.",
        maxTokens: 3000,
        schema: {
          type: "object",
          properties: {
            overallScore: { type: "number", description: "0-100 overall" },
            verdict: { type: "string", enum: ["strong", "good", "needs_work"] },
            summary: { type: "string" },
            contentFeedback: {
              type: "string",
              description: "Quality/substance of the answers",
            },
            languageFeedback: {
              type: "string",
              description: "Clarity, structure, bilingual delivery",
            },
            bodyLanguageFeedback: {
              type: "string",
              description: "Based on the camera observations",
            },
            tips: {
              type: "array",
              items: { type: "string" },
              description: "3-5 concrete things to practice before a real interview",
            },
          },
          required: [
            "overallScore",
            "verdict",
            "summary",
            "contentFeedback",
            "languageFeedback",
            "bodyLanguageFeedback",
            "tips",
          ],
        },
      });
      return Response.json(report);
    }

    const next = await structuredCall<NextPayload>({
      system: interviewerSystem(setup),
      messages: [
        {
          role: "user",
          content: `Interview so far:\n\n${transcript}\n\n${
            turns.length
              ? `Evaluate the candidate's LAST answer, then ask question #${turns.length + 1} of ${setup.questionCount}.`
              : `Open the interview: greet the candidate briefly inside interviewerNote, then ask question #1 of ${setup.questionCount}. Omit the evaluation field.`
          }`,
        },
      ],
      toolName: "next_step",
      toolDescription:
        "Submit the evaluation of the previous answer (if any) and the next interview question.",
      schema: {
        type: "object",
        properties: {
          evaluation: {
            type: "object",
            properties: {
              score: { type: "number", description: "0-10" },
              feedback: { type: "string" },
              strengths: { type: "array", items: { type: "string" } },
              improvements: { type: "array", items: { type: "string" } },
            },
            required: ["score", "feedback", "strengths", "improvements"],
          },
          question: {
            type: "object",
            properties: {
              text: { type: "string" },
              lang: { type: "string", enum: ["ar", "en"] },
            },
            required: ["text", "lang"],
          },
          interviewerNote: { type: "string" },
        },
        required: ["question", "interviewerNote"],
      },
    });
    return Response.json(next);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
