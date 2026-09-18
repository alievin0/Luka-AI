// Exposing the robot to Claude.
//
// Every ability already carries a JSON schema, a risk class and a bilingual
// description, which is exactly what a tool definition needs — so the tool list
// is generated from the registry rather than written by hand, and a new ability
// becomes callable by the model the moment it is registered.

import type Anthropic from "@anthropic-ai/sdk";
import type { AbilityRegistry } from "../core/registry.ts";
import type { RobotRuntime } from "../core/runtime.ts";
import type { AbilityManifest, AbilityResult, RiskClass } from "../core/types.ts";

const RISK_NOTE: Record<RiskClass, string> = {
  passive: "Reads only — safe to call whenever you need the information.",
  motion: "Moves the robot. The safety governor still applies.",
  contact: "Touches the world. Refused automatically if anyone is close.",
  critical: "Emergency behaviour. Runs even under an emergency stop.",
};

/** Turn the registry into Anthropic tool definitions. */
export function abilityTools(registry: AbilityRegistry): Anthropic.Tool[] {
  return registry.manifests().map(toTool);
}

export function toTool(manifest: AbilityManifest): Anthropic.Tool {
  return {
    // Dots are not allowed in tool names; the mapping is reversed on the way in.
    name: toToolName(manifest.id),
    description: [
      manifest.summary.en,
      "",
      manifest.rationale,
      "",
      `Risk: ${manifest.risk}. ${RISK_NOTE[manifest.risk]}`,
      `Needs: ${manifest.requires.join(", ") || "no special hardware"}.`,
      manifest.daemon
        ? "This is a daemon: it runs in the background until the mission ends."
        : `Typically takes about ${(manifest.typicalDurationMs / 1000).toFixed(1)} s.`,
    ].join("\n"),
    input_schema: manifest.inputSchema as Anthropic.Tool.InputSchema,
  };
}

export function toToolName(abilityId: string): string {
  return `robot_${abilityId.replace(/[.-]/g, "_")}`;
}

export function fromToolName(toolName: string, registry: AbilityRegistry): string | null {
  return registry.ids().find((id) => toToolName(id) === toolName) ?? null;
}

export type AbilityToolResult = {
  /** Text handed back to the model as the tool result. */
  resultText: string;
  /** Structured outcome, for the UI. */
  result: AbilityResult;
  abilityId: string;
};

/**
 * Execute a tool call from the model. Daemons are started and left running;
 * everything else runs to completion and reports back.
 */
export async function executeAbilityTool(
  runtime: RobotRuntime,
  toolName: string,
  input: Record<string, unknown>,
): Promise<AbilityToolResult> {
  const abilityId = fromToolName(toolName, runtime.registry);
  if (!abilityId) {
    const known = runtime.registry.ids().map(toToolName).join(", ");
    return {
      abilityId: toolName,
      result: { ok: false, summary: `Unknown tool ${toolName}.`, failure: "not-found" },
      resultText: `There is no such ability. Available: ${known}`,
    };
  }

  const manifest = runtime.registry.require(abilityId).manifest;

  if (manifest.daemon) {
    runtime.startDaemon(abilityId, input);
    const result: AbilityResult = {
      ok: true,
      summary: `${manifest.name.en} is now running in the background.`,
    };
    return {
      abilityId,
      result,
      resultText: `${manifest.name.en} started as a background daemon. It keeps running until the mission ends; its report comes back then.`,
    };
  }

  const result = await runtime.run(abilityId, input);
  const detail = result.metrics
    ? ` Metrics: ${Object.entries(result.metrics)
        .map(([key, value]) => `${key}=${round(value)}`)
        .join(", ")}.`
    : "";

  return {
    abilityId,
    result,
    resultText: `${result.ok ? "Done" : "Failed"}: ${result.summary}${detail}${
      result.failure ? ` (reason: ${result.failure})` : ""
    }`,
  };
}

/** A system-prompt fragment describing what this particular robot can do. */
export function describeRobot(registry: AbilityRegistry, robotId: string): string {
  const lines = registry
    .manifests()
    .map((m) => `- ${toToolName(m.id)} — ${m.name.en} / ${m.name.ar}: ${m.summary.en} [${m.risk}]`);
  return [
    `You are operating robot "${robotId}". Its abilities:`,
    ...lines,
    "",
    "Rules of engagement:",
    "- The safety governor overrides you. If it slows or stops the robot, that is not a failure to work around.",
    "- Start reflex.shield before any motion, and power.lifeline before any long mission.",
    "- Rehearse anything risky with plan.rehearse first, and respect a no-go verdict.",
    "- Report what actually happened, including the numbers the abilities return.",
  ].join("\n");
}

function round(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(3);
}
