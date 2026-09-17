#!/usr/bin/env node
// Command line for the robotics kernel.
//
//   npm run robo -- list
//   npm run robo -- demo
//   npm run robo -- demo feel-it-out
//   npm run robo -- run navigate.to '{"x":12,"y":8}' --scenario cluttered-office
//
// Everything runs in simulation, so none of it needs hardware or an API key.

import { createSimRig, type ScenarioName, SCENARIOS } from "../lib/robotics/index.ts";
import { runDemo, DEMOS, type DemoName } from "../lib/robotics/demos.ts";
import type { AbilityEvent } from "../lib/robotics/core/types.ts";

function printEvent(event: AbilityEvent): void {
  const t = `${(event.t / 1000).toFixed(1).padStart(7)}s`;
  switch (event.kind) {
    case "status":
      console.log(`${t}  ${event.message}`);
      break;
    case "safety":
      console.log(`${t}  [safety:${event.level}] ${event.reason}`);
      break;
    case "warn":
      console.log(`${t}  !  ${event.message}`);
      break;
    case "signal":
      console.log(`${t}  (${event.channel}) ${event.payload}`);
      break;
    case "metric":
      console.log(`${t}  ${event.name} = ${event.value.toFixed(3)}${event.unit ?? ""}`);
      break;
    case "result":
      console.log(`${t}  ${event.ok ? "+" : "x"} ${event.summary}`);
      break;
    default:
      break;
  }
}

const HELP = `Luka robotics kernel

  list                         every ability, with risk class and hardware needs
  scenarios                    the worlds you can run in
  demos                        the scripted demonstrations
  run <ability> [json]         run one ability
  demo [name]                  run a demonstration (default: all of them)

Flags:
  --scenario <name>            which world to run in
  --seed <n>                   fix the random seed
  --quiet                      results only, no telemetry`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help") {
    console.log(HELP);
    return;
  }

  if (command === "list") {
    const rig = createSimRig({ scenario: "empty-hall" });
    for (const manifest of rig.registry.manifests()) {
      console.log(`${manifest.id.padEnd(20)} ${manifest.risk.padEnd(9)} ${manifest.name.ar}`);
      console.log(`  ${manifest.summary.en}`);
      console.log(`  needs: ${manifest.requires.join(", ") || "nothing"}\n`);
    }
    return;
  }

  if (command === "scenarios") {
    for (const s of Object.values(SCENARIOS)) {
      console.log(`${s.name.padEnd(18)} ${s.title.ar}`);
      console.log(`  ${s.description}\n`);
    }
    return;
  }

  if (command === "demos") {
    for (const [name, demo] of Object.entries(DEMOS)) {
      console.log(`${name.padEnd(18)} ${demo.title.ar}`);
      console.log(`  ${demo.blurb}\n`);
    }
    return;
  }

  const flag = (name: string): string | undefined => {
    const index = rest.indexOf(`--${name}`);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  const quiet = rest.includes("--quiet");
  const scenario = (flag("scenario") ?? "cluttered-office") as ScenarioName;
  const seed = flag("seed") ? Number(flag("seed")) : undefined;

  if (command === "demo") {
    const requested = rest.find((arg) => !arg.startsWith("--")) as DemoName | undefined;
    const names = requested ? [requested] : (Object.keys(DEMOS) as DemoName[]);
    let allPassed = true;

    for (const name of names) {
      const demo = DEMOS[name];
      if (!demo) {
        console.error(`Unknown demo "${name}". Try: ${Object.keys(DEMOS).join(", ")}`);
        process.exitCode = 1;
        return;
      }
      console.log(`\n=== ${name} - ${demo.title.en} / ${demo.title.ar}`);
      console.log(`${demo.blurb}\n`);

      const outcome = await runDemo(name, { seed, onEvent: quiet ? undefined : printEvent });
      allPassed = allPassed && outcome.ok;
      console.log(`\n${outcome.ok ? "PASS" : "FAIL"}  ${outcome.summary}`);
      for (const [key, value] of Object.entries(outcome.metrics)) {
        console.log(`      ${key} = ${value.toFixed(3)}`);
      }
    }

    process.exitCode = allPassed ? 0 : 1;
    return;
  }

  if (command === "run") {
    const abilityId = rest[0];
    const raw = rest[1] && !rest[1].startsWith("--") ? rest[1] : "{}";
    if (!abilityId) {
      console.error("Which ability? Try `list`.");
      process.exitCode = 1;
      return;
    }

    const rig = createSimRig({ scenario, seed });
    if (!rig.registry.has(abilityId)) {
      console.error(`Unknown ability "${abilityId}". Known: ${rig.registry.ids().join(", ")}`);
      process.exitCode = 1;
      return;
    }
    if (!quiet) rig.runtime.on(printEvent);

    // Anything that moves runs with the shield up — the same rule the agent follows.
    const risky = rig.registry.require(abilityId).manifest.risk !== "passive";
    const shield = risky ? rig.runtime.startDaemon("reflex.shield", {}) : null;

    const result = await rig.runtime.run(abilityId, JSON.parse(raw));
    await rig.runtime.stopDaemons();
    if (shield) console.log(`\nshield: ${(await shield.promise).summary}`);

    console.log(`\n${result.ok ? "+" : "x"} ${result.summary}`);
    if (result.data) {
      console.log(JSON.stringify(result.data, null, 2).slice(0, 1500));
    }
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  console.error(`Unknown command "${command}". Try \`help\`.`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
