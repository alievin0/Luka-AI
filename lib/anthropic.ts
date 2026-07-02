import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.LUKA_MODEL || "claude-opus-4-8";

/**
 * Calls Claude with a single forced tool so the reply is guaranteed to be
 * structured JSON matching `schema` (no free-text parsing needed).
 */
export async function structuredCall<T>(opts: {
  system: string;
  messages: Anthropic.MessageParam[];
  toolName: string;
  toolDescription: string;
  schema: Anthropic.Tool.InputSchema;
  maxTokens?: number;
}): Promise<T> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: opts.messages,
    tools: [
      {
        name: opts.toolName,
        description: opts.toolDescription,
        input_schema: opts.schema,
      },
    ],
    tool_choice: { type: "tool", name: opts.toolName },
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Model did not return structured output.");
  }
  return block.input as T;
}

/** Returns an error Response when the API key is missing, else null. */
export function missingApiKey(): Response | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          "Server is missing ANTHROPIC_API_KEY. Add it to .env.local and restart.",
      },
      { status: 500 },
    );
  }
  return null;
}
